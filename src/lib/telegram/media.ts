import { MAX_TELEGRAM_IMAGE_BYTES, detectSupportedImageMime } from './vision-media';

export { MAX_TELEGRAM_IMAGE_BYTES, detectSupportedImageMime };
export type TelegramImageFile={bytes:Uint8Array;mimeType:string;fileSize:number};
export class TelegramMediaError extends Error{constructor(readonly code:string,message:string){super(message);}}
type TelegramFileResponse={ok?:boolean;result?:{file_path?:string;file_size?:number};description?:string};
function safeFilePath(value:string){return value.length<=512&&/^[A-Za-z0-9_./-]+$/.test(value)&&!value.split('/').some(part=>part==='..'||part==='')&&!value.startsWith('/');}
export async function downloadTelegramImage(fileId:string,reportedSize?:number):Promise<TelegramImageFile>{
 if(!fileId||fileId.length>512)throw new TelegramMediaError('invalid_file','Lampiran foto tidak valid.');
 if(reportedSize!==undefined&&(!Number.isSafeInteger(reportedSize)||reportedSize<1||reportedSize>MAX_TELEGRAM_IMAGE_BYTES))throw new TelegramMediaError('too_large','Foto melebihi batas 8 MB. Kirim versi yang lebih kecil.');
 const token=process.env.TELEGRAM_BOT_TOKEN;if(!token)throw new TelegramMediaError('not_configured','Bot belum dikonfigurasi untuk membaca foto.');
 let fileInfo:TelegramFileResponse;
 try{
  const response=await fetch('https://api.telegram.org/bot'+token+'/getFile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file_id:fileId}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error();
  fileInfo=await response.json() as TelegramFileResponse;
 }catch{throw new TelegramMediaError('telegram_get_file','Foto tidak dapat diambil dari Telegram. Silakan kirim ulang atau ketik manual.');}
 const path=fileInfo.result?.file_path,knownSize=fileInfo.result?.file_size;
 if(!fileInfo.ok||!path||!safeFilePath(path))throw new TelegramMediaError('telegram_file_path','Foto tidak dapat divalidasi dari Telegram.');
 if(knownSize!==undefined&&(!Number.isSafeInteger(knownSize)||knownSize<1||knownSize>MAX_TELEGRAM_IMAGE_BYTES))throw new TelegramMediaError('too_large','Foto melebihi batas 8 MB. Kirim versi yang lebih kecil.');
 const url='https://api.telegram.org/file/bot'+token+'/'+path;
 let response:Response;
 try{response=await fetch(url,{signal:AbortSignal.timeout(15000),redirect:'error'});}catch{throw new TelegramMediaError('telegram_download','Unduhan foto gagal. Silakan kirim ulang atau ketik manual.');}
 if(!response.ok)throw new TelegramMediaError('telegram_download','Unduhan foto gagal. Silakan kirim ulang atau ketik manual.');
 const length=Number(response.headers.get('content-length')||0);
 if(length>MAX_TELEGRAM_IMAGE_BYTES)throw new TelegramMediaError('too_large','Foto melebihi batas 8 MB. Kirim versi yang lebih kecil.');
 if(!response.body)throw new TelegramMediaError('empty_file','File foto kosong atau tidak valid.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let total=0;
 try{
  while(true){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>MAX_TELEGRAM_IMAGE_BYTES){await reader.cancel();throw new TelegramMediaError('too_large','Foto melebihi batas 8 MB. Kirim versi yang lebih kecil.');}chunks.push(part.value);}
 }catch(error){if(error instanceof TelegramMediaError)throw error;throw new TelegramMediaError('telegram_download','Unduhan foto gagal. Silakan kirim ulang atau ketik manual.');}
 if(total===0)throw new TelegramMediaError('empty_file','File foto kosong atau tidak valid.');
 const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 const mimeType=detectSupportedImageMime(bytes);
 if(!mimeType)throw new TelegramMediaError('unsupported_format','Format foto harus JPEG, PNG, GIF, atau WebP.');
 return{bytes,mimeType,fileSize:total};
}

