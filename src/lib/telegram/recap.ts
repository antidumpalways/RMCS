export type RecapCategory = 'service_volume' | 'service_fee' | 'sale' | 'expense' | 'cash_balance' | 'electronic_balance';
export type RecapEntry = { category: RecapCategory; label: string; amount: string; operation: 'add' | 'correct' | 'set' };
export type RecapInventoryLine = { id:string; sourceText:string; label:string; quantity:number; unit:string; productId:number|null; candidateProductIds:number[]; mappingStatus:'UNMATCHED'|'MATCHED'|'AMBIGUOUS'|'OWNER_REVIEW'; coverage:'UNDECIDED'|'INCLUDES_APP_SALES'|'UNRECORDED_ONLY'|'OWNER_REVIEW'; recordedWebQty?:number; appliedQty?:number };
export type RecapInventoryExtraction = { sourceText:string; label:string; quantity:number|string|null; unit:string|null; operation:'add'|'correct'|'set'|null; ambiguity?:string|null };
export type RecapDraft = { shiftLabel: string | null; entries: RecapEntry[]; inventoryLines?:RecapInventoryLine[]; unresolved: string[]; messages: string[]; processedUpdateIds?: string[]; photoReviews?:RecapPhotoReview[]; correctionPhotoId?:string|null };
export type RecapExtraction = { shiftLabel?: string | null; entries: RecapEntry[]; inventoryLines?:RecapInventoryExtraction[]; unresolved: string[]; resolved?: string[] };
export type RecapVisionLine={lineNumber:number;sourceText:string;lineType:'entry'|'subtotal'|'note'|'unreadable';category:RecapCategory|null;label:string|null;amount:string|null;quantity:string|null;unit:string|null;accountName:string|null;note:string|null;correctionTarget:string|null;operation:'add'|'correct'|'set'|null;ambiguity:string|null};
export type RecapPhotoReview={id:string;fileId:string;fileUniqueId:string;sha256:string;mimeType:string;caption:string|null;quality?:'clear'|'mixed'|'unreadable';sourceLines:RecapVisionLine[];entries:RecapEntry[];inventoryLines?:RecapInventoryExtraction[];unresolved:string[];status:'PROCESSING'|'PENDING_REVIEW'|'CORRECTING'|'MERGED'|'IGNORED'|'FAILED';metrics?:{latencyMs:number;promptTokens:number;completionTokens:number;approximateInputTokens:number;failureCode?:string};createdAt:string;correctionMessages?:string[]};
export type RecapTotals = Record<RecapCategory, string>;
const categories = new Set<RecapCategory>(['service_volume','service_fee','sale','expense','cash_balance','electronic_balance']);
export const emptyRecap = (): RecapDraft => ({shiftLabel:null,entries:[],inventoryLines:[],unresolved:[],messages:[],processedUpdateIds:[]});
export function parseIndonesianRupiah(s:string):bigint|null {
 const m=/^(?:rp\s*)?(\d+(?:[.,]\d+)*)(jt|juta|m|rb|ribu|k)?$/i.exec(s.trim()); if(!m)return null;
 const [,n,u='']=m; let value:bigint;
 if(u){if(!/^\d+(?:[.,]\d{1,2})?$/.test(n))return null;const [w,f='']=n.split(/[.,]/);if(f.length>2)return null;const k=['jt','juta','m'].includes(u.toLowerCase())?1000000n:1000n;value=BigInt(w)*k+(f?BigInt((f+'0').slice(0,2))*k/100n:0n);}
 else {if(/[.,]/.test(n)){if(!/^\d{1,3}(?:[.,]\d{3})+$/.test(n))return null;value=BigInt(n.replace(/[.,]/g,''));}else value=BigInt(n);}
 return value<=1000000000000n?value:null;
}
function valid(e:RecapEntry){return !!e&&categories.has(e.category)&&typeof e.label==='string'&&!!e.label.trim()&&e.label.length<=80&&typeof e.amount==='string'&&parseIndonesianRupiah(e.amount)!==null&&['add','correct','set'].includes(e.operation);}
export function normalizeExtraction(v:unknown):RecapExtraction {
 if(!v||typeof v!=='object')return {entries:[],unresolved:['Pesan belum dapat dipahami.']};
 const r=v as Record<string,unknown>;
  const inventoryLines = Array.isArray(r.inventoryLines) ? r.inventoryLines.flatMap((raw): RecapInventoryExtraction[] => {
   if (!raw || typeof raw !== 'object') return [];
   const item = raw as Record<string, unknown>;
   if (typeof item.sourceText !== 'string' || typeof item.label !== 'string') return [];
   const operation = item.operation === 'add' || item.operation === 'correct' || item.operation === 'set' ? item.operation : null;
   return [{ sourceText: item.sourceText.slice(0, 500), label: item.label.slice(0, 120),
    quantity: typeof item.quantity === 'string' || typeof item.quantity === 'number' ? item.quantity : null,
    unit: typeof item.unit === 'string' ? item.unit.slice(0, 30) : null, operation,
    ambiguity: typeof item.ambiguity === 'string' ? item.ambiguity.slice(0, 180) : null }];
  }).slice(0, 50) : [];
  return { shiftLabel: typeof r.shiftLabel === 'string' ? r.shiftLabel.slice(0, 40) : null,
   entries: Array.isArray(r.entries) ? r.entries.filter(valid).map(e => ({ ...e, label: e.label.trim().toLowerCase() })) : [],
   inventoryLines, unresolved: Array.isArray(r.unresolved) ? r.unresolved.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 180)).slice(0, 8) : [],
   resolved: Array.isArray(r.resolved) ? r.resolved.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 180)).slice(0, 8) : [] };
}
export function applyExtraction(d:RecapDraft,x:RecapExtraction,message:string,updateId?:string):RecapDraft {
 if(updateId&&d.processedUpdateIds?.includes(updateId))return d;
 const entries=[...d.entries];
 for(const e of x.entries){const i=entries.findIndex(p=>p.category===e.category&&p.label===e.label);
  if(e.operation==='add'&&i>=0)entries[i]={...e,amount:(parseIndonesianRupiah(entries[i].amount)!+parseIndonesianRupiah(e.amount)!).toString()};
  else if(i>=0)entries[i]={...e,operation:'set'};else entries.push({...e,operation:'set'});
 }
 const unresolved=[...x.unresolved];const inventoryLines=[...(d.inventoryLines??[])];for(let i=0;i<(x.inventoryLines??[]).length;i++){const incoming=x.inventoryLines![i],qty=typeof incoming.quantity==='number'?incoming.quantity:Number(incoming.quantity),label=incoming.label.trim().toLocaleLowerCase('id-ID'),unit=(incoming.unit??'').trim().toLocaleLowerCase('id-ID');if(incoming.ambiguity){unresolved.push(incoming.ambiguity);continue;}if(!Number.isSafeInteger(qty)||qty<=0||qty>1000000||!label||!unit){unresolved.push('Jumlah atau satuan produk perlu diperjelas: '+incoming.sourceText);continue;}const index=inventoryLines.findIndex(line=>line.label===label);if(incoming.operation==='correct'||incoming.operation==='set'){if(index<0){unresolved.push('Koreksi jumlah '+label+' belum memiliki baris sebelumnya.');continue;}inventoryLines[index]={...inventoryLines[index],sourceText:incoming.sourceText,label,quantity:qty,unit,productId:null,candidateProductIds:[],mappingStatus:'UNMATCHED',coverage:'UNDECIDED',recordedWebQty:undefined,appliedQty:undefined};}else if(index>=0){if(inventoryLines[index].unit!==unit){unresolved.push('Satuan untuk '+label+' berbeda; perlu diperjelas.');continue;}inventoryLines[index]={...inventoryLines[index],sourceText:inventoryLines[index].sourceText+'; '+incoming.sourceText,quantity:inventoryLines[index].quantity+qty,productId:null,candidateProductIds:[],mappingStatus:'UNMATCHED',coverage:'UNDECIDED'};}else inventoryLines.push({id:'line-'+(updateId??'manual')+'-'+i,sourceText:incoming.sourceText,label,quantity:qty,unit,productId:null,candidateProductIds:[],mappingStatus:'UNMATCHED',coverage:'UNDECIDED'});}
 return {shiftLabel:x.shiftLabel??d.shiftLabel,entries,inventoryLines,unresolved:[...new Set([...d.unresolved.filter(q=>!x.resolved?.some(r=>q.toLowerCase().includes(r.toLowerCase())||r.toLowerCase().includes(q.toLowerCase()))),...x.unresolved])].slice(-12),messages:[...d.messages,message.slice(0,1000)].slice(-30),processedUpdateIds:[...(d.processedUpdateIds??[]),...(updateId?[updateId]:[])]};
}
export function recapTotals(d:RecapDraft):RecapTotals {
 const t:RecapTotals={service_volume:'0',service_fee:'0',sale:'0',expense:'0',cash_balance:'0',electronic_balance:'0'};
 for(const e of d.entries){const n=parseIndonesianRupiah(e.amount);if(n!==null)t[e.category]=(BigInt(t[e.category])+n).toString();}return t;
}
export function buildAggregateReport(d:RecapDraft) {
 return {shiftLabel:d.shiftLabel,entries:d.entries.map(e=>({...e})),inventoryLines:(d.inventoryLines??[]).map(e=>({...e,candidateProductIds:[...e.candidateProductIds]})),totals:recapTotals(d),messages:[...d.messages],photoEvidence:(d.photoReviews??[]).map(p=>({ ...p, sourceLines:p.sourceLines.map(line=>({...line})), entries:p.entries.map(e=>({...e})) }))};
}export function canFinalizeRecap(d:RecapDraft):boolean { return recapIssues(d).length===0; }
export function recapIssues(d:RecapDraft):string[] {
 const a=[...d.unresolved];if(!d.entries.some(e=>e.category==='cash_balance'))a.push('Saldo kas akhir belum disebutkan.');
 if(!d.entries.some(e=>e.category==='electronic_balance'))a.push('Saldo elektronik akhir belum disebutkan (atau tulis saldo elektronik 0).');
 if(!d.entries.length&&!(d.inventoryLines?.length))a.push('Belum ada angka rekap yang terbaca.');for(const line of d.inventoryLines??[]){if(line.mappingStatus!=='MATCHED')a.push('Produk '+line.label+' belum dipastikan di katalog.');if(line.coverage==='UNDECIDED')a.push('Cakupan penjualan RMCS untuk '+line.label+' belum dikonfirmasi.');if(line.coverage==='OWNER_REVIEW'||line.mappingStatus==='OWNER_REVIEW')a.push('Produk '+line.label+' menunggu tinjauan owner.');}return [...new Set(a)];
}
export async function extractRecapMessage(text:string,d:RecapDraft):Promise<RecapExtraction>{
 const key=process.env.DEEPSEEK_API_KEY;if(!key)return deterministicExtraction(text);
 const response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({
  model:process.env.DEEPSEEK_MODEL||'deepseek-flash',response_format:{type:'json_object'},max_tokens:500,
   messages:[{role:'system',content:'Ekstrak laporan shift informal Indonesia sebagai JSON {"shiftLabel":string|null,"entries":[{"category":"service_volume|service_fee|sale|expense|cash_balance|electronic_balance","label":string,"amount":string,"operation":"add|correct|set"}],"inventoryLines":[{"sourceText":string,"label":string,"quantity":integer|null,"unit":string|null,"operation":"add|correct|set","ambiguity":string|null}],"unresolved":[string],"resolved":[string]}. Ekstrak unit produk hanya jika jumlah dan satuan tertulis eksplisit. Jangan infer jumlah dari nominal; nominal penjualan tetap aggregate sale terpisah. Unit yang tak jelas wajib ambiguity. Jangan menebak produk/SKU. Tandai nilai bertentangan unresolved. Jangan buat profit atau fakta. Pertahankan nominal asli. service_volume=pokok jasa; service_fee=admin; sale=omzet barang; expense=pengeluaran; cash_balance=kas akhir; electronic_balance=saldo elektronik akhir. Koreksi eksplisit correct; saldo set; aktivitas add. Draft: '+JSON.stringify(d.entries)+' Klarifikasi: '+JSON.stringify(d.unresolved)+'. Isi resolved hanya untuk persoalan yang dijawab. Pesan: '+text}],stream:false
 }),signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('AI rekap tidak tersedia. Pesan belum disimpan; coba lagi.');
 const data=await response.json() as {choices?:{message?:{content?:string}}[]};
 try{return normalizeExtraction(JSON.parse(data.choices?.[0]?.message?.content||''));}catch{throw new Error('AI rekap memberi respons tidak valid. Pesan belum disimpan; coba lagi.');}
}
export function deterministicExtraction(text:string):RecapExtraction{
 const entries:RecapEntry[]=[],inventoryLines:RecapInventoryExtraction[]=[],unresolved:string[]=[];
 const sourceLines=text.split(/\r?\n/);for(const raw of sourceLines){const candidate=raw.trim().replace(/^[-•*]\s*/,''),correction=/^(?:eh\s+)?(.+?)\s+(?:tadi\s+)?salah\s+bukan\s+\d+\s*(pcs?|unit|units?|biji|buah|lembar|batang)\s+(?:tapi|tp)\s+(\d+)\s*(pcs?|unit|units?|biji|buah|lembar|batang)\s*$/i.exec(candidate);if(correction){inventoryLines.push({sourceText:raw.trim(),label:correction[1].replace(/\b(tadi|terjual|jual)\s*$/i,'').trim(),quantity:correction[3],unit:correction[4].toLowerCase(),operation:'correct',ambiguity:correction[2].toLowerCase()!==correction[4].toLowerCase()?'Satuan koreksi berbeda.':null});continue;}const m=/^(.*?)\s*(?:terjual|jual)?\s*[:=]?\s*(\d+)\s*(pcs?|unit|units?|biji|buah|lembar|batang|pack|pak|box|bungkus)\s*$/i.exec(candidate);if(m){const label=m[1].replace(/\b(terjual|jual)\s*$/i,'').trim();inventoryLines.push({sourceText:raw.trim(),label,quantity:m[2],unit:m[3].toLowerCase(),operation:'add'});}}
 let rest=sourceLines.filter(raw=>!inventoryLines.some(line=>line.sourceText===raw.trim())).join(' ');
 const correction=/\b(rokok|pulsa|tf|transfer|tarik)\b(?:\s+\w+){0,3}\s+salah\s+bukan\s+(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)\s+(?:tapi|tp)\s+(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i.exec(rest);
 if(correction){const key=correction[1].toLowerCase();const category:RecapCategory=key==='rokok'?'sale':'service_volume';const label=key==='tf'||key==='transfer'?'transfer keluar':key==='tarik'?'tarik tunai':key;entries.push({category,label,amount:correction[3],operation:'correct'});rest=rest.replace(correction[0],' ');}
 const specs:Array<[RecapCategory,string,RegExp,'add'|'set']>=[
 ['cash_balance','kas',/(?:saldo\s*)?(?:cash|kas)(?:\s*(?:akhir|sisa))?\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'set'],
 ['electronic_balance','dana',/(?:saldo\s*)?(dana|gopay|ovo|rekening|elektronik)(?:\s*(?:akhir|sisa))?\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'set'],
 ['service_fee','admin transfer',/(?:admin|fee)\s*(?:tf|transfer)?\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['service_fee','admin tarik tunai',/(?:admin|fee)\s*(?:tarik(?:\s*tunai)?)\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['expense','pengeluaran',/(?:pengeluaran|biaya)\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['service_volume','pulsa',/pulsa\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['sale','rokok',/rokok\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['sale','voucher telkomsel',/(?:vc|voucher)\s+telkomsel\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['service_volume','transfer keluar',/(?:tf|transfer)\s*(?:keluar)?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['service_volume','tarik tunai',/tarik(?:\s*tunai)?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add']];
 for(const [category,label,re,operation] of specs){const m=re.exec(rest);if(!m)continue;const amount=m[m.length-1].trim();if(parseIndonesianRupiah(amount)!==null)entries.push({category,label,amount,operation});else unresolved.push('Nominal '+amount+' ambigu.');rest=rest.replace(m[0],' ');}
 for(const m of rest.matchAll(/([\w-]+)\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/gi)){if(!['shift','pagi','siang','malam','eh','tadi','salah','bukan','tapi'].includes(m[1].toLowerCase()))unresolved.push('Kategori '+m[1]+' perlu diperjelas: omzet barang, volume jasa, atau biaya.');}
 if(!entries.length&&!inventoryLines.length&&!unresolved.length)unresolved.push('Belum ada nominal rekap yang terbaca.');
 return {shiftLabel:/\b(pagi|siang|malam)\b/i.exec(text)?.[1]?.toLowerCase()??null,entries,inventoryLines,unresolved};
}
