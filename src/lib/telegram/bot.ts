import { createHash, timingSafeEqual } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { allowedTelegramGroup, duplicateUpdateDisposition, formatTelegramRupiah, parseTelegramCallback, parseTelegramCommand, telegramId } from './core';
import { answerTelegramCallback, sendTelegramMessage, type InlineKeyboard } from './client';
import { applyExtraction, buildAggregateReport, canFinalizeRecap, emptyRecap, extractRecapMessage, parseIndonesianRupiah, recapIssues, recapTotals, type RecapDraft } from './recap';
import { correctTelegramPhotoFromText, handleTelegramPhoto, handleTelegramVisionCallback, sendLatestPhotoReview, visionCallbackFromData } from './photo-flow';
import { calculateUnrecordedQuantity, correctedStockDeduction, correctionDelta, inventoryCallback, parseInventoryCallback, type InventoryCallbackAction } from './inventory';
import { prepareInventoryReview, postTelegramInventory, inventoryPreview, TelegramInventoryError } from '@/lib/services/telegram-inventory';
import { shiftOpening } from '@/lib/automation';

type TelegramChat={id:number;type:string};
type TelegramUser={id:number;first_name?:string};
type TelegramPhoto={file_id:string;file_unique_id:string;width:number;height:number;file_size?:number};
type TelegramDocument={file_id:string;file_unique_id:string;file_name?:string;mime_type?:string;file_size?:number};
type TelegramMessage={message_id:number;chat:TelegramChat;from?:TelegramUser;text?:string;caption?:string;photo?:TelegramPhoto[];document?:TelegramDocument;media_group_id?:string;reply_to_message?:{message_id:number}};
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
async function linkAccount(chat:TelegramChat,from:TelegramUser,code:string){
 if(chat.type!=='private'||chat.id!==from.id)return sendTelegramMessage(chat.id,'Demi keamanan, proses /link hanya bisa dilakukan lewat chat pribadi dengan bot.');
 if(!/^[A-Za-z0-9_-]{32,64}$/.test(code))return sendTelegramMessage(chat.id,'Kode linking tidak valid. Minta owner membuat kode baru di Pengaturan RMCS.');
 const hash=createHash('sha256').update(code).digest('hex'), telegramUserId=telegramId(from.id);
 if(telegramUserId===null)throw new Error('Invalid Telegram user ID');
 let linked:{count:number};
 try{linked=await prisma.user.updateMany({where:{telegramLinkCodeHash:hash,telegramLinkExpiresAt:{gt:new Date()},active:true},data:{telegramUserId,telegramLinkCodeHash:null,telegramLinkExpiresAt:null}});}
 catch(e){if((e as {code?:string}).code!=='P2002')throw e;return sendTelegramMessage(chat.id,'Akun Telegram ini sudah tertaut ke akun RMCS lain. Minta owner menerbitkan kode baru.');}
 if(linked.count!==1)return sendTelegramMessage(chat.id,'Kode tidak cocok, sudah dipakai, atau kedaluwarsa. Minta owner membuat kode baru.');
 const user=await prisma.user.findUnique({where:{telegramUserId},select:{username:true}});
 return sendTelegramMessage(chat.id,'Akun Telegram berhasil ditautkan ke '+(user?.username||'akun RMCS')+'.');
}
function formatDraft(d:RecapDraft):string{
 const totals=recapTotals(d);
 const labels:{[K in keyof typeof totals]:string}={service_volume:'Volume jasa',service_fee:'Biaya jasa',sale:'Penjualan barang',expense:'Pengeluaran',cash_balance:'Saldo kas akhir',electronic_balance:'Saldo elektronik akhir'};
 const rows=(Object.keys(labels) as (keyof typeof totals)[]).map(k=>labels[k]+': '+formatTelegramRupiah(BigInt(totals[k])));
 const detail=d.entries.map(e=>'• '+e.label+': '+formatTelegramRupiah(parseIndonesianRupiah(e.amount) ?? 0n)+(e.category==='service_volume'?' (volume)':e.category==='service_fee'?' (biaya jasa)':e.category==='sale'?' (penjualan)':e.category==='expense'?' (pengeluaran)':e.category==='cash_balance'?' (kas akhir)':' (saldo elektronik)'));
 return 'Draf rekap'+(d.shiftLabel?' — shift '+d.shiftLabel:'')+':\n'+rows.join('\n')+(detail.length?'\n\nRincian:\n'+detail.join('\n'):'')+'\n\nTidak ada transaksi atau stok RMCS yang diubah.';
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
async function sendReportDraft(chatId:bigint,userId:number,sessionId:string,draftId:string){
 let session=await prisma.telegramSession.findUnique({where:{id:sessionId}}),row=await prisma.telegramDraft.findUnique({where:{id:draftId}});
 if(!session||session.draftId!==draftId||!row||row.status!=='PENDING')return;
 let draft=row.payload as unknown as RecapDraft;
 const prepared=await prepareInventoryReview(userId,draft);
 if(JSON.stringify(prepared.draft)!==JSON.stringify(draft)){
  const revision=await saveInventoryDraft(sessionId,draftId,session.revision,prepared.draft);
  if(revision===null)return sendTelegramMessage(chatId,'Sesi berubah bersamaan. Jalankan /rekap untuk meninjau versi terbaru.');
  session={...session,revision};draft=prepared.draft;
 }
 const issues=recapIssues(draft),stockRows:string[]=[];
 const productIds=[...new Set((draft.inventoryLines??[]).flatMap(line=>line.productId?[line.productId]:[]))];
 const products=await prisma.product.findMany({where:{id:{in:productIds}},select:{id:true,name:true,stock:true,location:true}});
 const byId=new Map(products.map(product=>[product.id,product]));
 const unresolvedLines=(draft.inventoryLines??[]).filter(line=>!line.productId||line.mappingStatus!=='MATCHED');
 for(const line of unresolvedLines)stockRows.push('• '+line.label+': '+line.quantity+' '+line.unit+' — '+(line.mappingStatus==='AMBIGUOUS'?'pilih varian katalog':line.mappingStatus==='UNMATCHED'?'tidak ditemukan; perlu owner':'menunggu owner'));
 const grouped=new Map<number,typeof draft.inventoryLines>();for(const line of draft.inventoryLines??[])if(line.productId)grouped.set(line.productId,[...(grouped.get(line.productId)??[]),line]);
 let stockInsufficient=false;
 for(const [productId,lines] of grouped){const product=byId.get(productId);if(!product||!lines)continue;const quantity=lines.reduce((sum,line)=>sum+line.quantity,0),recorded=Math.max(...lines.map(line=>line.recordedWebQty??0)),coverage=lines[0].coverage;const applied=calculateUnrecordedQuantity(quantity,recorded,coverage==='INCLUDES_APP_SALES'?'INCLUDES_APP_SALES':'UNRECORDED_ONLY')??quantity;stockRows.push('• '+lines.map(line=>line.label).join(' / ')+': terjual '+quantity+' pcs; stok saat ini '+product.stock+(product.location?.name?' ('+product.location.name+')':'')+'; tercatat Web App '+recorded+'; dikurangi '+applied+'; sisa '+(product.stock-applied));if(applied>product.stock)stockInsufficient=true;}
 const stockText=stockRows.length?'\n\nPERUBAHAN STOK (pratinjau):\n'+stockRows.join('\n')+'\n\nJumlah Web App hanya dikurangkan jika Anda menyatakan jumlah itu sudah termasuk dalam rekap.':'\n\nTidak ada jumlah unit eksplisit; stok tidak diubah.';
 const allIssues=[...issues,...(stockInsufficient?['Stok saat ini tidak cukup untuk seluruh jumlah yang diajukan. Minta owner meninjau; laporan tidak akan diposting sebagian.']:[])]; await sendTelegramMessage(chatId,formatDraft(draft)+stockText+(allIssues.length?'\n\nPerlu dilengkapi:\n• '+allIssues.join('\n• '):'\n\nPeriksa rekap dan perubahan stok sebelum konfirmasi.'),allIssues.length?undefined:keyboard(draftId,session.revision));
 const coveragePrompted=new Set<number>();for(const line of draft.inventoryLines??[]){
  if(line.mappingStatus==='AMBIGUOUS'){
   const candidates=await prisma.product.findMany({where:{id:{in:line.candidateProductIds}},orderBy:{name:'asc'},select:{id:true,name:true,stock:true}});
   await sendTelegramMessage(chatId,'Pilih produk katalog yang cocok untuk “'+line.label+'” ('+line.quantity+' '+line.unit+'):',inventoryKeyboard(draftId,draft.inventoryLines!.findIndex(item=>item.id===line.id),session.revision,candidates.map(product=>({text:product.name+' · stok '+product.stock,action:'select',value:String(product.id)}))));
  }else if(line.mappingStatus==='UNMATCHED'){
   await sendTelegramMessage(chatId,'Produk “'+line.label+'” tidak ditemukan. Tandai untuk tinjauan owner:',inventoryKeyboard(draftId,draft.inventoryLines!.findIndex(item=>item.id===line.id),session.revision,[{text:'Minta tinjauan owner',action:'owner',value:'-'}]));
  }else if(line.mappingStatus==='MATCHED'&&line.productId!==null&&!coveragePrompted.has(line.productId)&&(line.recordedWebQty??0)>0&&line.coverage==='UNDECIDED'){coveragePrompted.add(line.productId);const reported=(draft.inventoryLines??[]).filter(item=>item.productId===line.productId).reduce((sum,item)=>sum+item.quantity,0);
   await sendTelegramMessage(chatId,'Produk “'+line.label+'”: Web App mencatat '+line.recordedWebQty+' unit pada shift karyawan ini. Apakah jumlah '+reported+' di rekap sudah termasuk '+line.recordedWebQty+' unit tersebut?',inventoryKeyboard(draftId,draft.inventoryLines!.findIndex(item=>item.id===line.id),session.revision,[{text:'Ya, sudah termasuk',action:'included',value:'-'},{text:'Tidak, jumlah rekap tambahan',action:'unrecorded',value:'-'}]));
  }
 }
}
async function handleInventoryCallback(c:TelegramCallback,userId:number,chatId:bigint){
 const parsed=parseInventoryCallback(c.data);if(!parsed)return false;
 const session=await prisma.telegramSession.findUnique({where:{chatId_userId:{chatId,userId}}});
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
  const fresh=await inventoryPreview(userId,draft);const recorded=fresh.items.find(item=>item.id===product.id)?.recordedWebQty??0;
  const sameProduct=items.filter(item=>item.productId===product.id),totalReported=sameProduct.reduce((sum,item)=>sum+item.quantity,0);
  const coverage=recorded===0?'UNRECORDED_ONLY':parsed.action==='included'?(totalReported<recorded?'OWNER_REVIEW':'INCLUDES_APP_SALES'):'UNRECORDED_ONLY';
  next.inventoryLines=items.map(item=>item.productId===product.id?{...item,recordedWebQty:recorded,coverage,appliedQty:undefined}:item);
 }
 const revision=await saveInventoryDraft(session.id,row.id,session.revision,next);if(revision===null){await answerTelegramCallback(c.id,'Draf berubah bersamaan; gunakan /rekap.');return true;}
 await answerTelegramCallback(c.id,parsed.action==='owner'?'Ditandai untuk tinjauan owner.':'Pilihan tersimpan.');
 if(parsed.action==='owner'){
  await sendTelegramMessage(chatId,'Permintaan tinjauan produk '+line.label+' dicatat. Owner perlu memastikan pemetaan sebelum rekap dapat dikonfirmasi.');
  const owners=await prisma.user.findMany({where:{role:'owner',active:true,telegramUserId:{not:null}},select:{telegramUserId:true,username:true}});
  for(const owner of owners)if(owner.telegramUserId!==null)await sendTelegramMessage(owner.telegramUserId,'Tinjauan produk Telegram diperlukan\nKaryawan: '+(await prisma.user.findUnique({where:{id:userId},select:{username:true}}))?.username+'\nProduk dari rekap: '+line.label+' ('+line.quantity+' '+line.unit+')\nGrup: '+chatId+'\nBuka RMCS dan pastikan produk katalog sebelum rekap dikonfirmasi.');
 }
 await sendReportDraft(chatId,userId,session.id,row.id);return true;
}
async function openReport(chatId:bigint,userId:number){
 let session=await prisma.telegramSession.findUnique({where:{chatId_userId:{chatId,userId}}});
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
  session=await prisma.telegramSession.create({data:{chatId,userId,state:'REPORTING',expiresAt:new Date(Date.now()+SESSION_TTL)}});
 }
 if(!session.draftId){
  const draft=await prisma.telegramDraft.create({data:{userId,chatId,kind:'SHIFT_RECAP',status:'PENDING',expiresAt:new Date(Date.now()+SESSION_TTL),payload:emptyRecap() as object}});
  const claimed=await prisma.telegramSession.updateMany({where:{id:session.id,draftId:null},data:{draftId:draft.id,state:'REPORTING',expiresAt:draft.expiresAt}});
  if(!claimed.count){await prisma.telegramDraft.updateMany({where:{id:draft.id,status:'PENDING'},data:{status:'CANCELLED'}});session=await prisma.telegramSession.findUniqueOrThrow({where:{id:session.id}});}
  else session={...session,draftId:draft.id};
 }
 const draft=session.draftId?await prisma.telegramDraft.findUnique({where:{id:session.draftId}}):null;
 const data=(draft?.payload||emptyRecap()) as unknown as RecapDraft;
 if(draft&&await sendLatestPhotoReview(chatId,draft.id,data,session.revision))return;
 if(draft)return sendReportDraft(chatId,userId,session.id,draft.id);
 return sendTelegramMessage(chatId,formatDraft(data)+"\n\nSilakan kirim ringkasan shift atau foto buku rekap.");
}
async function recordReportMessage(message:TelegramMessage,userId:number,updateId:bigint){
 const chatId=telegramId(message.chat.id);if(chatId===null||!message.text)return;
 const session=await prisma.telegramSession.findUnique({where:{chatId_userId:{chatId,userId}}});
 if(!session||session.expiresAt<=new Date()||!session.draftId)return;
 const stored=await prisma.telegramDraft.findUnique({where:{id:session.draftId}});
 if(!stored||stored.status!=='PENDING')return;
 const prior=stored.payload as unknown as RecapDraft;
 if(prior.correctionPhotoId&&await correctTelegramPhotoFromText(message,userId,updateId))return;
 if(prior.processedUpdateIds?.includes(updateId.toString())){await sendReportDraft(chatId,userId,session.id,stored.id);return;}
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
 await sendReportDraft(chatId,userId,session.id,stored.id);
}
async function requestReportCorrection(chatId:bigint,userId:number,args:string){
 const [reportId,lineId,quantityText,...reasonParts]=args.trim().split(/\s+/),reason=reasonParts.join(' ').trim(),quantity=Number(quantityText);
 if(!reportId||!lineId||!Number.isSafeInteger(quantity)||quantity<0||quantity>1000000||reason.length<5)return sendTelegramMessage(chatId,'Format: /koreksi ID_REKAP ID_BARIS JUMLAH_BARU alasan koreksi. Contoh: /koreksi abc123 line-42-0 5 salah hitung.');
 const me=await prisma.user.findUnique({where:{id:userId},select:{id:true,role:true}});if(!me)return;
 const report=await prisma.telegramShiftReport.findUnique({where:{id:reportId},include:{inventoryPostings:true}});
 if(!report||report.userId!==userId&&me.role!=='owner')return sendTelegramMessage(chatId,'Rekap tidak ditemukan atau Anda tidak berwenang mengoreksinya.');
 const posting=report.inventoryPostings.find(item=>item.lineId===lineId);if(!posting)return sendTelegramMessage(chatId,'Baris stok tidak ditemukan pada rekap tersebut.');
 const approved=await prisma.telegramReportCorrection.aggregate({where:{postingId:posting.id,status:'APPROVED'},_sum:{deltaQty:true}});
 const currentQty=posting.reportedQty+(approved._sum.deltaQty??0);if(currentQty===quantity)return sendTelegramMessage(chatId,'Jumlah tersebut sudah sesuai. Tidak ada koreksi yang dibuat.');
 const operationKey=createHash('sha256').update([report.id,posting.id,userId,quantity,reason.toLocaleLowerCase('id-ID')].join('|')).digest('hex');
 const prior=await prisma.telegramReportCorrection.findUnique({where:{operationKey}});if(prior)return sendTelegramMessage(chatId,prior.status==='PENDING'?'Permintaan koreksi yang sama masih menunggu owner.':'Permintaan koreksi yang sama sudah diproses.');
 const correction=await prisma.telegramReportCorrection.create({data:{operationKey,reportId:report.id,postingId:posting.id,requestedById:userId,reason:reason.slice(0,500),previousQty:currentQty,requestedQty:quantity,deltaQty:quantity-currentQty}});
 await sendTelegramMessage(chatId,'Permintaan koreksi tercatat. Jumlah terjual pada rekap saat ini '+currentQty+'; target '+quantity+'. Owner harus menyetujui sebelum stok berubah.',{inline_keyboard:[[{text:'Setujui koreksi',callback_data:'rcms:cr:'+correction.id+':a'},{text:'Tolak',callback_data:'rcms:cr:'+correction.id+':r'}]]});
}
async function handleCorrectionCallback(c:TelegramCallback,userId:number,chatId:bigint){
 const match=/^rcms:cr:([A-Za-z0-9_-]{10,40}):(a|r)$/.exec(c.data??'');if(!match)return false;
 const owner=await prisma.user.findUnique({where:{id:userId},select:{role:true,active:true}});if(!owner?.active||owner.role!=='owner'){await answerTelegramCallback(c.id,'Hanya owner yang dapat menyetujui koreksi.');return true;}
 let result:{status:string;delta:number;stockDelta:number;productName:string}|null=null;
 try{
  result=await prisma.$transaction(async tx=>{
   await tx.$queryRaw`SELECT "id" FROM "TelegramReportCorrection" WHERE "id" = ${match[1]} FOR UPDATE`;
   const correction=await tx.telegramReportCorrection.findUnique({where:{id:match[1]},include:{posting:{include:{product:true}}}});
   if(!correction)throw new Error('CORRECTION_NOT_FOUND');
   if(correction.status!=='PENDING')return{status:'ALREADY',delta:0,stockDelta:0,productName:correction.posting.product.name};
   if(match[2]==='r'){
    await tx.telegramReportCorrection.update({where:{id:correction.id},data:{status:'REJECTED',approvedById:userId,approvedAt:new Date()}});
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
   const movement=stockDelta===0?null:await tx.inventoryMovement.create({data:{productId:product.id,type:'TELEGRAM_SHIFT_RECAP_CORRECTION',qty:-stockDelta,costAtTime:product.costPrice,note:`Koreksi rekap ${correction.reportId}; alasan: ${correction.reason}`,userId},select:{id:true}});
   await tx.telegramReportCorrection.update({where:{id:correction.id},data:{status:'APPROVED',approvedById:userId,approvedAt:new Date(),deltaQty:delta,movementId:movement?.id??null}});
   return{status:'APPROVED',delta,stockDelta,productName:product.name};
  },{isolationLevel:'Serializable',timeout:15000});
 }catch(error){const message=(error as Error).message;if(message==='CORRECTION_STALE'||message==='CORRECTION_STOCK_INSUFFICIENT'||message==='CORRECTION_COVERAGE_REVIEW'){await answerTelegramCallback(c.id,'Koreksi tidak dapat diterapkan: '+(message==='CORRECTION_STALE'?'rekap telah dikoreksi sebelumnya.':message==='CORRECTION_COVERAGE_REVIEW'?'jumlah terjual bertentangan dengan penjualan Web App.':'stok tidak cukup untuk koreksi.'));return true;}throw error;}
 await answerTelegramCallback(c.id,result.status==='APPROVED'?'Koreksi disetujui.':result.status==='REJECTED'?'Koreksi ditolak.':'Permintaan sudah diproses.');
 if(result.status==='APPROVED')await sendTelegramMessage(chatId,'Koreksi '+result.productName+' disetujui. Perubahan stok: '+(result.stockDelta>0?'−'+result.stockDelta:result.stockDelta<0?'+'+Math.abs(result.stockDelta):'tidak berubah')+' unit. Jumlah terjual pada rekap: '+(result.delta>0?'bertambah '+result.delta:result.delta<0?'berkurang '+Math.abs(result.delta):'tetap')+'.');
 else if(result.status==='REJECTED')await sendTelegramMessage(chatId,'Permintaan koreksi stok ditolak owner.');
 return true;
}
async function handleCommand(m:TelegramMessage,from:TelegramUser,userId:number|null,command:string,args:string){
 const chatId=telegramId(m.chat.id);if(chatId===null)return;
 if(m.chat.type==='private'){
  if(command==='link')return linkAccount(m.chat,from,args);
  if(command==='start')return sendTelegramMessage(chatId,'Bot R-CELL aktif. Hubungkan akun dengan kode sekali pakai dari Pengaturan RMCS: /link KODE (chat pribadi).');
  return sendTelegramMessage(chatId,'Rekap operasional hanya tersedia di grup R-CELL yang diizinkan.');
 }
 if(!userId)return sendTelegramMessage(chatId,'Akun Telegram belum tertaut. Minta owner membuat kode di Pengaturan RMCS, lalu kirim /link KODE secara pribadi ke bot.');
 if(command==='start')return sendTelegramMessage(chatId,'Perintah: /rekap untuk mulai atau melanjutkan laporan, /status untuk melihat draf, /koreksi untuk meminta koreksi stok, /batal untuk membatalkan.');
 if(command==='rekap')return openReport(chatId,userId);
 if(command==='koreksi')return requestReportCorrection(chatId,userId,args);
 if(command==='status'){
  const [session,latest]=await Promise.all([prisma.telegramSession.findUnique({where:{chatId_userId:{chatId,userId}}}),prisma.telegramShiftReport.findFirst({where:{userId,chatId},orderBy:{confirmedAt:'desc'}})]);
  let result=session?.draftId?await prisma.telegramDraft.findUnique({where:{id:session.draftId}}):null;
  let message=result&&result.status==='PENDING'?formatDraft(result.payload as unknown as RecapDraft)+'\n\n'+(recapIssues(result.payload as unknown as RecapDraft).join('\n')||'Siap konfirmasi dengan tombol di pesan rekap.'):session?'Sesi rekap ada, tetapi drafnya tidak aktif. Gunakan /rekap.':'Tidak ada draf rekap aktif.';
  if(latest)message+='\n\nRekap terakhir dikonfirmasi: '+latest.confirmedAt.toLocaleString('id-ID',{timeZone:'Asia/Jakarta'})+'.';
  return sendTelegramMessage(chatId,message);
 }
 if(command==='batal'){
  const session=await prisma.telegramSession.findUnique({where:{chatId_userId:{chatId,userId}}});
  if(session?.draftId)await prisma.telegramDraft.updateMany({where:{id:session.draftId,status:'PENDING'},data:{status:'CANCELLED'}});
  await prisma.telegramSession.deleteMany({where:{chatId,userId}});
  return sendTelegramMessage(chatId,'Sesi rekap dibatalkan. Tidak ada perubahan transaksi, stok, saldo, atau penutupan shift RMCS.');
 }
 return sendTelegramMessage(chatId,'Perintah tidak dikenal. Gunakan /rekap, /status, atau /batal.');
}
async function handleCallback(c:TelegramCallback,userId:number|null){
 const m=c.message,chatId=m&&telegramId(m.chat.id);
 if(!m||chatId===null||chatId===undefined||!groupAllowed(m.chat)){await answerTelegramCallback(c.id,'Grup tidak diizinkan.');return;}
 if(!userId){await answerTelegramCallback(c.id,'Akun belum tertaut.');return;}
 if(visionCallbackFromData(c.data)){await handleTelegramVisionCallback(c,userId);return;}
 if(await handleInventoryCallback(c,userId,chatId))return;
 if(await handleCorrectionCallback(c,userId,chatId))return;
 const parsed=parseTelegramCallback(c.data);if(!parsed){await answerTelegramCallback(c.id,'Tombol tidak valid.');return;}
 const draft=await prisma.telegramDraft.findUnique({where:{id:parsed.draftId}});
 if(!draft||draft.userId!==userId||draft.chatId!==chatId||draft.kind!=='SHIFT_RECAP'){await answerTelegramCallback(c.id,'Draf bukan milik Anda.');return;}
 if(parsed.operation==='edit'){await answerTelegramCallback(c.id,'Silakan koreksi rekap.');await sendTelegramMessage(chatId,'Kirim nilai koreksi sebagai pesan baru, misalnya: rokok tadi salah bukan 175rb tapi 195rb atau axis salah bukan 7 pcs tapi 5 pcs.');return;}
 if(parsed.operation==='cancel'){
  const changed=await prisma.telegramDraft.updateMany({where:{id:draft.id,status:'PENDING'},data:{status:'CANCELLED'}});
  await prisma.telegramSession.deleteMany({where:{userId,chatId,draftId:draft.id}});
  await answerTelegramCallback(c.id,changed.count?'Draf dibatalkan.':'Draf sudah diproses.');return;
 }

 const active=await prisma.telegramSession.findUnique({where:{chatId_userId:{chatId,userId}},select:{id:true,draftId:true,revision:true}});
 if(!active||active.draftId!==draft.id||parsed.revision===undefined||parsed.revision!==active.revision){await answerTelegramCallback(c.id,'Ringkasan ini sudah berubah. Gunakan tombol pada ringkasan terbaru.');return;}
 if(draft.status!=='PENDING'||draft.expiresAt<=new Date()){await answerTelegramCallback(c.id,'Draf tidak aktif atau kedaluwarsa.');return;}
 const data=draft.payload as unknown as RecapDraft,issues=recapIssues(data);
 if(!canFinalizeRecap(data)){await answerTelegramCallback(c.id,'Belum lengkap. Lanjutkan pesan rekap dahulu.');return;}
 const payload=buildAggregateReport(data),shiftStart=(await shiftOpening(new Date())).start;
 let postings:{productId:number;appliedQty:number;lineId:string}[]=[],reportIdResult='';
 try{
  await prisma.$transaction(async tx=>{
   const sessionClaim=await tx.telegramSession.updateMany({where:{id:active!.id,draftId:draft.id,state:'REPORTING',revision:parsed.revision},data:{revision:{increment:1}}});
   if(sessionClaim.count!==1)throw new Error('STALE_REPORT_REVISION');
   const claimed=await tx.telegramDraft.updateMany({where:{id:draft.id,status:'PENDING'},data:{status:'PROCESSING'}});
   if(claimed.count!==1)throw new Error('DRAFT_ALREADY_PROCESSED');
   const report=await tx.telegramShiftReport.create({data:{draftId:draft.id,userId,chatId,shiftLabel:data.shiftLabel,payload},select:{id:true}});reportIdResult=report.id;
   postings=await postTelegramInventory(tx,report.id,userId,data,shiftStart,new Date());
   await tx.telegramShiftReport.update({where:{id:report.id},data:{payload:{...payload,inventoryPostings:postings} as object}});
   await tx.telegramDraft.update({where:{id:draft.id},data:{status:'CONFIRMED',confirmedAt:new Date()}});
   await tx.telegramSession.deleteMany({where:{userId,chatId,draftId:draft.id}});
  },{isolationLevel:'Serializable',timeout:20000});
 }catch(e){
  if((e as Error).message==='DRAFT_ALREADY_PROCESSED'||(e as {code?:string}).code==='P2002'){await answerTelegramCallback(c.id,'Rekap sudah diproses sebelumnya.');return;}
  if((e as Error).message==='STALE_REPORT_REVISION'){await answerTelegramCallback(c.id,'Rekap berubah. Buka /rekap untuk meninjau versi terbaru.');return;}
  if(e instanceof TelegramInventoryError){await answerTelegramCallback(c.id,e.message);await sendTelegramMessage(chatId,e.message+' Tidak ada stok yang diubah. Periksa /rekap atau minta tinjauan owner.');return;}
  throw e;
 }
 await answerTelegramCallback(c.id,'Rekap dikonfirmasi dan stok diperbarui.');
 const summary=postings.map(posting=>{const ids=posting.lineId.split(',');const label=ids.map(id=>(data.inventoryLines??[]).find(line=>line.id===id)?.label).filter(Boolean).join(' / ');return '• '+label+': '+posting.appliedQty+' unit dikurangi';}).join('\n');
 const correctionHelp=postings.map(posting=>' /koreksi '+reportIdResult+' '+posting.lineId+' <jumlah-baru> <alasan>').join('\n');
 await sendTelegramMessage(chatId,'✅ REKAP BERHASIL DISIMPAN'+(data.shiftLabel?'\nShift '+data.shiftLabel:'')+(summary?'\n\n'+summary:'\n\nTidak ada perubahan stok.')+'\n\nAdmin TF + TD: '+formatTelegramRupiah(BigInt(recapTotals(data).service_fee))+'\nPengeluaran: '+formatTelegramRupiah(BigInt(recapTotals(data).expense))+(postings.length?'\n\nID laporan: '+reportIdResult+'\nKoreksi stok setelah disimpan:'+correctionHelp:''));
}
async function processUpdate(u:TelegramUpdate){
 const id=telegramId(u.update_id);if(id===null)throw new Error('Invalid Telegram update_id');
 const m=u.message,c=u.callback_query,chat=m?.chat??c?.message?.chat,from=m?.from??c?.from;if(!chat||!from)return false;
 const command=m?.text?parseTelegramCommand(m.text):null,privateAllowed=chat.type==='private'&&(command?.command==='link'||command?.command==='start');
 if(!privateAllowed&&!groupAllowed(chat))return false;
 const claim=await claimUpdate(id);if(claim==='PROCESSED')return true;if(claim==='BUSY')throw new TelegramUpdateBusy();
 try{
  const tid=telegramId(from.id);if(tid===null)throw new Error('Invalid sender id');
  const user=await prisma.user.findFirst({where:{telegramUserId:tid,active:true},select:{id:true}});
  if(c)await handleCallback(c,user?.id??null);
  else if(m&&command)await handleCommand(m,from,user?.id??null,command.command,command.args);
  else if(m&&user&&(m.photo||m.document))await handleTelegramPhoto(m,user.id,id);
  else if(m&&(m.photo||m.document))await sendTelegramMessage(m.chat.id,'Akun Telegram belum ditautkan. Minta owner membuat kode sekali pakai.');
  else if(m&&user)await recordReportMessage(m,user.id,id);
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

















