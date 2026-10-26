export const MAX_TELEGRAM_IMAGE_BYTES=8*1024*1024;
export type SupportedImageMime='image/jpeg'|'image/png'|'image/gif'|'image/webp';
function starts(bytes:Uint8Array,signature:number[],offset=0){return signature.every((value,index)=>bytes[offset+index]===value);}
function contains(bytes:Uint8Array,signature:number[]){outer:for(let i=0;i<=bytes.length-signature.length;i++){for(let j=0;j<signature.length;j++)if(bytes[i+j]!==signature[j])continue outer;return true;}return false;}
export function detectSupportedImageMime(bytes:Uint8Array):SupportedImageMime|null{
 if(bytes.length>MAX_TELEGRAM_IMAGE_BYTES||bytes.length<14)return null;
 if(starts(bytes,[0xff,0xd8,0xff])&&bytes[bytes.length-2]===0xff&&bytes[bytes.length-1]===0xd9)return'image/jpeg';
 if(starts(bytes,[137,80,78,71,13,10,26,10])&&contains(bytes,[73,72,68,82])&&contains(bytes,[73,69,78,68,174,66,96,130]))return'image/png';
 if((starts(bytes,[71,73,70,56,55,97])||starts(bytes,[71,73,70,56,57,97]))&&bytes[bytes.length-1]===0x3b)return'image/gif';
 if(starts(bytes,[82,73,70,70])&&starts(bytes,[87,69,66,80],8)){const declared=bytes[4]|(bytes[5]<<8)|(bytes[6]<<16)|(bytes[7]<<24);if(declared>=4&&declared+8<=bytes.length)return'image/webp';}
 return null;
}

