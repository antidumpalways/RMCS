import { parseIndonesianRupiah, type RecapCategory, type RecapEntry, type RecapInventoryExtraction } from './recap';
export type VisionLine={lineNumber:number;sourceText:string;lineType:'entry'|'subtotal'|'note'|'unreadable';category:RecapCategory|null;label:string|null;amount:string|null;quantity:string|null;unit:string|null;accountName:string|null;note:string|null;correctionTarget:string|null;operation:'add'|'correct'|'set'|null;ambiguity:string|null};
export type VisionExtraction={quality:'clear'|'mixed'|'unreadable';lines:VisionLine[];entries:RecapEntry[];inventoryLines:RecapInventoryExtraction[];unresolved:string[]};
export type VisionMetrics={latencyMs:number;promptTokens:number;completionTokens:number;approximateInputTokens:number;failureCode?:string};
export class VisionExtractionError extends Error{constructor(readonly code:string,readonly metrics:VisionMetrics,message:string){super(message);}}
const validCategories=new Set<RecapCategory>(['service_volume','service_fee','sale','expense','cash_balance','electronic_balance','total_balance']);
const nullableString=(v:unknown):v is string|null=>v===null||(typeof v==='string'&&v.length<=500);
export function validateVisionExtraction(value:unknown):VisionExtraction{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('malformed_json');
 const root=value as Record<string,unknown>;
 const rootKeys=['quality','lines'];if(Object.keys(root).length!==rootKeys.length||Object.keys(root).some(k=>!rootKeys.includes(k)))throw new Error('invalid_schema');
 if(!['clear','mixed','unreadable'].includes(String(root.quality))||!Array.isArray(root.lines)||root.lines.length>200)throw new Error('invalid_schema');
 const seen=new Set<number>();
 const lines:VisionLine[]=root.lines.map(raw=>{
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('invalid_schema');
  const x=raw as Record<string,unknown>;
  const fields=['lineNumber','sourceText','lineType','category','label','amount','quantity','unit','accountName','note','correctionTarget','operation','ambiguity'];if(Object.keys(x).length!==fields.length||fields.some(k=>!Object.prototype.hasOwnProperty.call(x,k)))throw new Error('invalid_schema');
  if(!Number.isSafeInteger(x.lineNumber)||Number(x.lineNumber)<1||Number(x.lineNumber)>500||seen.has(Number(x.lineNumber)))throw new Error('invalid_schema');
  if(typeof x.sourceText!=='string'||!x.sourceText.trim()||x.sourceText.length>500||!['entry','subtotal','note','unreadable'].includes(String(x.lineType)))throw new Error('invalid_schema');
  if(x.category!==null&&!validCategories.has(x.category as RecapCategory))throw new Error('invalid_schema');
  for(const field of ['label','amount','quantity','unit','accountName','note','correctionTarget','ambiguity'])if(!nullableString(x[field]))throw new Error('invalid_schema');
  if(x.operation!==null&&!['add','correct','set'].includes(String(x.operation)))throw new Error('invalid_schema');
  seen.add(Number(x.lineNumber));
  return{lineNumber:Number(x.lineNumber),sourceText:x.sourceText.trim(),lineType:x.lineType as VisionLine['lineType'],category:x.category as RecapCategory|null,label:x.label as string|null,amount:x.amount as string|null,quantity:x.quantity as string|null,unit:x.unit as string|null,accountName:x.accountName as string|null,note:x.note as string|null,correctionTarget:x.correctionTarget as string|null,operation:x.operation as VisionLine['operation'],ambiguity:x.ambiguity as string|null};
 });
 const entries:RecapEntry[]=[],inventoryLines:RecapInventoryExtraction[]=[],unresolved:string[]=[];
 for(const line of lines){
  if(line.ambiguity)unresolved.push('Baris '+line.lineNumber+': '+line.ambiguity);
  if(line.lineType==='unreadable'){unresolved.push('Baris '+line.lineNumber+' belum terbaca: '+line.sourceText);continue;}
  if(line.lineType!=='entry')continue;
  const hasQuantity=line.quantity!==null;if(hasQuantity)inventoryLines.push({sourceText:line.sourceText,label:line.label??'',quantity:line.quantity,unit:line.unit,operation:line.operation,ambiguity:line.ambiguity??(!line.unit?'Satuan barang belum terbaca.':null)});
  if(hasQuantity&&!line.amount)continue;
  if(!line.category||!line.label||!line.amount||!line.operation){unresolved.push('Baris '+line.lineNumber+' belum lengkap: '+line.sourceText);continue;}
  if(parseIndonesianRupiah(line.amount)===null){unresolved.push('Nominal pada baris '+line.lineNumber+' perlu diperjelas: '+line.sourceText);continue;}
  entries.push({category:line.category==='cash_balance'||line.category==='electronic_balance'?'total_balance':line.category,label:line.category==='cash_balance'||line.category==='electronic_balance'?'komponen saldo':'saldo total',amount:line.amount,operation:line.operation});
 }
 const balanceEntries=entries.filter(entry=>entry.category==='total_balance');
 if(balanceEntries.length){
  const explicitTotals=balanceEntries.filter(entry=>entry.label==='saldo total');
  const balanceValues=explicitTotals.length?explicitTotals:balanceEntries;
  const total=balanceValues.reduce((sum,entry)=>sum+(parseIndonesianRupiah(entry.amount)??0n),0n);
  for(let i=entries.length-1;i>=0;i--)if(entries[i].category==='total_balance')entries.splice(i,1);
  entries.push({category:'total_balance',label:'saldo total',amount:total.toString(),operation:'set'});
 } if(root.quality==='unreadable'&&!unresolved.length)unresolved.push('Tulisan pada foto belum terbaca jelas.');
 return{quality:root.quality as VisionExtraction['quality'],lines,entries,inventoryLines,unresolved:[...new Set(unresolved)].slice(0,30)};
}
const prompt=[
'Baca satu foto buku rekap shift toko. Kembalikan JSON saja dengan bentuk {"quality":"clear|mixed|unreadable","lines":[{"lineNumber":1,"sourceText":"transkripsi persis atau [tidak terbaca]","lineType":"entry|subtotal|note|unreadable","category":"service_volume|service_fee|sale|expense|cash_balance|electronic_balance|total_balance atau null","label":"deskripsi atau null","amount":"nominal persis atau null","quantity":"jumlah barang jika tertulis atau null","unit":"satuan jika tertulis atau null","accountName":"nama akun seperti DANA atau null","note":"catatan asli atau null","correctionTarget":"baris yang dikoreksi atau null","operation":"add|correct|set atau null","ambiguity":"alasan ketidakjelasan atau null"}]}.',
'Buat satu elemen per baris, pertahankan urutan dan sourceText. Jangan mengarang atau memperbaiki tulisan. Tulis nominal persis seperti 2,5jt. Jangan hitung subtotal/total dan jangan jadikan subtotal sebagai entry; simpan sebagai lineType subtotal. service_volume adalah pokok jasa transfer/tarik/topup; service_fee biaya admin; sale barang dagang; expense pengeluaran; cash_balance kas; electronic_balance saldo elektronik; total_balance saldo total gabungan kas dan elektronik. Saldo gunakan set, aktivitas baru add, koreksi eksplisit correct. Bila buku menulis kas dan elektronik sebagai dua baris, pertahankan masing-masing sesuai tulisan; aplikasi akan menggabungkannya secara deterministik menjadi satu saldo total. Jangan meminta pemilihan akun. Jika tidak terbaca, pertahankan sourceText [tidak terbaca] disertai nomor baris dan isi ambiguity. Laporan foto bukan bukti transaksi.'
].join(' ');
export async function extractHandwrittenImage(bytes:Uint8Array,mimeType:string,caption?:string|null):Promise<{extraction:VisionExtraction;metrics:VisionMetrics}>{
 const apiKey=process.env.DEEPSEEK_API_KEY;
 if(!apiKey)throw new VisionExtractionError('not_configured',{latencyMs:0,promptTokens:0,completionTokens:0,approximateInputTokens:Math.ceil(bytes.byteLength/1024)},'Pembacaan AI tidak tersedia; silakan ketik rekap manual.');
 const model=process.env.DEEPSEEK_VISION_MODEL||'deepseek-flash';
 const image='data:'+mimeType+';base64,'+Buffer.from(bytes).toString('base64');
 const userPrompt=caption?.trim()?'Keterangan dari karyawan (konteks, bukan angka terverifikasi): '+caption.trim().slice(0,1000):'Baca semua baris tulisan tangan pada gambar.';
 const started=Date.now();
 try{
  const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},body:JSON.stringify({
   model,messages:[{role:'system',content:prompt},{role:'user',content:[{type:'text',text:userPrompt},{type:'image_url',image_url:{url:image,detail:'high'}}]}],
   response_format:{type:'json_object'},thinking:{type:'disabled'},temperature:0,max_tokens:2400,stream:false
  }),signal:AbortSignal.timeout(45000)});
  const latencyMs=Date.now()-started;
  if(!response.ok)throw new VisionExtractionError('provider_http',{latencyMs,promptTokens:0,completionTokens:0,approximateInputTokens:Math.ceil(bytes.byteLength/1024)},'Pembacaan foto gagal. Anda bisa mengetik rekap manual.');
  const payload=await response.json() as {choices?:{finish_reason?:string;message?:{content?:string|null}}[];usage?:{prompt_tokens?:number;completion_tokens?:number}};
  const metrics:VisionMetrics={latencyMs,promptTokens:payload.usage?.prompt_tokens??0,completionTokens:payload.usage?.completion_tokens??0,approximateInputTokens:Math.ceil(bytes.byteLength/1024)};
  const content=payload.choices?.[0]?.message?.content;
  if(!content||payload.choices?.[0]?.finish_reason==='length')throw new VisionExtractionError('incomplete_response',metrics,'Pembacaan foto tidak lengkap. Anda bisa mengetik rekap manual.');
  let decoded:unknown;try{decoded=JSON.parse(content);}catch{throw new VisionExtractionError('malformed_json',metrics,'Hasil foto tidak dapat divalidasi. Anda bisa mengetik rekap manual.');}
  try{return{extraction:validateVisionExtraction(decoded),metrics};}catch(error){throw new VisionExtractionError(error instanceof Error?error.message:'invalid_schema',metrics,'Hasil foto tidak dapat divalidasi. Anda bisa mengetik rekap manual.');}
 }catch(error){
  if(error instanceof VisionExtractionError)throw error;
  throw new VisionExtractionError(error instanceof Error&&error.name==='TimeoutError'?'timeout':'provider_error',{latencyMs:Date.now()-started,promptTokens:0,completionTokens:0,approximateInputTokens:Math.ceil(bytes.byteLength/1024)},'Pembacaan foto gagal atau timeout. Anda bisa mengetik rekap manual.');
 }
}

