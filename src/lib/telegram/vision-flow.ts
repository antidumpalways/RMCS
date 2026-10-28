import type { RecapEntry, RecapPhotoReview } from './recap';
import { parseIndonesianRupiah } from './recap';
export type VisionAction='accept'|'correct'|'more'|'manual'|'replace'|'supplement'|'skip'|'finish';
const actionCodes:Record<VisionAction,string>={accept:'a',correct:'c',more:'m',manual:'t',replace:'r',supplement:'s',skip:'x',finish:'f'};
const codeActions:Record<string,VisionAction>=Object.fromEntries(Object.entries(actionCodes).map(([action,code])=>[code,action as VisionAction]));
export function parseVisionCallback(data:string|undefined):{action:VisionAction;draftId:string;photoId:string;revision:number}|null{
 const m=/^rcms:v:([acmrstxf]):([A-Za-z0-9_-]{10,40}):([A-Za-z0-9_-]{6,16}):([0-9]{1,10})$/.exec(data??'');
 return m?{action:codeActions[m[1]],draftId:m[2],photoId:m[3],revision:Number(m[4])}:null;
}
export function visionCallback(action:VisionAction,draftId:string,photoId:string,revision:number){return'rcms:v:'+actionCodes[action]+':'+draftId+':'+photoId+':'+revision;}
function canonicalLabel(category:string,label:string){
 const value=label.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim();
 if(category==='service_volume'){if(/\b(tf|transfer)\b/.test(value))return'transfer keluar';if(/\b(tarik|penarikan)\b/.test(value))return'tarik tunai';if(/\b(pulsa|top ?up|isi ulang)\b/.test(value))return'pulsa';}
 if(category==='service_fee'){if(/\b(tf|transfer)\b/.test(value))return'admin transfer';if(/\b(tarik|penarikan)\b/.test(value))return'admin tarik tunai';}
 if(category==='sale'&&/\brokok\b/.test(value))return'rokok';
  if(category==='cash_balance'||category==='electronic_balance'||category==='total_balance')return'saldo total';
 return value;
}export function findDuplicatePhoto(reviews:RecapPhotoReview[],fileUniqueId:string,sha256?:string){return reviews.find(x=>x.fileUniqueId===fileUniqueId||(sha256&&x.sha256===sha256))??null;}
export function findVisionConflicts(current:RecapEntry[],candidate:RecapEntry[]):RecapEntry[]{
 return candidate.filter(entry=>current.some(old=>old.category===entry.category&&canonicalLabel(old.category,old.label)===canonicalLabel(entry.category,entry.label)));
}
export function visionPhotoAllowed(groupAllowed:boolean,identifiedTelegramActor:boolean,activeSession:boolean){return groupAllowed&&identifiedTelegramActor&&activeSession;}
export function mergeVisionEntries(current:RecapEntry[],candidate:RecapEntry[],mode:'accept'|'replace'|'supplement'):{entries:RecapEntry[];conflicts:RecapEntry[];blockedBalanceSupplement:boolean}{
 const conflicts=findVisionConflicts(current,candidate);
 if(mode==='accept'&&conflicts.length)return{entries:current,conflicts,blockedBalanceSupplement:false};
 if(mode==='supplement'&&conflicts.some(x=>x.category==='cash_balance'||x.category==='electronic_balance'||x.category==='total_balance'))return{entries:current,conflicts,blockedBalanceSupplement:true};
 const entries=current.map(e=>({...e}));
 for(const incoming of candidate){
  const i=entries.findIndex(e=>e.category===incoming.category&&canonicalLabel(e.category,e.label)===canonicalLabel(incoming.category,incoming.label));
  if(i>=0&&mode==='replace'){entries[i]={...incoming,operation:'set'};continue;}
  if(i>=0&&mode==='supplement'&&(incoming.category==='cash_balance'||incoming.category==='electronic_balance'||incoming.category==='total_balance'))continue;
  if(i>=0){const left=parseIndonesianRupiah(entries[i].amount),right=parseIndonesianRupiah(incoming.amount);if(left!==null&&right!==null)entries[i]={...incoming,amount:(left+right).toString(),operation:'add'};}
  else entries.push({...incoming,operation:incoming.category==='cash_balance'||incoming.category==='electronic_balance'||incoming.category==='total_balance'?'set':'add'});
 }
 return{entries,conflicts,blockedBalanceSupplement:false};
}
export function photoReviewIsEditable(status:string){return status==='PENDING';}




