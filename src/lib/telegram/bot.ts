import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { allowedTelegramGroup, authorizedTelegramGroupSender, callbackBelongsToActor, duplicateUpdateDisposition, formatTelegramRupiah, parseTelegramCallback, parseTelegramCommand, telegramId } from './core';
import { answerTelegramCallback, sendTelegramMessage, type InlineKeyboard } from './client';
import { applyExtraction, buildAggregateReport, canFinalizeRecap, emptyRecap, extractRecapMessage, parseIndonesianRupiah, recapIssues, recapTotals, type RecapDraft } from './recap';
import { correctTelegramPhotoFromText, handleTelegramPhoto, handleTelegramVisionCallback, sendLatestPhotoReview, visionCallbackFromData } from './photo-flow';
import { calculateUnrecordedQuantity, correctedStockDeduction, correctionDelta, inventoryCallback, parseInventoryCallback, type InventoryCallbackAction } from './inventory';
import { prepareInventoryReview, postTelegramInventory, inventoryPreview, TelegramInventoryError } from '@/lib/services/telegram-inventory';
import { cashOnHandAt, shiftOpening } from '@/lib/automation';
import { combinedBalanceAt, setCombinedBalance } from '@/lib/services/combined-balance';
import { identifyTelegramActor, configuredTelegramOwners, type TelegramActor } from './identity';
import { handleGroupAssistantMessage, handleOwnerCallback, handleOwnerMessage } from './owner-assistant';
import { authorizedOwnerPrivateChat } from './owner-intent';

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
 const reclaimed=await prisma.telegramUpdate.updateMany({where:{updateId,OR:[{status:'FAILED'},{status:'PROCESSING',leaseUntil:{lt:now}}]},data:{status:'PROCESSING',attempts:{increment:1},leaseUntil,lastError:null}});
 if(reclaimed.count===1)return 'CLAIMED';
 const current=await prisma.telegramUpdate.findUnique({where:{updateId},select:{status:true,leaseUntil:true}});
 const disposition=duplicateUpdateDisposition(current?.status??null,current?.leaseUntil??null,now);
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
  [{text:'🕒 Mulai shift',callback_data:'rcms:group:menu:shift_open'}],
  [{text:'🧾 Rekap shift',callback_data:'rcms:group:menu:rekap'}],
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
function stripBotMention(text:string){const username=configuredBotUsername();return username?text.replace(new RegExp('@'+escapeRegex(username),'ig'),' ').replace(/\s+/g,' ').trim():text.trim();}
function addressedToGroupAssistant(m:TelegramMessage){const username=configuredBotUsername();if(!username)return false;const mention=!!m.text&&new RegExp('@'+escapeRegex(username)+'\\b','i').test(m.text);const reply=m.reply_to_message?.from;return mention||!!reply?.is_bot&&reply.username?.toLocaleLowerCase('id-ID')===username;}
function naturalRecapStart(text:string){const clean=text.trim().replace(/^@\w+\s*/,'');const match=/^(?:(?:halo|hai)\s+)?(?:(?:aku|saya|kami)\s+)?(?:(?:mau|ingin|boleh|tolong)\s+)?(?:(?:mulai|buka|buat|lanjut)\s+)?(?:rekap|laporan|lapor)(?:\s+(?:shift|hari\s+ini|penjualan|jualan))?(?:\s+(pagi|siang|malam))?[.!?]*$/i.exec(clean);return match?{shiftLabel:match[1]?.toLocaleLowerCase('id-ID')??null}:null;}
function formatDraft(d:RecapDraft):string{
 const totals=recapTotals(d);
 const labels:{[K in keyof typeof totals]:string}={service_volume:'Volume jasa',service_fee:'Biaya jasa',sale:'Penjualan barang',expense:'Pengeluaran',cash_balance:'Saldo kas akhir',electronic_balance:'Saldo elektronik akhir',total_balance:'Saldo total (kas + elektronik)'};
 const rows=(Object.keys(labels) as (keyof typeof totals)[]).filter(k=>k!=='cash_balance'&&k!=='electronic_balance').map(k=>labels[k]+': '+formatTelegramRupiah(BigInt(totals[k])));
 const detail=d.entries.map(e=>'• '+e.label+': '+formatTelegramRupiah(parseIndonesianRupiah(e.amount) ?? 0n)+(e.category==='service_volume'?' (volume)':e.category==='service_fee'?' (biaya jasa)':e.category==='sale'?' (penjualan)':e.category==='expense'?' (pengeluaran)':e.category==='cash_balance'?' (legacy kas akhir)':e.category==='electronic_balance'?' (legacy saldo elektronik)':e.category==='total_balance'?' (saldo total)':''));
 return 'Draf rekap'+(d.shiftLabel?' — shift '+d.shiftLabel:'')+':\n'+rows.join('\n')+(detail.length?'\n\nRincian:\n'+detail.join('\n'):'')+'\n\nTidak ada transaksi atau stok RMCS yang diubah.';
}
type ShiftOpeningLine={productId:number;name:string;provider?:string|null;sku:string|null;expectedQty:number;actualQty:number|null};
type ShiftOpeningPayload={version:1;stage:'CHECK'|'COUNT'|'REVIEW';shiftStart:string;shiftLabel:string|null;openingBalance:string;openedByIdentityId:string;lines:ShiftOpeningLine[];reviewStatus?:'CLEAR'|'OWNER_REVIEW';startedAt?:string;closedAt?:string;closingReportId?:string};
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
function shiftOpeningSummary(payload:ShiftOpeningPayload){
 const differences=payload.lines.filter(line=>line.actualQty!==null&&line.actualQty!==line.expectedQty);
 return payload.lines.length?payload.lines.map((line,index)=>`${index+1}. ${line.name}${line.provider?' · '+line.provider:''}${line.sku?' · SKU '+line.sku:''}: RMCS ${line.expectedQty} · fisik ${line.actualQty??line.expectedQty}${line.actualQty!==null&&line.actualQty!==line.expectedQty?' · selisih '+(line.actualQty-line.expectedQty):''}`).join('\n'):'Tidak ada voucher atau barang cepat laku yang terdeteksi untuk dihitung.';
}
async function sendShiftOpeningDraft(chatId:bigint,row:{id:string;payload:unknown}){
 const payload=shiftOpeningPayload(row.payload);if(!payload)return sendTelegramMessage(chatId,'Hitungan awal shift tidak dapat dibaca. Batalkan lalu mulai /shift kembali.');
 const list=shiftOpeningSummary(payload);
 if(payload.stage==='COUNT')return sendTelegramMessage(chatId,'Kirim hanya barang yang jumlah fisiknya berbeda, satu per baris. Contoh:\n1 16\nAxis 16 pcs\n\nBarang yang tidak disebut dianggap sesuai angka RMCS. Gunakan nama persis dari daftar atau nomor di depannya.');
 const isCheck=payload.stage==='CHECK';
 const header=isCheck?'🕒 CEK STOK AWAL SHIFT\nBandingkan stok fisik dengan angka RMCS berikut.':'🕒 TINJAU STOK AWAL SHIFT';
 const footer=isCheck?'Jika ada selisih, tekan “Ada selisih” lalu kirim hanya nama/nomor barang dan jumlah fisiknya. Barang lain dianggap sesuai. Tidak ada stok yang diubah.':'Selisih akan dicatat untuk tinjauan Owner. Stok RMCS tidak diubah dan selisih tidak dianggap penjualan.';
 const confirmFooter= isCheck?'':(payload.lines.some(line=>line.actualQty!==null&&line.actualQty!==line.expectedQty)?'Konfirmasi untuk memulai shift.':'Semua jumlah cocok. Stok RMCS tidak diubah. Konfirmasi untuk memulai shift.');
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
  updates.set(line.productId,quantity);
 }
 return{updates,unknown};
}
async function relevantShiftOpeningProducts(){
 const since=new Date(Date.now()-30*24*60*60_000);
 const movers=await prisma.saleItem.groupBy({by:['productId'],where:{sale:{is:{kind:'SALE',createdAt:{gte:since}}}},_sum:{qty:true},orderBy:{_sum:{qty:'desc'}},take:6});
 const voucherAndCigarettes=await prisma.product.findMany({where:{OR:[{category:{name:{contains:'voucher',mode:'insensitive'}}},{category:{name:{contains:'rokok',mode:'insensitive'}}},{name:{contains:'voucher',mode:'insensitive'}},{name:{contains:'rokok',mode:'insensitive'}}]},orderBy:[{provider:'asc'},{name:'asc'}],select:{id:true,name:true,provider:true,sku:true,stock:true}});
 const oilProducts=await prisma.product.findMany({where:{OR:[{category:{name:{contains:'minyak',mode:'insensitive'}}},{name:{contains:'minyak',mode:'insensitive'}}]},orderBy:[{stock:'desc'},{name:'asc'}],take:2,select:{id:true,name:true,provider:true,sku:true,stock:true}});
 const ids=[...new Set([...voucherAndCigarettes.map(row=>row.id),...oilProducts.map(row=>row.id),...movers.map(row=>row.productId)])];
 const products=await prisma.product.findMany({where:{id:{in:ids}},select:{id:true,name:true,provider:true,sku:true,stock:true}});const byId=new Map(products.map(row=>[row.id,row]));
 return ids.flatMap(id=>{const row=byId.get(id);return row?[row]:[];});
}
async function activeShiftOpening(chatId:bigint,identityId:string){
 const rows=await prisma.telegramDraft.findMany({where:{chatId,telegramIdentityId:identityId,kind:'SHIFT_OPENING',status:'CONFIRMED'},orderBy:{createdAt:'desc'},take:12});
 for(const row of rows){const payload=shiftOpeningPayload(row.payload);if(payload&&!payload.closedAt)return{row,payload};}
 return null;
}
async function startShiftOpening(chatId:bigint,actor:TelegramActor,shiftLabel:string|null=null){
 const key={chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}};
 const session=await prisma.telegramSession.findUnique({where:key});
 if(session&&session.expiresAt>new Date()){
  const current=session.draftId?await prisma.telegramDraft.findUnique({where:{id:session.draftId}}):null;
  if(session.state==='OPENING'&&current?.kind==='SHIFT_OPENING'&&current.status==='PENDING')return sendShiftOpeningDraft(chatId,current);
  if(session.state==='REPORTING'&&current?.kind==='SHIFT_RECAP'&&current.status==='PENDING')return sendTelegramMessage(chatId,'Rekap shift masih berjalan. Selesaikan dengan /rekap sebelum membuka shift berikutnya.');
 }
 if(session){if(session.draftId)await prisma.telegramDraft.updateMany({where:{id:session.draftId,status:'PENDING'},data:{status:'EXPIRED'}});await prisma.telegramSession.deleteMany({where:{id:session.id}});}
 const active=await activeShiftOpening(chatId,actor.identityId);
 if(active)return sendLongTelegramMessage(chatId,'Shift Anda sudah dibuka. Stok awal tersimpan. Gunakan /rekap saat shift selesai.\n\n'+shiftOpeningSummary(active.payload));
 const opening=await captureShiftOpeningBalance(),products=await relevantShiftOpeningProducts();
 const payload:ShiftOpeningPayload={version:1,stage:'CHECK',shiftStart:opening.start.toISOString(),shiftLabel,openingBalance:opening.balance.toString(),openedByIdentityId:actor.identityId,lines:products.map(product=>({productId:product.id,name:product.name,provider:product.provider,sku:product.sku,expectedQty:product.stock,actualQty:null}))};
 try{
  const row=await prisma.$transaction(async tx=>{
   const draft=await tx.telegramDraft.create({data:{userId:actor.linkedUserId,telegramIdentityId:actor.identityId,chatId,kind:'SHIFT_OPENING',status:'PENDING',expiresAt:new Date(Date.now()+OPENING_TTL),payload:payload as object}});
   await tx.telegramSession.create({data:{chatId,userId:actor.linkedUserId,telegramIdentityId:actor.identityId,state:'OPENING',draftId:draft.id,expiresAt:new Date(Date.now()+OPENING_TTL)}});
   return draft;
  });
  return sendShiftOpeningDraft(chatId,row);
 }catch(error){if((error as {code?:string}).code!=='P2002')throw error;const current=await prisma.telegramSession.findUnique({where:key});const row=current?.draftId?await prisma.telegramDraft.findUnique({where:{id:current.draftId}}):null;if(current?.state==='OPENING'&&row?.kind==='SHIFT_OPENING')return sendShiftOpeningDraft(chatId,row);return sendTelegramMessage(chatId,'Sesi shift berubah bersamaan. Periksa /status lalu coba lagi.');}
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
 const next:ShiftOpeningPayload={...payload,stage:'REVIEW',lines,reviewStatus:lines.some(line=>line.actualQty!==line.expectedQty)?'OWNER_REVIEW':'CLEAR'};
 const saved=await prisma.telegramDraft.updateMany({where:{id:row.id,kind:'SHIFT_OPENING',status:'PENDING',updatedAt:row.updatedAt},data:{payload:next as object}});
 if(saved.count!==1){await sendTelegramMessage(chatId,'Hitungan berubah bersamaan. Buka /shift untuk melihat data terbaru.');return true;}
 await sendShiftOpeningDraft(chatId,{id:row.id,payload:next});return true;
}
async function handleShiftOpeningCallback(c:TelegramCallback,actor:TelegramActor,chatId:bigint){
 const match=/^rcms:shiftopen:(same|diff|confirm|edit|cancel):([A-Za-z0-9_-]{10,40})$/.exec(c.data??'');if(!match)return false;
 const row=await prisma.telegramDraft.findUnique({where:{id:match[2]}}),payload=shiftOpeningPayload(row?.payload);
 if(!row||row.kind!=='SHIFT_OPENING'||row.chatId!==chatId||row.telegramIdentityId!==actor.identityId||!payload||row.status!=='PENDING'){await answerTelegramCallback(c.id,'Tombol tidak aktif atau sesi shift bukan milik Anda.');return true;}
 if(match[1]==='cancel'){
  await prisma.$transaction(async tx=>{await tx.telegramDraft.updateMany({where:{id:row.id,status:'PENDING'},data:{status:'CANCELLED'}});await tx.telegramSession.deleteMany({where:{chatId,telegramIdentityId:actor.identityId,draftId:row.id,state:'OPENING'}});});
  await answerTelegramCallback(c.id,'Buka shift dibatalkan.');return sendTelegramMessage(chatId,'Proses buka shift dibatalkan. Stok RMCS tidak berubah.');
 }
 if(match[1]==='diff'||match[1]==='edit'){
  const next={...payload,stage:'COUNT' as const};const saved=await prisma.telegramDraft.updateMany({where:{id:row.id,status:'PENDING',updatedAt:row.updatedAt},data:{payload:next as object}});
  if(!saved.count){await answerTelegramCallback(c.id,'Sesi berubah. Jalankan /shift untuk melihat versi terbaru.');return true;}
  await answerTelegramCallback(c.id,'Kirim jumlah fisik yang berbeda.');return sendShiftOpeningDraft(chatId,{id:row.id,payload:next});
 }
 if(match[1]==='same'&&payload.stage!=='CHECK'||match[1]==='confirm'&&payload.stage!=='REVIEW'){await answerTelegramCallback(c.id,'Tinjau hitungan terbaru dahulu.');return true;}
 const lines=match[1]==='same'?payload.lines.map(line=>({...line,actualQty:line.expectedQty})):payload.lines;
 const products=await prisma.product.findMany({where:{id:{in:lines.map(line=>line.productId)}},select:{id:true,stock:true}}),stocks=new Map(products.map(product=>[product.id,product.stock]));
 if(lines.some(line=>stocks.get(line.productId)!==line.expectedQty)){
  await prisma.$transaction(async tx=>{await tx.telegramDraft.updateMany({where:{id:row.id,status:'PENDING'},data:{status:'CANCELLED'}});await tx.telegramSession.deleteMany({where:{chatId,telegramIdentityId:actor.identityId,draftId:row.id,state:'OPENING'}});});
  await answerTelegramCallback(c.id,'Stok RMCS berubah.');return sendTelegramMessage(chatId,'Stok RMCS berubah saat hitungan dilakukan. Proses dibatalkan; tekan /shift lalu cocokkan lagi dengan angka terbaru.');
 }
 const now=new Date(),differences=lines.filter(line=>line.actualQty!==line.expectedQty),next:ShiftOpeningPayload={...payload,stage:'REVIEW',shiftStart:now.toISOString(),lines,reviewStatus:differences.length?'OWNER_REVIEW':'CLEAR',startedAt:now.toISOString()};
 const result=await prisma.$transaction(async tx=>{
  const claimed=await tx.telegramDraft.updateMany({where:{id:row.id,status:'PENDING'},data:{status:'PROCESSING'}});if(claimed.count!==1)return false;
  await tx.telegramDraft.update({where:{id:row.id},data:{status:'CONFIRMED',confirmedAt:new Date(),expiresAt:new Date(Date.now()+36*60*60_000),payload:next as object}});
  await tx.telegramSession.deleteMany({where:{chatId,telegramIdentityId:actor.identityId,draftId:row.id,state:'OPENING'}});return true;
 });
 if(!result){await answerTelegramCallback(c.id,'Shift sudah diproses.');return true;}
 await answerTelegramCallback(c.id,differences.length?'Shift dibuka; selisih dicatat.':'Shift dibuka.');
 return sendLongTelegramMessage(chatId,'✅ SHIFT DIMULAI\nStok awal tercatat:\n'+shiftOpeningSummary(next)+(differences.length?'\n\n⚠️ Ada selisih stok. Dicatat untuk tinjauan Owner; tidak dianggap penjualan dan stok RMCS tidak diubah.':'\n\nJumlah cocok. Stok RMCS tidak diubah.')+'\n\nSaat shift selesai, gunakan /rekap.');
}
async function captureShiftOpeningBalance(){
 const now=new Date(),cashOpening=await shiftOpening(now),ledgerCash=await cashOnHandAt(cashOpening.start),total=await combinedBalanceAt(now);
 return{start:now,balance:total+cashOpening.openingCash-ledgerCash};
}
function keyboard(id:string,revision:number):InlineKeyboard{return{inline_keyboard:[[{text:'Konfirmasi & Simpan',callback_data:'rcms:ok:'+id+':'+revision},{text:'Koreksi Rekap',callback_data:'rcms:edit:'+id+':'+revision}],[{text:'Batal',callback_data:'rcms:cancel:'+id+':'+revision}]]};}
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
async function sendReportDraft(chatId:bigint,actor:TelegramActor,sessionId:string,draftId:string){
 let session=await prisma.telegramSession.findUnique({where:{id:sessionId}}),row=await prisma.telegramDraft.findUnique({where:{id:draftId}});
 if(!session||session.draftId!==draftId||!row||row.status!=='PENDING')return;
 let draft=row.payload as unknown as RecapDraft;
 const opening=await activeShiftOpening(chatId,actor.identityId);
 if(!opening)return sendTelegramMessage(chatId,'Shift belum dibuka atau sudah ditutup. Gunakan /shift untuk mulai mencatat stok awal.');
 const openingStart=new Date(opening.payload.shiftStart);
 const prepared=await prepareInventoryReview(actor.linkedUserId,draft,new Date(),openingStart);
 if(JSON.stringify(prepared.draft)!==JSON.stringify(draft)){
  const revision=await saveInventoryDraft(sessionId,draftId,session.revision,prepared.draft);
  if(revision===null)return sendTelegramMessage(chatId,'Sesi berubah bersamaan. Jalankan /rekap untuk meninjau versi terbaru.');
  session={...session,revision};draft=prepared.draft;
 }
 const openingBalance=BigInt(opening.payload.openingBalance);
 const totals=recapTotals(draft);
 const hasEndBalance=draft.entries.some(entry=>entry.category==='total_balance')||(draft.entries.some(entry=>entry.category==='cash_balance')&&draft.entries.some(entry=>entry.category==='electronic_balance'));
 const stockOpeningText='\n\nCEK STOK AWAL SHIFT\n'+shiftOpeningSummary(opening.payload)+(opening.payload.reviewStatus==='OWNER_REVIEW'?'\nSelisih tercatat untuk tinjauan Owner.':'');
 const balanceText='\n\nPENCOCOKAN SALDO\nSaldo awal shift (kas + elektronik): '+formatTelegramRupiah(openingBalance)+'\n'+(hasEndBalance?'Saldo akhir menurut rekap: '+formatTelegramRupiah(BigInt(totals.total_balance))+'\nPerubahan bersih: '+formatTelegramRupiah(BigInt(totals.total_balance)-openingBalance):'Saldo akhir belum dicatat di rekap.');
 const issues=recapIssues(draft),stockRows:string[]=[];
 const productIds=[...new Set((draft.inventoryLines??[]).flatMap(line=>line.productId?[line.productId]:[]))];
 const products=await prisma.product.findMany({where:{id:{in:productIds}},select:{id:true,name:true,stock:true,location:true}});
 const byId=new Map(products.map(product=>[product.id,product]));
 const unresolvedLines=(draft.inventoryLines??[]).filter(line=>!line.productId||line.mappingStatus!=='MATCHED');
 for(const line of unresolvedLines)stockRows.push('• '+line.label+': '+line.quantity+' '+line.unit+' — '+(line.mappingStatus==='AMBIGUOUS'?'pilih varian katalog':line.mappingStatus==='UNMATCHED'?'tidak ditemukan; perlu owner':'menunggu owner'));
 const appSalesLabel=actor.linkedUserId===null?'total transaksi Web App toko pada shift ini':'transaksi Web App Anda pada shift ini';
 const grouped=new Map<number,typeof draft.inventoryLines>();for(const line of draft.inventoryLines??[])if(line.productId)grouped.set(line.productId,[...(grouped.get(line.productId)??[]),line]);
 let stockInsufficient=false;
 for(const [productId,lines] of grouped){const product=byId.get(productId);if(!product||!lines)continue;const quantity=lines.reduce((sum,line)=>sum+line.quantity,0),recorded=Math.max(...lines.map(line=>line.recordedWebQty??0)),coverage=lines[0].coverage;const applied=calculateUnrecordedQuantity(quantity,recorded,coverage==='INCLUDES_APP_SALES'?'INCLUDES_APP_SALES':'UNRECORDED_ONLY')??quantity;stockRows.push('• '+lines.map(line=>line.label).join(' / ')+': terjual '+quantity+' pcs; stok saat ini '+product.stock+(product.location?.name?' ('+product.location.name+')':'')+'; '+appSalesLabel+' '+recorded+'; dikurangi '+applied+'; sisa '+(product.stock-applied));if(applied>product.stock)stockInsufficient=true;}
 const stockText=stockRows.length?'\n\nPERUBAHAN STOK (pratinjau):\n'+stockRows.join('\n')+'\n\nJumlah Web App hanya dikurangkan jika Anda menyatakan jumlah itu sudah termasuk dalam rekap.':'\n\nTidak ada jumlah unit eksplisit; stok tidak diubah.';
 const allIssues=[...issues,...(stockInsufficient?['Stok saat ini tidak cukup untuk seluruh jumlah yang diajukan. Minta owner meninjau; laporan tidak akan diposting sebagian.']:[])]; await sendTelegramMessage(chatId,formatDraft(draft)+balanceText+stockOpeningText+stockText+(allIssues.length?'\n\nPerlu dilengkapi:\n• '+allIssues.join('\n• '):'\n\nPeriksa rekap dan perubahan stok sebelum konfirmasi.'),allIssues.length?undefined:keyboard(draftId,session.revision));
 const coveragePrompted=new Set<number>();for(const line of draft.inventoryLines??[]){
  if(line.mappingStatus==='AMBIGUOUS'){
   const candidates=await prisma.product.findMany({where:{id:{in:line.candidateProductIds}},orderBy:{name:'asc'},select:{id:true,name:true,stock:true}});
   await sendTelegramMessage(chatId,'Pilih produk katalog yang cocok untuk “'+line.label+'” ('+line.quantity+' '+line.unit+'):',inventoryKeyboard(draftId,draft.inventoryLines!.findIndex(item=>item.id===line.id),session.revision,candidates.map(product=>({text:product.name+' · stok '+product.stock,action:'select',value:String(product.id)}))));
  }else if(line.mappingStatus==='UNMATCHED'){
  await sendTelegramMessage(chatId,'Produk “'+line.label+'” tidak ditemukan. Tandai untuk tinjauan owner:',inventoryKeyboard(draftId,draft.inventoryLines!.findIndex(item=>item.id===line.id),session.revision,[{text:'Minta tinjauan owner',action:'owner',value:'-'}]));
  }else if(line.mappingStatus==='MATCHED'&&line.productId!==null&&!coveragePrompted.has(line.productId)&&(line.recordedWebQty??0)>0&&line.coverage==='UNDECIDED'){coveragePrompted.add(line.productId);const reported=(draft.inventoryLines??[]).filter(item=>item.productId===line.productId).reduce((sum,item)=>sum+item.quantity,0);
   await sendTelegramMessage(chatId,'Produk “'+line.label+'”: '+appSalesLabel+' '+line.recordedWebQty+' unit. Apakah jumlah '+reported+' di rekap sudah termasuk '+line.recordedWebQty+' unit tersebut?',inventoryKeyboard(draftId,draft.inventoryLines!.findIndex(item=>item.id===line.id),session.revision,[{text:'Ya, sudah termasuk',action:'included',value:'-'},{text:'Tidak, jumlah rekap tambahan',action:'unrecorded',value:'-'}]));
  }
 }
}
async function handleInventoryCallback(c:TelegramCallback,actor:TelegramActor,chatId:bigint){
 const parsed=parseInventoryCallback(c.data);if(!parsed)return false;
 const session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 if(!session||session.draftId!==parsed.draftId||session.revision!==parsed.revision){await answerTelegramCallback(c.id,'Draf berubah. Gunakan tombol terbaru atau /rekap.');return true;}
 const row=await prisma.telegramDraft.findUnique({where:{id:parsed.draftId}});if(!row||row.status!=='PENDING'){await answerTelegramCallback(c.id,'Draf tidak aktif.');return true;}
 const draft=row.payload as unknown as RecapDraft,line=(draft.inventoryLines??[])[parsed.lineIndex];if(!line){await answerTelegramCallback(c.id,'Baris stok tidak ditemukan.');return true;}
 let next:RecapDraft={...draft,inventoryLines:[...(draft.inventoryLines??[])]};const index=next.inventoryLines!.findIndex(item=>item.id===line.id),items=next.inventoryLines!;
 if(parsed.action==='select'){
  const productId=Number(parsed.value);if(!Number.isSafeInteger(productId)||!line.candidateProductIds.includes(productId)){await answerTelegramCallback(c.id,'Pilihan produk tidak valid.');return true;}
  items[index]={...line,productId,candidateProductIds:[productId],mappingStatus:'MATCHED',coverage:'UNDECIDED',recordedWebQty:undefined,appliedQty:undefined};
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
 const revision=await saveInventoryDraft(session.id,row.id,session.revision,next);if(revision===null){await answerTelegramCallback(c.id,'Draf berubah bersamaan; gunakan /rekap.');return true;}
 await answerTelegramCallback(c.id,parsed.action==='owner'?'Ditandai untuk tinjauan owner.':'Pilihan tersimpan.');
 if(parsed.action==='owner'){
  await sendTelegramMessage(chatId,'Permintaan tinjauan produk '+line.label+' dicatat. Owner perlu memastikan pemetaan sebelum rekap dapat dikonfirmasi.');
  const linkedOwners=await prisma.user.findMany({where:{role:'owner',active:true,telegramUserId:{not:null}},select:{telegramUserId:true}});
  const ownerIds=new Set([...configuredTelegramOwners(),...linkedOwners.flatMap(owner=>owner.telegramUserId===null?[]:[owner.telegramUserId.toString()])]);
  const employee=await prisma.telegramIdentity.findUnique({where:{id:actor.identityId},select:{displayName:true}});
  for(const ownerId of ownerIds)await sendTelegramMessage(BigInt(ownerId),'Tinjauan produk Telegram diperlukan\nKaryawan: '+(employee?.displayName??actor.displayName)+'\nProduk dari rekap: '+line.label+' ('+line.quantity+' '+line.unit+')\nGrup: '+chatId+'\nBuka RMCS dan pastikan produk katalog sebelum rekap dikonfirmasi.');
 }
 await sendReportDraft(chatId,actor,session.id,row.id);return true;
}
async function openReport(chatId:bigint,actor:TelegramActor,shiftLabel:string|null=null){
 const chatSession=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 if(chatSession?.state==='OPENING'&&chatSession.draftId){const openingDraft=await prisma.telegramDraft.findUnique({where:{id:chatSession.draftId}});if(openingDraft?.kind==='SHIFT_OPENING'&&openingDraft.status==='PENDING')return sendShiftOpeningDraft(chatId,openingDraft);}
 const opening=await activeShiftOpening(chatId,actor.identityId);
 if(!opening)return startShiftOpening(chatId,actor,shiftLabel);
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
 if(draft)return sendReportDraft(chatId,actor,session.id,draft.id);
 return sendTelegramMessage(chatId,formatDraft(data)+"\n\nSilakan kirim ringkasan shift atau foto buku rekap.");
}
async function recordReportMessage(message:TelegramMessage,actor:TelegramActor,updateId:bigint){
 const chatId=telegramId(message.chat.id);if(chatId===null||!message.text)return;
 const session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
 if(!session||session.expiresAt<=new Date()||!session.draftId)return;
 const stored=await prisma.telegramDraft.findUnique({where:{id:session.draftId}});
 if(!stored||stored.status!=='PENDING')return;
 const prior=stored.payload as unknown as RecapDraft;
 if(prior.correctionPhotoId&&await correctTelegramPhotoFromText(message,actor.identityId,updateId))return;
 if(prior.processedUpdateIds?.includes(updateId.toString())){await sendReportDraft(chatId,actor,session.id,stored.id);return;}
 const extraction=await extractRecapMessage(message.text,prior);
 let saved:RecapDraft|null=null;let savedRevision:number|null=null;
 for(let attempt=0;attempt<3&&!saved;attempt++){
  const current=await prisma.telegramSession.findUnique({where:{id:session.id}});
  if(!current||current.draftId!==stored.id)return;
  const currentDraft=await prisma.telegramDraft.findUnique({where:{id:stored.id}});
  if(!currentDraft||currentDraft.status!=='PENDING')return;
  const base=currentDraft.payload as unknown as RecapDraft;
  if(base.processedUpdateIds?.includes(updateId.toString())){saved=base;savedRevision=current.revision;break;}
  const merged=applyExtraction(base,extraction,message.text,updateId.toString());
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
 const approved=await prisma.telegramReportCorrection.aggregate({where:{postingId:posting.id,status:'APPROVED'},_sum:{deltaQty:true}});
 const currentQty=posting.reportedQty+(approved._sum.deltaQty??0);if(currentQty===quantity)return sendTelegramMessage(chatId,'Jumlah tersebut sudah sesuai. Tidak ada koreksi yang dibuat.');
 const operationKey=createHash('sha256').update([report.id,posting.id,actor.telegramUserId,quantity,reason.toLocaleLowerCase('id-ID')].join('|')).digest('hex');
 const prior=await prisma.telegramReportCorrection.findUnique({where:{operationKey}});if(prior)return sendTelegramMessage(chatId,prior.status==='PENDING'?'Permintaan koreksi yang sama masih menunggu owner.':'Permintaan koreksi yang sama sudah diproses.');
 const correction=await prisma.telegramReportCorrection.create({data:{operationKey,reportId:report.id,postingId:posting.id,requestedById:actor.linkedUserId,requestedByTelegramIdentityId:actor.identityId,reason:reason.slice(0,500),previousQty:currentQty,requestedQty:quantity,deltaQty:quantity-currentQty}});
 await sendTelegramMessage(chatId,'Permintaan koreksi tercatat. Jumlah terjual pada rekap saat ini '+currentQty+'; target '+quantity+'. Owner harus menyetujui sebelum stok berubah.',{inline_keyboard:[[{text:'Setujui koreksi',callback_data:'rcms:cr:'+correction.id+':a'},{text:'Tolak',callback_data:'rcms:cr:'+correction.id+':r'}]]});
}
async function handleCorrectionCallback(c:TelegramCallback,actor:TelegramActor,chatId:bigint){
 const match=/^rcms:cr:([A-Za-z0-9_-]{10,40}):(a|r)$/.exec(c.data??'');if(!match)return false;
 if(!actor.isOwner){await answerTelegramCallback(c.id,'Hanya owner yang telah diotorisasi yang dapat menyetujui koreksi.');return true;}
 let result:{status:string;delta:number;stockDelta:number;productName:string}|null=null;
 try{
  result=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "TelegramReportCorrection" WHERE "id" = ${match[1]} FOR UPDATE`;
   const correction=await tx.telegramReportCorrection.findUnique({where:{id:match[1]},include:{posting:{include:{product:true}},report:{select:{chatId:true}}}});
   if(!correction)throw new Error('CORRECTION_NOT_FOUND');
   if(correction.report.chatId!==chatId)throw new Error('CORRECTION_WRONG_CHAT');
   if(correction.status!=='PENDING')return{status:'ALREADY',delta:0,stockDelta:0,productName:correction.posting.product.name};
   if(match[2]==='r'){
    await tx.telegramReportCorrection.update({where:{id:correction.id},data:{status:'REJECTED',approvedById:actor.linkedUserId,approvedByTelegramIdentityId:actor.identityId,approvedAt:new Date()}});
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
   if(stockDelta>0){const changed=await tx.product.updateMany({where:{id:product.id,stock:{gte:stockDelta}},data:{stock:{decrement:stockDelta}}});if(changed.count!==1)throw new Error('CORRECTION_STOCK_INSUFFICIENT');}
   else if(stockDelta<0)await tx.product.update({where:{id:product.id},data:{stock:{increment:-stockDelta}}});
   const movement=stockDelta===0?null:await tx.inventoryMovement.create({data:{productId:product.id,type:'TELEGRAM_SHIFT_RECAP_CORRECTION',qty:-stockDelta,costAtTime:product.costPrice,note:`Koreksi rekap ${correction.reportId}; alasan: ${correction.reason}`,userId:actor.linkedUserId,telegramIdentityId:actor.identityId},select:{id:true}});
   await tx.telegramReportCorrection.update({where:{id:correction.id},data:{status:'APPROVED',approvedById:actor.linkedUserId,approvedByTelegramIdentityId:actor.identityId,approvedAt:new Date(),deltaQty:delta,movementId:movement?.id??null}});
   return{status:'APPROVED',delta,stockDelta,productName:product.name};
  },{isolationLevel:'Serializable',timeout:15000});
 }catch(error){const message=(error as Error).message;if(message==='CORRECTION_WRONG_CHAT'){await answerTelegramCallback(c.id,'Tombol koreksi hanya berlaku di grup asal rekap.');return true;}if(message==='CORRECTION_STALE'||message==='CORRECTION_STOCK_INSUFFICIENT'||message==='CORRECTION_COVERAGE_REVIEW'){await answerTelegramCallback(c.id,'Koreksi tidak dapat diterapkan: '+(message==='CORRECTION_STALE'?'rekap telah dikoreksi sebelumnya.':message==='CORRECTION_COVERAGE_REVIEW'?'jumlah terjual bertentangan dengan penjualan Web App.':'stok tidak cukup untuk koreksi.'));return true;}throw error;}
 await answerTelegramCallback(c.id,result.status==='APPROVED'?'Koreksi disetujui.':result.status==='REJECTED'?'Koreksi ditolak.':'Permintaan sudah diproses.');
 if(result.status==='APPROVED')await sendTelegramMessage(chatId,'Koreksi '+result.productName+' disetujui. Perubahan stok: '+(result.stockDelta>0?'−'+result.stockDelta:result.stockDelta<0?'+'+Math.abs(result.stockDelta):'tidak berubah')+' unit. Jumlah terjual pada rekap: '+(result.delta>0?'bertambah '+result.delta:result.delta<0?'berkurang '+Math.abs(result.delta):'tetap')+'.');
 else if(result.status==='REJECTED')await sendTelegramMessage(chatId,'Permintaan koreksi stok ditolak owner.');
 return true;
}
async function handleCommand(m:TelegramMessage,actor:TelegramActor,command:string,args:string){
 const chatId=telegramId(m.chat.id);if(chatId===null)return;
 if(command==='menu')return sendTelegramMessage(chatId,groupMenuText(actor),groupMenuKeyboard(actor));
 if(command==='start')return sendTelegramMessage(chatId,'Pilih menu bot untuk mulai rekap, melihat status, atau cek barang. /menu menampilkan tombol fitur.',groupMenuKeyboard(actor));
 if(command==='shift')return startShiftOpening(chatId,actor,args.trim()||null);
 if(command==='rekap')return openReport(chatId,actor);
 if(command==='koreksi')return requestReportCorrection(chatId,actor,args);
 if(command==='status'){
  const [session,latest]=await Promise.all([prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}}),prisma.telegramShiftReport.findFirst({where:{telegramIdentityId:actor.identityId,chatId},orderBy:{confirmedAt:'desc'}})]);
  if(session?.state==='OPENING'&&session.draftId){const openingDraft=await prisma.telegramDraft.findUnique({where:{id:session.draftId}});if(openingDraft?.kind==='SHIFT_OPENING'&&openingDraft.status==='PENDING')return sendShiftOpeningDraft(chatId,openingDraft);}
  const activeOpening=await activeShiftOpening(chatId,actor.identityId);
  let result=session?.draftId?await prisma.telegramDraft.findUnique({where:{id:session.draftId}}):null;
  let message=result&&result.status==='PENDING'?formatDraft(result.payload as unknown as RecapDraft)+'\n\n'+(recapIssues(result.payload as unknown as RecapDraft).join('\n')||'Siap konfirmasi dengan tombol di pesan rekap.'):session?'Sesi rekap ada, tetapi drafnya tidak aktif. Gunakan /rekap.':'Tidak ada draf rekap aktif.';
  if(activeOpening){message='Shift sedang berjalan sejak '+new Date(activeOpening.payload.shiftStart).toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+'.\nSaldo awal (kas + elektronik): '+formatTelegramRupiah(BigInt(activeOpening.payload.openingBalance))+'\n\n'+shiftOpeningSummary(activeOpening.payload);if(session?.state==='REPORTING'&&result?.kind==='SHIFT_RECAP'&&result.status==='PENDING')message+='\n\n'+formatDraft(result.payload as unknown as RecapDraft)+'\n'+(recapIssues(result.payload as unknown as RecapDraft).join('\n')||'Rekap menunggu konfirmasi.');else message+='\n\nGunakan /rekap saat shift selesai.';}
  if(latest)message+='\n\nRekap terakhir dikonfirmasi: '+latest.confirmedAt.toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+'.';
  return sendLongTelegramMessage(chatId,message);
 }
 if(command==='batal'){
  const session=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}}});
  if(session?.draftId)await prisma.telegramDraft.updateMany({where:{id:session.draftId,status:'PENDING'},data:{status:'CANCELLED'}});
  await prisma.telegramSession.deleteMany({where:{chatId,telegramIdentityId:actor.identityId}});
  return sendTelegramMessage(chatId,session?.state==='OPENING'?'Proses buka shift dibatalkan. Stok RMCS tidak berubah.':'Sesi rekap dibatalkan. Tidak ada perubahan transaksi, stok, saldo, atau penutupan shift RMCS.');
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
 const m=c.message,chatId=m&&telegramId(m.chat.id);
 if(!m||chatId===null||chatId===undefined||!groupAllowed(m.chat)){await answerTelegramCallback(c.id,'Grup tidak diizinkan.');return;}
 if(visionCallbackFromData(c.data)){await handleTelegramVisionCallback(c,actor.identityId);return;}
 if(await handleInventoryCallback(c,actor,chatId))return;
 if(await handleCorrectionCallback(c,actor,chatId))return;
 const parsed=parseTelegramCallback(c.data);if(!parsed){await answerTelegramCallback(c.id,'Tombol tidak valid.');return;}
 const draft=await prisma.telegramDraft.findUnique({where:{id:parsed.draftId}});
 if(!draft||!callbackBelongsToActor(draft.telegramIdentityId,actor.identityId)||draft.chatId!==chatId||draft.kind!=='SHIFT_RECAP'){await answerTelegramCallback(c.id,'Draf ini milik karyawan lain dan tidak bisa Anda ubah.');return;}
 if(parsed.operation==='edit'){await answerTelegramCallback(c.id,'Silakan koreksi rekap.');await sendTelegramMessage(chatId,'Kirim nilai koreksi sebagai pesan baru, misalnya: rokok tadi salah bukan 175rb tapi 195rb atau axis salah bukan 7 pcs tapi 5 pcs.');return;}
 if(parsed.operation==='cancel'){
  const changed=await prisma.telegramDraft.updateMany({where:{id:draft.id,status:'PENDING'},data:{status:'CANCELLED'}});
  await prisma.telegramSession.deleteMany({where:{telegramIdentityId:actor.identityId,chatId,draftId:draft.id}});
  await answerTelegramCallback(c.id,changed.count?'Draf dibatalkan.':'Draf sudah diproses.');return;
 }

 const active=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId,telegramIdentityId:actor.identityId}},select:{id:true,draftId:true,revision:true}});
 if(!active||active.draftId!==draft.id||parsed.revision===undefined||parsed.revision!==active.revision){await answerTelegramCallback(c.id,'Ringkasan ini sudah berubah. Gunakan tombol pada ringkasan terbaru.');return;}
 if(draft.status!=='PENDING'||draft.expiresAt<=new Date()){await answerTelegramCallback(c.id,'Draf tidak aktif atau kedaluwarsa.');return;}
 const data=draft.payload as unknown as RecapDraft,issues=recapIssues(data);
 if(!canFinalizeRecap(data)){await answerTelegramCallback(c.id,'Belum lengkap. Lanjutkan pesan rekap dahulu.');return;}
 const shiftOpening=await activeShiftOpening(chatId,actor.identityId);
 if(!shiftOpening){await answerTelegramCallback(c.id,'Shift sudah ditutup atau perlu dibuka ulang.');return;}
 const shiftStart=new Date(shiftOpening.payload.shiftStart),openingBalance=BigInt(shiftOpening.payload.openingBalance),endingBalance=BigInt(recapTotals(data).total_balance);
 const openingStockSnapshot={draftId:shiftOpening.row.id,startedAt:shiftOpening.payload.startedAt??shiftOpening.payload.shiftStart,reviewStatus:shiftOpening.payload.reviewStatus??'CLEAR',lines:shiftOpening.payload.lines};
 const payload={...buildAggregateReport(data),openingStockSnapshot,balanceReconciliation:{openingBalance:openingBalance.toString(),endingBalance:endingBalance.toString(),netChange:(endingBalance-openingBalance).toString()}};
 let postings:{productId:number;appliedQty:number;lineId:string}[]=[],reportIdResult='';
 try{
  await prisma.$transaction(async tx=>{
   const sessionClaim=await tx.telegramSession.updateMany({where:{id:active!.id,draftId:draft.id,state:'REPORTING',revision:parsed.revision},data:{revision:{increment:1}}});
   if(sessionClaim.count!==1)throw new Error('STALE_REPORT_REVISION');
   const claimed=await tx.telegramDraft.updateMany({where:{id:draft.id,status:'PENDING'},data:{status:'PROCESSING'}});
   if(claimed.count!==1)throw new Error('DRAFT_ALREADY_PROCESSED');
   const report=await tx.telegramShiftReport.create({data:{draftId:draft.id,userId:actor.linkedUserId,telegramIdentityId:actor.identityId,chatId,shiftLabel:data.shiftLabel,payload},select:{id:true}});reportIdResult=report.id;
   postings=await postTelegramInventory(tx,report.id,actor.linkedUserId,actor.identityId,data,shiftStart,new Date());
   const openingClosed=await tx.telegramDraft.updateMany({where:{id:shiftOpening.row.id,status:'CONFIRMED'},data:{payload:{...shiftOpening.payload,closedAt:new Date().toISOString(),closingReportId:report.id} as object}});
   if(openingClosed.count!==1)throw new Error('SHIFT_OPENING_ALREADY_CLOSED');
   await tx.telegramShiftReport.update({where:{id:report.id},data:{payload:{...payload,inventoryPostings:postings} as object}});
   await setCombinedBalance(tx,{targetBalance:BigInt(recapTotals(data).total_balance),createdById:actor.linkedUserId,sourceDraftId:draft.id,note:'Saldo total diperbarui dari rekap shift yang dikonfirmasi.'});
   await tx.telegramDraft.update({where:{id:draft.id},data:{status:'CONFIRMED',confirmedAt:new Date()}});
   await tx.telegramSession.deleteMany({where:{telegramIdentityId:actor.identityId,chatId,draftId:draft.id}});
  },{isolationLevel:'Serializable',timeout:20000});
 }catch(e){
  if((e as Error).message==='DRAFT_ALREADY_PROCESSED'||(e as {code?:string}).code==='P2002'){await answerTelegramCallback(c.id,'Rekap sudah diproses sebelumnya.');return;}
  if((e as Error).message==='STALE_REPORT_REVISION'){await answerTelegramCallback(c.id,'Rekap berubah. Buka /rekap untuk meninjau versi terbaru.');return;}
  if((e as Error).message==='SHIFT_OPENING_ALREADY_CLOSED'){await answerTelegramCallback(c.id,'Shift ini sudah ditutup.');return;}
  if(e instanceof TelegramInventoryError){await answerTelegramCallback(c.id,e.message);await sendTelegramMessage(chatId,e.message+' Tidak ada stok yang diubah. Periksa /rekap atau minta tinjauan owner.');return;}
  throw e;
 }
 await answerTelegramCallback(c.id,'Rekap dikonfirmasi dan stok diperbarui.');
 const summary=postings.map(posting=>{const ids=posting.lineId.split(',');const label=ids.map(id=>(data.inventoryLines??[]).find(line=>line.id===id)?.label).filter(Boolean).join(' / ');return '• '+label+': '+posting.appliedQty+' unit dikurangi';}).join('\n');
 const correctionHelp=postings.map(posting=>' /koreksi '+reportIdResult+' '+posting.lineId+' <jumlah-baru> <alasan>').join('\n');
 await sendTelegramMessage(chatId,'✅ REKAP BERHASIL DISIMPAN'+(data.shiftLabel?'\nShift '+data.shiftLabel:'')+(summary?'\n\n'+summary:'\n\nTidak ada perubahan stok.')+'\n\nAdmin TF + TD: '+formatTelegramRupiah(BigInt(recapTotals(data).service_fee))+'\nPengeluaran: '+formatTelegramRupiah(BigInt(recapTotals(data).expense))+'\nSaldo awal (kas + elektronik): '+formatTelegramRupiah(openingBalance)+'\nSaldo akhir (kas + elektronik): '+formatTelegramRupiah(endingBalance)+'\nPerubahan bersih saldo: '+formatTelegramRupiah(endingBalance-openingBalance)+(postings.length?'\n\nID laporan: '+reportIdResult+'\nKoreksi stok setelah disimpan:'+correctionHelp:''));
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
 const assistantRequest=m?addressedToGroupAssistant(m):false;
 // Ignore ordinary group chatter before creating Telegram identities or update rows.
 if(!c&&!command&&!startRequest&&!assistantRequest){
  const existingIdentity=await prisma.telegramIdentity.findUnique({where:{telegramUserId:senderId},select:{id:true}});
  if(!existingIdentity)return false;
  const active=await prisma.telegramSession.findUnique({where:{chatId_telegramIdentityId:{chatId:BigInt(chat.id),telegramIdentityId:existingIdentity.id}},select:{state:true,draftId:true,expiresAt:true}});
  if(!active||!['REPORTING','OPENING'].includes(active.state)||!active.draftId||active.expiresAt<=new Date())return false;
 }
 const claim=await claimUpdate(id);if(claim==='PROCESSED')return true;if(claim==='BUSY')throw new TelegramUpdateBusy();
 try{
  const actor=await identifyTelegramActor(from,BigInt(chat.id));if(!actor)throw new Error('Invalid sender id');
  if(c)await handleCallback(c,actor);
  else if(m&&command)await handleCommand(m,actor,command.command,command.args);
  else if(m&&startRequest){
   const chatId=BigInt(chat.id),opening=await activeShiftOpening(chatId,actor.identityId);
   if(!opening){await startShiftOpening(chatId,actor,startRequest.shiftLabel);if(m.photo||m.document)await sendTelegramMessage(chatId,'Selesaikan cek stok awal dahulu. Setelah shift dimulai, kirim foto rekap lagi agar terbaca.');}
   else{await openReport(chatId,actor,startRequest.shiftLabel);if(m.photo||m.document)await handleTelegramPhoto(m,actor.identityId,id);else if(m.text)await recordReportMessage(m,actor,id);}
  }
  else if(m&&assistantRequest&&m.text){const text=stripBotMention(m.text);await handleGroupAssistantMessage({chatId:BigInt(chat.id),identityId:actor.identityId,text:text||'Tanya apa yang bisa saya bantu soal barang?',updateId:id.toString()});}
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


















