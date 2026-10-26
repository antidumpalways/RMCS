import { createHash, randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { answerTelegramCallback, sendTelegramMessage, type InlineKeyboard } from './client';
import { allowedTelegramGroup, formatTelegramRupiah, telegramId } from './core';
import { downloadTelegramImage, MAX_TELEGRAM_IMAGE_BYTES, TelegramMediaError } from './media';
import { applyExtraction, buildAggregateReport, canFinalizeRecap, extractRecapMessage, parseIndonesianRupiah, recapIssues, recapTotals, type RecapDraft, type RecapPhotoReview } from './recap';
import { extractHandwrittenImage, VisionExtractionError, type VisionMetrics } from './vision';
import { findDuplicatePhoto, findVisionConflicts, mergeVisionEntries, parseVisionCallback, photoReviewIsEditable, visionCallback, visionPhotoAllowed, type VisionAction } from './vision-flow';
import { findInventoryConflicts, mergePhotoInventory } from './inventory';

type Chat={id:number;type:string};
type PhotoSize={file_id:string;file_unique_id:string;width:number;height:number;file_size?:number};
type Document={file_id:string;file_unique_id:string;file_name?:string;mime_type?:string;file_size?:number};
export type IncomingPhotoMessage={message_id:number;chat:Chat;caption?:string;text?:string;photo?:PhotoSize[];document?:Document;media_group_id?:string;reply_to_message?:{message_id:number}};
type Callback={id:string;from:{id:number};data?:string;message?:{message_id:number;chat:Chat}};
const SESSION_TTL=12*60*60_000;
type Input={fileId:string;fileUniqueId:string;fileSize?:number};
function chooseImage(m:IncomingPhotoMessage):Input|null{
 if(m.photo?.length){const x=[...m.photo].sort((a,b)=>b.width*b.height-a.width*a.height).at(0)!;return{fileId:x.file_id,fileUniqueId:x.file_unique_id,fileSize:x.file_size};}
 if(m.document)return{fileId:m.document.file_id,fileUniqueId:m.document.file_unique_id,fileSize:m.document.file_size};
 return null;
}
async function mutate<T>(sessionId:string,draftId:string,fn:(draft:RecapDraft)=>{next:RecapDraft;value:T;changed:boolean}):Promise<{draft:RecapDraft;revision:number;value:T}|null>{
 for(let n=0;n<6;n++){
  const session=await prisma.telegramSession.findUnique({where:{id:sessionId}});
  if(!session||session.draftId!==draftId||session.state!=='REPORTING')return null;
  const row=await prisma.telegramDraft.findUnique({where:{id:draftId}});
  if(!row||!photoReviewIsEditable(row.status))return null;
  const current=row.payload as unknown as RecapDraft,result=fn(current);
  if(!result.changed)return{draft:current,revision:session.revision,value:result.value};
  try{
   const saved=await prisma.$transaction(async tx=>{
    const guard=await tx.telegramSession.updateMany({where:{id:session.id,revision:session.revision,state:'REPORTING'},data:{revision:{increment:1},expiresAt:new Date(Date.now()+SESSION_TTL)}});
    if(!guard.count)return false;
    await tx.telegramDraft.update({where:{id:draftId},data:{payload:result.next as object,expiresAt:new Date(Date.now()+SESSION_TTL)}});
    return true;
   });
   if(saved)return{draft:result.next,revision:session.revision+1,value:result.value};
  }catch(e){if((e as {code?:string}).code!=='P2034')throw e;}
 }
 return null;
}
const categoryLabel=(category:string)=>({service_volume:'Volume jasa',service_fee:'Biaya jasa',sale:'Penjualan',expense:'Pengeluaran',cash_balance:'Saldo kas',electronic_balance:'Saldo elektronik'} as Record<string,string>)[category]??category;
function reviewText(r:RecapPhotoReview){
 if(r.status==='FAILED')return'Foto belum berhasil dibaca. Anda bisa mengetik rekap manual.';
 const amounts=r.entries.map(e=>'• '+categoryLabel(e.category)+' ('+e.label+'): '+formatTelegramRupiah(parseIndonesianRupiah(e.amount)??0n));
 const lines=[...r.sourceLines.map(l=>l.lineNumber+'. '+l.sourceText+(l.lineType==='subtotal'?' (subtotal, tidak dijumlahkan)':l.lineType==='note'?' (catatan)':'')),...(r.inventoryLines??[]).map(l=>'Unit terjual: '+l.label+' '+l.quantity+' '+(l.unit??'satuan tidak terbaca'))];
 const unclear=r.unresolved.length?'\n\n⚠️ Perlu diperjelas:\n• '+r.unresolved.join('\n• '):'';
 const warning=r.quality==='unreadable'||r.quality==='mixed'||r.sourceLines.some(l=>l.lineType==='unreadable')||r.unresolved.length?'\n\n⚠️ Ada tulisan yang belum jelas.':'';
 return'📸 Foto berhasil dibaca.'+warning+'\n\n'+(amounts.length?amounts.join('\n'):'Belum ada nominal yang bisa dipastikan.')+unclear+'\n\nBaris sumber:\n'+(lines.length?lines.join('\n'):'(tidak ada baris terbaca)')+'\n\nPeriksa hasil sebelum memasukkannya ke draf.';
}
function makeKeyboard(draftId:string,r:RecapPhotoReview,d:RecapDraft,revision:number):InlineKeyboard{
 const conflicts=findVisionConflicts(d.entries,r.entries),inventoryConflicts=findInventoryConflicts(d.inventoryLines??[],r.inventoryLines??[]),hasConflicts=conflicts.length>0||inventoryConflicts.length>0,balance=conflicts.some(e=>e.category==='cash_balance'||e.category==='electronic_balance');
 const btn=(label:string,action:VisionAction)=>({text:label,callback_data:visionCallback(action,draftId,r.id,revision)});
 const rows:Array<Array<{text:string;callback_data:string}>>=[];
 if(r.status==='CORRECTING'){rows.push([btn('Selesai koreksi','finish'),btn('Koreksi lagi','correct')]);if(hasConflicts)rows.push([btn('Ganti nilai','replace'),...(balance?[]:[btn('Tambahkan','supplement')]),btn('Abaikan','skip')]);}
 else if(hasConflicts)rows.push([btn('Ganti nilai','replace'),...(balance?[]:[btn('Tambahkan','supplement')]),btn('Abaikan','skip')]);
 else rows.push([btn('Benar, Lanjut','accept'),btn('Koreksi','correct')]);
 rows.push([btn('Tambah Foto','more'),btn('Ketik Manual','manual')]);
 return{inline_keyboard:rows};
}
async function showReview(chatId:bigint,draftId:string,r:RecapPhotoReview,d:RecapDraft,revision:number){
 return sendTelegramMessage(chatId,reviewText(r),['PENDING_REVIEW','CORRECTING'].includes(r.status)?makeKeyboard(draftId,r,d,revision):undefined);
}
function usage(metrics:VisionMetrics,bytes:number){console.info('telegram_vision_usage',JSON.stringify({latencyMs:metrics.latencyMs,promptTokens:metrics.promptTokens,completionTokens:metrics.completionTokens,approximateInputTokens:metrics.approximateInputTokens,bytes,failureCode:metrics.failureCode??null}));}
export async function sendLatestPhotoReview(chatId:bigint,draftId:string,d:RecapDraft,revision:number):Promise<boolean>{
 const r=[...(d.photoReviews??[])].reverse().find(x=>['PENDING_REVIEW','CORRECTING'].includes(x.status));
 if(!r)return false;await showReview(chatId,draftId,r,d,revision);return true;
}
export async function handleTelegramPhoto(m:IncomingPhotoMessage,userId:number,updateId:bigint){
 const chatId=telegramId(m.chat.id);if(chatId===null)return;
 const session=await prisma.telegramSession.findUnique({where:{chatId_userId:{chatId,userId}}});
 const row=session?.draftId?await prisma.telegramDraft.findUnique({where:{id:session.draftId}}):null;
 const authorized=visionPhotoAllowed(allowedTelegramGroup(m.chat.id,m.chat.type,process.env.TELEGRAM_ALLOWED_GROUP_IDS),userId!==null,!!session&&session.state==='REPORTING'&&!!row&&row.status==='PENDING'&&session.expiresAt>new Date());
 if(!authorized||!session||!row)return sendTelegramMessage(chatId,'Jalankan /rekap terlebih dahulu sebelum mengirim foto.');
 const input=chooseImage(m);if(!input||!input.fileUniqueId)return sendTelegramMessage(chatId,'Lampiran foto tidak dikenali. Kirim JPEG, PNG, GIF, atau WebP.');
 if(input.fileSize!==undefined&&input.fileSize>MAX_TELEGRAM_IMAGE_BYTES)return sendTelegramMessage(chatId,'Foto melebihi batas 8 MB. Kirim versi yang lebih kecil atau ketik manual.');
 let draft=row.payload as unknown as RecapDraft;
 const known=findDuplicatePhoto(draft.photoReviews??[],input.fileUniqueId);
 if(known){
  if(['PENDING_REVIEW','CORRECTING'].includes(known.status))return showReview(chatId,row.id,known,draft,session.revision);
  return sendTelegramMessage(chatId,known.status==='PROCESSING'?'Foto yang sama sedang diproses. Tunggu sebentar.':'Foto yang sama sudah pernah diterima dan tidak dihitung ulang.');
 }
 let file;
 try{file=await downloadTelegramImage(input.fileId,input.fileSize);}catch(e){return sendTelegramMessage(chatId,e instanceof TelegramMediaError?e.message:'Unduhan foto gagal. Silakan ketik manual.');}
 const sha256=createHash('sha256').update(file.bytes).digest('hex');
 const sameContent=findDuplicatePhoto(draft.photoReviews??[],input.fileUniqueId,sha256);
 if(sameContent)return sendTelegramMessage(chatId,'Foto ini sama dengan foto sebelumnya. Tidak ada nominal yang ditambahkan ulang.');
 const id=randomUUID().replaceAll('-','').slice(0,10);
 const placeholder:RecapPhotoReview={id,fileId:input.fileId,fileUniqueId:input.fileUniqueId,sha256,mimeType:file.mimeType,caption:m.caption?.slice(0,1000)??null,sourceLines:[],entries:[],inventoryLines:[],unresolved:[],status:'PROCESSING',metrics:{latencyMs:0,promptTokens:0,completionTokens:0,approximateInputTokens:Math.ceil(file.fileSize/1024)},createdAt:new Date().toISOString()};
 const reservation=await mutate(session.id,row.id,current=>{
  const duplicate=findDuplicatePhoto(current.photoReviews??[],input.fileUniqueId,sha256);
  if(duplicate)return{next:current,value:{review:duplicate,created:false},changed:false};
  return{next:{...current,photoReviews:[...(current.photoReviews??[]),placeholder],processedUpdateIds:[...(current.processedUpdateIds??[]),updateId.toString()]},value:{review:placeholder,created:true},changed:true};
 });
 if(!reservation)return sendTelegramMessage(chatId,'Sesi rekap berubah. Periksa /status lalu coba lagi.');
 if(!reservation.value.created){if(reservation.value.review.status==='PROCESSING')return sendTelegramMessage(chatId,'Foto yang sama sedang diproses. Tunggu sebentar.');if(reservation.value.review.status==='FAILED')return sendTelegramMessage(chatId,'Foto sebelumnya gagal dibaca. Silakan ketik rekap manual.');return showReview(chatId,row.id,reservation.value.review,reservation.draft,reservation.revision);}
 try{
  const result=await extractHandwrittenImage(file.bytes,file.mimeType,m.caption);
  usage(result.metrics,file.fileSize);
  const saved=await mutate(session.id,row.id,current=>{
   const reviews=[...(current.photoReviews??[])],i=reviews.findIndex(x=>x.id===id);if(i<0)return{next:current,value:null,changed:false};
   reviews[i]={...reviews[i],quality:result.extraction.quality,sourceLines:result.extraction.lines,entries:result.extraction.entries,inventoryLines:result.extraction.inventoryLines,unresolved:result.extraction.unresolved,status:'PENDING_REVIEW',metrics:result.metrics};
   return{next:{...current,photoReviews:reviews},value:reviews[i],changed:true};
  });
  if(!saved?.value)return sendTelegramMessage(chatId,'Hasil foto tidak tersimpan. Foto belum dimasukkan; ketik rekap manual atau kirim ulang.');
  return showReview(chatId,row.id,saved.value,saved.draft,saved.revision);
 }catch(e){
  const metrics=e instanceof VisionExtractionError?{...e.metrics,failureCode:e.code}:{latencyMs:0,promptTokens:0,completionTokens:0,approximateInputTokens:Math.ceil(file.fileSize/1024),failureCode:'unknown'};
  usage(metrics,file.fileSize);
  await mutate(session.id,row.id,current=>{
   const reviews=(current.photoReviews??[]).map(x=>x.id===id?{...x,status:'FAILED' as const,metrics}:x);
   return{next:{...current,photoReviews:reviews},value:true,changed:true};
  });
  return sendTelegramMessage(chatId,e instanceof VisionExtractionError?e.message:'Pembacaan foto gagal. Silakan ketik rekap manual.');
 }
}
export async function correctTelegramPhotoFromText(m:IncomingPhotoMessage,userId:number,updateId:bigint):Promise<boolean>{
 const chatId=telegramId(m.chat.id);if(chatId===null||!m.text)return false;
 const session=await prisma.telegramSession.findUnique({where:{chatId_userId:{chatId,userId}}});if(!session?.draftId)return false;
 const row=await prisma.telegramDraft.findUnique({where:{id:session.draftId}});if(!row||row.status!=='PENDING')return false;
 const draft=row.payload as unknown as RecapDraft;if(!draft.correctionPhotoId)return false;const review=draft.photoReviews?.find(x=>x.id===draft.correctionPhotoId&&x.status==='CORRECTING');if(!review)return false;
 if(draft.processedUpdateIds?.includes(updateId.toString())){await showReview(chatId,row.id,review,draft,session.revision);return true;}
 const base={...draft,entries:review.entries,unresolved:review.unresolved,messages:[],processedUpdateIds:[]};
 const x=await extractRecapMessage(m.text,base);
 const entries=x.entries.map(e=>review.entries.some(old=>old.category===e.category&&old.label===e.label)?{...e,operation:'correct' as const}:e);
 const updated=applyExtraction(base,{...x,entries},m.text);
 const saved=await mutate(session.id,row.id,current=>{
  if(current.processedUpdateIds?.includes(updateId.toString()))return{next:current,value:false,changed:false};
  const reviews=[...(current.photoReviews??[])],i=reviews.findIndex(r=>r.id===review.id&&r.status==='CORRECTING');if(i<0)return{next:current,value:false,changed:false};
  reviews[i]={...reviews[i],entries:updated.entries,inventoryLines:(updated.inventoryLines??[]).map(line=>({sourceText:line.sourceText,label:line.label,quantity:line.quantity,unit:line.unit,operation:'set' as const})),unresolved:updated.unresolved,correctionMessages:[...(reviews[i].correctionMessages??[]),m.text!.slice(0,500)]};
  return{next:{...current,photoReviews:reviews,processedUpdateIds:[...(current.processedUpdateIds??[]),updateId.toString()]},value:true,changed:true};
 });
 if(saved){const latest=saved.draft.photoReviews!.find(r=>r.id===review.id)!;await sendTelegramMessage(chatId,reviewText(latest)+'\n\nKoreksi tercatat. Tekan Selesai koreksi jika sudah benar.',makeKeyboard(row.id,latest,saved.draft,saved.revision));}
 return true;
}
export async function handleTelegramVisionCallback(c:Callback,userId:number|null){
 const chat=c.message?.chat,chatId=chat&&telegramId(chat.id),parsed=parseVisionCallback(c.data);
 if(!chat||chatId===null||chatId===undefined||!allowedTelegramGroup(chat.id,chat.type,process.env.TELEGRAM_ALLOWED_GROUP_IDS)){await answerTelegramCallback(c.id,'Grup tidak diizinkan.');return;}
 if(!parsed){await answerTelegramCallback(c.id,'Tombol foto tidak valid.');return;}
 if(!userId){await answerTelegramCallback(c.id,'Akun belum tertaut.');return;}
 const session=await prisma.telegramSession.findUnique({where:{chatId_userId:{chatId,userId}}});
 if(!session||session.draftId!==parsed.draftId||session.revision!==parsed.revision){await answerTelegramCallback(c.id,'Sesi berubah. Gunakan ringkasan foto terbaru atau /rekap.');return;}
 const row=await prisma.telegramDraft.findUnique({where:{id:parsed.draftId}});if(!row||row.status!=='PENDING'){await answerTelegramCallback(c.id,'Draf sudah tidak aktif.');return;}
 const draft=row.payload as unknown as RecapDraft,review=draft.photoReviews?.find(x=>x.id===parsed.photoId);
 if(!review||!['PENDING_REVIEW','CORRECTING'].includes(review.status)){await answerTelegramCallback(c.id,'Hasil foto tidak aktif.');return;}
 if(parsed.action==='more'||parsed.action==='manual'){if(draft.correctionPhotoId)await mutate(session.id,row.id,current=>({next:{...current,correctionPhotoId:null,photoReviews:(current.photoReviews??[]).map(x=>x.id===draft.correctionPhotoId&&x.status==='CORRECTING'?{...x,status:'PENDING_REVIEW' as const}:x)},value:true,changed:true}));await answerTelegramCallback(c.id,'Siap.');await sendTelegramMessage(chatId,parsed.action==='more'?'Silakan kirim foto berikutnya.':'Silakan ketik rekap manual. Nilai akan masuk ke sesi ini.');return;}
 if(parsed.action==='correct'){
  await mutate(session.id,row.id,current=>{const reviews=(current.photoReviews??[]).map(x=>x.id===review.id?{...x,status:'CORRECTING' as const}:x);return{next:{...current,photoReviews:reviews,correctionPhotoId:review.id},value:true,changed:true};});
  await answerTelegramCallback(c.id,'Mode koreksi aktif.');
  await sendTelegramMessage(chatId,'Kirim koreksi eksplisit, misalnya: rokok tadi salah bukan 175rb tapi 195rb. Hasil foto belum masuk ke rekap utama.');return;
 }
 if(parsed.action==='skip'){
  await mutate(session.id,row.id,current=>({next:{...current,photoReviews:(current.photoReviews??[]).map(x=>x.id===review.id?{...x,status:'IGNORED' as const}:x),correctionPhotoId:null},value:true,changed:true}));
  await answerTelegramCallback(c.id,'Foto diabaikan dan tidak dihitung.');return;
 }
 const mode=parsed.action==='replace'?'replace':parsed.action==='supplement'?'supplement':'accept';
 const first=mergeVisionEntries(draft.entries,review.entries,mode);
 const inventoryFirst=mergePhotoInventory(draft.inventoryLines??[],review.inventoryLines??[],mode,review.id);
 if(mode==='accept'&&(first.conflicts.length||inventoryFirst.conflicts.length)){ await answerTelegramCallback(c.id,'Kategori ini sudah ada. Pilih Ganti nilai atau Tambahkan.');return;}
 if(first.blockedBalanceSupplement){await answerTelegramCallback(c.id,'Saldo akun yang sama tidak dijumlahkan. Pilih Ganti nilai atau Abaikan.');return;}
 const completed=await mutate(session.id,row.id,current=>{
  const r=current.photoReviews?.find(x=>x.id===review.id);if(!r||!['PENDING_REVIEW','CORRECTING'].includes(r.status))return{next:current,value:false,changed:false};
  const merged=mergeVisionEntries(current.entries,r.entries,mode),inventoryMerged=mergePhotoInventory(current.inventoryLines??[],r.inventoryLines??[],mode,r.id);if((mode==='accept'&&(merged.conflicts.length||inventoryMerged.conflicts.length))||merged.blockedBalanceSupplement)return{next:current,value:false,changed:false};
  const nextReviews=(current.photoReviews??[]).map(x=>x.id===r.id?{...x,status:'MERGED' as const}:x);
  return{next:{...current,entries:merged.entries,inventoryLines:inventoryMerged.lines,unresolved:[...new Set([...current.unresolved,...r.unresolved,...inventoryMerged.unresolved])],photoReviews:nextReviews,correctionPhotoId:null,messages:[...current.messages,'Foto '+r.id+' ditinjau dan dimasukkan ke draf.']},value:true,changed:true};
 });
 if(!completed?.value){await answerTelegramCallback(c.id,'Draf berubah atau foto sudah diproses. Periksa pesan terbaru.');return;}
 await answerTelegramCallback(c.id,'Pembacaan foto dimasukkan ke draf.');
 const issues=recapIssues(completed.draft),labels:{[K in keyof ReturnType<typeof recapTotals>]:string}={service_volume:'Volume jasa',service_fee:'Biaya jasa',sale:'Penjualan barang',expense:'Pengeluaran',cash_balance:'Saldo kas akhir',electronic_balance:'Saldo elektronik akhir'};
 const summary='Draf rekap:\n'+(Object.keys(labels) as (keyof typeof labels)[]).map(k=>labels[k]+': '+formatTelegramRupiah(BigInt(recapTotals(completed.draft)[k]))).join('\n')+'\n\nTidak ada transaksi atau stok RMCS yang diubah.';
 await sendTelegramMessage(chatId,summary+(issues.length?'\n\nPerlu dilengkapi:\n• '+issues.join('\n• '):'\n\nPeriksa lalu konfirmasi.'),issues.length?undefined:{inline_keyboard:[[{text:'Konfirmasi rekap',callback_data:'rcms:ok:'+row.id+':'+completed.revision},{text:'Batal',callback_data:'rcms:cancel:'+row.id+':'+completed.revision}]]});
}
export function visionCallbackFromData(data:string|undefined){return parseVisionCallback(data);}








