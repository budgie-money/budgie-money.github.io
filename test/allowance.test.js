const assert=require('assert'),B=require('../engine'),fixture=require('./fixture');let n=0;
const eq=(a,b,s)=>{assert.deepStrictEqual(a,b,s);n++;},near=(a,b,s)=>{assert(Math.abs(a-b)<.011,s+': '+a+' vs '+b);n++;};
function base(){const t=fixture();for(const k of ['income','bills','transfers','transactions','moves','loans','loanItems','settlements','goals','valuations','amounts','exceptions','settings','budgets'])t[k]=[];
t.income=[{id:'pay',person:'ethan',name:'Pay',isPay:true,amount:2000,account:'e-main',unit:'month',on:'1',start:'2026-11-01'}];
t.budgets=[{id:'food',person:'ethan',name:'Food',amount:150,mode:'weekly',account:'e-food',carry:true},{id:'fuel',person:'ethan',name:'Fuel',amount:90,mode:'daily',account:'e-car',carry:true},{id:'fun',person:'ethan',name:'Entertainment',amount:210,mode:'daily',account:'e-main',carry:false}];
t.settings=[{person:'ethan',key:'start',value:'2026-11-01'}];t.valuations=[{id:'open',account:'e-main',date:'2026-10-31',amount:10000}];return t;}
const bank=(t,date)=>B.dailyAllowances(B.load(t,date),'ethan',date),part=(r,id)=>r.parts.find(x=>x.id===id);
{
 let t=base(),r=bank(t,'2026-11-07');near(r.daily,15,'15 total per day');near(r.builtUp,105,'seven unspent days accumulate to 105');near(r.available,105,'funded accumulated allowance spendable');near(part(r,'food').available,35,'weekly Food builds daily');near(part(r,'fuel').available,21,'Fuel independent');near(part(r,'fun').available,49,'Entertainment independent');
 t.transactions.push({id:'fun-buy',person:'ethan',date:'2026-11-07',amount:20,budget:'fun',account:'e-main'});r=bank(t,'2026-11-07');near(part(r,'fun').available,29,'20 reduces only entertainment');near(part(r,'food').available,35,'Food unaffected by entertainment purchase');near(part(r,'fuel').available,21,'Fuel unaffected by entertainment purchase');near(r.available,85,'overall positive allowance reduced by actual20');
 r=bank(t,'2026-11-08');near(part(r,'fun').available,36,'next day accrues original7, no rebasing');near(part(r,'food').available,40,'Food gains original5');near(part(r,'fuel').available,24,'Fuel gains original3');
 t.transactions.push({id:'fun-refund',person:'ethan',date:'2026-11-08',amount:-10,budget:'fun',account:'e-main',refundOf:'fun-buy'});r=bank(t,'2026-11-08');near(part(r,'fun').available,46,'linked refund restores category allowance');near(part(r,'food').available,40,'refund does not change Food');
 const before=r.parts.map(x=>x.available);t.moves.push({id:'pot-fund',person:'ethan',date:'2026-11-08',from:'e-main',to:'e-food',amount:150,key:'pay:2026-11-01:e-food'});eq(bank(t,'2026-11-08').parts.map(x=>x.available),before,'moving money to a pot does not spend or create allowance');
}
{
 let t=base();t.transactions.push({id:'advance',person:'ethan',date:'2026-11-01',amount:80,budget:'fun',account:'e-main'});let r=bank(t,'2026-11-01');near(part(r,'fun').available,0,'no negative spendable amount');near(part(r,'fun').early,73,'80 uses73 of future days');near(part(r,'fun').left,130,'full month budget still130 left');near(part(r,'food').available,5,'Food still builds while Fun catches up');r=bank(t,'2026-11-02');near(part(r,'fun').early,66,'advance pays down by7 next day');near(part(r,'fuel').available,6,'Fuel still builds');r=bank(t,'2026-11-12');near(part(r,'fun').available,4,'allowance resumes after advance catches up');
}
{
 let t=base();t.transactions.push({id:'future',person:'ethan',date:'2026-11-20',amount:30,budget:'fun',account:'e-main'});near(part(bank(t,'2026-11-07'),'fun').available,49,'future-dated purchase not deducted before date');
 t.transactions=[];t.transactions.push({id:'shared',person:'ethan',date:'2026-11-07',amount:20,budget:'food',account:'e-main',split:'half'});near(part(bank(t,'2026-11-07'),'food').available,25,'only own half deducted');
 const d=B.load(t,'2026-11-07'),today=B.today(d,'ethan','2026-11-07');let r=B.dailyAllowances(d,'ethan','2026-11-07',{...today,cashFree:12});near(r.builtUp,95,'cash shortage never rewrites category balances');near(r.available,12,'cash shortage caps combined spendable amount');eq(r.cashLimited,true,'cash cap explicit');
}
{
 let t=base();t.settings[0].value='2026-10-01';t.income[0].start='2026-10-01';let r=bank(t,'2026-11-01');near(part(r,'food').carry,150,'existing Food carry rule retained');near(part(r,'food').available,155,'carry available immediately plus first daily share');near(part(r,'fuel').available,93,'Fuel carry retained');near(part(r,'fun').available,7,'Entertainment does not carry because settingoff');
 t.budgets[0].carry=false;near(part(bank(t,'2026-11-01'),'food').available,5,'turning carryoff follows existing budget semantics');
}
{
 let t=base();t.budgets=[{id:'food',person:'ethan',name:'Food',amount:100,mode:'daily',account:'e-main'}];for(const [day,expected]of[['2026-11-01',3.33],['2026-11-07',23.33],['2026-11-30',100]])near(part(bank(t,day),'food').available,expected,'penny-exact accumulated fraction '+day);
 t.settings[0].value='2026-11-26';let r=bank(t,'2026-11-27');near(part(r,'food').available,6.67,'tracking stub accrues its prorated budget over remaining days');
}
{
 let t=base();for(let day=1;day<=30;day++){const date='2026-11-'+String(day).padStart(2,'0');near(bank(t,date).builtUp,15*day,'every daily step accumulates deterministically '+day);}
 const before=JSON.stringify(t);bank(t,'2026-11-07');eq(JSON.stringify(t),before,'guide calculation creates no records or budget edits');
 t.settings.push({person:'ethan',key:'share.totals',value:false});let sm=B.summary(B.load(t,'2026-11-07'),'ethan','2026-11-07');eq(sm.accumulated,undefined,'private totals do not leak new accumulated summary');t.settings.pop();sm=B.summary(B.load(t,'2026-11-07'),'ethan','2026-11-07');near(sm.accumulated.available,105,'partner gets same allowance through existing totals permission');eq(sm.mainBalance,undefined,'allowance sharing does not expose bank balance');
}
{let t=base();t.transactions.push({id:'advance-check',person:'ethan',date:'2026-11-01',amount:80,budget:'fun',account:'e-main'});let check=B.purchaseCheck(B.load(t,'2026-11-02'),'ethan','2026-11-02','fun',20,'','budget');eq(check.budgetFits,true,'advance can still fit full-period budget');eq(check.accrued.usesFuture,true,'checker distinguishes built up allowance from monthly budget');near(check.accrued.earlyAfter,86,'checker shows total early use after new purchase');}
console.log('All '+n+' accumulated allowance checks passed.');
