import assert from 'node:assert/strict';
import test from 'node:test';
import { extractHandwrittenImage, validateVisionExtraction, VisionExtractionError } from './vision';
import { applyExtraction, buildAggregateReport, emptyRecap, type RecapPhotoReview } from './recap';
import { findDuplicatePhoto, findVisionConflicts, mergeVisionEntries, parseVisionCallback, photoReviewIsEditable, visionCallback, visionPhotoAllowed, type VisionAction } from './vision-flow';
import { MAX_TELEGRAM_IMAGE_BYTES, detectSupportedImageMime } from './vision-media';
import { downloadTelegramImage, TelegramMediaError } from './media';

const line=(patch:Record<string,unknown>={})=>({lineNumber:1,sourceText:'TF keluar 2,5jt',lineType:'entry',category:'service_volume',label:'transfer keluar',amount:'2,5jt',quantity:null,unit:null,accountName:null,note:null,correctionTarget:null,operation:'add',ambiguity:null,...patch});
const review=(patch:Partial<RecapPhotoReview>={}):RecapPhotoReview=>({id:'photo1234',fileId:'file-secret-id',fileUniqueId:'unique-1',sha256:'abc',mimeType:'image/png',caption:null,quality:'clear',sourceLines:[line() as never],entries:[{category:'service_volume',label:'transfer keluar',amount:'2,5jt',operation:'add'}],unresolved:[],status:'MERGED',createdAt:new Date().toISOString(),...patch});
const jsonResponse=(content:string,status=200)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content}}],usage:{prompt_tokens:321,completion_tokens:45}}),{status,headers:{'content-type':'application/json'}});
test('clear handwritten extraction validates lines and maps only actual entries',()=>{
 const x=validateVisionExtraction({quality:'clear',lines:[line(),line({lineNumber:2,sourceText:'TOTAL 2,5jt',lineType:'subtotal',category:null,label:null,amount:'2,5jt',operation:null})]});
 assert.equal(x.entries.length,1);assert.equal(x.entries[0].amount,'2,5jt');assert.equal(x.lines[1].sourceText,'TOTAL 2,5jt');
});
test('Vision extraction separates explicit product unit quantities from aggregate amounts',()=>{
 const x=validateVisionExtraction({quality:'clear',lines:[line({sourceText:'Axis 7 pcs',label:'axis',category:'sale',amount:null,quantity:'7',unit:'pcs'}),line({lineNumber:2,sourceText:'VC Telkomsel Rp230.000',label:'voucher telkomsel',category:'sale',amount:'230000',quantity:null,unit:null})]});
 assert.equal(x.inventoryLines.length,1);assert.equal(x.inventoryLines[0].quantity,'7');assert.equal(x.entries[0].amount,'230000');
});test('blurry and unreadable lines remain evidence and block silent omission',()=>{
 const x=validateVisionExtraction({quality:'mixed',lines:[line({lineNumber:1,sourceText:'pulsa 35?rb',amount:null,ambiguity:'digit uncertain'}),line({lineNumber:2,sourceText:'[tidak terbaca]',lineType:'unreadable',category:null,label:null,amount:null,operation:null,ambiguity:'blur'})]});
 assert.equal(x.entries.length,0);assert.equal(x.lines.length,2);assert.ok(x.unresolved.length>=2);
});
test('strict schema rejects unknown fields and malformed values',()=>{
 assert.throws(()=>validateVisionExtraction({quality:'clear',lines:[],inventedTotal:42}),/invalid_schema/);
 assert.throws(()=>validateVisionExtraction({quality:'clear',lines:[{...line(),amount:2500000}]}),/invalid_schema/);
});
test('multiple photo evidence records survive final report; identical photo is not re-extracted',()=>{
 const a=review(),b=review({id:'photo5678',fileId:'other-file',fileUniqueId:'unique-2',sha256:'def'});
 const d={...emptyRecap(),photoReviews:[a,b]};
 const report=buildAggregateReport(d);
 assert.equal(report.photoEvidence.length,2);
 assert.equal(findDuplicatePhoto(d.photoReviews!,'unique-1'),a);
 assert.equal(findDuplicatePhoto(d.photoReviews!,'new-id','def'),b);
});
test('text and photo amounts share the same draft; conflicting lines require an explicit choice',()=>{
 const photo=review();
 const d=applyExtraction({...emptyRecap(),entries:photo.entries},{entries:[{category:'sale',label:'rokok',amount:'175rb',operation:'add'}],unresolved:[]},'rokok 175rb');
 const conflicts=findVisionConflicts(d.entries,[{category:'sale',label:'rokok',amount:'195rb',operation:'add'}]);
 assert.equal(conflicts.length,1);
 const replace=mergeVisionEntries(d.entries,[{category:'sale',label:'rokok',amount:'195rb',operation:'add'}],'replace');
 assert.equal(replace.entries.find(x=>x.label==='rokok')?.amount,'195rb');
 const supplement=mergeVisionEntries(d.entries,[{category:'sale',label:'rokok',amount:'195rb',operation:'add'}],'supplement');
 assert.equal(supplement.entries.find(x=>x.label==='rokok')?.amount,'370000');
});
test('same-account balance cannot be automatically supplemented',()=>{
 const x=mergeVisionEntries([{category:'electronic_balance',label:'dana',amount:'3,5jt',operation:'set'}],[{category:'electronic_balance',label:'dana',amount:'4jt',operation:'set'}],'supplement');
 assert.equal(x.blockedBalanceSupplement,true);
});
test('photo authorization requires an allowlisted group, identified Telegram sender and active report',()=>{
 assert.equal(visionPhotoAllowed(true,true,true),true);
 assert.equal(visionPhotoAllowed(false,true,true),false);
 assert.equal(visionPhotoAllowed(true,false,true),false);
 assert.equal(visionPhotoAllowed(true,true,false),false);
});
test('finalized drafts cannot be edited by the photo flow',()=>{
 assert.equal(photoReviewIsEditable('PENDING'),true);
 assert.equal(photoReviewIsEditable('CONFIRMED'),false);
 assert.equal(photoReviewIsEditable('CANCELLED'),false);
});
test('Vision inline callback payloads stay below Telegram limit and reject stale-shaped data',()=>{
 const actions:VisionAction[]=['accept','correct','more','manual','replace','supplement','skip','finish'];
 for(const action of actions){
  const data=visionCallback(action,'cmr1234567890123456789012','0123456789',2147483647);
  assert.ok(Buffer.byteLength(data,'utf8')<=64,`${action} callback exceeded 64 bytes`);
  assert.deepEqual(parseVisionCallback(data),{action,draftId:'cmr1234567890123456789012',photoId:'0123456789',revision:2147483647});
 }
 assert.equal(parseVisionCallback('rcms:v:accept:draft:photo:1'),null);
});test('supported image detection checks bytes and enforces the app size cap',()=>{
 const png=new Uint8Array([137,80,78,71,13,10,26,10,...Array(8).fill(0),73,72,68,82,...Array(4).fill(0),73,69,78,68,174,66,96,130]);
 assert.equal(detectSupportedImageMime(png),'image/png');
 assert.equal(detectSupportedImageMime(new TextEncoder().encode('<svg><script>')),null);
 assert.equal(detectSupportedImageMime(new Uint8Array(MAX_TELEGRAM_IMAGE_BYTES+1)),null);
});
test('oversized Telegram attachments are rejected before network access',async()=>{
 await assert.rejects(()=>downloadTelegramImage('fileid',MAX_TELEGRAM_IMAGE_BYTES+1),(e)=>e instanceof TelegramMediaError&&e.code==='too_large');
});
test('DeepSeek receives the official multimodal data URL request and reports usage',async()=>{
 const oldFetch=global.fetch,oldKey=process.env.DEEPSEEK_API_KEY,oldModel=process.env.DEEPSEEK_VISION_MODEL;
 process.env.DEEPSEEK_API_KEY='test-key';process.env.DEEPSEEK_VISION_MODEL='deepseek-flash';
 let request:Record<string,unknown>|null=null;
 global.fetch=(async(_input,init)=>{request=JSON.parse(String(init?.body)) as Record<string,unknown>;return jsonResponse(JSON.stringify({quality:'clear',lines:[line()]}));}) as typeof fetch;
 try{
  const result=await extractHandwrittenImage(new Uint8Array([1,2,3]),'image/png','shift pagi');
  const payload=request as unknown as {model:string;messages:{content:{type:string;image_url?:{url:string;detail:string}}[]}[]};
  assert.equal(payload.model,'deepseek-flash');assert.equal(payload.messages[1].content[1].image_url?.detail,'high');
  assert.match(payload.messages[1].content[1].image_url?.url??'',/^data:image\/png;base64,/);
  assert.equal(result.extraction.entries.length,1);assert.equal(result.metrics.promptTokens,321);
 }finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey;if(oldModel===undefined)delete process.env.DEEPSEEK_VISION_MODEL;else process.env.DEEPSEEK_VISION_MODEL=oldModel;}
});
test('malformed DeepSeek JSON fails closed with a manual fallback',async()=>{
 const oldFetch=global.fetch,oldKey=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test-key';global.fetch=(async()=>jsonResponse('{not-json')) as typeof fetch;
 try{await assert.rejects(()=>extractHandwrittenImage(new Uint8Array([1]),'image/png'),e=>e instanceof VisionExtractionError&&e.code==='malformed_json');}
 finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey;}
});
test('DeepSeek timeout and HTTP errors are sanitized for manual fallback',async()=>{
 const oldFetch=global.fetch,oldKey=process.env.DEEPSEEK_API_KEY;process.env.DEEPSEEK_API_KEY='test-key';
 try{
  global.fetch=(async()=>{const e=new Error('timeout');e.name='TimeoutError';throw e;}) as typeof fetch;
  await assert.rejects(()=>extractHandwrittenImage(new Uint8Array([1]),'image/png'),e=>e instanceof VisionExtractionError&&e.code==='timeout'&&!e.message.includes('test-key'));
  global.fetch=(async()=>new Response('provider secret', {status:500})) as typeof fetch;
  await assert.rejects(()=>extractHandwrittenImage(new Uint8Array([1]),'image/png'),e=>e instanceof VisionExtractionError&&e.code==='provider_http'&&!e.message.includes('provider secret'));
 }finally{global.fetch=oldFetch;if(oldKey===undefined)delete process.env.DEEPSEEK_API_KEY;else process.env.DEEPSEEK_API_KEY=oldKey;}
});



