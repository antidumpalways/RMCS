import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { MAX_UPDATE_ATTEMPTS, allowedTelegramGroup, authorizedTelegramGroupSender, callbackBelongsToActor, duplicateUpdateDisposition, formatTelegramRupiah, parseTelegramCallback, parseTelegramCommand, telegramId } from './core';
import { classifyShiftIntent, matchCorrectionPosting, worthClassifying, type ShiftIntent } from './shift-intent';
import { answerTelegramCallback, deleteTelegramMessage, sendTelegramMessage, tryAnswerTelegramCallback, type InlineKeyboard } from './client';
import { applyExtraction, buildAggregateReport, inputDuplicateKey, canFinalizeRecap, emptyRecap, extractRecapMessage, parseIndonesianRupiah, recapIssues, recapTotals, type RecapDraft } from './recap';
import { correctTelegramPhotoFromText, handleTelegramPhoto, handleTelegramVisionCallback, sendLatestPhotoReview, visionCallbackFromData } from './photo-flow';
import { calculateUnrecordedQuantity, correctedStockDeduction, correctionDelta, inventoryCallback, parseInventoryCallback, parseStockCountLines, type InventoryCallbackAction } from './inventory';
import { prepareInventoryReview, postTelegramInventory, inventoryPreview, TelegramInventoryError } from '@/lib/services/telegram-inventory';
import { cashOnHandAt, shiftOpening } from '@/lib/automation';
import { combinedBalanceAt, recordedCombinedMovementsBetween, setCombinedBalance } from '@/lib/services/combined-balance';
import { identifyTelegramActor, configuredTelegramOwners, type TelegramActor } from './identity';
import { handleGroupAssistantMessage, handleOwnerCallback, handleOwnerMessage } from './owner-assistant';
import { authorizedOwnerPrivateChat } from './owner-intent';
import { isImplicitCatalogQuestion, lateEntryText, looksLikeCatalogQuestion, removeBotMention, splitRecapStart, stripRecapHeader } from './group-routing';
import { isLikelySaleNote } from './item-line';
import type { Prisma } from '@prisma/client';
import { applyLateEntry } from '@/lib/services/telegram-late-entry';

type TelegramChat={id:number;type:string};
type TelegramUser={id:number;first_name?:string;last_name?:string;username?:string;is_bot?:boolean};
type TelegramPhoto={file_id:string;file_unique_id:string;width:number;height:number;file_size?:number};
type TelegramDocument={file_id:string;file_unique_id:string;file_name?:string;mime_type?:string;file_size?:number};
type TelegramMessage={message_id:number;chat:TelegramChat;from?:TelegramUser;sender_chat?:TelegramChat;text?:string;caption?:string;photo?:TelegramPhoto[];document?:TelegramDocument;media_group_id?:string;reply_to_message?:{message_id:number;from?:TelegramUser}};
type TelegramCallback={id:string;from:TelegramUser;data?:string;message?:TelegramMessage};
type TelegramUpdate={update_id:number;message?:TelegramMessage;callback_query?:TelegramCallback};
const SESSION_TTL=12*60*60_000, UPDATE_LEASE=2*60_000;
function secretMatches(a:string|null,b:string){return !!a&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
class TelegramUpdateBusy extends Error{}
async function claimUpdate(updateId:bigint):Promise<'CLAIMED'|'PROCESSED'|'BUSY'>{
 const now=new Date(),leaseUntil=new Date(now.getTime()+UPDATE_LEASE);
 try{await prisma.telegramUpdate.create({data:{updateId,status:'PROCESSING',leaseUntil}});return 'CLAIMED';}
 catch(e){if((e as {code?:string}).code!=='P2002')throw e;}
 const reclaimed=await prisma.telegramUpdate.updateMany({where:{updateId,attempts:{lt:MAX_UPDATE_ATTEMPTS},OR:[{status:'FAILED'},{status:'PROCESSING',leaseUntil:{lt:now}}]},data:{status:'PROCESSING',attempts:{increment:1},leaseUntil,lastError:null}});
 if(reclaimed.count===1)return 'CLAIMED';
 const current=await prisma.telegramUpdate.findUnique({where:{updateId},select:{status:true,leaseUntil:true,attempts:true,lastError:true}});
 const disposition=duplicateUpdateDisposition(current?.status??null,current?.leaseUntil??null,now,current?.attempts??0);
 // Pesan yang gagal berulang kali ditandai DEAD (dilewati) dan owner diberi tahu sekali.
 if(disposition==='PROCESSED'&&current&&current.status!=='PROCESSED'&&current.status!=='DEAD'){
  const dead=await prisma.telegramUpdate.updateMany({where:{updateId,status:current.status},data:{status:'DEAD',leaseUntil:null}});
  if(dead.count===1)await notifyOwnersText('⚠️ Satu pesan Telegram gagal diproses '+MAX_UPDATE_ATTEMPTS+' kali dan dilewati (update '+updateId.toString()+'). Penyebab terakhir: '+(current.lastError??'tidak diketahui')+'\nMinta karyawan mengirim ulang pesannya bila perlu.').catch(()=>{});
 }
 return disposition;
}
function groupAllowed(c:TelegramChat){return allowedTelegramGroup(c.id,c.type,process.env.TELEGRAM_ALLOWED_GROUP_IDS);}
async function sendLongTelegramMessage(chatId:bigint|number,text:string,replyMarkup?:InlineKeyboard){
 if(text.length<=3900)return sendTelegramMessage(chatId,text,replyMarkup);
 const chunks:string[]=[];let rest=text;
 while(rest.length>3500){let end=rest.lastIndexOf('\n',3500);if(end<1500)end=3500;chunks.push(rest.slice(0,end));rest=rest.slice(end).replace(/^\n+/, '');}
 chunks.push(rest);for(const chunk of chunks.slice(0,-1))await sendTelegramMessage(chatId,chunk);
 return sendTelegramMessage(chatId,chunks[chunks.length-1],replyMarkup);
}
function groupMenuKeyboard(actor:TelegramActor):InlineKeyboard{
 const rows:Array<Array<{text:string;callback_data?:string;url?:string}>>=[
  [{text:'🕒 Cek stok awal (boleh dilewati)',callback_data:'rcms:group:menu:shift_open'}],
  [{text:'🧾 Rekap / tutup shift',callback_data:'rcms:group:menu:rekap'}],
  [{text:'📄 Status rekap',callback_data:'rcms:group:menu:status'},{text:'🔎 Cek harga/stok',callback_data:'rcms:group:menu:check'}],
  [{text:'❌ Batal rekap',callback_data:'rcms:group:menu:cancel'}],
 ];
 const username=configuredBotUsername();
 if(actor.isOwner&&username)rows.push([{text:'🔐 Panel Owner (pribadi)',url:'https://t.me/'+username+'?start=ownerpanel'}]);
 return{inline_keyboard:rows};
}
function groupMenuText(actor:TelegramActor){return 'Menu R-CELL\nPilih tombol untuk rekap shift atau status. Untuk cek barang, tekan tombol lalu sebut nama produk. '+(actor.isOwner?'Panel Owner membuka chat pribadi agar saldo, laporan, dan perubahan usaha tidak tampil di grup.':'');}
function configuredBotUsername(){return (process.env.TELEGRAM_BOT_USERNAME??'').trim().replace(/^@/,'').toLocaleLowerCase('id-ID');}
function escapeRegex(value:string){return value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}
function stripBotMention(text:string){return removeBotMention(text,configuredBotUsername());}
function addressedToGroupAssistant(m:TelegramMessage){const username=configuredBotUsername();if(!username)return false;const mention=!!m.text&&new RegExp('@'+escapeRegex(username)+'\\b','i').test(m.text);const reply=m.reply_to_message?.from;return mention||!!reply?.is_bot&&reply.username?.toLocaleLowerCase('id-ID')===username;}
function naturalRecapStart(text:string){return splitRecapStart(text);}
function formatDraft(d:RecapDraft):string{
 const totals=recapTotals(d);
 const labels:Array<[keyof typeof totals,string]>=[['service_fee','Admin jasa'],['sale','Penjualan (rupiah)'],['service_volume','Volume jasa'],['expense','Pengeluaran']];
 const rows=labels.filter(([key])=>BigInt(totals[key])!==0n).map(([key,label])=>label+': '+formatTelegramRupiah(BigInt(totals[key])));
 return '🧾 REKAP SHIFT'+(d.shiftLabel?' '+d.shiftLabel.toLocaleUpperCase('id-ID'):'')+' (belum disimpan)'+(rows.length?'\n'+rows.join('\n'):'');
}
type ShiftOpeningLine={productId:number;name:string;provider?:string|null;sku:string|null;expectedQty:number;actualQty:number|null};
type ShiftOpeningPayload={version:1;shiftId?:string;stage:'CHECK'|'COUNT'|'REVIEW';shiftStart:string;shiftLabel:string|null;openingBalance:string;openedByIdentityId:string;lines:ShiftOpeningLine[];reviewStatus?:'CLEAR'|'OWNER_REVIEW';startedAt?:string;closedAt?:string;closingReportId?:string;closedByIdentityId?:string};
const OPENING_TTL=30*60_000;
function shiftOpeningKeyboard(id:string,stage:ShiftOpeningPayload['stage']):InlineKeyboard{
 const rows:Array<Array<{text:string;callback_data:string}>>=[];
 if(stage==='CHECK')rows.push([{text:'✅ Sesuai semua · Mulai shift',callback_data:'rcms:shiftopen:same:'+id},{text:'⚠️ Ada selisih',callback_data:'rcms:shiftopen:diff:'+id}]);
 if(stage==='REVIEW')rows.push([{text:'✅ Konfirmasi stok awal',callback_data:'rcms:shiftopen:confirm:'+id},{text:'✏️ Ubah hitungan',callback_data:'rcms:shiftopen:edit:'+id}]);
 rows.push([{text:'Batal',callback_data:'rcms:shiftopen:cancel:'+id}]);return{inline_keyboard:rows};
}
function shiftOpeningPayload(value:unknown):ShiftOpeningPayload|null{
 if(!value||typeof value!=='object')return null;const p=value as Partial<ShiftOpeningPayload>;
 if(p.version!==1||!['CHECK','COUNT','REVIEW'].includes(p.stage??'')||!Array.isArray(p.lines)||typeof p.openedByIdentityId!=='string'||!p.openedByIdentityId||typeof p.shiftStart!=='string'||typeof p.openingBalance!=='string')return null;
 if(!p.lines.every(line=>line&&Number.isSafeInteger(line.productId)&&typeof line.name==='string'&&(line.provider===undefined||line.provider===null||typeof line.provider==='string')&&Number.isSafeInteger(line.expectedQty)&&line.expectedQty>=0&&(line.actualQty===null||Number.isSafeInteger(line.actualQty)&&line.actualQty>=0)))return null;
 return p as ShiftOpeningPayload;
}
function openingLineName(line:ShiftOpeningLine){return line.provider&&!line.name.toLocaleLowerCase('id-ID').includes(line.provider.toLocaleLowerCase('id-ID'))?line.name+' · '+line.provider:line.name;}
function shiftOpeningSummary(payload:ShiftOpeningPayload){
 return payload.lines.length?payload.lines.map((line,index)=>{
  const counted=line.actualQty!==null&&line.actualQty!==line.expectedQty;
  return `${index+1}. ${openingLineName(line)}: ${counted?`${line.expectedQty} → ${line.actualQty} (selisih ${line.actualQty!-line.expectedQty})`:line.expectedQty}`;
 }).join('\n'):'Tidak ada voucher atau barang cepat laku yang terdeteksi untuk dihitung.';
}
async function sendShiftOpeningDraft(chatId:bigint,row:{id:string;payload:unknown}){
 const payload=shiftOpeningPayload(row.payload);if(!payload)return sendTelegramMessage(chatId,'Hitungan awal shift tidak dapat dibaca. Batalkan lalu mulai /shift kembali.');
 const list=shiftOpeningSummary(payload);
 if(payload.stage==='COUNT')return sendTelegramMessage(chatId,'Kirim hanya barang yang jumlah stoknya berbeda, satu per baris. Contoh:\n1 16\nAxis 16 pcs\n\nBarang yang tidak disebut dianggap cocok. Boleh pakai nomor di depan atau nama barang. Setelah dikirim, shift langsung dimulai.');
 const isCheck=payload.stage==='CHECK';
 const header=isCheck?'🕒 CEK STOK AWAL SHIFT\nCocokkan jumlah stok di rak dengan daftar ini.':'🕒 TINJAU STOK AWAL SHIFT';
 const footer=isCheck?'Kalau ada yang tidak cocok, tekan “Ada selisih” lalu kirim nomor barang dan jumlah stok sebenarnya. Barang lain dianggap cocok.':'Selisih dicatat untuk owner. Stok di sistem tidak diubah dan selisih tidak dianggap penjualan.';
 const confirmFooter= isCheck?'':(payload.lines.some(line=>line.actualQty!==null&&line.actualQty!==line.expectedQty)?'Konfirmasi untuk memulai shift.':'Semua jumlah cocok. Konfirmasi untuk memulai shift.');
 const full=header+'\n\n'+list+'\n\n'+footer+(confirmFooter?'\n\n'+confirmFooter:'');
 return sendLongTelegramMessage(chatId,full,shiftOpeningKeyboard(row.id,payload.stage));
}
function normalizeOpeningName(value:string){return value.toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
function parseOpeningCountLines(text:string,payload:ShiftOpeningPayload){
 const updates=new Map<number,number>(),unknown:string[]=[];
 for(const raw of text.split(/[\n,;]+/).map(part=>part.trim()).filter(Boolean)){
  const value=raw.replace(/\s*(?:pcs?|unit|units?|biji|buah|lembar|batang)\s*$/i,'').trim();
  const indexed=/^(?:#)?(\d{1,2})\s*(?:[:=]|\s)\s*(\d{1,7})$/.exec(value);
  const named=/^(.+?)\s*(?:[:=]\s*|\s+)(\d{1,7})$/.exec(value);
  const index=indexed?Number(indexed[1])-1:-1,quantity=Number(indexed?.[2]??named?.[2]);
  let line=Number.isInteger(index)&&index>=0&&index<payload.lines.length?payload.lines[index]:null;
  if(!line&&named){const label=normalizeOpeningName(named[1]);line=payload.lines.find(item=>normalizeOpeningName(item.name)===label||item.sku&&normalizeOpeningName(item.sku)===label)??null;}
  if(!line||!Number.isSafeInteger(quantity)||quantity<0||quantity>1_000_000){unknown.push(raw);continue;}
  if(updates.has(line.productId)){unknown.push(raw);continue;}
  updates.set(line.productId,quantity);
 }
 return{updates,unknown};
}
async function relevantShiftOpeningProducts(){
 const voucherAndCigarettes=await prisma.product.findMany({where:{OR:[{category:{name:{contains:'voucher',mode:'insensitive'}}},{category:{name:{contains:'rokok',mode:'insensitive'}}},{name:{contains:'voucher',mode:'insensitive'}},{name:{contains:'rokok',mode:'insensitive'}}]},orderBy:[{provider:'asc'},{name:'asc'}],select:{id:true,name:true,provider:true,sku:true,stock:true}});
 const oilProducts=await prisma.product.findMany({where:{OR:[{category:{name:{contains:'minyak',mode:'insensitive'}}},{name:{contains:'minyak',mode:'insensitive'}}]},orderBy:[{stock:'desc'},{name:'asc'}],select:{id:true,name:true,provider:true,sku:true,stock:true}});
 const ids=[...new Set([...voucherAndCigarettes.map(row=>row.id),...oilProducts.map(row=>row.id)])];
 const products=await prisma.product.findMany({where:{id:{in:ids}},select:{id:true,name:true,provider:true,sku:true,stock:true}});const byId=new Map(products.map(row=>[row.id,row]));
 return ids.flatMap(id=>{const row=byId.get(id);return row?[row]:[];});
}
async function closingTrackedStock(){
 return prisma.product.findMany({where:{OR:[
  {category:{name:{contains:'voucher',mode:'insensitive'}}},{category:{name:{contains:'rokok',mode:'insensitive'}}},{category:{name:{contains:'minyak',mode:'insensitive'}}},
  {name:{contains:'voucher',mode:'insensitive'}},{name:{contains:'rokok',mode:'insensitive'}},{name:{contains:'minyak',mode:'insensitive'}}
 ]},orderBy:[{provider:'asc'},{name:'asc'}],select:{id:true,name:true,provider:true,stock:true}});
}
async function activeShiftOpening(chatId:bigint,identityId:string){
 const register=await prisma.telegramShiftRegister.findUnique({where:{chatId}});
 if(register?.activeShiftId){const row=await prisma.telegramDraft.findUnique({where:{id:register.activeShiftId}}),payload=shiftOpeningPayload(row?.payload);if(row?.status==='CONFIRMED'&&payload&&!payload.closedAt)return{row,payload};if(row?.status==='PENDING')return null;}
 const rows=await prisma.telegramDraft.findMany({where:{chatId,kind:'SHIFT_OPENING',status:'CONFIRMED'},orderBy:{createdAt:'desc'},take:20});
 for(const row of rows){const payload=shiftOpeningPayload(row.payload);if(!payload||payload.closedAt)continue;
  if(!register){try{await prisma.telegramShiftRegister.create({data:{chatId,activeShiftId:row.id}});}catch(error){if((error as {code?:string}).code!=='P2002')throw error;}
   const current=await prisma.telegramShiftRegister.findUnique({where:{chatId}});if(current?.activeShiftId===row.id)return{row,payload};
  }else if(register.activeShiftId===row.id)return{row,payload};
 }
 return null;
}
async function releaseExpiredOpening(chatId:bigint){
 const register=await prisma.telegramShiftRegister.findUnique({where:{chatId}});
 if(!register?.activeShiftId)return;
 const row=await prisma.telegramDraft.findUnique({where:{id:register.activeShiftId}});
 if(row?.kind==='SHIFT_OPENING'&&row.status==='PENDING'&&row.expiresAt<=new Date()){
  await prisma.$transaction(async tx=>{
   await tx.telegramDraft.updateMany({where:{id:row.id,status:'PENDING'},data:{status:'EXPIRED'}});
   await tx.telegramSession.deleteMany({where:{chatId,draftId:row.id,state:'OPENING'}});
   await tx.telegramShiftRegister.updateMany({where:{chatId,activeShiftId:row.id},data:{activeShiftId:null,recapIdentityId:null}});
  });
 }
}
async function autoOpenShift(chatId:bigint,actor:TelegramActor,shiftLabel:string|null){
 await releaseExpiredOpening(chatId);
 // Shift dibuka tanpa hitung stok: stok awal diambil dari sistem dan dianggap sesuai.
 const opening=await captureShiftOpeningBalance(),products=await relevantShiftOpeningProducts(),now=new Date();
 const payload:ShiftOpeningPayload={version:1,stage:'REVIEW',shiftStart:opening.start.toISOString(),shiftLabel,openingBalance:opening.balance.toString(),openedByIdentityId:actor.identityId,reviewStatus:'CLEAR',startedAt:now.toISOString(),lines:products.map(product=>({productId:product.id,name:product.name,provider:product.provider,sku:product.sku,expectedQty:product.stock,actualQty:product.stock}))};
 try{
  await prisma.$transaction(async tx=>{
   const draft=await tx.telegramDraft.create({data:{userId:actor.linkedUserId,telegramIdentityId:actor.identityId,chatId,kind:'SHIFT_OPENING',status:'CONFIRMED',confirmedAt:now,expiresAt:new Date(Date.now()+36*60*60_000),payload:payload as object}});
   await tx.telegramShiftRegister.upsert({where:{chatId},create:{chatId,activeShiftId:null,recapIdentityId:null},update:{}});
   const reserved=await tx.telegramShiftRegister.updateMany({where:{chatId,activeShiftId:null},data:{activeShiftId:draft.id,recapIdentityId:null}});if(reserved.count!==1)throw new Error('SHIFT_ALREADY_ACTIVE');
   await tx.telegramDraft.update({where:{id:draft.id},data:{payload:{...payload,shiftId:draft.id} as object}});
  });
  return true;
 }catch(error){if((error as Error).message==='SHIFT_ALREADY_ACTIVE')return false;throw error;}
}
async function closeStaleShift(chatId:bigint,actor:TelegramActor,opening:{row:{id:string};payload:ShiftOpeningPayload}){
 // Shift yang lupa ditutup tidak boleh memblokir shift berikutnya: tutup otomatis tanpa rekap (stok dan saldo tidak diubah).
 const ageHours=(Date.now()-new Date(opening.payload.shiftStart).getTime())/3_600_000;
 const sameOpener=opening.payload.openedByIdentityId===actor.identityId;
 if(!(ageHours>24||(!sameOpener&&ageHours>14)))return false;
 const shiftId=opening.payload.shiftId??opening.row.id;
 const activeRecap=await prisma.telegramSession.findFirst({where:{chatId,state:'REPORTING',expiresAt:{gt:new Date()}},select:{id:true}});
 if(activeRecap)return false;
 const closed=await prisma.$transaction(async tx=>{
  const marked=await tx.telegramDraft.updateMany({where:{id:opening.row.id,status:'CONFIRMED'},data:{payload:{...opening.payload,shiftId,closedAt:new Date().toISOString(),closedByIdentityId:actor.identityId,autoClosed:true} as object}});
  if(marked.count!==1)return false;
  await tx.telegramShiftRegister.updateMany({where:{chatId,activeShiftId:shiftId},data:{activeShiftId:null,recapIdentityId:null}});
  const sessions=await tx.telegramSession.findMany({where:{chatId,state:'REPORTING'},select:{id:true,draftId:true}});
  for(const session of sessions){if(session.draftId)await tx.telegramDraft.updateMany({where:{id:session.draftId,status:'PENDING'},data:{status:'EXPIRED'}});}
  await tx.telegramSession.deleteMany({where:{id:{in:sessions.map(session=>session.id)}}});
  return true;
 });
 if(closed){
  const opener=await prisma.telegramIdentity.findUnique({where:{id:opening.payload.openedByIdentityId},select:{displayName:true}});
  try{await notifyOwnersText('ℹ️ SHIFT LAMA DITUTUP OTOMATIS\nDibuka oleh '+(opener?.displayName??'karyawan')+' sejak '+new Date(opening.payload.shiftStart).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+', belum direkap.\nDitutup saat '+actor.displayName+' memulai shift baru. Stok dan saldo tidak diubah.');}catch{/* Info untuk owner hanya pelengkap. */}
 }
 return closed;
}
async function startShiftOpening(chatId:bigint,actor:TelegramActor,shiftLabel:string|null=null){
 const key={chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}};
 const session=await prisma.telegramSession.findUnique({where:key});
 if(session&&session.expiresAt>new Date()){
  const current=session.draftId?await prisma.telegramDraft.findUnique({where:{id:session.draftId}}):null;
  if(session.state==='OPENING'&&current?.kind==='SHIFT_OPENING'&&current.status==='PENDING')return sendTelegramMessage(chatId,'Cek stok awal masih menunggu di pesan sebelumnya. Lanjutkan dengan tombol di sana; kalau perlu tampilkan lagi, kirim /status.');
  if(session.state==='REPORTING'&&current?.kind==='SHIFT_RECAP'&&current.status==='PENDING')return sendTelegramMessage(chatId,'Rekap shift masih berjalan. Selesaikan dengan /rekap sebelum membuka shift berikutnya.');
 }
 if(session){if(session.draftId)await prisma.telegramDraft.updateMany({where:{id:session.draftId,status:'PENDING'},data:{status:'EXPIRED'}});await prisma.telegramSession.deleteMany({where:{id:session.id}});}
 const register=await prisma.telegramShiftRegister.findUnique({where:{chatId}});
 if(register?.activeShiftId){const other=await prisma.telegramDraft.findUnique({where:{id:register.activeShiftId}}),otherPayload=shiftOpeningPayload(other?.payload);if(other?.status==='PENDING'&&other.expiresAt>new Date()&&otherPayload){if(other.telegramIdentityId===actor.identityId)return sendTelegramMessage(chatId,'Cek stok awal masih berjalan di pesan sebelumnya. Lanjutkan dengan tombol di sana.');const opener=await prisma.telegramIdentity.findUnique({where:{id:other.telegramIdentityId??''},select:{displayName:true}});return sendTelegramMessage(chatId,'Proses buka shift grup sedang menunggu '+(opener?.displayName??'karyawan lain')+' menyelesaikan pemeriksaan.');}if(other?.status==='PENDING'&&other.expiresAt<=new Date())await prisma.telegramDraft.updateMany({where:{id:other.id,status:'PENDING'},data:{status:'EXPIRED'}});if(other?.status==='CONFIRMED'&&otherPayload&&!otherPayload.closedAt)return sendTelegramMessage(chatId,'Shift grup masih aktif sejak '+new Date(otherPayload.shiftStart).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+'. Satu grup memakai saldo dan stok bersama; gunakan /rekap untuk menutup shift sebelum membuka shift berikutnya.');await prisma.telegramShiftRegister.updateMany({where:{chatId,activeShiftId:register.activeShiftId},data:{activeShiftId:null,recapIdentityId:null}});}
 let active=await activeShiftOpening(chatId,actor.identityId);
 if(active&&await closeStaleShift(chatId,actor,active))active=null;
 if(active)return sendTelegramMessage(chatId,'Shift sudah dibuka dan stok awal tersimpan untuk '+active.payload.lines.length+' barang. Gunakan /rekap saat shift selesai.');
 const opening=await captureShiftOpeningBalance(),products=await relevantShiftOpeningProducts();
 const payload:ShiftOpeningPayload={version:1,stage:'CHECK',shiftStart:opening.start.toISOString(),shiftLabel,openingBalance:opening.balance.toString(),openedByIdentityId:actor.identityId,lines:products.map(product=>({productId:product.id,name:product.name,provider:product.provider,sku:product.sku,expectedQty:product.stock,actualQty:null}))};
 try{
  const row=await prisma.$transaction(async tx=>{
   const draft=await tx.telegramDraft.create({data:{userId:actor.linkedUserId,telegramIdentityId:actor.identityId,chatId,kind:'SHIFT_OPENING',status:'PENDING',expiresAt:new Date(Date.now()+OPENING_TTL),payload:payload as object}});
   await tx.telegramShiftRegister.upsert({where:{chatId},create:{chatId,activeShiftId:null,recapIdentityId:null},update:{}});
   const reserved=await tx.telegramShiftRegister.updateMany({where:{chatId,activeShiftId:null},data:{activeShiftId:draft.id,recapIdentityId:null}});if(reserved.count!==1)throw new Error('SHIFT_ALREADY_ACTIVE');
   await tx.telegramDraft.update({where:{id:draft.id},data:{payload:{...payload,shiftId:draft.id} as object}});
   await tx.telegramSession.create({data:{chatId,userId:actor.linkedUserId,telegramIdentityId:actor.identityId,state:'OPENING',draftId:draft.id,expiresAt:new Date(Date.now()+OPENING_TTL)}});
   return draft;
  });
  return sendShiftOpeningDraft(chatId,row);
 }catch(error){if((error as Error).message==='SHIFT_ALREADY_ACTIVE')return sendTelegramMessage(chatId,'Shift grup dibuka oleh karyawan lain secara bersamaan. Jalankan /status untuk melihat shift aktif.');if((error as {code?:string}).code!=='P2002')throw error;const current=await prisma.telegramSession.findUnique({where:key});const row=current?.draftId?await prisma.telegramDraft.findUnique({where:{id:current.draftId}}):null;if(current?.state==='OPENING'&&row?.kind==='SHIFT_OPENING')return sendTelegramMessage(chatId,'Cek stok awal sudah dibuat. Lanjutkan dengan tombol pada pesan sebelumnya.');return sendTelegramMessage(chatId,'Sesi shift berubah bersamaan. Periksa /status lalu coba lagi.');}
}
async function recordShiftOpeningMessage(message:TelegramMessage,actor:TelegramActor):Promise<boolean>{
 const chatId=telegramId(message.chat.id);if(chatId===null)return false;
 const session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 if(!session||session.state!=='OPENING'||!session.draftId)return false;
 const row=await prisma.telegramDraft.findUnique({where:{id:session.draftId}}),payload=shiftOpeningPayload(row?.payload);
 if(!row||row.kind!=='SHIFT_OPENING'||row.status!=='PENDING'||!payload)return false;
 if(payload.stage!=='COUNT'){await sendTelegramMessage(chatId,'Gunakan tombol “Ada selisih” dahulu. Jika semua cocok, tekan “Sesuai semua · Mulai shift”.');return true;}
 if(!message.text){await sendTelegramMessage(chatId,'Untuk hitungan awal, kirim nama barang dan jumlahnya sebagai teks.');return true;}
 const parsed=parseOpeningCountLines(message.text,payload);
 if(parsed.unknown.length||!parsed.updates.size){await sendTelegramMessage(chatId,'Saya belum cocokkan: '+(parsed.unknown.join(', ')||'jumlah belum terbaca')+'. Kirim nomor/nama persis dari daftar dan jumlahnya, misalnya “1 16”.');return true;}
 const lines=payload.lines.map(line=>({...line,actualQty:parsed.updates.get(line.productId)??line.expectedQty}));
 await completeShiftOpening(row,payload,lines,actor,chatId,async()=>{});return true;
}
async function handleShiftOpeningCallback(c:TelegramCallback,actor:TelegramActor,chatId:bigint){
 const match=/^rcms:shiftopen:(same|diff|confirm|edit|cancel):([A-Za-z0-9_-]{10,40})$/.exec(c.data??'');if(!match)return false;
 const row=await prisma.telegramDraft.findUnique({where:{id:match[2]}}),payload=shiftOpeningPayload(row?.payload);
 if(!row||row.kind!=='SHIFT_OPENING'||row.chatId!==chatId||row.telegramIdentityId!==actor.identityId||!payload||row.status!=='PENDING'){await answerTelegramCallback(c.id,'Tombol tidak aktif atau sesi shift bukan milik Anda.');return true;}
 const groupRegister=await prisma.telegramShiftRegister.findUnique({where:{chatId}});if(groupRegister?.activeShiftId!==row.id){await answerTelegramCallback(c.id,'Shift grup berubah. Jalankan /status untuk melihat keadaan terbaru.');return true;}
 if(match[1]==='cancel'){
  await prisma.$transaction(async tx=>{await tx.telegramDraft.updateMany({where:{id:row.id,status:'PENDING'},data:{status:'CANCELLED'}});await tx.telegramSession.deleteMany({where:{chatId,telegramIdentityId:actor.identityId,draftId:row.id,state:'OPENING'}});await tx.telegramShiftRegister.updateMany({where:{chatId,activeShiftId:row.id},data:{activeShiftId:null,recapIdentityId:null}});});
  await answerTelegramCallback(c.id,'Buka shift dibatalkan.');return sendTelegramMessage(chatId,'Proses buka shift dibatalkan. Stok tidak berubah.');
 }
 if(match[1]==='diff'||match[1]==='edit'){
  const next={...payload,stage:'COUNT' as const};const saved=await prisma.telegramDraft.updateMany({where:{id:row.id,status:'PENDING',updatedAt:row.updatedAt},data:{payload:next as object}});
  if(!saved.count){await answerTelegramCallback(c.id,'Sesi berubah. Jalankan /shift untuk melihat versi terbaru.');return true;}
  await answerTelegramCallback(c.id,'Kirim jumlah stok yang berbeda.');return sendShiftOpeningDraft(chatId,{id:row.id,payload:next});
 }
 if(match[1]==='same'&&payload.stage!=='CHECK'||match[1]==='confirm'&&payload.stage!=='REVIEW'){await answerTelegramCallback(c.id,'Tinjau hitungan terbaru dahulu.');return true;}
 const lines=match[1]==='same'?payload.lines.map(line=>({...line,actualQty:line.expectedQty})):payload.lines;
 return completeShiftOpening(row,payload,lines,actor,chatId,text=>answerTelegramCallback(c.id,text));
}
async function completeShiftOpening(row:{id:string},payload:ShiftOpeningPayload,lines:ShiftOpeningLine[],actor:TelegramActor,chatId:bigint,answer:(text:string)=>Promise<unknown>){
 const products=await prisma.product.findMany({where:{id:{in:lines.map(line=>line.productId)}},select:{id:true,stock:true}}),stocks=new Map(products.map(product=>[product.id,product.stock]));
 if(lines.some(line=>stocks.get(line.productId)!==line.expectedQty)){
  await prisma.$transaction(async tx=>{await tx.telegramDraft.updateMany({where:{id:row.id,status:'PENDING'},data:{status:'CANCELLED'}});await tx.telegramSession.deleteMany({where:{chatId,telegramIdentityId:actor.identityId,draftId:row.id,state:'OPENING'}});await tx.telegramShiftRegister.updateMany({where:{chatId,activeShiftId:row.id},data:{activeShiftId:null,recapIdentityId:null}});});
  await answer('Stok di sistem berubah.');return sendTelegramMessage(chatId,'Stok di sistem berubah saat Anda menghitung. Proses dibatalkan; tekan /shift lalu cocokkan lagi dengan angka terbaru.');
 }
 const now=new Date(),differences=lines.filter(line=>line.actualQty!==line.expectedQty),next:ShiftOpeningPayload={...payload,shiftId:payload.shiftId??row.id,stage:'REVIEW',shiftStart:now.toISOString(),lines,reviewStatus:differences.length?'OWNER_REVIEW':'CLEAR',startedAt:now.toISOString()};
 let openingReviewTaskId:string|null=null;
 const result=await prisma.$transaction(async tx=>{
  const claimed=await tx.telegramDraft.updateMany({where:{id:row.id,status:'PENDING'},data:{status:'PROCESSING'}});if(claimed.count!==1)return false;
  await tx.telegramDraft.update({where:{id:row.id},data:{status:'CONFIRMED',confirmedAt:new Date(),expiresAt:new Date(Date.now()+36*60*60_000),payload:next as object}});
  await tx.telegramSession.deleteMany({where:{chatId,telegramIdentityId:actor.identityId,draftId:row.id,state:'OPENING'}});
  if(differences.length){const employee=await tx.telegramIdentity.findUnique({where:{id:actor.identityId},select:{displayName:true}});const summary=differences.map(line=>`${line.name}${line.provider?' · '+line.provider:''}: sistem ${line.expectedQty}, hitungan ${line.actualQty}`).join('\n');const task=await tx.telegramOwnerReviewTask.create({data:{operationKey:'shift-opening:'+row.id+':stock',kind:'STOCK_OPENING_DISCREPANCY',status:'REVIEWED',reviewedAt:new Date(),chatId,telegramIdentityId:actor.identityId,payload:{summary:'Karyawan: '+(employee?.displayName??actor.displayName)+'\n'+summary,openingDraftId:row.id}}});openingReviewTaskId=task.id;}
  return true;
 });
 if(!result){await answer('Shift sudah diproses.');return true;}
 await answer(differences.length?'Shift dibuka; selisih dicatat.':'Shift dibuka.');
 if(differences.length){try{await notifyOwnersText('⚠️ SELISIH STOK AWAL SHIFT\nKaryawan: '+actor.displayName+'\n'+differences.map(line=>'• '+openingLineName(line)+': sistem '+line.expectedQty+', stok sebenarnya '+line.actualQty).join('\n'));}catch{/* Info untuk owner hanya pelengkap. */}}
 const pendingBalanceReviews=await prisma.telegramOwnerReviewTask.count({where:{kind:'BALANCE_DISCREPANCY',status:'PENDING'}});
 return sendTelegramMessage(chatId,'✅ Shift dimulai. Stok awal sudah dicatat.'+(differences.length?'\n⚠️ Selisih stok awal dicatat untuk owner:\n'+differences.map(line=>'• '+openingLineName(line)+': sistem '+line.expectedQty+' → stok '+line.actualQty).join('\n'):'')+(pendingBalanceReviews?'\n⚠️ Ada selisih saldo shift sebelumnya yang belum diputuskan owner, jadi selisih bisa muncul lagi di rekap.':'')+'\n\nSaat shift selesai, tekan tombol Rekap di bawah lalu tulis jualan dan saldo akhir.',{inline_keyboard:[[{text:'🧾 Rekap shift (saat selesai)',callback_data:'rcms:group:menu:rekap'}]]});
}
async function captureShiftOpeningBalance(){
 const now=new Date(),cashOpening=await shiftOpening(now),ledgerCash=await cashOnHandAt(cashOpening.start),total=await combinedBalanceAt(now);
 return{start:now,balance:total+cashOpening.openingCash-ledgerCash};
}
type BalanceReader=Parameters<typeof recordedCombinedMovementsBetween>[0]&Pick<Prisma.TransactionClient,'product'>;
async function calculateBalanceCheck(db:BalanceReader,shiftStart:Date,openingBalance:bigint,actualBalance:bigint,now:Date,draft:RecapDraft){
 const recorded=await recordedCombinedMovementsBetween(db,shiftStart,now),totals=recapTotals(draft),conflicts:string[]=[];
 const reportedTotal=(category:'sale'|'service_fee'|'expense',recordedAmount:bigint,label:string)=>{
  const hasReported=draft.entries.some(entry=>entry.category===category),reported=BigInt(totals[category]);
  if(!hasReported)return recordedAmount;
  if(reported<recordedAmount)conflicts.push(label+' pada rekap ('+formatTelegramRupiah(reported)+') lebih kecil dari catatan RMCS ('+formatTelegramRupiah(recordedAmount)+').');
  return reported>recordedAmount?reported:recordedAmount;
 };
 // Barang yang ditulis dalam pcs dihargai dari harga jual katalog supaya uangnya ikut dihitung di saldo.
 const soldLines=(draft.inventoryLines??[]).filter(line=>line.productId&&line.mappingStatus==='MATCHED');
 const priceRows=soldLines.length?await db.product.findMany({where:{id:{in:[...new Set(soldLines.map(line=>line.productId!))]}},select:{id:true,sellPrice:true}}):[];
 const priceById=new Map(priceRows.map(row=>[row.id,row.sellPrice]));
 const itemSales=soldLines.reduce((sum,line)=>sum+(priceById.get(line.productId!)??0n)*BigInt(line.quantity),0n);
 const sales=reportedTotal('sale',recorded.sales,'Penjualan')+itemSales,fees=reportedTotal('service_fee',recorded.serviceFees,'Biaya admin/jasa'),expenses=reportedTotal('expense',recorded.expenses,'Pengeluaran');
 // Report totals are treated as whole-shift totals. A total that includes Web App records replaces that category's ledger total; max() prevents duplicate addition.
 const movementDelta=sales+fees+recorded.debtPayments-expenses+recorded.adjustments,expectedBalance=openingBalance+movementDelta,difference=actualBalance-expectedBalance;
 const status=difference===0n?'MATCH' as const:difference<0n?'SHORT' as const:'EXCESS' as const;
 return{openingBalance:openingBalance.toString(),expectedBalance:expectedBalance.toString(),actualBalance:actualBalance.toString(),movementDelta:movementDelta.toString(),difference:difference.toString(),status,sourceConflicts:conflicts,itemSales:itemSales.toString()};
}
function formatBalanceCheck(check:NonNullable<RecapDraft['balanceCheck']>){
 const expected=BigInt(check.expectedBalance),actual=BigInt(check.actualBalance),difference=BigInt(check.difference);
 const lines=['Saldo seharusnya menurut RMCS + rekap: '+formatTelegramRupiah(expected),'Saldo akhir yang dihitung karyawan: '+formatTelegramRupiah(actual)];
 if(check.status==='MATCH')lines.push('✅ Saldo cocok.');
 else if(check.status==='SHORT')lines.push('⚠️ Kekurangan '+formatTelegramRupiah(-difference)+'. Dilaporkan ke Owner.');
 if(check.status==='SHORT'&&check.sourceConflicts.length)lines.push(...check.sourceConflicts);
 if(check.itemSales&&BigInt(check.itemSales)>0n)lines.push('Termasuk uang dari barang yang ditulis dalam pcs (harga katalog): '+formatTelegramRupiah(BigInt(check.itemSales))+'.');
 lines.push('Nilai penjualan, admin, dan pengeluaran pada rekap dianggap total shift; transaksi RMCS yang tercakup tidak ditambahkan dua kali.');
 return lines.join('\n');
}
async function notifyBalanceOwner(chatId:bigint,identityId:string,check:NonNullable<RecapDraft['balanceCheck']>,reportId:string){
 const owners=await prisma.user.findMany({where:{role:'owner',active:true,telegramUserId:{not:null}},select:{telegramUserId:true}});
 const ownerIds=new Set([...configuredTelegramOwners(),...owners.flatMap(owner=>owner.telegramUserId===null?[]:[owner.telegramUserId.toString()])]);
 const identity=await prisma.telegramIdentity.findUnique({where:{id:identityId},select:{displayName:true}});
 const difference=BigInt(check.difference),abs=difference<0n?-difference:difference;
 const result=check.status==='MATCH'?'✅ PAS (tidak ada selisih)':check.status==='SHORT'?'⚠️ KURANG '+formatTelegramRupiah(abs):'⚠️ LEBIH '+formatTelegramRupiah(abs);
 const message='💰 LAPORAN SALDO REKAP SHIFT\nKaryawan: '+(identity?.displayName??'Telegram')+'\nSaldo awal shift: '+formatTelegramRupiah(BigInt(check.openingBalance))+'\nSeharusnya menurut rekap: '+formatTelegramRupiah(BigInt(check.expectedBalance))+'\nSaldo akhir dihitung karyawan: '+formatTelegramRupiah(BigInt(check.actualBalance))+'\nHasil: '+result+(check.status!=='MATCH'&&check.sourceConflicts.length?'\n'+check.sourceConflicts.join('\n'):'')+'\n\nSaldo RMCS sudah mengikuti hitungan karyawan. Penyebab selisih (jika ada) silakan diperiksa manual.\nID laporan: '+reportId;
 for(const ownerId of ownerIds){try{await sendTelegramMessage(BigInt(ownerId),message);}catch{/* A notification failure must not roll back a committed shift report. */}}
}
async function notifyOwnersText(text:string){
 const owners=await prisma.user.findMany({where:{role:'owner',active:true,telegramUserId:{not:null}},select:{telegramUserId:true}});
 const ownerIds=new Set([...configuredTelegramOwners(),...owners.flatMap(owner=>owner.telegramUserId===null?[]:[owner.telegramUserId.toString()])]);
 for(const ownerId of ownerIds){try{await sendTelegramMessage(BigInt(ownerId),text);}catch{/* Notification is best effort. */}}
}
async function notifyOwnerReviewTask(taskId:string,summary:string){
 const owners=await prisma.user.findMany({where:{role:'owner',active:true,telegramUserId:{not:null}},select:{telegramUserId:true}});
 const ownerIds=new Set([...configuredTelegramOwners(),...owners.flatMap(owner=>owner.telegramUserId===null?[]:[owner.telegramUserId.toString()])]);
 const message='⚠️ TINJAUAN SHIFT MENUNGGU\n'+summary+'\n\nTugas tersimpan: '+taskId+'\nBuka /menu → Persetujuan di chat pribadi untuk melihat dan menandai setelah diperiksa.';
 for(const ownerId of ownerIds){try{await sendTelegramMessage(BigInt(ownerId),message);}catch{/* The durable queue remains available from the owner menu. */}}
}
function keyboard(id:string,revision:number,stockCountComplete:boolean,canConfirm=true,removable:Array<{index:number;label:string}>=[],quick:Array<{id:number;label:string}>=[]):InlineKeyboard{
 const rows:Array<Array<{text:string;callback_data:string}>>=[];
 if(canConfirm)rows.push([{text:'✅ Selesai · Simpan rekap',callback_data:'rcms:ok:'+id+':'+revision}]);
 if(!stockCountComplete)rows.push([{text:'⚠️ Ada selisih stok',callback_data:'rcms:stockend:'+id+':'+revision}]);
 quick=quick.slice(0,4);
 for(let i=0;i<quick.length;i+=2)rows.push(quick.slice(i,i+2).map(item=>({text:'➕ '+item.label.slice(0,24),callback_data:'rcms:q:'+item.id})));
 // Hanya empat barang terakhir yang diberi tombol hapus supaya draf tidak penuh tombol; yang lain cukup ditulis "hapus <nama barang>".
 for(const item of removable.slice(-4))rows.push([{text:'🗑 Hapus: '+item.label.slice(0,26),callback_data:inventoryCallback('remove',id,String(item.index),'-',revision)}]);
 rows.push([{text:'Koreksi Rekap',callback_data:'rcms:edit:'+id+':'+revision},{text:'Batal',callback_data:'rcms:cancel:'+id+':'+revision}]);
 return{inline_keyboard:rows};
}
function parseClosingCountLines(text:string,payload:ShiftOpeningPayload){return parseStockCountLines(text,payload.lines);}
function soldQuantities(draft:RecapDraft){const sold=new Map<number,number>();for(const line of draft.inventoryLines??[])if(line.productId&&line.mappingStatus==='MATCHED')sold.set(line.productId,(sold.get(line.productId)??0)+line.quantity);return sold;}
async function expectedClosingStock(payload:ShiftOpeningPayload,draft:RecapDraft){
 const products=await prisma.product.findMany({where:{id:{in:payload.lines.map(line=>line.productId)}},select:{id:true,stock:true}}),stock=new Map(products.map(product=>[product.id,product.stock])),sold=soldQuantities(draft);
 return new Map(payload.lines.map(line=>[line.productId,Math.max(0,(stock.get(line.productId)??line.actualQty??line.expectedQty)-(sold.get(line.productId)??0))] as [number,number]));
}
function closingStockCountPrompt(payload:ShiftOpeningPayload,expected:Map<number,number>){return '⚠️ SELISIH STOK AKHIR\nKirim HANYA barang yang jumlah stoknya berbeda dari angka di bawah, satu baris per barang. Contoh:\n1 12\n\nBarang yang tidak disebut dianggap sesuai.\n\n'+payload.lines.map((line,index)=>`${index+1}. ${line.name}${line.provider?' · '+line.provider:''} (seharusnya ${expected.get(line.productId)??line.actualQty??line.expectedQty})`).join('\n')+'\n\nIni hanya pemeriksaan; stok belum diubah.';}
async function saveInventoryDraft(sessionId:string,draftId:string,revision:number,draft:RecapDraft){
 const result=await prisma.$transaction(async tx=>{
  const guard=await tx.telegramSession.updateMany({where:{id:sessionId,draftId,state:'REPORTING',revision},data:{revision:{increment:1},expiresAt:new Date(Date.now()+SESSION_TTL)}});
  if(guard.count!==1)return false;
  const draftGuard=await tx.telegramDraft.updateMany({where:{id:draftId,status:'PENDING'},data:{payload:draft as object,expiresAt:new Date(Date.now()+SESSION_TTL)}});
  return draftGuard.count===1;
 });
 return result?revision+1:null;
}
function inventoryKeyboard(draftId:string,lineIndex:number,revision:number,choices:Array<{text:string;action:InventoryCallbackAction;value:string}>):InlineKeyboard{
 return{inline_keyboard:choices.map(choice=>[{text:choice.text,callback_data:inventoryCallback(choice.action,draftId,String(lineIndex),choice.value,revision)}])};
}
async function mergeDraftPayload(draftId:string,patch:Partial<RecapDraft>){
 // Tulis hanya bila draf tidak berubah sejak dibaca (updatedAt); ulangi bila ada yang menulis bersamaan.
 for(let attempt=0;attempt<3;attempt++){
  const row=await prisma.telegramDraft.findUnique({where:{id:draftId},select:{payload:true,status:true,updatedAt:true}});
  if(!row||row.status!=='PENDING'||!row.payload||typeof row.payload!=='object')return;
  const saved=await prisma.telegramDraft.updateMany({where:{id:draftId,status:'PENDING',updatedAt:row.updatedAt},data:{payload:{...(row.payload as object),...patch} as object}});
  if(saved.count===1)return;
 }
}
async function deliverDraftMessage(chatId:bigint,draftId:string,previousMessageId:number|undefined,text:string,markup:InlineKeyboard){
 // Satu draf aktif saja: kirim yang baru di bagian bawah grup, lalu hapus draf lama agar chat tidak penuh.
 if(text.length>3900){
  await sendLongTelegramMessage(chatId,text,markup);
  if(previousMessageId){try{await deleteTelegramMessage(chatId,previousMessageId);}catch{/* Pesan lama mungkin sudah terhapus atau terlalu lama. */}try{await mergeDraftPayload(draftId,{draftMessageId:undefined});}catch{/* Hanya kerapian. */}}
  return;
 }
 const sent=await sendTelegramMessage(chatId,text,markup),newId=sent?.message_id;
 if(previousMessageId&&previousMessageId!==newId){try{await deleteTelegramMessage(chatId,previousMessageId);}catch{/* Pesan lama mungkin sudah terhapus atau terlalu lama. */}}
 if(newId){try{await mergeDraftPayload(draftId,{draftMessageId:newId});}catch{/* Penyimpanan id pesan hanya untuk kerapian. */}}
}
// Barang yang paling sering terjual 3 minggu terakhir: jadi tombol "➕" supaya karyawan cukup menekan, tanpa mengetik.
async function quickSellerButtons():Promise<Array<{id:number;label:string}>>{
 try{
  const since=new Date(Date.now()-21*86_400_000);
  const top=await prisma.telegramInventoryPosting.groupBy({by:['productId'],where:{createdAt:{gte:since}},_sum:{appliedQty:true},orderBy:{_sum:{appliedQty:'desc'}},take:6});
  if(!top.length)return[];
  const names=await prisma.product.findMany({where:{id:{in:top.map(item=>item.productId)}},select:{id:true,name:true}});
  const byName=new Map(names.map(item=>[item.id,item.name]));
  return top.flatMap(item=>{const label=byName.get(item.productId);return label&&!label.endsWith('(nonaktif)')?[{id:item.productId,label}]:[];});
 }catch{return[];}
}
async function handleQuickSaleCallback(c:TelegramCallback,actor:TelegramActor,chatId:bigint){
 const match=/^rcms:q:(\d{1,9})$/.exec(c.data??'');if(!match||!c.message)return false;
 const product=await prisma.product.findUnique({where:{id:Number(match[1])},select:{name:true}});
 if(!product){await answerTelegramCallback(c.id,'Barang tidak ditemukan.');return true;}
 await answerTelegramCallback(c.id,'Tercatat: '+product.name.slice(0,30)+' ×1');
 await recordReportMessage({...c.message,from:c.from,text:product.name+' 1 pcs'},actor,BigInt(Date.now())*1000n+BigInt(Math.floor(Math.random()*1000)),true);
 return true;
}
async function sendReportDraft(chatId:bigint,actor:TelegramActor,sessionId:string,draftId:string){
 let session=await prisma.telegramSession.findUnique({where:{id:sessionId}}),row=await prisma.telegramDraft.findUnique({where:{id:draftId}});
 if(!session||session.draftId!==draftId||!row||row.status!=='PENDING')return;
 let draft=row.payload as unknown as RecapDraft;
 const opening=await activeShiftOpening(chatId,actor.identityId);
 if(!opening)return sendTelegramMessage(chatId,'Shift belum dibuka atau sudah ditutup. Gunakan /shift untuk mulai mencatat stok awal.');
 const openingStart=new Date(opening.payload.shiftStart);
 const prepared=await prepareInventoryReview(actor.linkedUserId,draft,new Date(),openingStart);
 draft=prepared.draft;
 const openingBalance=BigInt(opening.payload.openingBalance);
 const totals=recapTotals(draft);
 const hasEndBalance=draft.entries.some(entry=>entry.category==='total_balance')||(draft.entries.some(entry=>entry.category==='cash_balance')&&draft.entries.some(entry=>entry.category==='electronic_balance'));
 const balanceCheck=hasEndBalance?await calculateBalanceCheck(prisma,openingStart,openingBalance,BigInt(totals.total_balance),new Date(),draft):undefined;
 const nextDraft:RecapDraft={...draft,balanceCheck};
 if(JSON.stringify(nextDraft)!==JSON.stringify(row.payload)){
  const revision=await saveInventoryDraft(sessionId,draftId,session.revision,nextDraft);
  if(revision===null)return sendTelegramMessage(chatId,'Rekap baru saja berubah. Tekan tombol Rekap untuk melihat yang terbaru.');
  session={...session,revision};draft=nextDraft;
 }
 const stockOpeningText=opening.payload.reviewStatus==='OWNER_REVIEW'?'\n\nSTOK AWAL: ada selisih untuk tinjauan Owner.':'';
 const balanceText=balanceCheck?'\n\n💰 SALDO AKHIR: '+formatTelegramRupiah(BigInt(balanceCheck.actualBalance))+(balanceCheck.status==='MATCH'?' ✅ cocok':balanceCheck.status==='SHORT'?' ⚠️ kurang '+formatTelegramRupiah(-BigInt(balanceCheck.difference)):''):'';
 const issues=recapIssues(draft),stockRows:string[]=[];
 const productIds=[...new Set([...(draft.inventoryLines??[]).flatMap(line=>line.productId?[line.productId]:[]),...opening.payload.lines.map(line=>line.productId)])];
 const products=await prisma.product.findMany({where:{id:{in:productIds}},select:{id:true,name:true,stock:true,location:true,sellPrice:true}});
 const byId=new Map(products.map(product=>[product.id,product]));
 let itemMoney=0n;
 const unresolvedLines=(draft.inventoryLines??[]).filter(line=>!line.productId||line.mappingStatus!=='MATCHED');
 for(const line of unresolvedLines)stockRows.push('• '+line.label+' — '+line.quantity+' '+line.unit+(line.mappingStatus==='AMBIGUOUS'?' (pilih barangnya)':line.mappingStatus==='UNMATCHED'?' (tidak ditemukan)':' (menunggu owner)'));
 const grouped=new Map<number,typeof draft.inventoryLines>();for(const line of draft.inventoryLines??[])if(line.productId)grouped.set(line.productId,[...(grouped.get(line.productId)??[]),line]);
 let stockInsufficient=false;
 for(const [productId,lines] of grouped){const product=byId.get(productId);if(!product||!lines)continue;const quantity=lines.reduce((sum,line)=>sum+line.quantity,0);itemMoney+=product.sellPrice*BigInt(quantity);stockRows.push('• '+product.name+' — '+quantity+' pcs (stok jadi '+(product.stock-quantity)+')');if(quantity>product.stock)stockInsufficient=true;}
 const stockText=stockRows.length?'\n\n📦 BARANG TERJUAL:\n'+stockRows.join('\n')+(itemMoney>0n?'\nUang masuk dari barang (harga katalog): '+formatTelegramRupiah(itemMoney)+' — tidak perlu ditulis lagi.':'')+(draft.entries.some(entry=>entry.category==='sale')?'\n⚠️ Anda juga menulis penjualan dalam rupiah. Pastikan uang dari barang pcs di atas tidak ditulis dua kali.':''):'';
 const countByProduct=new Map((draft.closingStockCounts??[]).map(item=>[item.productId,item.actualQty]));
 const stockCountComplete=opening.payload.lines.every(line=>countByProduct.has(line.productId));
 const counted=countByProduct.size;
 const soldNow=soldQuantities(draft),closingDiffs=stockCountComplete?opening.payload.lines.flatMap(line=>{const product=byId.get(line.productId),actual=countByProduct.get(line.productId);const expected=product?Math.max(0,product.stock-(soldNow.get(line.productId)??0)):undefined;return product&&actual!==undefined&&expected!==undefined&&actual!==expected?[{line,expected,actual}]:[];}):[];
 const closeCountText='\n\n📋 STOK AKHIR: '+(stockCountComplete?'sudah dicek ✅'+closingDiffs.map(item=>'\n• '+openingLineName(item.line)+': seharusnya '+item.expected+', stok sebenarnya '+item.actual).join(''):'dianggap sesuai. Kalau ada yang beda, tekan “Ada selisih stok”.');
 const allIssues=[...issues,...(stockInsufficient?['Ada barang yang jumlahnya lebih banyak dari stok di sistem. Cek lagi jumlahnya, atau minta owner.']:[])]; const inputGuide=draft.entries.length===0&&(draft.inventoryLines??[]).length===0?'\n\nTulis saja, boleh bertahap. Contoh:\n• Admin 45rb\n• Axis 13GB 7 hari 2 pcs\n• Saldo total akhir 25.168.000':''; const todo=allIssues.length?'\n\nTinggal:\n'+allIssues.map((item,index)=>(index+1)+'. '+item).join('\n'):'\n\nSudah lengkap. Tekan Selesai untuk menyimpan.'; await deliverDraftMessage(chatId,draftId,draft.draftMessageId,formatDraft(draft)+balanceText+stockOpeningText+stockText+closeCountText+todo,keyboard(draftId,session.revision,stockCountComplete,true,(draft.inventoryLines??[]).map((line,index)=>({index,label:(line.productId?byId.get(line.productId)?.name:undefined)??line.label})),await quickSellerButtons()));
 const choiceItems=(draft.inventoryLines??[]).map((line,index)=>({line,index})).filter(item=>item.line.mappingStatus==='AMBIGUOUS'||item.line.mappingStatus==='UNMATCHED');
 if(draft.choiceMessageId){try{await deleteTelegramMessage(chatId,draft.choiceMessageId);}catch{/* Pesan pilihan lama mungkin sudah terhapus. */}}
 let choiceMessageId:number|undefined;
 if(choiceItems.length){
  const candidateRows=await prisma.product.findMany({where:{id:{in:[...new Set(choiceItems.flatMap(item=>item.line.candidateProductIds))]}},select:{id:true,name:true,stock:true}}),candidateById=new Map(candidateRows.map(product=>[product.id,product]));
  const rows:Array<Array<{text:string;callback_data:string}>>=[],textRows:string[]=[];
  choiceItems.forEach((item,position)=>{
   const number=position+1;
   textRows.push(number+'. “'+item.line.label+'” ('+item.line.quantity+' '+item.line.unit+')'+(item.line.mappingStatus==='UNMATCHED'?' — tidak ditemukan':''));
   if(item.line.mappingStatus==='AMBIGUOUS'){for(const id of item.line.candidateProductIds.slice(0,5)){const product=candidateById.get(id);if(product)rows.push([{text:number+') '+product.name.slice(0,34)+' · stok '+product.stock,callback_data:inventoryCallback('select',draftId,String(item.index),String(id),session.revision)}]);}}
   else rows.push([{text:number+') Minta owner cek',callback_data:inventoryCallback('owner',draftId,String(item.index),'-',session.revision)}]);
  });
  const sent=await sendTelegramMessage(chatId,'Pilih barang yang dimaksud:\n'+textRows.join('\n'),{inline_keyboard:rows});
  choiceMessageId=sent?.message_id;
 }
 if(choiceMessageId!==draft.choiceMessageId){try{await mergeDraftPayload(draftId,{choiceMessageId});}catch{/* Hanya untuk kerapian chat. */}}
}
async function handleInventoryCallback(c:TelegramCallback,actor:TelegramActor,chatId:bigint){
 const parsed=parseInventoryCallback(c.data);if(!parsed)return false;
 const session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 if(!session||session.draftId!==parsed.draftId||session.revision!==parsed.revision){await answerTelegramCallback(c.id,'Tombol ini sudah lama. Pakai tombol di pesan rekap yang terbaru.');return true;}
 const row=await prisma.telegramDraft.findUnique({where:{id:parsed.draftId}});if(!row||row.status!=='PENDING'){await answerTelegramCallback(c.id,'Rekap ini sudah tidak aktif.');return true;}
 const draft=row.payload as unknown as RecapDraft,line=(draft.inventoryLines??[])[parsed.lineIndex];if(!line){await answerTelegramCallback(c.id,'Baris stok tidak ditemukan.');return true;}
 let next:RecapDraft={...draft,closingStockAwaiting:false,closingStockCounts:undefined,inventoryLines:[...(draft.inventoryLines??[])]};const index=next.inventoryLines!.findIndex(item=>item.id===line.id),items=next.inventoryLines!;
 if(parsed.action==='select'){
  const productId=Number(parsed.value);if(!Number.isSafeInteger(productId)||!line.candidateProductIds.includes(productId)){await answerTelegramCallback(c.id,'Pilihan produk tidak valid.');return true;}
  items[index]={...line,productId,candidateProductIds:[productId],mappingStatus:'MATCHED',coverage:'UNDECIDED',recordedWebQty:undefined,appliedQty:undefined};
 }else if(parsed.action==='remove'){
  items.splice(index,1);
 }else if(parsed.action==='owner'){
  items[index]={...line,mappingStatus:'OWNER_REVIEW',coverage:'OWNER_REVIEW'};
 }else{
  const product=await prisma.product.findUnique({where:{id:line.productId??-1},select:{id:true}});if(!product||line.mappingStatus!=='MATCHED'){await answerTelegramCallback(c.id,'Pilih produk dahulu.');return true;}
  const opening=await activeShiftOpening(chatId,actor.identityId);if(!opening){await answerTelegramCallback(c.id,'Shift sudah ditutup.');return true;}
  const fresh=await inventoryPreview(actor.linkedUserId,draft,new Date(),new Date(opening.payload.shiftStart));const recorded=fresh.items.find(item=>item.id===product.id)?.recordedWebQty??0;
  const sameProduct=items.filter(item=>item.productId===product.id),totalReported=sameProduct.reduce((sum,item)=>sum+item.quantity,0);
  const coverage=recorded===0?'UNRECORDED_ONLY':parsed.action==='included'?(totalReported<recorded?'OWNER_REVIEW':'INCLUDES_APP_SALES'):'UNRECORDED_ONLY';
  next.inventoryLines=items.map(item=>item.productId===product.id?{...item,recordedWebQty:recorded,coverage,appliedQty:undefined}:item);
 }
 const revision=await saveInventoryDraft(session.id,row.id,session.revision,next);if(revision===null){await answerTelegramCallback(c.id,'Rekap baru saja berubah. Tekan tombol Rekap untuk melihat yang terbaru.');return true;}
 await answerTelegramCallback(c.id,parsed.action==='owner'?'Ditandai untuk tinjauan owner.':parsed.action==='remove'?'Baris dihapus.':'Pilihan tersimpan.');
 if(parsed.action==='owner'){
  await sendTelegramMessage(chatId,'Permintaan tinjauan produk '+line.label+' dicatat. Owner perlu memastikan pemetaan sebelum rekap dapat dikonfirmasi.');
  const linkedOwners=await prisma.user.findMany({where:{role:'owner',active:true,telegramUserId:{not:null}},select:{telegramUserId:true}});
  const ownerIds=new Set([...configuredTelegramOwners(),...linkedOwners.flatMap(owner=>owner.telegramUserId===null?[]:[owner.telegramUserId.toString()])]);
  const employee=await prisma.telegramIdentity.findUnique({where:{id:actor.identityId},select:{displayName:true}});
  for(const ownerId of ownerIds)await sendTelegramMessage(BigInt(ownerId),'Tinjauan produk Telegram diperlukan\nKaryawan: '+(employee?.displayName??actor.displayName)+'\nProduk dari rekap: '+line.label+' ('+line.quantity+' '+line.unit+')\nGrup: '+chatId+'\nBuka chat pribadi bot dan pastikan produk katalog sebelum rekap dikonfirmasi.');
 }
 await sendReportDraft(chatId,actor,session.id,row.id);return true;
}
async function claimGroupShiftRecap(chatId:bigint,shiftId:string,identityId:string){
 let current=await prisma.telegramShiftRegister.findUnique({where:{chatId}});
 if(current?.activeShiftId!==shiftId)return false;
 if(current.recapIdentityId&&current.recapIdentityId!==identityId){const oldSession=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:current.recapIdentityId}}}),oldDraft=oldSession?.draftId?await prisma.telegramDraft.findUnique({where:{id:oldSession.draftId},select:{status:true,expiresAt:true}}):null;
  if(oldSession&&oldSession.state==='REPORTING'&&oldSession.expiresAt>new Date()&&oldDraft?.status==='PENDING'&&oldDraft.expiresAt>new Date())return false;
  await prisma.telegramShiftRegister.updateMany({where:{chatId,activeShiftId:shiftId,recapIdentityId:current.recapIdentityId},data:{recapIdentityId:null}});current=await prisma.telegramShiftRegister.findUnique({where:{chatId}});
 }
 const result=await prisma.telegramShiftRegister.updateMany({where:{chatId,activeShiftId:shiftId,OR:[{recapIdentityId:null},{recapIdentityId:identityId}]},data:{recapIdentityId:identityId}});
 if(result.count===1)return true;
 current=await prisma.telegramShiftRegister.findUnique({where:{chatId}});return current?.activeShiftId===shiftId&&current.recapIdentityId===identityId;
}async function openReport(chatId:bigint,actor:TelegramActor,shiftLabel:string|null=null,initialMessage?:TelegramMessage,initialUpdateId?:bigint){
 const chatSession=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 if(chatSession?.state==='OPENING'&&chatSession.draftId){const openingDraft=await prisma.telegramDraft.findUnique({where:{id:chatSession.draftId}});if(openingDraft?.kind==='SHIFT_OPENING'&&openingDraft.status==='PENDING'&&openingDraft.expiresAt>new Date())return sendTelegramMessage(chatId,'Cek stok awal masih menunggu di pesan sebelumnya. Selesaikan dulu, lalu kirim /rekap.');}
 let opening=await activeShiftOpening(chatId,actor.identityId);
 if(opening&&await closeStaleShift(chatId,actor,opening))opening=null;
 if(!opening){
  // Rekap tidak menuntut buka shift manual: shift dibuka otomatis dengan stok dan saldo dari sistem.
  await autoOpenShift(chatId,actor,shiftLabel);
  opening=await activeShiftOpening(chatId,actor.identityId);
  if(!opening)return sendTelegramMessage(chatId,'Shift grup sedang disiapkan karyawan lain. Tekan Rekap lagi sebentar lagi.');
 }
 if(opening){const claimed=await claimGroupShiftRecap(chatId,opening.payload.shiftId??opening.row.id,actor.identityId);if(!claimed){const register=await prisma.telegramShiftRegister.findUnique({where:{chatId}}),recapOwner=register?.recapIdentityId?await prisma.telegramIdentity.findUnique({where:{id:register.recapIdentityId},select:{displayName:true}}):null;return sendTelegramMessage(chatId,'Rekap shift bersama sedang dikerjakan oleh '+(recapOwner?.displayName??'karyawan lain')+'. Lanjutkan dari akun yang memulai rekap.');}}
 shiftLabel=shiftLabel??opening.payload.shiftLabel;
 let session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 if(session&&session.expiresAt<=new Date()){
  if(session.draftId)await prisma.telegramDraft.updateMany({where:{id:session.draftId,status:'PENDING'},data:{status:'EXPIRED'}});
  await prisma.telegramSession.deleteMany({where:{id:session.id}});session=null;
 }
 if(session){
  const oldDraft=session.draftId?await prisma.telegramDraft.findUnique({where:{id:session.draftId},select:{id:true,kind:true,status:true}}):null;
  if(session.state!=='REPORTING'||(session.draftId&&(!oldDraft||oldDraft.kind!=='SHIFT_RECAP'||oldDraft.status!=='PENDING'))){
   if(oldDraft?.status==='PENDING')await prisma.telegramDraft.updateMany({where:{id:oldDraft.id,status:'PENDING'},data:{status:'CANCELLED'}});
   await prisma.telegramSession.deleteMany({where:{id:session.id}});session=null;
  }
 } if(!session){
  session=await prisma.telegramSession.create({data:{chatId,userId:actor.linkedUserId,telegramIdentityId:actor.identityId,state:'REPORTING',expiresAt:new Date(Date.now()+SESSION_TTL)}});
 }
 if(!session.draftId){
  const draft=await prisma.telegramDraft.create({data:{userId:actor.linkedUserId,telegramIdentityId:actor.identityId,chatId,kind:'SHIFT_RECAP',status:'PENDING',expiresAt:new Date(Date.now()+SESSION_TTL),payload:emptyRecap() as object}});
  const claimed=await prisma.telegramSession.updateMany({where:{id:session.id,draftId:null},data:{draftId:draft.id,state:'REPORTING',expiresAt:draft.expiresAt}});
  if(!claimed.count){await prisma.telegramDraft.updateMany({where:{id:draft.id,status:'PENDING'},data:{status:'CANCELLED'}});session=await prisma.telegramSession.findUniqueOrThrow({where:{id:session.id}});}
  else session={...session,draftId:draft.id};
 }
 const draft=session.draftId?await prisma.telegramDraft.findUnique({where:{id:session.draftId}}):null;
 const data=(draft?.payload||emptyRecap()) as unknown as RecapDraft;
 if(draft&&await sendLatestPhotoReview(chatId,draft.id,data,session.revision))return;
 if(draft&&initialMessage?.text&&initialUpdateId!==undefined)return recordReportMessage(initialMessage,actor,initialUpdateId);
 if(draft)return sendReportDraft(chatId,actor,session.id,draft.id);
 return sendTelegramMessage(chatId,formatDraft(data)+"\n\nSilakan kirim ringkasan shift atau foto buku rekap.");
}
async function handleClosingStockCountCallback(c:TelegramCallback,actor:TelegramActor,chatId:bigint){
 const match=/^rcms:(stockend|stockok|stocklist):([A-Za-z0-9_-]{10,40}):(\d{1,10})$/.exec(c.data??'');if(!match)return false;
 const session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 if(!session||session.draftId!==match[2]||session.revision!==Number(match[3])){await answerTelegramCallback(c.id,'Tombol ini sudah lama. Pakai tombol di pesan rekap yang terbaru.');return true;}
 const [row,opening]=await Promise.all([prisma.telegramDraft.findUnique({where:{id:match[2]}}),activeShiftOpening(chatId,actor.identityId)]);
 if(!row||row.status!=='PENDING'||row.kind!=='SHIFT_RECAP'||!opening){await answerTelegramCallback(c.id,'Rekap atau shift tidak aktif.');return true;}
 const current=row.payload as unknown as RecapDraft,expected=await expectedClosingStock(opening.payload,current);
 if(match[1]==='stockok'){
  const done:RecapDraft={...current,closingStockAwaiting:false,closingStockCounts:opening.payload.lines.map(line=>({productId:line.productId,actualQty:expected.get(line.productId)??line.actualQty??line.expectedQty}))};
  const saved=await saveInventoryDraft(session.id,row.id,session.revision,done);if(saved===null){await answerTelegramCallback(c.id,'Rekap baru saja berubah. Tekan tombol Rekap untuk melihat yang terbaru.');return true;}
  await answerTelegramCallback(c.id,'Stok akhir dicatat sesuai.');return sendReportDraft(chatId,actor,session.id,row.id);
 }
 if(match[1]==='stocklist'){await answerTelegramCallback(c.id,'Daftar barang dikirim.');return sendLongTelegramMessage(chatId,closingStockCountPrompt(opening.payload,expected));}
 const next:RecapDraft={...current,closingStockAwaiting:true,closingStockCounts:[]};
 const revision=await saveInventoryDraft(session.id,row.id,session.revision,next);if(revision===null){await answerTelegramCallback(c.id,'Rekap baru saja berubah. Tekan tombol Rekap untuk melihat yang terbaru.');return true;}
 await answerTelegramCallback(c.id,'Kirim hanya barang yang berbeda.');
 if(match[1]==='stocklist')return sendLongTelegramMessage(chatId,closingStockCountPrompt(opening.payload,expected));
 return sendTelegramMessage(chatId,'⚠️ SELISIH STOK AKHIR\nTulis barang yang stoknya beda dari sistem, satu per baris, diikuti jumlah stok sebenarnya. Contoh:\nAxis 13GB 3\nSurya 12 28\n\nBarang lain dianggap cocok.',{inline_keyboard:[[{text:'📋 Lihat daftar barang',callback_data:'rcms:stocklist:'+row.id+':'+revision}]]});
}
async function handleDuplicateCallback(c:TelegramCallback,actor:TelegramActor,chatId:bigint){
 const match=/^rcms:dup:([A-Za-z0-9_-]{10,40}):(\d{1,10}):(y|n)$/.exec(c.data??'');if(!match)return false;
 const session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 if(!session||session.draftId!==match[1]||session.revision!==Number(match[2])){await answerTelegramCallback(c.id,'Pertanyaan ini sudah lama.');return true;}
 const row=await prisma.telegramDraft.findUnique({where:{id:match[1]}});
 const draft=row?.status==='PENDING'?row.payload as unknown as RecapDraft:null,pending=draft?.pendingDuplicate;
 if(!row||!draft||!pending){await answerTelegramCallback(c.id,'Sudah diproses.');return true;}
 const revision=await saveInventoryDraft(session.id,row.id,session.revision,{...draft,pendingDuplicate:undefined});
 if(revision===null){await answerTelegramCallback(c.id,'Rekap baru saja berubah. Tekan tombol Rekap untuk melihat yang terbaru.');return true;}
 if(c.message){try{await deleteTelegramMessage(chatId,c.message.message_id);}catch{/* Pesan pertanyaan boleh tertinggal. */}}
 if(match[3]==='n'){await answerTelegramCallback(c.id,'Tidak dicatat dobel.');return true;}
 await answerTelegramCallback(c.id,'Dicatat lagi.');
 await recordReportMessage({message_id:0,chat:c.message?.chat??{id:Number(chatId),type:'supergroup'},from:c.from,text:pending.text},actor,BigInt(Date.now()),true);
 return true;
}
async function recordReportMessage(rawMessage:TelegramMessage,actor:TelegramActor,updateId:bigint,force=false){
 const message=rawMessage.text?{...rawMessage,text:stripRecapHeader(stripBotMention(rawMessage.text))}:rawMessage;
 const chatId=telegramId(message.chat.id);if(chatId===null||!message.text)return;
 const session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 if(!session||session.expiresAt<=new Date()||!session.draftId)return;
 const register=await prisma.telegramShiftRegister.findUnique({where:{chatId}});if(register?.recapIdentityId&&register.recapIdentityId!==actor.identityId){await sendTelegramMessage(chatId,'Rekap shift bersama sedang dikerjakan karyawan lain. Pesan ini tidak dimasukkan.');return;}
 const stored=await prisma.telegramDraft.findUnique({where:{id:session.draftId}});
 if(!stored||stored.status!=='PENDING')return;
 const prior=stored.payload as unknown as RecapDraft;
 if(prior.correctionPhotoId&&await correctTelegramPhotoFromText(message,actor.identityId,updateId))return;
 if(prior.closingStockAwaiting){
  const opening=await activeShiftOpening(chatId,actor.identityId);if(!opening){await sendTelegramMessage(chatId,'Shift sudah ditutup. Hitung stok tidak tersimpan.');return;}
  const parsed=parseClosingCountLines(message.text,opening.payload);
  if(parsed.unknown.length||!parsed.updates.size){await sendTelegramMessage(chatId,'Belum cocok: '+(parsed.unknown.join(', ')||'jumlah belum terbaca')+'.\nTulis nama barang lebih lengkap lalu jumlah stok sebenarnya, contoh “Axis 13GB 3”. Lupa nama barangnya? Tekan “Lihat daftar barang” di pesan sebelumnya.');return;}
  const expected=await expectedClosingStock(opening.payload,prior);
  const next:RecapDraft={...prior,closingStockAwaiting:false,closingStockCounts:opening.payload.lines.map(line=>({productId:line.productId,actualQty:parsed.updates.get(line.productId)??expected.get(line.productId)??line.actualQty??line.expectedQty})),processedUpdateIds:[...(prior.processedUpdateIds??[]),updateId.toString()]};
  const revision=await saveInventoryDraft(session.id,stored.id,session.revision,next);if(revision===null){await sendTelegramMessage(chatId,'Rekap baru saja berubah. Tekan tombol Rekap untuk melihat yang terbaru.');return;}
  return sendReportDraft(chatId,actor,session.id,stored.id);
 }
 if(prior.processedUpdateIds?.includes(updateId.toString())){await sendReportDraft(chatId,actor,session.id,stored.id);return;}
 // Pesan rekap yang sama persis dalam 1 menit kemungkinan terkirim dobel: tanya dulu, jangan langsung dijumlahkan.
 const duplicateKeyValue=inputDuplicateKey(message.text),nowMs=Date.now(),recentInputs=(prior.recentInputs??[]).filter(item=>nowMs-item.at<=60_000);
 if(!force&&duplicateKeyValue&&recentInputs.some(item=>item.key===duplicateKeyValue)){
  const asked:RecapDraft={...prior,pendingDuplicate:{text:message.text.slice(0,1000),at:nowMs}};
  const askedRevision=await saveInventoryDraft(session.id,stored.id,session.revision,asked);
  if(askedRevision===null)return sendTelegramMessage(chatId,'Rekap baru saja berubah. Tekan tombol Rekap untuk melihat yang terbaru.');
  return sendTelegramMessage(chatId,'Pesan ini sama persis dengan yang baru saja Anda kirim. Catat lagi? (jumlahnya akan bertambah dobel)',{inline_keyboard:[[{text:'✅ Ya, catat lagi',callback_data:'rcms:dup:'+stored.id+':'+askedRevision+':y'},{text:'❌ Tidak',callback_data:'rcms:dup:'+stored.id+':'+askedRevision+':n'}]]});
 }
 const extraction=await extractRecapMessage(message.text,prior);
 let saved:RecapDraft|null=null;let savedRevision:number|null=null;
 for(let attempt=0;attempt<3&&!saved;attempt++){
  const current=await prisma.telegramSession.findUnique({where:{id:session.id}});
  if(!current||current.draftId!==stored.id)return;
  const currentDraft=await prisma.telegramDraft.findUnique({where:{id:stored.id}});
  if(!currentDraft||currentDraft.status!=='PENDING')return;
  const base=currentDraft.payload as unknown as RecapDraft;
  if(base.processedUpdateIds?.includes(updateId.toString())){saved=base;savedRevision=current.revision;break;}
  const merged={...applyExtraction(base,extraction,message.text,updateId.toString()),recentInputs:[...recentInputs,{key:duplicateKeyValue,at:nowMs}].slice(-5)};
  try{
   const count=await prisma.$transaction(async tx=>{
    const guard=await tx.telegramSession.updateMany({where:{id:current.id,revision:current.revision,state:'REPORTING'},data:{revision:{increment:1},expiresAt:new Date(Date.now()+SESSION_TTL)}});
    if(guard.count!==1)return 0;
    await tx.telegramDraft.update({where:{id:stored.id},data:{payload:merged as object,expiresAt:new Date(Date.now()+SESSION_TTL)}});
    return 1;
   });
   if(count){saved=merged;savedRevision=current.revision+1;}
  }catch(e){if((e as {code?:string}).code!=='P2034')throw e;}
 }
 if(!saved)throw new Error('Sesi rekap berubah bersamaan. Kirim ulang pesan terakhir.');
 const issues=recapIssues(saved);
 await sendReportDraft(chatId,actor,session.id,stored.id);
}
async function requestReportCorrection(chatId:bigint,actor:TelegramActor,args:string){
 const [reportId,lineId,quantityText,...reasonParts]=args.trim().split(/\s+/),reason=reasonParts.join(' ').trim(),quantity=Number(quantityText);
 if(!reportId||!lineId||!Number.isSafeInteger(quantity)||quantity<0||quantity>1000000||reason.length<5)return sendTelegramMessage(chatId,'Format: /koreksi ID_REKAP ID_BARIS JUMLAH_BARU alasan koreksi. Contoh: /koreksi abc123 line-42-0 5 salah hitung.');
 const report=await prisma.telegramShiftReport.findUnique({where:{id:reportId},include:{inventoryPostings:true}});
 if(!report||(!callbackBelongsToActor(report.telegramIdentityId,actor.identityId)&&!actor.isOwner))return sendTelegramMessage(chatId,'Rekap tidak ditemukan atau Anda tidak berwenang mengoreksinya.');
 const posting=report.inventoryPostings.find(item=>item.lineId===lineId);if(!posting)return sendTelegramMessage(chatId,'Baris stok tidak ditemukan pada rekap tersebut.');
 return submitReportCorrection(chatId,actor,report,posting,quantity,reason);
}
async function tryAutoApplyCorrection(chatId:bigint,actor:TelegramActor,correctionId:string){
 // Koreksi kecil diterapkan langsung; yang besar/tidak jelas tetap menunggu owner.
 try{return await prisma.$transaction(tx=>approveCorrectionTx(tx,correctionId,chatId,{userId:actor.linkedUserId,identityId:actor.identityId},'approve',CORRECTION_AUTO_LIMIT),{isolationLevel:'Serializable',timeout:15000});}
 catch(error){const message=(error as Error).message;if(['CORRECTION_LIMIT','CORRECTION_STALE','CORRECTION_STOCK_INSUFFICIENT','CORRECTION_COVERAGE_REVIEW','CORRECTION_WRONG_CHAT','CORRECTION_NOT_FOUND'].includes(message)||(error as {code?:string}).code==='P2034')return null;throw error;}
}
async function submitReportCorrection(chatId:bigint,actor:TelegramActor,report:{id:string},posting:{id:string;productLabel:string;reportedQty:number},quantity:number,reason:string,viaChat=false){
 const approved=await prisma.telegramReportCorrection.aggregate({where:{postingId:posting.id,status:'APPROVED'},_sum:{deltaQty:true}});
 const currentQty=posting.reportedQty+(approved._sum.deltaQty??0);if(currentQty===quantity)return sendTelegramMessage(chatId,'Jumlah tersebut sudah sesuai. Tidak ada koreksi yang dibuat.');
 const correctionCount=await prisma.telegramReportCorrection.count({where:{postingId:posting.id}});
 const operationKey=createHash('sha256').update([report.id,posting.id,actor.telegramUserId,quantity,reason.toLocaleLowerCase('id-ID'),currentQty,correctionCount].join('|')).digest('hex');
 const prior=await prisma.telegramReportCorrection.findUnique({where:{operationKey}});if(prior)return sendTelegramMessage(chatId,prior.status==='PENDING'?'Permintaan koreksi yang sama masih menunggu owner.':'Permintaan koreksi yang sama sudah diproses.');
 const correction=await prisma.telegramReportCorrection.create({data:{operationKey,reportId:report.id,postingId:posting.id,requestedById:actor.linkedUserId,requestedByTelegramIdentityId:actor.identityId,reason:reason.slice(0,500),previousQty:currentQty,requestedQty:quantity,deltaQty:quantity-currentQty}});
 const auto=await tryAutoApplyCorrection(chatId,actor,correction.id);
 if(auto&&auto.status==='APPROVED'){
  const stockText=auto.stockDelta>0?'berkurang '+auto.stockDelta:auto.stockDelta<0?'bertambah '+Math.abs(auto.stockDelta):'tidak berubah';
  try{await notifyOwnersText('✏️ KOREKSI REKAP DICATAT\nKaryawan: '+actor.displayName+'\nRekap: '+report.id+'\n'+auto.productName+': jumlah terjual '+currentQty+' → '+quantity+' (stok '+stockText+')\nAlasan: '+reason.slice(0,200));}catch{/* Info untuk owner hanya pelengkap. */}
  return sendTelegramMessage(chatId,(viaChat?'Saya tangkap koreksi “'+posting.productLabel+'”. ':'')+'✅ Koreksi dicatat: jumlah terjual '+currentQty+' → '+quantity+'. Stok '+stockText+'. Owner sudah diberi tahu.');
 }
 await sendTelegramMessage(chatId,(viaChat?'Saya tangkap koreksi “'+posting.productLabel+'”. ':'')+'Permintaan koreksi tercatat. Jumlah terjual pada rekap saat ini '+currentQty+'; target '+quantity+'. Owner harus menyetujui sebelum stok berubah.',{inline_keyboard:[[{text:'Setujui koreksi',callback_data:'rcms:cr:'+correction.id+':a'},{text:'Tolak',callback_data:'rcms:cr:'+correction.id+':r'}]]});
}
async function correctReportByChat(chatId:bigint,actor:TelegramActor,intent:ShiftIntent,text:string){
 const report=await prisma.telegramShiftReport.findFirst({where:{chatId,confirmedAt:{gte:new Date(Date.now()-48*60*60_000)},...(actor.isOwner?{}:{telegramIdentityId:actor.identityId})},orderBy:{confirmedAt:'desc'},include:{inventoryPostings:true}});
 if(!report)return sendTelegramMessage(chatId,'Saya tidak menemukan rekap Anda dalam 48 jam terakhir yang bisa dikoreksi.');
 if(!report.inventoryPostings.length)return sendTelegramMessage(chatId,'Rekap terakhir tidak punya pengurangan stok, jadi tidak ada jumlah barang yang bisa dikoreksi dari sini. Hubungi owner untuk koreksi lain.');
 const match=matchCorrectionPosting(report.inventoryPostings,intent.productText);
 if(match.status!=='MATCH'||intent.newQuantity===null){
  const list=report.inventoryPostings.map(item=>'• '+item.productLabel+': '+item.reportedQty+' pcs').join('\n');
  return sendTelegramMessage(chatId,'Saya mengerti Anda ingin mengoreksi rekap, tapi belum yakin barang atau jumlahnya. Rekap terakhir:\n'+list+'\n\nTulis ulang dengan nama barang dan jumlah yang benar, misalnya “'+report.inventoryPostings[0].productLabel+' seharusnya 5, salah hitung”.');
 }
 const reason=intent.reason&&intent.reason.length>=5?intent.reason:'Koreksi lewat chat: '+text.slice(0,300);
 return submitReportCorrection(chatId,actor,report,match.posting as (typeof report.inventoryPostings)[number],intent.newQuantity,reason,true);
}
async function handleAiShiftIntent(chatId:bigint,actor:TelegramActor,intent:ShiftIntent,text:string,message?:TelegramMessage,updateId?:bigint){
 if(intent.intent==='open_shift')return startShiftOpening(chatId,actor,intent.shiftLabel);
 if(intent.intent==='close_shift'){
  // Bila pesan juga memuat isi rekap (beberapa baris atau ada angka), catat isinya, jangan dibuang.
  const hasBody=!!message&&(text.split(/\r?\n/).length>1||/\d/.test(text));
  return openReport(chatId,actor,intent.shiftLabel,hasBody?{...message!,text}:undefined,updateId);
 }
 return correctReportByChat(chatId,actor,intent,text);
}
type CorrectionApprover={userId:number|null;identityId:string|null};
const CORRECTION_AUTO_LIMIT=1_000_000n;
async function approveCorrectionTx(tx:Prisma.TransactionClient,correctionId:string,chatId:bigint,approver:CorrectionApprover,mode:'approve'|'reject',autoLimit?:bigint):Promise<{status:string;delta:number;stockDelta:number;productName:string}>{
   await tx.$queryRaw`SELECT "id" FROM "TelegramReportCorrection" WHERE "id" = ${correctionId} FOR UPDATE`;
   const correction=await tx.telegramReportCorrection.findUnique({where:{id:correctionId},include:{posting:{include:{product:true}},report:{select:{chatId:true}}}});
   if(!correction)throw new Error('CORRECTION_NOT_FOUND');
   if(correction.report.chatId!==chatId)throw new Error('CORRECTION_WRONG_CHAT');
   if(correction.status!=='PENDING')return{status:'ALREADY',delta:0,stockDelta:0,productName:correction.posting.product.name};
   if(mode==='reject'){
    await tx.telegramReportCorrection.update({where:{id:correction.id},data:{status:'REJECTED',approvedById:approver.userId,approvedByTelegramIdentityId:approver.identityId,approvedAt:new Date()}});
    return{status:'REJECTED',delta:0,stockDelta:0,productName:correction.posting.product.name};
   }
   await tx.$queryRaw`SELECT "id" FROM "Product" WHERE "id" = ${correction.posting.productId} FOR UPDATE`;
   const prior=await tx.telegramReportCorrection.aggregate({where:{postingId:correction.postingId,status:'APPROVED'},_sum:{deltaQty:true}});
   const currentReported=correction.posting.reportedQty+(prior._sum.deltaQty??0);
   if(currentReported!==correction.previousQty)throw new Error('CORRECTION_STALE');
   const nextReported=correction.requestedQty;const delta=correctionDelta(currentReported,nextReported);if(delta===null)throw new Error('CORRECTION_STALE');const product=correction.posting.product;
   const coverage=correction.posting.coverage as 'INCLUDES_APP_SALES'|'UNRECORDED_ONLY';
   const currentApplied=correctedStockDeduction(currentReported,correction.posting.webAppQty,coverage),nextApplied=correctedStockDeduction(nextReported,correction.posting.webAppQty,coverage);
   if(currentApplied===null||nextApplied===null)throw new Error('CORRECTION_COVERAGE_REVIEW');
   const stockDelta=correctionDelta(currentApplied,nextApplied);if(stockDelta===null)throw new Error('CORRECTION_STALE');
   if(autoLimit!==undefined&&BigInt(Math.abs(stockDelta))*product.sellPrice>autoLimit)throw new Error('CORRECTION_LIMIT');
   if(stockDelta>0){const changed=await tx.product.updateMany({where:{id:product.id,stock:{gte:stockDelta}},data:{stock:{decrement:stockDelta}}});if(changed.count!==1)throw new Error('CORRECTION_STOCK_INSUFFICIENT');}
   else if(stockDelta<0)await tx.product.update({where:{id:product.id},data:{stock:{increment:-stockDelta}}});
   const movement=stockDelta===0?null:await tx.inventoryMovement.create({data:{productId:product.id,type:'TELEGRAM_SHIFT_RECAP_CORRECTION',qty:-stockDelta,costAtTime:product.costPrice,note:`Koreksi rekap ${correction.reportId}; alasan: ${correction.reason}`,userId:approver.userId,telegramIdentityId:approver.identityId},select:{id:true}});
   await tx.telegramReportCorrection.update({where:{id:correction.id},data:{status:'APPROVED',approvedById:approver.userId,approvedByTelegramIdentityId:approver.identityId,approvedAt:new Date(),deltaQty:delta,movementId:movement?.id??null}});
   return{status:'APPROVED',delta,stockDelta,productName:product.name};
}
async function handleCorrectionCallback(c:TelegramCallback,actor:TelegramActor,chatId:bigint){
 const match=/^rcms:cr:([A-Za-z0-9_-]{10,40}):(a|r)$/.exec(c.data??'');if(!match)return false;
 if(!actor.isOwner){await answerTelegramCallback(c.id,'Hanya owner yang telah diotorisasi yang dapat menyetujui koreksi.');return true;}
 let result:{status:string;delta:number;stockDelta:number;productName:string}|null=null;
 try{
  result=await prisma.$transaction(tx=>approveCorrectionTx(tx,match[1],chatId,{userId:actor.linkedUserId,identityId:actor.identityId},match[2]==='r'?'reject':'approve'),{isolationLevel:'Serializable',timeout:15000});
 }catch(error){const message=(error as Error).message;if(message==='CORRECTION_WRONG_CHAT'){await answerTelegramCallback(c.id,'Tombol koreksi hanya berlaku di grup asal rekap.');return true;}if(message==='CORRECTION_STALE'||message==='CORRECTION_STOCK_INSUFFICIENT'||message==='CORRECTION_COVERAGE_REVIEW'){await answerTelegramCallback(c.id,'Koreksi tidak dapat diterapkan: '+(message==='CORRECTION_STALE'?'rekap telah dikoreksi sebelumnya.':message==='CORRECTION_COVERAGE_REVIEW'?'jumlah terjual bertentangan dengan penjualan Web App.':'stok tidak cukup untuk koreksi.'));return true;}throw error;}
 await answerTelegramCallback(c.id,result.status==='APPROVED'?'Koreksi disetujui.':result.status==='REJECTED'?'Koreksi ditolak.':'Permintaan sudah diproses.');
 if(result.status==='APPROVED')await sendTelegramMessage(chatId,'Koreksi '+result.productName+' disetujui. Perubahan stok: '+(result.stockDelta>0?'−'+result.stockDelta:result.stockDelta<0?'+'+Math.abs(result.stockDelta):'tidak berubah')+' unit. Jumlah terjual pada rekap: '+(result.delta>0?'bertambah '+result.delta:result.delta<0?'berkurang '+Math.abs(result.delta):'tetap')+'.');
 else if(result.status==='REJECTED')await sendTelegramMessage(chatId,'Permintaan koreksi stok ditolak owner.');
 return true;
}
async function handleCommand(m:TelegramMessage,actor:TelegramActor,command:string,args:string,updateId?:bigint){
 const chatId=telegramId(m.chat.id);if(chatId===null)return;
 if(command==='menu')return sendTelegramMessage(chatId,groupMenuText(actor),groupMenuKeyboard(actor));
 if(command==='start')return sendTelegramMessage(chatId,'Pilih menu bot untuk mulai rekap, melihat status, atau cek barang. /menu menampilkan tombol fitur.',groupMenuKeyboard(actor));
 if(command==='shift')return startShiftOpening(chatId,actor,args.trim()||null);
 if(command==='susulan')return handleLateEntry(m,actor,args.trim(),updateId??0n);
 if(command==='rekap'){const body=args.trim();return openReport(chatId,actor,null,body?{...m,text:body}:undefined,updateId);}
 if(command==='koreksi')return requestReportCorrection(chatId,actor,args);
 if(command==='status'){
  const [session,latest]=await Promise.all([prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}}),prisma.telegramShiftReport.findFirst({where:{telegramIdentityId:actor.identityId,chatId},orderBy:{confirmedAt:'desc'}})]);
  if(session?.state==='OPENING'&&session.draftId){const openingDraft=await prisma.telegramDraft.findUnique({where:{id:session.draftId}});if(openingDraft?.kind==='SHIFT_OPENING'&&openingDraft.status==='PENDING')return sendTelegramMessage(chatId,'Cek stok awal masih menunggu di pesan sebelumnya. Selesaikan dulu, lalu kirim /rekap.');}
  const activeOpening=await activeShiftOpening(chatId,actor.identityId);
  let result=session?.draftId?await prisma.telegramDraft.findUnique({where:{id:session.draftId}}):null;
  let message=result&&result.status==='PENDING'?formatDraft(result.payload as unknown as RecapDraft)+'\n\n'+((result.payload as unknown as RecapDraft).balanceCheck?formatBalanceCheck((result.payload as unknown as RecapDraft).balanceCheck!)+'\n\n':'')+(recapIssues(result.payload as unknown as RecapDraft).join('\n')||'Siap konfirmasi dengan tombol di pesan rekap.'):session?'Sesi rekap ada, tetapi drafnya tidak aktif. Gunakan /rekap.':'Belum ada shift atau draf rekap yang aktif. Tekan “Mulai shift” di /menu atau kirim /shift untuk memulai.';
  if(activeOpening){const opener=await prisma.telegramIdentity.findUnique({where:{id:activeOpening.payload.openedByIdentityId},select:{displayName:true}});message='Shift sedang berjalan · ID '+(activeOpening.payload.shiftId??activeOpening.row.id)+' · dibuka oleh '+(opener?.displayName??'karyawan')+' sejak '+new Date(activeOpening.payload.shiftStart).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+'.\nSaldo awal (kas + elektronik): '+formatTelegramRupiah(BigInt(activeOpening.payload.openingBalance))+'\n\n'+shiftOpeningSummary(activeOpening.payload);if(session?.state==='REPORTING'&&result?.kind==='SHIFT_RECAP'&&result.status==='PENDING')message+='\n\n'+formatDraft(result.payload as unknown as RecapDraft)+'\n'+(recapIssues(result.payload as unknown as RecapDraft).join('\n')||'Rekap menunggu konfirmasi.');else message+='\n\nGunakan /rekap saat shift selesai.';}
  if(latest)message+='\n\nRekap terakhir dikonfirmasi: '+latest.confirmedAt.toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+'.';
  return sendLongTelegramMessage(chatId,message);
 }
 if(command==='batal'){
  const session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
  if(session?.draftId)await prisma.telegramDraft.updateMany({where:{id:session.draftId,status:'PENDING'},data:{status:'CANCELLED'}});
  await prisma.telegramSession.deleteMany({where:{chatId,telegramIdentityId:actor.identityId}});if(session?.state==='REPORTING')await prisma.telegramShiftRegister.updateMany({where:{chatId,recapIdentityId:actor.identityId},data:{recapIdentityId:null}});
  return sendTelegramMessage(chatId,session?.state==='OPENING'?'Proses buka shift dibatalkan. Stok tidak berubah.':'Sesi rekap dibatalkan. Tidak ada perubahan transaksi, stok, saldo, atau penutupan shift RMCS.');
 }
 return sendTelegramMessage(chatId,'Perintah tidak dikenal. Gunakan /rekap, /status, atau /batal.');
}
async function handleCallback(c:TelegramCallback,actor:TelegramActor){
 const menu=/^rcms:group:menu:(shift_open|rekap|status|cancel|check)$/.exec(c.data??'');
 if(menu){
  const m=c.message;
  if(!m||!groupAllowed(m.chat)){await answerTelegramCallback(c.id,'Grup tidak diizinkan.');return;}
  if(menu[1]==='shift_open'){await answerTelegramCallback(c.id,'Menyiapkan hitungan stok awal.');return startShiftOpening(BigInt(m.chat.id),actor);}
  if(menu[1]==='check'){
   await answerTelegramCallback(c.id,'Kirim nama barang.');
   const username=(process.env.TELEGRAM_BOT_USERNAME??'bot').replace(/^@/,'');
   return sendTelegramMessage(m.chat.id,'Untuk cek harga/stok, tag @'+username+' dan sebut nama barang. Contoh: @'+username+' harga Axis 13 GB.');
  }
  await answerTelegramCallback(c.id,menu[1]==='rekap'?'Membuka rekap':menu[1]==='status'?'Memeriksa status':'Membatalkan sesi');
  return handleCommand(m,actor,menu[1]==='cancel'?'batal':menu[1],'');
 }
 if(await handleShiftOpeningCallback(c,actor,BigInt(c.message?.chat.id??0)))return;
 if(await handleDuplicateCallback(c,actor,BigInt(c.message?.chat.id??0)))return;
 const preMessageChat=c.message&&telegramId(c.message.chat.id);if(c.message&&preMessageChat!==null&&preMessageChat!==undefined&&groupAllowed(c.message.chat)&&await handleClosingStockCountCallback(c,actor,preMessageChat))return;
 const m=c.message,chatId=m&&telegramId(m.chat.id);
 if(!m||chatId===null||chatId===undefined||!groupAllowed(m.chat)){await answerTelegramCallback(c.id,'Grup tidak diizinkan.');return;}
 if(visionCallbackFromData(c.data)){await handleTelegramVisionCallback(c,actor.identityId);return;}
 if(await handleQuickSaleCallback(c,actor,chatId))return;
 if(await handleInventoryCallback(c,actor,chatId))return;
 if(await handleCorrectionCallback(c,actor,chatId))return;
 const parsed=parseTelegramCallback(c.data);if(!parsed){await answerTelegramCallback(c.id,'Tombol tidak valid.');return;}
 const draft=await prisma.telegramDraft.findUnique({where:{id:parsed.draftId}});
 if(!draft||!callbackBelongsToActor(draft.telegramIdentityId,actor.identityId)||draft.chatId!==chatId||draft.kind!=='SHIFT_RECAP'){await answerTelegramCallback(c.id,'Rekap ini sedang dikerjakan karyawan lain.');return;}
 if(parsed.operation==='edit'){await answerTelegramCallback(c.id,'Silakan koreksi rekap.');await sendTelegramMessage(chatId,'Kirim nilai koreksi sebagai pesan baru, misalnya: rokok tadi salah bukan 175rb tapi 195rb atau axis salah bukan 7 pcs tapi 5 pcs.');return;}
 if(parsed.operation==='cancel'){
  const changed=await prisma.telegramDraft.updateMany({where:{id:draft.id,status:'PENDING'},data:{status:'CANCELLED'}});
  await prisma.telegramSession.deleteMany({where:{telegramIdentityId:actor.identityId,chatId,draftId:draft.id}});
  await prisma.telegramShiftRegister.updateMany({where:{chatId,recapIdentityId:actor.identityId},data:{recapIdentityId:null}});
  await answerTelegramCallback(c.id,changed.count?'Draf dibatalkan.':'Draf sudah diproses.');return;
 }

 const active=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}},select:{id:true,draftId:true,revision:true}});
 if(!active||active.draftId!==draft.id||parsed.revision===undefined||parsed.revision!==active.revision){await answerTelegramCallback(c.id,'Tombol ini sudah lama. Pakai tombol di pesan rekap yang terbaru.');return;}
 if(draft.status!=='PENDING'||draft.expiresAt<=new Date()){await answerTelegramCallback(c.id,'Rekap ini sudah tidak aktif. Tekan Rekap untuk mulai lagi.');return;}
 const data=draft.payload as unknown as RecapDraft,issues=recapIssues(data);
 if(!canFinalizeRecap(data)){await answerTelegramCallback(c.id,'Rekap belum lengkap. Lihat bagian “Tinggal” di pesan rekap.');return;}
 const shiftOpening=await activeShiftOpening(chatId,actor.identityId);
 if(!shiftOpening){await answerTelegramCallback(c.id,'Shift sudah ditutup atau perlu dibuka ulang.');return;}
 const groupRegister=await prisma.telegramShiftRegister.findUnique({where:{chatId}});if(groupRegister?.activeShiftId!==(shiftOpening.payload.shiftId??shiftOpening.row.id)||groupRegister.recapIdentityId!==actor.identityId){await answerTelegramCallback(c.id,'Rekap shift ini dipegang karyawan lain.');return;}
 const shiftStart=new Date(shiftOpening.payload.shiftStart),openingBalance=BigInt(shiftOpening.payload.openingBalance),endingBalance=BigInt(recapTotals(data).total_balance);
 const closingCounts=new Map((data.closingStockCounts??[]).map(item=>[item.productId,item.actualQty]));const closingStockAssumed=!shiftOpening.payload.lines.every(line=>closingCounts.has(line.productId));
 if(closingStockAssumed){const expectedClosing=await expectedClosingStock(shiftOpening.payload,data);for(const line of shiftOpening.payload.lines)if(!closingCounts.has(line.productId))closingCounts.set(line.productId,expectedClosing.get(line.productId)??line.actualQty??line.expectedQty);}
 const openingStockSnapshot={draftId:shiftOpening.row.id,startedAt:shiftOpening.payload.startedAt??shiftOpening.payload.shiftStart,reviewStatus:shiftOpening.payload.reviewStatus??'CLEAR',lines:shiftOpening.payload.lines};
 let postings:{productId:number;appliedQty:number;lineId:string}[]=[],reportIdResult='',finalBalanceCheck=data.balanceCheck,closingStockDifferences:Array<{productId:number;name:string;provider:string|null;expectedQty:number;actualQty:number}>=[],reviewTaskNotifications:Array<{id:string;summary:string}>=[];
 const say=async(text:string)=>{if(!await tryAnswerTelegramCallback(c.id,text))await sendTelegramMessage(chatId,text);};
 try{
  await prisma.$transaction(async tx=>{
   const sessionClaim=await tx.telegramSession.updateMany({where:{id:active!.id,draftId:draft.id,state:'REPORTING',revision:parsed.revision},data:{revision:{increment:1}}});
   if(sessionClaim.count!==1)throw new Error('STALE_REPORT_REVISION');
   const claimed=await tx.telegramDraft.updateMany({where:{id:draft.id,status:'PENDING'},data:{status:'PROCESSING'}});
   if(claimed.count!==1)throw new Error('DRAFT_ALREADY_PROCESSED');
   const checkedAt=new Date(),freshBalanceCheck=await calculateBalanceCheck(tx,shiftStart,openingBalance,endingBalance,checkedAt,data);
   if(!data.balanceCheck||freshBalanceCheck.expectedBalance!==data.balanceCheck.expectedBalance||freshBalanceCheck.difference!==data.balanceCheck.difference||freshBalanceCheck.status!==data.balanceCheck.status||JSON.stringify(freshBalanceCheck.sourceConflicts)!==JSON.stringify(data.balanceCheck.sourceConflicts))throw new Error('BALANCE_CHECK_STALE');
   finalBalanceCheck=freshBalanceCheck;
   const payload={...buildAggregateReport(data),shiftId:shiftOpening.payload.shiftId??shiftOpening.row.id,openedByIdentityId:shiftOpening.payload.openedByIdentityId,closedByIdentityId:actor.identityId,openingStockSnapshot,closingStockCounts:[...closingCounts].map(([productId,actualQty])=>({productId,actualQty})),closingStockAssumed,balanceReconciliation:{...freshBalanceCheck,reviewStatus:freshBalanceCheck.status==='MATCH'?'CLEAR':'REPORTED_TO_OWNER',checkedAt:checkedAt.toISOString()}};
   const report=await tx.telegramShiftReport.create({data:{draftId:draft.id,userId:actor.linkedUserId,telegramIdentityId:actor.identityId,chatId,shiftLabel:data.shiftLabel,payload},select:{id:true}});reportIdResult=report.id;
   postings=await postTelegramInventory(tx,report.id,actor.linkedUserId,actor.identityId,data,shiftStart,checkedAt);
   const closingStates=await tx.product.findMany({where:{id:{in:shiftOpening.payload.lines.map(line=>line.productId)}},select:{id:true,name:true,provider:true,stock:true}}),statesById=new Map(closingStates.map(product=>[product.id,product]));
   closingStockDifferences=shiftOpening.payload.lines.flatMap(line=>{const product=statesById.get(line.productId),actualQty=closingCounts.get(line.productId);return product&&actualQty!==undefined&&actualQty!==product.stock?[{productId:product.id,name:product.name,provider:product.provider,expectedQty:product.stock,actualQty}]:[];});
   if(closingStockDifferences.length){const employee=await tx.telegramIdentity.findUnique({where:{id:actor.identityId},select:{displayName:true}}),summary='Karyawan: '+(employee?.displayName??actor.displayName)+'\n'+closingStockDifferences.map(item=>`${item.name}${item.provider?' · '+item.provider:''}: seharusnya ${item.expectedQty}, stok sebenarnya ${item.actualQty}`).join('\n');const task=await tx.telegramOwnerReviewTask.create({data:{operationKey:'shift-report:'+report.id+':stock-closing',kind:'STOCK_CLOSING_DISCREPANCY',status:'REVIEWED',reviewedAt:new Date(),chatId,telegramIdentityId:actor.identityId,reportId:report.id,payload:{summary,items:closingStockDifferences}}});reviewTaskNotifications.push({id:task.id,summary:'Ada selisih stok fisik akhir.\n'+summary});}
   const openingClosed=await tx.telegramDraft.updateMany({where:{id:shiftOpening.row.id,status:'CONFIRMED'},data:{payload:{...shiftOpening.payload,shiftId:shiftOpening.payload.shiftId??shiftOpening.row.id,closedAt:checkedAt.toISOString(),closingReportId:report.id,closedByIdentityId:actor.identityId} as object}});
   if(openingClosed.count!==1)throw new Error('SHIFT_OPENING_ALREADY_CLOSED');
   const releasedRegister=await tx.telegramShiftRegister.updateMany({where:{chatId,activeShiftId:shiftOpening.payload.shiftId??shiftOpening.row.id,recapIdentityId:actor.identityId},data:{activeShiftId:null,recapIdentityId:null}});if(releasedRegister.count!==1)throw new Error('SHIFT_OPENING_ALREADY_CLOSED');
   await tx.telegramShiftReport.update({where:{id:report.id},data:{payload:{...payload,inventoryPostings:postings,closingStockReview:{status:closingStockDifferences.length?'OWNER_REVIEW':'CLEAR',discrepancies:closingStockDifferences}} as object}});
   await setCombinedBalance(tx,{targetBalance:endingBalance,createdById:actor.linkedUserId,sourceDraftId:draft.id,note:freshBalanceCheck.status==='MATCH'?'Saldo total shift cocok dengan catatan RMCS.':'Saldo total shift mengikuti hitungan karyawan (selisih '+freshBalanceCheck.difference+').'});
   await tx.telegramDraft.update({where:{id:draft.id},data:{status:'CONFIRMED',confirmedAt:checkedAt}});
   await tx.telegramSession.deleteMany({where:{telegramIdentityId:actor.identityId,chatId,draftId:draft.id}});
  },{isolationLevel:'Serializable',timeout:20000});
 }catch(e){
  if((e as Error).message==='DRAFT_ALREADY_PROCESSED'||(e as {code?:string}).code==='P2002'){await say('Rekap ini sudah tersimpan.');return;}
  if((e as {code?:string}).code==='P2034'){await say('Ada yang menekan bersamaan. Belum ada yang tersimpan, silakan tekan Selesai sekali lagi.');return;}
  if((e as Error).message==='STALE_REPORT_REVISION'){await say('Rekap baru saja berubah. Tekan tombol Rekap untuk melihat yang terbaru.');return;}
  if((e as Error).message==='SHIFT_OPENING_ALREADY_CLOSED'){await say('Shift ini sudah ditutup.');return;}
  if((e as Error).message==='BALANCE_CHECK_STALE'){
   const refreshed={...data,balanceCheck:await calculateBalanceCheck(prisma,shiftStart,openingBalance,endingBalance,new Date(),data)};
   const newRevision=await saveInventoryDraft(active.id,draft.id,active.revision,refreshed);
   await say('Catatan saldo berubah dan rekap sudah diperbarui. Periksa lagi lalu tekan Selesai.');
   if(newRevision!==null)await sendReportDraft(chatId,actor,active.id,draft.id);
   return;
  }
  if(e instanceof TelegramInventoryError){await say(e.message);await sendTelegramMessage(chatId,e.message+' Tidak ada stok yang diubah. Periksa /rekap atau minta tinjauan owner.');return;}
  throw e;
 }
 await answerTelegramCallback(c.id,finalBalanceCheck?.status==='MATCH'?'Rekap disimpan. Saldo cocok.':'Rekap tersimpan; selisih saldo dilaporkan ke Owner.');
 const summary=postings.map(posting=>{const ids=posting.lineId.split(',');const label=ids.map(id=>(data.inventoryLines??[]).find(line=>line.id===id)?.label).filter(Boolean).join(' / ');return '• '+label+': '+posting.appliedQty+' unit dikurangi';}).join('\n');
 const correctionHelp=postings.map(posting=>' /koreksi '+reportIdResult+' '+posting.lineId+' <jumlah-baru> <alasan>').join('\n');
 const reconciliationText=finalBalanceCheck?formatBalanceCheck(finalBalanceCheck):'Saldo belum berhasil direkonsiliasi.';
 const closingStockReviewText=closingStockDifferences.length?'\n\n⚠️ Selisih stok akhir: '+closingStockDifferences.length+' produk. Tugas tinjauan tersimpan untuk Owner; stok tidak disesuaikan otomatis dari hitungan stok.':'\n\n✅ Stok akhir sesuai setelah pengurangan.';
 try{
  const check=finalBalanceCheck,gap=check?BigInt(check.difference):0n,gapAbs=gap<0n?-gap:gap;
  const balanceLine=check?(check.status==='MATCH'?'PAS ✅ '+formatTelegramRupiah(BigInt(check.actualBalance)):(check.status==='SHORT'?'⚠️ KURANG ':'⚠️ LEBIH ')+formatTelegramRupiah(gapAbs)+' (seharusnya '+formatTelegramRupiah(BigInt(check.expectedBalance))+', dihitung karyawan '+formatTelegramRupiah(BigInt(check.actualBalance))+')'):'belum direkonsiliasi';
  const stockLine=closingStockDifferences.length?'⚠️ ada selisih\n'+closingStockDifferences.map(item=>'• '+item.name+': seharusnya '+item.expectedQty+', stok sebenarnya '+item.actualQty).join('\n'):'sesuai ✅';
  await notifyOwnersText('📋 REKAP SHIFT DISIMPAN'+(data.shiftLabel?' · '+data.shiftLabel:'')+'\nKaryawan: '+actor.displayName+(summary?'\n\n'+summary:'')+'\n\nAdmin: '+formatTelegramRupiah(BigInt(recapTotals(data).service_fee))+' · Pengeluaran: '+formatTelegramRupiah(BigInt(recapTotals(data).expense))+'\n💰 Saldo: '+balanceLine+'\n📦 Stok akhir: '+stockLine+'\n\nSaldo sistem sudah mengikuti hitungan karyawan. Penyebab selisih (jika ada) silakan diperiksa manual.\nID laporan: '+reportIdResult);
 }catch{/* Rincian untuk owner hanya pelengkap. */}
 await sendLongTelegramMessage(chatId,'✅ REKAP DISIMPAN'+(data.shiftLabel?' · Shift '+data.shiftLabel:'')+(summary?'\n\n'+summary:'')+'\n\n💰 Saldo: '+(finalBalanceCheck?.status==='SHORT'?'kurang '+formatTelegramRupiah(-BigInt(finalBalanceCheck.difference))+' ⚠️':finalBalanceCheck?.status==='MATCH'?'cocok ✅':'tercatat ✅')+'\n📦 Stok akhir: '+(closingStockDifferences.length?'ada selisih ⚠️ (dicatat untuk Owner)':'sesuai ✅')+'\n\nSalah catat? Tulis saja, contoh: axis 13gb tadi harusnya 5.\nAda yang terlewat? Tulis: susulan <barang atau uang>.');
}
async function handleLateEntry(m:TelegramMessage,actor:TelegramActor,content:string,updateId:bigint){
 const chatId=telegramId(m.chat.id);if(chatId===null)return;
 const session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 // Rekap Anda masih terbuka: tulis saja langsung di rekap, tidak perlu dibawa ke owner.
 if(session&&session.state==='REPORTING'&&session.draftId&&session.expiresAt>new Date()){
  if(!content)return sendTelegramMessage(chatId,'Rekap Anda masih terbuka. Tulis saja barang atau uangnya langsung, contoh: Axis 13gb 7 hari 1 pcs.');
  return recordReportMessage({...m,text:content},actor,updateId);
 }
 const runningShift=await activeShiftOpening(chatId,actor.identityId);
 if(runningShift&&content)return openReport(chatId,actor,null,{...m,text:content},updateId);
 if(!content)return sendTelegramMessage(chatId,'Tulis isinya setelah kata susulan. Contoh: susulan Axis 13gb 7 hari 1 pcs, atau susulan admin 5rb.');
 const report=await prisma.telegramShiftReport.findFirst({where:{chatId,confirmedAt:{gte:new Date(Date.now()-48*60*60_000)},...(actor.isOwner?{}:{telegramIdentityId:actor.identityId})},orderBy:{confirmedAt:'desc'},select:{id:true,confirmedAt:true}});
 if(!report)return sendTelegramMessage(chatId,'Saya tidak menemukan rekap Anda dalam 48 jam terakhir. Kalau shift masih berjalan, tulis saja di rekap (tombol Rekap).');
 // Susulan diterapkan langsung (stok dipotong, saldo disesuaikan); hanya bila tidak bisa otomatis diteruskan ke owner.
 const applied=await applyLateEntry({reportId:report.id,chatId,identityId:actor.identityId,linkedUserId:actor.linkedUserId,displayName:actor.displayName,content,updateId:updateId.toString()});
 if(applied.status==='DUPLICATE')return sendTelegramMessage(chatId,'Susulan ini sudah dicatat sebelumnya.');
 if(applied.status==='APPLIED'){
  const rupiah=(value:bigint)=>formatTelegramRupiah(value<0n?-value:value);
  const itemText=applied.lines.map(line=>'• '+line.name+' — '+line.qty+' pcs (stok jadi '+line.stockAfter+')').join('\n');
  const balanceText=applied.balanceDelta===0n?(applied.lines.length?'\n💰 Saldo tidak diubah (uang barang dianggap sudah terhitung di saldo akhir). Kalau belum, tulis: susulan penjualan <nominal>.':''):'\n💰 Saldo '+(applied.balanceDelta>0n?'bertambah ':'berkurang ')+rupiah(applied.balanceDelta)+(applied.balanceAfter!==null?' (sekarang '+formatTelegramRupiah(applied.balanceAfter)+')':'');
  try{await notifyOwnersText('➕ SUSULAN DICATAT\nKaryawan: '+actor.displayName+'\nRekap: '+report.id+(itemText?'\n'+itemText:'')+balanceText+'\nTulisan karyawan: '+content.slice(0,200));}catch{/* Info untuk owner hanya pelengkap. */}
  return sendTelegramMessage(chatId,'✅ Susulan dicatat'+(itemText?'\n'+itemText:'')+balanceText+'\nOwner sudah diberi tahu.');
 }
 const employee=await prisma.telegramIdentity.findUnique({where:{id:actor.identityId},select:{displayName:true}});
 const summary='Karyawan: '+(employee?.displayName??actor.displayName)+'\n'+'Rekap terakhir: '+report.id+'\n'+'Susulan: '+content.slice(0,500);
 try{
  const task=await prisma.telegramOwnerReviewTask.create({data:{operationKey:'late-entry:'+updateId.toString(),kind:'LATE_ENTRY',chatId,telegramIdentityId:actor.identityId,reportId:report.id,payload:{summary,text:content.slice(0,500)}}});
  await notifyOwnerReviewTask(task.id,'Susulan setelah rekap ditutup.'+'\n'+summary);
 }catch(error){if((error as {code?:string}).code!=='P2002')throw error;}
 return sendTelegramMessage(chatId,'⚠️ Belum bisa dicatat otomatis ('+applied.reason+'). Sudah saya teruskan ke owner untuk disesuaikan.');
}
async function processUpdate(u:TelegramUpdate){
 const id=telegramId(u.update_id);if(id===null)throw new Error('Invalid Telegram update_id');
 const m=u.message,c=u.callback_query,chat=m?.chat??c?.message?.chat,from=m?.from??c?.from;if(!chat||!from)return false;
 const command=m?.text?parseTelegramCommand(m.text):null;
 if(chat.type==='private'){
  let claim:'PROCESSED'|'BUSY'|'CLAIMED';
  try{claim=await claimUpdate(id);}catch{
   if(c)await answerTelegramCallback(c.id,'Saya belum bisa memeriksa permintaan ini. Coba lagi sebentar.');
   else await sendTelegramMessage(chat.id,'Maaf, saya belum bisa memeriksa pesan ini sekarang. Tidak ada perubahan usaha yang diterapkan; coba lagi sebentar.');
   return true;
  }
  if(claim==='PROCESSED')return true;
  if(claim==='BUSY'){
   if(c)await answerTelegramCallback(c.id,'Pesan sebelumnya masih diproses.');
   else await sendTelegramMessage(chat.id,'Pesan sebelumnya masih diproses. Tunggu sebentar lalu kirim lagi.');
   return true;
  }
  try{
   const senderId=telegramId(from.id);
   if(senderId===null||senderId<=0n){
    if(c)await answerTelegramCallback(c.id,'Pengirim tidak dapat diverifikasi.');
    else await sendTelegramMessage(chat.id,'Saya tidak dapat memverifikasi pengirim pesan ini.');
   }else if(command?.command==='whoami'){
    await sendTelegramMessage(chat.id,'ID Telegram Anda: '+senderId.toString()+'. Kirim angka ini kepada owner bila perlu ditambahkan sebagai owner bot.');
   }else if(senderId!==BigInt(chat.id)||!authorizedOwnerPrivateChat(from.id,chat.id)){
    if(c)await answerTelegramCallback(c.id,'Akses tidak diizinkan.');
    else await sendTelegramMessage(chat.id,'Asisten administrasi hanya tersedia untuk owner yang telah diotorisasi.');
   }else if(c){
    try{await handleOwnerCallback(c,from.id);}catch{
     await answerTelegramCallback(c.id,'Saya belum bisa menyelesaikan tombol ini. Periksa status terbaru sebelum mencoba lagi.');
    }
   }else if(m){
    await handleOwnerMessage(m,from.id);
   }
   await prisma.telegramUpdate.update({where:{updateId:id},data:{status:'PROCESSED',processedAt:new Date(),leaseUntil:null,lastError:null}});
   return true;
  }catch(e){await prisma.telegramUpdate.update({where:{updateId:id},data:{status:'FAILED',leaseUntil:null,lastError:(e instanceof Error?e.message:'unknown').slice(0,500)}});throw e;}
 }
 if(!groupAllowed(chat))return false;
 const senderId=authorizedTelegramGroupSender({chatId:chat.id,chatType:chat.type,senderId:from.id,senderChatId:m?.sender_chat?.id,configuredGroups:process.env.TELEGRAM_ALLOWED_GROUP_IDS});
 if(senderId===null)return false;
 const startRequest=m?naturalRecapStart(m.text??m.caption??''):null;
 const lateEntry=m?.text&&!command?lateEntryText(m.text):null;
 let assistantRequest=m?addressedToGroupAssistant(m):false;
 // Karyawan yang sedang mengisi rekap/cek stok sering membalas pesan bot atau menyebut @bot: anggap itu isi rekap kecuali jelas bertanya harga/stok.
 if(m&&assistantRequest&&!command&&m.text&&!looksLikeCatalogQuestion(stripBotMention(m.text))){
  const ident=await prisma.telegramIdentity.findUnique({where:{telegramUserId:senderId},select:{id:true}});
  const flow=ident?await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId:BigInt(chat.id),telegramIdentityId:ident.id}},select:{state:true,draftId:true,expiresAt:true}}):null;
  if(flow&&['REPORTING','OPENING'].includes(flow.state)&&flow.draftId&&flow.expiresAt>new Date())assistantRequest=false;
 }
 let implicitAsk=false;
 if(m&&!assistantRequest&&!command&&startRequest===null&&lateEntry===null&&m.text&&isImplicitCatalogQuestion(m.text)){assistantRequest=true;implicitAsk=true;}
 // Ignore ordinary group chatter before creating Telegram identities or update rows.
 let aiIntent:ShiftIntent|null=null;
 let recapStart=startRequest;
 if(!c&&!command&&!startRequest&&!assistantRequest&&lateEntry===null){
  const existingIdentity=await prisma.telegramIdentity.findUnique({where:{telegramUserId:senderId},select:{id:true}});
  const active=existingIdentity?await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId:BigInt(chat.id),telegramIdentityId:existingIdentity.id}},select:{state:true,draftId:true,expiresAt:true}}):null;
  const inFlow=!!active&&['REPORTING','OPENING'].includes(active.state)&&!!active.draftId&&active.expiresAt>new Date();
  if(!inFlow){
   // Karyawan langsung menulis barang terjual ("telkomsel 3 hari", "axis 5 hari 2 pcs") tanpa mengetik "rekap":
   // buka rekap otomatis dan catat isinya, jangan didiamkan.
   if(m?.text&&!m.photo&&!m.document&&isLikelySaleNote(m.text))recapStart={shiftLabel:null,rest:m.text.trim()};
   // Bahasa bebas: AI hanya menilai niat pada pesan teks yang lolos penyaring kasar. Gagal/ragu = diam.
   else if(m&&!m.photo&&!m.document&&worthClassifying(m.text)){const found=await classifyShiftIntent(m.text!);if(found.intent!=='none'&&found.confidence==='high')aiIntent=found;}
   if(!aiIntent&&!recapStart)return false;
  }
 }
 const claim=await claimUpdate(id);if(claim==='PROCESSED')return true;if(claim==='BUSY')throw new TelegramUpdateBusy();
 try{
  const actor=await identifyTelegramActor(from,BigInt(chat.id));if(!actor)throw new Error('Invalid sender id');
  if(c)await handleCallback(c,actor);
  else if(m&&command)await handleCommand(m,actor,command.command,command.args,id);
  else if(m&&lateEntry!==null)await handleLateEntry(m,actor,lateEntry,id);
  else if(m&&aiIntent)await handleAiShiftIntent(BigInt(chat.id),actor,aiIntent,m.text??'',m,id);
  else if(m&&recapStart){
   const chatId=BigInt(chat.id),body=recapStart.rest;
   if(m.photo||m.document){await openReport(chatId,actor,recapStart.shiftLabel);await handleTelegramPhoto(m,actor.identityId,id);}
   else await openReport(chatId,actor,recapStart.shiftLabel,body?{...m,text:body}:undefined,id);
  }
  else if(m&&assistantRequest&&m.text){const text=stripBotMention(m.text);await handleGroupAssistantMessage({chatId:BigInt(chat.id),identityId:actor.identityId,text:text||'Tanya apa yang bisa saya bantu soal barang?',updateId:id.toString(),implicit:implicitAsk});}
  else if(m&&await recordShiftOpeningMessage(m,actor)){}
  else if(m&&(m.photo||m.document))await handleTelegramPhoto(m,actor.identityId,id);
  else if(m)await recordReportMessage(m,actor,id);
  await prisma.telegramUpdate.update({where:{updateId:id},data:{status:'PROCESSED',processedAt:new Date(),leaseUntil:null,lastError:null}});
  return true;
 }catch(e){
  await prisma.telegramUpdate.update({where:{updateId:id},data:{status:'FAILED',leaseUntil:null,lastError:(e instanceof Error?e.message:'unknown').slice(0,500)}});
  throw e;
 }
}
export async function handleTelegramWebhook(request:Request){
 const secret=process.env.TELEGRAM_WEBHOOK_SECRET;
 if(!secret||!/^[A-Za-z0-9_-]{1,256}$/.test(secret))return{status:503,body:{error:'Telegram webhook is not configured.'}};
 if(!secretMatches(request.headers.get('x-telegram-bot-api-secret-token'),secret))return{status:401,body:{error:'Unauthorized.'}};
 const length=Number(request.headers.get('content-length')??0);if(length>64000)return{status:413,body:{error:'Update too large.'}};
 let update:TelegramUpdate;try{const body=await request.text();if(body.length>64000)return{status:413,body:{error:'Update too large.'}};update=JSON.parse(body) as TelegramUpdate;}catch{return{status:400,body:{error:'Invalid JSON update.'}};}
 try{await processUpdate(update);return{status:200,body:{ok:true}};}catch(e){if(e instanceof TelegramUpdateBusy)return{status:503,body:{error:'Update is already processing; retry shortly.'}};console.error('Telegram update processing failed:',e instanceof Error?e.message:'unknown');return{status:500,body:{error:'Update processing failed; Telegram may retry.'}};}
}




















