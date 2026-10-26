import assert from 'node:assert/strict';
import test from 'node:test';
import { applyExtraction, buildAggregateReport, canFinalizeRecap, deterministicExtraction, emptyRecap, parseIndonesianRupiah, recapIssues, recapTotals, type RecapDraft } from './recap';
import { duplicateUpdateDisposition, allowedTelegramGroup } from './core';

const add=(category:any,label:string,amount:string,operation:'add'|'set'|'correct'='add')=>({category,label,amount,operation});
test('accepts informal Indonesian rupiah and rejects ambiguous decimals',()=>{
 assert.equal(parseIndonesianRupiah('2,5jt'),2500000n);
 assert.equal(parseIndonesianRupiah('350rb'),350000n);
 assert.equal(parseIndonesianRupiah('1.250.000'),1250000n);
 assert.equal(parseIndonesianRupiah('2,5'),null);
});
test('parses the example report across transaction volume, fee, sales and expenses',()=>{
 const x=deterministicExtraction('shift pagi tf keluar 2,5jt tarik 1,2jt pulsa 350rb rokok 175rb pengeluaran 25rb');
 assert.equal(x.shiftLabel,'pagi');
 assert.deepEqual(x.entries.map(e=>[e.category,e.label,parseIndonesianRupiah(e.amount)]).sort((a,b)=>(String(a[0])+String(a[1])).localeCompare(String(b[0])+String(b[1]))),[
  ['expense','pengeluaran',25000n],['sale','rokok',175000n],['service_volume','pulsa',350000n],['service_volume','tarik tunai',1200000n],['service_volume','transfer keluar',2500000n]
 ]);
});
test('multiple messages accumulate activities while setting balances',()=>{
 let d=emptyRecap();
 d=applyExtraction(d,{entries:[add('service_volume','transfer keluar','2,5jt'),add('sale','rokok','175rb')],unresolved:[]},'shift pagi tf keluar 2,5jt rokok 175rb');
 d=applyExtraction(d,{entries:[add('cash_balance','kas','2,1jt','set'),add('electronic_balance','dana','3,5jt','set')],unresolved:[]},'saldo dana akhir 3,5jt cash 2,1jt');
 assert.deepEqual(recapTotals(d),{service_volume:'2500000',service_fee:'0',sale:'175000',expense:'0',cash_balance:'2100000',electronic_balance:'3500000'});
 assert.deepEqual(recapIssues(d),[]); assert.equal(canFinalizeRecap(d),true);
});
test('the same reported update cannot add its amount twice',()=>{
 let d=applyExtraction(emptyRecap(),{entries:[add('service_volume','transfer keluar','2,5jt')],unresolved:[]},'tf keluar 2,5jt','update-100');
 d=applyExtraction(d,{entries:[add('service_volume','transfer keluar','2,5jt')],unresolved:[]},'tf keluar 2,5jt','update-100');
 assert.equal(recapTotals(d).service_volume,'2500000');
});test('explicit correction replaces the earlier amount instead of adding',()=>{
 let d:RecapDraft=emptyRecap();
 d=applyExtraction(d,{entries:[add('sale','rokok','175rb')],unresolved:[]},'rokok 175rb');
 const x=deterministicExtraction('eh rokok tadi salah bukan 175 tapi 195rb');
 d=applyExtraction(d,x,'eh rokok tadi salah bukan 175 tapi 195rb');
 assert.equal(d.entries.length,1);
 assert.equal(parseIndonesianRupiah(d.entries[0].amount),195000n);
});
test('ambiguous categories and incomplete reports block confirmation',()=>{
 const d=applyExtraction(emptyRecap(),deterministicExtraction('barang 25'), 'barang 25');
 assert.ok(d.unresolved.length);
 assert.ok(recapIssues(d).length); assert.equal(canFinalizeRecap(d),false);
});
test('concurrent employee sessions remain isolated',async()=>{
 const [a,b]=await Promise.all([Promise.resolve().then(()=>applyExtraction(emptyRecap(),{entries:[add('sale','rokok','195rb')],unresolved:[]},'rokok 195rb')),Promise.resolve().then(()=>applyExtraction(emptyRecap(),{entries:[add('expense','pengeluaran','25rb')],unresolved:[]},'pengeluaran 25rb'))]);
 assert.equal(recapTotals(a).sale,'195000'); assert.equal(recapTotals(a).expense,'0');
 assert.equal(recapTotals(b).expense,'25000'); assert.equal(recapTotals(b).sale,'0');
});
test('aggregate report contains only submitted recap values, not transaction records',()=>{
 const d=applyExtraction(emptyRecap(),{entries:[add('sale','rokok','195rb')],unresolved:[]},'rokok 195rb');
 const payload=buildAggregateReport(d);
 assert.equal(payload.totals.sale,'195000');
 assert.equal('saleTransactions' in payload,false);
 assert.equal('inventoryMovements' in payload,false);
});
test('duplicate Telegram update IDs are acknowledged only after the original is processed',()=>{
 const now=new Date();
 assert.equal(duplicateUpdateDisposition('PROCESSED',null,now),'PROCESSED');
 assert.equal(duplicateUpdateDisposition('PROCESSING',new Date(now.getTime()+10000),now),'BUSY');
 assert.equal(duplicateUpdateDisposition('FAILED',null,now),'CLAIMED');
});
test('an identified Telegram member does not need an RMCS account to use an allowed report group',()=>{
 assert.equal(allowedTelegramGroup(-100123,'supergroup','-100123'),true);
 assert.equal(allowedTelegramGroup(-100999,'supergroup','-100123'),false);
});







