import { parseItemCorrection, parseItemSegments } from './item-line';
export type RecapCategory = 'service_volume' | 'service_fee' | 'sale' | 'expense' | 'cash_balance' | 'electronic_balance' | 'total_balance';
export type RecapEntry = { category: RecapCategory; label: string; amount: string; operation: 'add' | 'correct' | 'set' };
export type RecapInventoryLine = { id:string; sourceText:string; label:string; quantity:number; unit:string; productId:number|null; candidateProductIds:number[]; mappingStatus:'UNMATCHED'|'MATCHED'|'AMBIGUOUS'|'OWNER_REVIEW'; coverage:'UNDECIDED'|'INCLUDES_APP_SALES'|'UNRECORDED_ONLY'|'OWNER_REVIEW'; recordedWebQty?:number; appliedQty?:number };
export type RecapInventoryExtraction = { sourceText:string; label:string; quantity:number|string|null; unit:string|null; operation:'add'|'correct'|'set'|null; ambiguity?:string|null };
export type RecapBalanceCheck={openingBalance:string;expectedBalance:string;actualBalance:string;movementDelta:string;difference:string;status:'MATCH'|'SHORT'|'EXCESS';sourceConflicts:string[];itemSales?:string};
export type RecapDraft = { contributors?: string[]; shiftLabel: string | null; entries: RecapEntry[]; inventoryLines?:RecapInventoryLine[]; unresolved: string[]; messages: string[]; processedUpdateIds?: string[]; photoReviews?:RecapPhotoReview[]; correctionPhotoId?:string|null; balanceCheck?:RecapBalanceCheck; closingStockAwaiting?:boolean; closingStockCounts?:Array<{productId:number;actualQty:number}>; draftMessageId?:number; choiceMessageId?:number; recentInputs?:Array<{key:string;at:number}>; pendingDuplicate?:{text:string;at:number} };
export type RecapExtraction = { shiftLabel?: string | null; entries: RecapEntry[]; inventoryLines?:RecapInventoryExtraction[]; unresolved: string[]; resolved?: string[] };
export type RecapVisionLine={lineNumber:number;sourceText:string;lineType:'entry'|'subtotal'|'note'|'unreadable';category:RecapCategory|null;label:string|null;amount:string|null;quantity:string|null;unit:string|null;accountName:string|null;note:string|null;correctionTarget:string|null;operation:'add'|'correct'|'set'|null;ambiguity:string|null};
export type RecapPhotoReview={id:string;fileId:string;fileUniqueId:string;sha256:string;mimeType:string;caption:string|null;quality?:'clear'|'mixed'|'unreadable';sourceLines:RecapVisionLine[];entries:RecapEntry[];inventoryLines?:RecapInventoryExtraction[];unresolved:string[];status:'PROCESSING'|'PENDING_REVIEW'|'CORRECTING'|'MERGED'|'IGNORED'|'FAILED';metrics?:{latencyMs:number;promptTokens:number;completionTokens:number;approximateInputTokens:number;failureCode?:string};createdAt:string;correctionMessages?:string[]};
export type RecapTotals = Record<RecapCategory, string>;
const categories = new Set<RecapCategory>(['service_volume','service_fee','sale','expense','cash_balance','electronic_balance','total_balance']);
export const emptyRecap = (): RecapDraft => ({shiftLabel:null,entries:[],inventoryLines:[],unresolved:[],messages:[],processedUpdateIds:[]});
export function parseIndonesianRupiah(s:string):bigint|null {
 const compound=/^(?:rp\s*)?(\d+(?:[.,]\d+)?)\s*(jt|juta|m)\s*(?:\+\s*)?(\d+(?:[.,]\d+)?)\s*(rb|ribu|k)$/i.exec(s.trim());
 if(compound){const first=parseIndonesianRupiah(compound[1]+compound[2]),second=parseIndonesianRupiah(compound[3]+compound[4]);return first===null||second===null||first+second>1000000000000n?null:first+second;}
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
   return [{ sourceText: item.sourceText.slice(0, 500), label: cleanItemLabel(item.label).slice(0, 120),
    quantity: typeof item.quantity === 'string' || typeof item.quantity === 'number' ? item.quantity : null,
    // Karyawan tidak wajib menulis satuan: tanpa satuan berarti pcs.
    unit: typeof item.unit === 'string' && item.unit.trim() ? item.unit.slice(0, 30) : 'pcs', operation,
    ambiguity: typeof item.ambiguity === 'string' ? item.ambiguity.slice(0, 180) : null }];
  }).slice(0, 50) : [];
  return { shiftLabel: typeof r.shiftLabel === 'string' ? r.shiftLabel.slice(0, 40) : null,
   entries: (() => {
    const rawEntries = Array.isArray(r.entries) ? r.entries.filter(valid) : [];
    const balanceEntries = rawEntries.filter(e => e.category === 'total_balance' || e.category === 'cash_balance' || e.category === 'electronic_balance');
    const explicitTotal = balanceEntries.filter(e => e.category === 'total_balance');
    const combinedEntries = explicitTotal.length ? explicitTotal : balanceEntries;
    const otherEntries = rawEntries.filter(e => e.category !== 'total_balance' && e.category !== 'cash_balance' && e.category !== 'electronic_balance')
      .map(e => ({ ...e, label: e.label.trim().toLowerCase() }));
    if (!combinedEntries.length) return otherEntries;
    const total = combinedEntries.reduce((sum, entry) => sum + (parseIndonesianRupiah(entry.amount) ?? 0n), 0n);
    return [...otherEntries, { category: 'total_balance' as const, label: 'saldo total', amount: total.toString(),
      operation: combinedEntries.some(entry => entry.operation === 'correct') ? 'correct' as const : 'set' as const }];
   })(),   inventoryLines, unresolved: Array.isArray(r.unresolved) ? r.unresolved.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 180)).slice(0, 8) : [],
   resolved: Array.isArray(r.resolved) ? r.resolved.filter((x): x is string => typeof x === 'string').map(x => x.slice(0, 180)).slice(0, 8) : [] };
}
// Peringatan sementara dari pembaca teks ("Kategori total perlu diperjelas") tidak boleh menempel selamanya:
// hilang bila pesan baru menyebut kata yang sama atau sudah mencatat saldo total.
function staleWordWarning(q:string,message:string,x:RecapExtraction){
 const match=/^Kategori (.+?) perlu diperjelas/.exec(q)??/^Nominal (.+?) ambigu/.exec(q)??/^Belum paham “([\w-]+)/.exec(q)??/^Angka “(.+?)”/.exec(q);
 if(!match)return false;
 const token=match[1].toLowerCase();
 return message.toLowerCase().includes(token)||(['total','saldo','akhir'].includes(token)&&x.entries.some(entry=>entry.category==='total_balance'));
}
// Kunci pembanding pesan: huruf kecil, tanpa tanda baca dan spasi ganda, agar pesan yang sama persis (walau beda spasi) terdeteksi.
export function inputDuplicateKey(text:string){return text.toLocaleLowerCase('id-ID').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
// Label barang dari AI/pembaca teks dibersihkan dari kata penyerta seperti "rekap ... laku".
export function cleanItemLabel(label:string){return label.trim().replace(/^(?:rekap|laporan|lapor)\s+/i,'').replace(/\s+(?:terjual|jual|laku|keluar|habis|kejual)$/i,'').trim();}
export function applyExtraction(d:RecapDraft,x:RecapExtraction,message:string,updateId?:string):RecapDraft {
 if(updateId&&d.processedUpdateIds?.includes(updateId))return d;
 const entries=[...d.entries];
 for(const e of x.entries){const i=entries.findIndex(p=>p.category===e.category&&p.label===e.label);
  if(e.operation==='add'&&i>=0)entries[i]={...e,amount:(parseIndonesianRupiah(entries[i].amount)!+parseIndonesianRupiah(e.amount)!).toString()};
  else if(i>=0)entries[i]={...e,operation:'set'};else entries.push({...e,operation:'set'});
 }
 const unresolved=[...x.unresolved];const inventoryLines=[...(d.inventoryLines??[])];for(let i=0;i<(x.inventoryLines??[]).length;i++){const incoming=x.inventoryLines![i],qty=typeof incoming.quantity==='number'?incoming.quantity:Number(incoming.quantity),label=incoming.label.trim().toLocaleLowerCase('id-ID'),unit=(incoming.unit??'').trim().toLocaleLowerCase('id-ID');if(incoming.ambiguity){unresolved.push(incoming.ambiguity);continue;}const changing=incoming.operation==='correct'||incoming.operation==='set',removing=changing&&qty===0;if(!removing&&(!Number.isSafeInteger(qty)||qty<=0||qty>1000000||!label||!unit)){unresolved.push('Jumlah “'+incoming.sourceText+'” belum jelas. Contoh: axis 3 hari 2');continue;}let index=inventoryLines.findIndex(line=>line.label===label);if(index<0&&changing){const words=label.split(/\s+/).filter(Boolean),near=inventoryLines.map((line,position)=>({line,position})).filter(item=>words.every(word=>item.line.label.split(/\s+/).includes(word)));if(near.length===1)index=near[0].position;}if(changing){if(index<0){unresolved.push('“'+label+'” belum ada di rekap ini, jadi belum bisa dikoreksi.');continue;}if(removing){inventoryLines.splice(index,1);continue;}inventoryLines[index]={...inventoryLines[index],sourceText:incoming.sourceText,label,quantity:qty,unit,productId:null,candidateProductIds:[],mappingStatus:'UNMATCHED',coverage:'UNDECIDED',recordedWebQty:undefined,appliedQty:undefined};}else if(index>=0){if(inventoryLines[index].unit!==unit){unresolved.push('Satuan untuk '+label+' berbeda; perlu diperjelas.');continue;}inventoryLines[index]={...inventoryLines[index],sourceText:inventoryLines[index].sourceText+'; '+incoming.sourceText,quantity:inventoryLines[index].quantity+qty,productId:null,candidateProductIds:[],mappingStatus:'UNMATCHED',coverage:'UNDECIDED'};}else inventoryLines.push({id:'line-'+(updateId??'manual')+'-'+i,sourceText:incoming.sourceText,label,quantity:qty,unit,productId:null,candidateProductIds:[],mappingStatus:'UNMATCHED',coverage:'UNDECIDED'});}
 const appliedLabels=(x.inventoryLines??[]).map(item=>item.label.trim().toLocaleLowerCase('id-ID')).filter(label=>label&&!unresolved.some(message=>message.toLowerCase().includes(label)));
 return {contributors:d.contributors,draftMessageId:d.draftMessageId,choiceMessageId:d.choiceMessageId,shiftLabel:x.shiftLabel??d.shiftLabel,entries,inventoryLines,unresolved:[...new Set([...d.unresolved.filter(q=>!appliedLabels.some(label=>q.toLowerCase().includes(label))&&!staleWordWarning(q,message,x)&&!x.resolved?.some(r=>q.toLowerCase().includes(r.toLowerCase())||r.toLowerCase().includes(q.toLowerCase()))),...unresolved])].slice(-12),messages:[...d.messages,message.slice(0,1000)].slice(-30),processedUpdateIds:[...(d.processedUpdateIds??[]),...(updateId?[updateId]:[])]};
}
export function recapTotals(d:RecapDraft):RecapTotals {
 const t:RecapTotals={service_volume:'0',service_fee:'0',sale:'0',expense:'0',cash_balance:'0',electronic_balance:'0',total_balance:'0'};
 for(const e of d.entries){const n=parseIndonesianRupiah(e.amount);if(n!==null)t[e.category]=(BigInt(t[e.category])+n).toString();}
 const hasCombined=d.entries.some(e=>e.category==='total_balance');
 if(!hasCombined)t.total_balance=(BigInt(t.cash_balance)+BigInt(t.electronic_balance)).toString();
 return t;
}
export function buildAggregateReport(d:RecapDraft) {
 return {shiftLabel:d.shiftLabel,entries:d.entries.map(e=>({...e})),inventoryLines:(d.inventoryLines??[]).map(e=>({...e,candidateProductIds:[...e.candidateProductIds]})),totals:recapTotals(d),messages:[...d.messages],photoEvidence:(d.photoReviews??[]).map(p=>({ ...p, sourceLines:p.sourceLines.map(line=>({...line})), entries:p.entries.map(e=>({...e})) }))};
}export function canFinalizeRecap(d:RecapDraft):boolean { return recapIssues(d).length===0; }
export function recapIssues(d:RecapDraft):string[] {
 const hasData=d.entries.length>0||(d.inventoryLines?.length??0)>0,a=d.unresolved.filter(item=>!(hasData&&item==='Belum ada nominal rekap yang terbaca.'));
 const hasTotal=d.entries.some(e=>e.category==='total_balance');
 const hasLegacyCash=d.entries.some(e=>e.category==='cash_balance');
 const hasLegacyElectronic=d.entries.some(e=>e.category==='electronic_balance');
 if(!hasTotal&&!(hasLegacyCash&&hasLegacyElectronic))a.push('Tulis saldo akhir (kas + saldo elektronik digabung). Contoh: saldo akhir 25.000.000');
 if(!d.entries.length&&!(d.inventoryLines?.length))a.push('Tulis jualan atau angka shift. Contoh: Admin 45rb, Axis 13GB 2 pcs');for(const line of d.inventoryLines??[]){if(line.mappingStatus!=='MATCHED')a.push('Pilih barang “'+line.label+'” dengan tombol di bawah.');if(line.coverage==='OWNER_REVIEW'||line.mappingStatus==='OWNER_REVIEW')a.push('Barang “'+line.label+'” menunggu pengecekan owner.');}return [...new Set(a)];
}
export async function extractRecapMessage(text:string,d:RecapDraft):Promise<RecapExtraction>{
 const key=process.env.DEEPSEEK_API_KEY;if(!key)return deterministicExtraction(text);
 let response:Response;try{response=await fetch('https://api.deepseek.com/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify({
  model:process.env.DEEPSEEK_MODEL||'deepseek-flash',response_format:{type:'json_object'},temperature:0,max_tokens:3000,
   messages:[{role:'system',content:'Pahami bahasa sehari-hari, singkatan, typo ringan, pesan bertahap, dan koreksi seperti ‘eh tadi salah, axis bukan 7 tapi 5 pcs’ atau ‘saldo cash akhir 2jt’. Gunakan konteks draft untuk menerapkan koreksi pada baris yang benar; jika target atau satuan tidak jelas, tandai unresolved dan jangan menebak. Ekstrak laporan shift informal Indonesia sebagai JSON {"shiftLabel":string|null,"entries":[{"category":"service_volume|service_fee|sale|expense|cash_balance|electronic_balance|total_balance","label":string,"amount":string,"operation":"add|correct|set"}],"inventoryLines":[{"sourceText":string,"label":string,"quantity":integer|null,"unit":string|null,"operation":"add|correct|set","ambiguity":string|null}],"unresolved":[string],"resolved":[string]}. ATURAN BARANG TERJUAL (inventoryLines): karyawan menulis sesingkat mungkin, jadi JANGAN menuntut kata pcs. Setiap sebutan barang adalah satu baris inventoryLines dengan unit "pcs". Jika jumlah tidak ditulis, quantity=1. Contoh: "telkomsel 3 hari" => label "telkomsel 3 hari", quantity 1; "axis 5 hari 2" => label "axis 5 hari", quantity 2; "2 surya" => label "surya", quantity 2; "xl 7hr dua" => label "xl 7 hari", quantity 2; "tsel 3 hari sama axis 5 hari 2" => dua baris. Voucher dikelola per provider per masa aktif (hari); kuota GB tidak wajib dan boleh tidak ada. Angka yang langsung diikuti hari/hr/gb/mb adalah bagian NAMA barang, bukan jumlah. Angka dengan rb/ribu/k/jt/juta atau bernilai 1000 ke atas adalah UANG, bukan jumlah; harga yang ditulis di samping barang diabaikan. Jika provider ditulis dengan satu angka polos tanpa kata hari (mis. "axis 7") sehingga tidak jelas 7 hari atau 7 pcs, isi ambiguity dengan pertanyaan singkat. Label ditulis seperti kata karyawan (rapikan singkatan: tsel=telkomsel, hr=hari), tanpa kata laku/terjual/jual. Jangan infer jumlah dari nominal; nominal penjualan tetap aggregate sale terpisah. Jangan menebak produk/SKU yang tidak disebut. Untuk koreksi jumlah barang yang sudah ada di draft gunakan operation "correct" dengan label PERSIS seperti di draft; untuk menghapus barang dari draft ("hapus axis 3 hari", "axis 3 hari batal") gunakan operation "correct" dengan quantity 0. Tandai nilai bertentangan unresolved. Jangan buat profit atau fakta. Pertahankan nominal asli. service_volume=pokok jasa; service_fee=admin; sale=omzet barang; expense=pengeluaran; cash_balance=kas; electronic_balance=saldo elektronik. Jika ada dua nominal kas dan elektronik, keduanya dijumlahkan menjadi saldo gabungan; untuk satu angka gunakan total_balance. Usahakan minta dan catat satu angka saldo total saja. Koreksi eksplisit correct; saldo set; aktivitas add. Draft angka keuangan: '+JSON.stringify(d.entries)+' Draft barang dan jumlah sebelumnya: '+JSON.stringify((d.inventoryLines??[]).map(line=>({label:line.label,quantity:line.quantity,unit:line.unit,sourceText:line.sourceText})))+' Klarifikasi: '+JSON.stringify(d.unresolved)+'. Isi resolved hanya untuk persoalan yang dijawab. Pesan terbaru: '+text}],stream:false
 }),signal:AbortSignal.timeout(20000)});}catch{return deterministicExtraction(text);}
 if(!response.ok)return deterministicExtraction(text);
 const data=await response.json() as {choices?:{message?:{content?:string}}[]};
 try{const ai=normalizeExtraction(JSON.parse(data.choices?.[0]?.message?.content||''));if(!(ai.inventoryLines?.length)){const local=deterministicExtraction(text);if(local.inventoryLines?.length)return {...ai,inventoryLines:local.inventoryLines};if(!ai.entries.length&&local.entries.length)return {...local,unresolved:[...new Set([...ai.unresolved,...local.unresolved])].slice(0,8)};}return ai;}catch{return deterministicExtraction(text);}
}
export function deterministicExtraction(text:string):RecapExtraction{
 const entries:RecapEntry[]=[],inventoryLines:RecapInventoryExtraction[]=[],unresolved:string[]=[];
 const consumed=new Set<string>();
 const sourceLines=text.split(/\r?\n/).flatMap(line=>line.split(/(?<=\d\s*(?:pcs?|unit|units?|biji|buah|lembar|batang|pack|pak|box|bungkus)\.?)\s+(?!(?:tapi|tp)\b)(?=\p{L})/iu));for(const raw of sourceLines){const candidate=raw.trim().replace(/^[-•*]\s*/,''),correction=/^(?:eh\s+)?(.+?)\s+(?:tadi\s+)?salah\s+bukan\s+\d+\s*(pcs?|unit|units?|biji|buah|lembar|batang)\s+(?:tapi|tp)\s+(\d+)\s*(pcs?|unit|units?|biji|buah|lembar|batang)\s*$/i.exec(candidate);if(correction){consumed.add(raw);inventoryLines.push({sourceText:raw.trim(),label:correction[1].replace(/\b(tadi|terjual|jual)\s*$/i,'').trim(),quantity:correction[3],unit:correction[4].toLowerCase(),operation:'correct',ambiguity:correction[2].toLowerCase()!==correction[4].toLowerCase()?'Satuan koreksi berbeda.':null});continue;}const fixed=parseItemCorrection(candidate);if(fixed){consumed.add(raw);inventoryLines.push({sourceText:fixed.sourceText,label:fixed.label,quantity:String(fixed.quantity),unit:'pcs',operation:'correct',ambiguity:null});continue;}const items=parseItemSegments(candidate);if(items){consumed.add(raw);for(const item of items)inventoryLines.push({sourceText:item.sourceText,label:item.label,quantity:String(item.quantity),unit:item.unit,operation:'add',ambiguity:item.ambiguity});}}
 let rest=sourceLines.filter(raw=>!consumed.has(raw)).join(' ');
 const correction=/\b(rokok|pulsa|tf|transfer|tarik)\b(?:\s+\w+){0,3}\s+salah\s+bukan\s+(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)\s+(?:tapi|tp)\s+(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i.exec(rest);
 if(correction){const key=correction[1].toLowerCase();const category:RecapCategory=key==='rokok'?'sale':'service_volume';const label=key==='tf'||key==='transfer'?'transfer keluar':key==='tarik'?'tarik tunai':key;entries.push({category,label,amount:correction[3],operation:'correct'});rest=rest.replace(correction[0],' ');}
 const specs:Array<[RecapCategory,string,RegExp,'add'|'set']>=[
 ['total_balance','saldo total',/(?:saldo\s*(?:akhir|total(?:\s*nya)?|gabungan|sekarang)(?:\s+(?:akhir|total(?:\s*nya)?|gabungan|sekarang))*|total\s+saldo(?:\s+akhir)?)\s*[:=]?\s*(\d[\d.,]*\s*(?:(?:jt|juta|m)\s*)?(?:\d[\d.,]*\s*(?:rb|ribu|k))?)/i,'set'],

 ['total_balance','saldo elektronik',/\b(?:saldo\s*)?(?:cash|kas|dana|gopay|ovo|rekening|elektronik)\b(?:\s*(?:akhir|sisa))?\s*[:=]?\s*(\d[\d.,]*\s*(?:(?:jt|juta|m)\s*)?(?:\d[\d.,]*\s*(?:rb|ribu|k))?)/i,'set'],
 // "saldo 26jt", "sisa uang 26jt", "uang laci 26jt": karyawan jarang menulis "saldo akhir" lengkap.
 ['total_balance','saldo total',/\b(?:saldo(?:\s*nya)?|sisa\s+(?:uang|saldo|kas)|uang\s+(?:akhir|laci|di\s+laci|sekarang|total)|total\s+uang)\b\s*[:=]?\s*(\d[\d.,]*\s*(?:(?:jt|juta|m)\s*)?(?:\d[\d.,]*\s*(?:rb|ribu|k))?)/i,'set'],
 ['service_fee','admin transfer',/\b(?:admin|fee)\b\s*(?:tf|transfer)?\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['service_fee','admin tarik tunai',/\b(?:admin|fee)\b\s*(?:tarik(?:\s*tunai)?)\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['expense','pengeluaran',/\b(?:pengeluaran|biaya)\b\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['service_volume','pulsa',/\bpulsa\b\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['sale','penjualan',/\b(?:penjualan|jualan|omzet)\b\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['sale','rokok',/\brokok\b\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['sale','voucher telkomsel',/(?:vc|voucher)\s+telkomsel\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['service_volume','transfer keluar',/\b(?:tf|transfer)\b\s*(?:keluar)?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add'],
 ['service_volume','tarik tunai',/\btarik\b(?:\s*tunai)?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/i,'add']];
 for(const [category,label,re,operation] of specs){const m=re.exec(rest);if(!m)continue;const amount=m[m.length-1].trim();if(parseIndonesianRupiah(amount)!==null)entries.push({category,label,amount,operation});else unresolved.push('Angka “'+amount+'” kurang jelas. Tulis misalnya 45rb atau 45.000.');rest=rest.replace(m[0],' ');}
 // "beli plastik 10rb", "bayar parkir 5rb": pengeluaran dengan nama bebas.
 for(const m of [...rest.matchAll(/\b(?:beli|bayar)\s+([\p{L}][\p{L} ]{1,30}?)\s*[:=]?\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)(?![\d\p{L}])/giu)]){if(parseIndonesianRupiah(m[2].trim())===null)continue;entries.push({category:'expense',label:m[1].trim().toLowerCase(),amount:m[2].trim(),operation:'add'});rest=rest.replace(m[0],' ');}
 for(const m of rest.matchAll(/([\w-]+)\s*(\d[\d.,]*\s*(?:jt|juta|m|rb|ribu|k)?)/gi)){if(!['shift','pagi','siang','malam','eh','tadi','salah','bukan','tapi'].includes(m[1].toLowerCase()))unresolved.push('Belum paham “'+m[0].trim()+'”. Tulis misalnya: admin 45rb, pengeluaran 10rb, saldo akhir 25jt, atau axis 3 hari 2.');}
 const balanceEntries=entries.filter(entry=>entry.category==='cash_balance'||entry.category==='electronic_balance'||entry.category==='total_balance');
 if(balanceEntries.length){
  const total=balanceEntries.reduce((sum,entry)=>sum+(parseIndonesianRupiah(entry.amount)??0n),0n);
  for(let i=entries.length-1;i>=0;i--)if(entries[i].category==='cash_balance'||entries[i].category==='electronic_balance'||entries[i].category==='total_balance')entries.splice(i,1);
  entries.push({category:'total_balance',label:'saldo total',amount:total.toString(),operation:balanceEntries.some(entry=>entry.operation==='correct')?'correct':'set'});
 } if(!entries.length&&!inventoryLines.length&&!unresolved.length)unresolved.push('Belum ada nominal rekap yang terbaca.');
 return {shiftLabel:/\b(pagi|siang|malam)\b/i.exec(text)?.[1]?.toLowerCase()??null,entries,inventoryLines,unresolved};
}

