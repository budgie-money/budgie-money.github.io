// Independent ledger checks and dated scenarios. All amounts and people are invented.
const assert=require('assert'), B=require('../engine'), fixture=require('./fixture');let n=0;
const eq=(a,b,label)=>{assert.deepStrictEqual(a,b,label);n++;};
const near=(a,b,label)=>{assert(Math.abs(a-b)<0.011,label+': '+a+' vs '+b);n++;};
function simple(){const t=fixture();['income','bills','budgets','transfers','loans','loanItems','transactions','moves','settlements','goals','valuations','amounts','exceptions','settings'].forEach(k=>t[k]=[]);t.income=[{id:'pay',person:'ethan',name:'Salary',amount:2000,isPay:true,account:'e-main',unit:'month',on:'30',start:'2026-10-30'}];t.bills=[{id:'rent',person:'ethan',name:'Rent',amount:500,account:'e-main',unit:'month',on:'2',start:'2026-11-02'}];t.budgets=[{id:'food',person:'ethan',name:'Food',amount:500,account:'e-main',mode:'daily'},{id:'saving',person:'ethan',name:'Saving',amount:800,account:'e-isa',mode:'saving'}];t.settings=[{person:'ethan',key:'start',value:'2026-10-30'},{person:'sophie',key:'start',value:'2026-10-30'}];t.goals=[{id:'car',owners:'ethan',name:'Car',accounts:'e-isa',target:6000,due:'2027-02-28'}];t.valuations=[{id:'main',account:'e-main',date:'2026-10-29',amount:0},{id:'isa',account:'e-isa',date:'2026-10-29',amount:1000}];return t;}
const plan=(t,d)=>{let db=B.load(t,d);return B.planFor(db,'ethan',B.periodAt(db,'ethan',d));};
// Lower income must not cause a circular savings -> Main -> savings instruction.
{
 const t=simple();t.income[0].amount=1200;
 near(plan(t,'2026-10-30').shortfall,600,'baseline shortage');
 t.settings.push({person:'ethan',key:'saving.flexFrom',value:'2026-10-30'});
 let p=plan(t,'2026-10-30');near(p.lines.find(l=>l.id==='saving').amount,200,'savings take the reduction');near(p.shortfall,0,'no emergency cover for an unfunded new contribution');near(p.adjustments[0].reduction,600,'adjustment trace');
 t.moves.push({id:'already',person:'ethan',date:'2026-10-30',from:'e-main',to:'e-isa',amount:400,key:'bank:observed'});
 p=plan(t,'2026-10-30');near(p.lines.find(l=>l.id==='saving').amount,400,'recorded bank allocation floor');near(p.shortfall,200,'real transferred amount needs funding');
 t.settings.find(s=>s.key==='saving.flexFrom').value='2026-11-30';near(plan(t,'2026-10-30').shortfall,600,'future rule leaves history intact');
}
// Disabling adaptation later cannot change the earlier month's result.
{
 const t=simple();t.income[0].amount=1200;t.settings.push({person:'ethan',key:'saving.flexHistory',value:JSON.stringify([{from:'2026-10-30',on:true},{from:'2026-11-30',on:false}])});
 near(plan(t,'2026-10-30').lines.find(l=>l.id==='saving').amount,200,'historic adaptation retained');
 eq(B.savingFlexible(B.load(t),'ethan','2026-11-30').on,false,'later off date respected');
}
// Forecast money is never added to actual goal balances. Pay changes are dated.
{
 const t=simple(),d='2026-10-29';
 let db=B.load(t,d),f=B.goalForecast(db,'ethan','car',d,'2027-02-07');
 near(f.projected,4200,'four 800 contributions plus 1000 existing');near(f.gap,1800,'explicit early-date gap');
 near(B.goalForecast(db,'ethan','car',d,'2027-02-28').projected,5000,'short February clamps payday to the 28th');
 near(B.goals(db,'ethan',d)[0].saved,1000,'forecast never mutates saved balance');
 t.amounts.push({id:'raise',item:'pay',start:'2026-12-01',amount:2500});
 t.budgets.push({id:'rest',person:'ethan',mode:'remainder',account:'e-isa',name:'Spare'});
 db=B.load(t,d);f=B.goalForecast(db,'ethan','car',d,'2027-02-07');near(f.projected,6000,'two 1000 and two 1500 saving periods');
 t.settings.push({person:'ethan',key:'spare.rules',value:JSON.stringify({version:1,since:d,replaceFrom:'2026-10-30',buffer:10,savings:'e-emergency'})});
 db=B.load(t,d);f=B.goalForecast(db,'ethan','car',d,'2027-02-07');eq(f.routed,false,'unattached spare route flagged');near(f.projected,4200,'surplus outside goal excluded');
 t.income[0].amount=500;t.amounts=[];db=B.load(t,d);f=B.goalForecast(db,'ethan','car',d,'2027-02-07');near(f.projected,1000,'unfunded contributions excluded');eq(f.warnings.some(w=>w.includes('short')),true,'shortfall is explicit');
}
// A funded bill pot is not charged to future salary a second time.
{
 const t=simple();t.bills[0].account='e-bills';t.budgets.push({id:'rest',person:'ethan',name:'Spare',mode:'remainder',account:'e-isa'});t.valuations.push({id:'funded',account:'e-bills',date:'2026-10-29',amount:500});
 let db=B.load(t,'2026-10-29'),f=B.goalForecast(db,'ethan','car','2026-10-29','2026-11-07');near(f.projected,2500,'500 already in bill pot funds bill once and releases salary');
}
// Later repayment is not available on payday; the earlier salary-funded part still is.
{
 const t=simple();t.budgets[1].amount=0;t.budgets.push({id:'rest',person:'ethan',mode:'remainder',account:'e-isa',name:'Spare'});t.loans=[{id:'loan',lender:'ethan',borrower:'sophie',amount:200,date:'2026-10-20',repay:200,repayFrom:'2026-11-20',repayDay:'20'}];
 let db=B.load(t,'2026-10-29');let f=B.goalForecast(db,'ethan','car','2026-10-29','2026-11-07');near(f.projected,2000,'salary saving available before repayment');
 f=B.goalForecast(db,'ethan','car','2026-10-29','2026-11-21');near(f.projected,2200,'repayment included on own date');
}
// A challenge transfer and its real move must not both count. A plan alone isn't recorded saving.
{
 const t=simple();t.bills.push({id:'challenge',person:'ethan',name:'Challenge',amount:1,dailyIncrease:.01,account:'e-main',toAccount:'e-isa',unit:'day',start:'2026-10-30',end:'2026-11-01'});
 let db=B.load(t,'2026-11-01');near(B.recordedSaving(db,'ethan','2026-10-30','2026-11-01'),0,'unperformed saving plan is not saved');
 t.moves.push({id:'bk-challenge',person:'ethan',date:'2026-10-30',from:'e-main',to:'e-isa',amount:1,key:'bank:challenge'});db=B.load(t,'2026-11-01');near(B.recordedSaving(db,'ethan','2026-10-30','2026-11-01'),1,'recorded challenge counted');
 near(B.goalFlow(db,'ethan','car','2026-11-01').lines.filter(x=>x.kind==='challenge').reduce((s,x)=>s+x.amount,0),3.03,'three challenge days counted once in plan');
 t.moves.push({id:'withdraw',person:'ethan',date:'2026-11-01',from:'e-isa',to:'e-main',amount:.37});db=B.load(t,'2026-11-01');near(B.recordedSaving(db,'ethan','2026-10-30','2026-11-01'),.63,'withdrawals reduce actual saving');
}
// The same emergency/final destination is one move, not an unreachable second priority.
{
 const t=simple();t.income=[];t.bills=[];t.budgets=[];t.settings[0].value='2026-10-01';t.valuations=[{id:'v',account:'e-main',date:'2026-10-30',amount:1000}];t.settings.push({person:'ethan',key:'spare.rules',value:JSON.stringify({version:1,since:'2026-10-01',replaceFrom:'2026-10-01',buffer:10,emergency:'e-emergency',target:300,savings:'e-emergency',when:'soon',oneoff:true,repayments:true,unspent:true,ended:true})});
 const r=B.spareMoney(B.load(t,'2026-10-30'),'ethan','2026-10-30');eq(r.moves.length,1,'same destination creates one move');near(r.moves[0].amount,990,'whole eligible surplus saved to chosen account');
}
// An emergency target and Main buffer are filled once, not deducted from every future pay.
{
 const t=simple();t.budgets[1].amount=0;t.settings.push({person:'ethan',key:'spare.rules',value:JSON.stringify({version:1,since:'2026-10-29',replaceFrom:'2026-10-30',buffer:10,emergency:'e-emergency',target:300,savings:'e-isa',repayments:true})});
 const f=B.goalForecast(B.load(t,'2026-10-29'),'ethan','car','2026-10-29','2027-02-07');near(f.projected,4690,'4000 surplus less one 10 buffer and one 300 emergency target plus 1000 saved');
}
// Independent current-account/bill sharing does not disclose private payment rows.
{
 const t=simple();t.valuations.push({id:'bank-now',account:'e-main',date:'2026-10-30',amount:987.65});let db=B.load(t,'2026-10-30'),s=B.summary(db,'ethan','2026-10-30');eq(s.mainBalance,undefined,'balance private by default');eq(s.billDetails,undefined,'bill details private by default');
 t.settings.push({person:'ethan',key:'share.balance',value:true});s=B.summary(B.load(t,'2026-10-30'),'ethan','2026-10-30');near(s.mainBalance.amount,987.65,'explicit balance-only permission');eq(s.billDetails,undefined,'balance permission does not include bills');
 t.settings.push({person:'ethan',key:'share.bills',value:true});s=B.summary(B.load(t,'2026-10-30'),'ethan','2026-10-30');eq(s.billDetails.map(x=>x.name),['Rent'],'explicit sanitized bill list');
}
// 36 monthly ledgers, with varying pay and expenses, independently summed in integer pennies.
// Also check every pay-period boundary around leap years and weekends with no overlaps/gaps.
{
 const t=simple();t.income=[];t.bills=[];t.budgets=[];t.goals=[];t.valuations=[{id:'base',account:'e-main',date:'2026-10-29',amount:0},{id:'base-saving',account:'e-isa',date:'2026-10-29',amount:0}];let cash=0,saved=0,seed=19;
 const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed;};
 for(let i=0;i<36;i++){let month=new Date(Date.UTC(2026,10+i,1)).toISOString().slice(0,7),day=month+'-05',pay=170000+rnd()%140001,expense=20000+rnd()%60001,move=10000+rnd()%20001;cash+=pay-expense-move;saved+=move;
  t.transactions.push({id:'in'+i,person:'ethan',date:day,amount:-pay/100,account:'e-main'},{id:'out'+i,person:'ethan',date:day,amount:expense/100,account:'e-main'});t.moves.push({id:'m'+i,person:'ethan',date:day,amount:move/100,from:'e-main',to:'e-isa'});
  let balances=B.balances(B.load(t,day),day);near(balances['e-main'],cash/100,'month '+i+' cash ledger');near(balances['e-isa'],saved/100,'month '+i+' savings ledger');near(balances['e-main']+balances['e-isa'],(cash+saved)/100,'month '+i+' money conservation');
 }
 const dates=B.scheduleDates({unit:'month',on:'31',shift:'previous working day',start:'2026-01-01'},'2026-01-01','2036-01-01');eq(dates.length,120,'ten years of monthly pay');eq(new Set(dates).size,120,'no duplicate paydays');eq(dates.every(B.isWorkingDay),true,'all shifted paydays working days');
}
console.log('All '+n+' accuracy checks passed: ledger conservation, variable income, recorded saving, dated goals, privacy and 10-year schedules.');

