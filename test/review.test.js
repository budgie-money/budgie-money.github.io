// Review regressions: independent cash expectations, unchanged facts across dates,
// protected balances, restricted assets and checkpoint evidence. Invented data only.
const assert=require('assert'),B=require('../engine'),fixture=require('./fixture');let n=0;
const eq=(a,b,s)=>{assert.deepStrictEqual(a,b,s);n++;},near=(a,b,s)=>{assert(Math.abs(a-b)<.011,s+': '+a+' vs '+b);n++;};
function base(){let t=fixture();for(const k of ['bills','budgets','transfers','transactions','moves','loans','loanItems','settlements','goals','valuations','amounts','exceptions','settings','income'])t[k]=[];
t.income=[{id:'pay',person:'ethan',name:'Pay',amount:2000,account:'e-main',isPay:true,unit:'month',on:'last thursday',start:'2026-10-29'}];
t.budgets=[{id:'fun',person:'ethan',name:'Fun',mode:'daily',amount:200,account:'e-food'},{id:'lisa',person:'ethan',name:'LISA',mode:'saving',amount:334,account:'e-lisa'}];
t.settings=[{person:'ethan',key:'start',value:'2026-10-29'},{person:'ethan',key:'payday.netFrom',value:'2026-10-29'},{person:'ethan',key:'spare.rules',value:JSON.stringify({version:1,since:'2026-10-29',replaceFrom:'2026-10-29',buffer:10,savings:'e-isa',when:'soon',oneoff:true,repayments:true,unspent:true,ended:true})}];
t.valuations=[{id:'open',account:'e-main',date:'2026-10-28',amount:0},{id:'fun-open',account:'e-food',date:'2026-10-28',amount:0},{id:'goal-open',account:'e-isa',date:'2026-10-28',amount:1000}];t.goals=[{id:'car',owners:'ethan',name:'Car',target:6000,due:'2027-02-28',accounts:'e-isa',kind:'car'}];return t;}
const forecast=(t,date)=>B.goalForecast(B.load(t,date),'ethan','car',date,'2027-02-28').projected;
// Five salaries, five 200 budgets and five 334 contributions, plus original
// savings, less a single 10 buffer: 1000 + 5*(2000-200-334) - 10 = 8320.
{
 let t=base();for(const date of ['2026-10-29','2026-10-30','2026-11-01','2026-11-24','2026-11-25'])near(forecast(t,date),8320,'calendar alone cannot release unspent current allowances '+date);
 for(const date of ['2026-10-29','2026-10-30','2026-11-01','2026-11-25']){let x=base();x.valuations.push({id:'bk-main-'+date,account:'e-main',date,amount:2000,updated:3});x.exceptions.push({id:'salary-paid',item:'pay',date:'2026-10-29',action:'paid'});near(forecast(x,date),8320,'newer unchanged bank snapshot is not evidence of a pot or LISA transfer '+date);}
 let d=B.load(t,'2026-10-29'),steps=B.paydaySteps(d,'ethan','2026-10-29').steps;for(const s of steps){t.moves.push({id:'fund-'+s.account,person:'ethan',date:'2026-10-30',from:s.from,to:s.to,amount:s.remaining,key:s.key});}near(forecast(t,'2026-10-30'),8320,'actually funding allocations cannot change car affordability');
}
// With 100 cash, a 100 allowance and a 10 buffer, only 90 is spendable.
// The buffer also applies before a salary rule exists (opening-period mode).
for(const pay of [false,true]){let t=base();if(!pay)t.income=[];t.budgets=[{id:'fun',person:'ethan',name:'Fun',mode:'daily',amount:100,account:'e-main'}];t.valuations[0].amount=100;if(pay)t.income[0].amount=0;let d=B.load(t,'2026-10-29'),r=B.purchaseCheck(d,'ethan','2026-10-29','fun',100,'car','budget');near(r.cashAvailable,90,'buffer protected pay='+pay);eq(r.cashFits,false,'cannot spend protected buffer pay='+pay);near(B.today(d,'ethan','2026-10-29').cashFree,90,'daily guide cash respects same buffer pay='+pay);eq(B.purchaseCheck(d,'ethan','2026-10-29','fun',90,'car','budget').cashFits,true,'90 is usable pay='+pay);}
// Car cash excludes restricted and partner assets even when a user links them
// into the goal. Mixed goals may still use the owner's accessible 1000.
for(const kind of ['lisa','pension','credit','partner']){let t=base(),id=kind==='partner'?'s-savings':'restricted';if(kind!=='partner')t.accounts.push({id,owner:'ethan',name:'Restricted',kind});t.goals[0].accounts='e-isa,'+id;t.valuations.push({id:'restricted-value',account:id,date:'2026-10-29',amount:10000});let d=B.load(t,'2026-10-29'),r=B.goalScenario(d,'ethan','car','2026-10-29',{deadline:'2026-10-29',buyDate:'2026-10-29',price:1500,mode:'cash'});near(r.available,1000,kind+' not car cash');near(r.gap,500,kind+' cannot fill upfront gap');near(r.excluded,10000,kind+' exclusion visible');eq(r.shortfalls.length,1,kind+' cash shortfall retained');}
// Stale balances and net-zero changes must invalidate a monthly checkpoint.
{
 let t=base();t.valuations.push({id:'close',account:'e-main',date:'2026-10-29',amount:2000});let d=B.load(t,'2026-10-30'),r=B.reconcile(d,'ethan','2026-10-30');eq(r.issues.some(x=>x.kind==='stale'&&x.account==='e-main'),true,'yesterday balance cannot confirm through today');
 t.valuations[t.valuations.length-1].date='2026-10-30';r=B.reconcile(B.load(t,'2026-10-30'),'ethan','2026-10-30');eq(r.issues.some(x=>x.kind==='stale'&&x.account==='e-main'),false,'updated closing balance clears stale check');
 t.settings.push({person:'ethan',key:'reconcile.'+r.period.start,value:JSON.stringify({date:'2026-10-30',signature:r.signature,open:r.issues.length})});eq(B.reconcile(B.load(t,'2026-10-30'),'ethan','2026-10-30').changed,false,'same evidence stays reviewed');
 t.moves.push({id:'round-trip-out',person:'ethan',date:'2026-10-30',from:'e-main',to:'e-food',amount:5},{id:'round-trip-back',person:'ethan',date:'2026-10-30',from:'e-food',to:'e-main',amount:5});eq(B.reconcile(B.load(t,'2026-10-30'),'ethan','2026-10-30').changed,true,'net-zero movements still change review evidence');
}
// A bank payment due today can arrive later today; preserve its cash reserve
// without falsely declaring its receipt missing before the day has finished.
{let t=base();t.bills.push({id:'due',person:'ethan',name:'Bill',amount:20,account:'e-main',unit:'once',start:'2026-10-30'});t.valuations.push({id:'bk-current',account:'e-main',date:'2026-10-30',amount:2000});let d=B.load(t,'2026-10-30');eq(B.dataAudit(d,'ethan','2026-10-30').issues.some(x=>x.kind==='bill'),false,'today is still a valid payment day');eq(B.spareMoney(d,'ethan','2026-10-30').reserve>=20,true,'today bill stays reserved');t.valuations.push({id:'bk-next',account:'e-main',date:'2026-10-31',amount:2000});eq(B.dataAudit(B.load(t,'2026-10-31'),'ethan','2026-10-31').issues.some(x=>x.kind==='bill'),true,'past unpaid date is still flagged');}
console.log('All '+n+' comprehensive review regressions passed.');
