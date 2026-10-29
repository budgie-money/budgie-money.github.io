const fs = require('fs'), vm = require('vm'), assert = require('assert');
const path = require('path');
const repo = path.join(__dirname,'..');
const B = require(path.join(repo,'engine.js')), makeEnv = require(path.join(repo,'test/fake-gas.js'));
const day = '2026-10-29';
function household() {
  return {
    people: [{id:'alex',name:'Alex',partner:'sam'},{id:'sam',name:'Sam',partner:'alex'}],
    accounts: [
      {id:'a-main',owner:'alex',name:'Main',kind:'main'},
      {id:'a-bills',owner:'alex',name:'Bills',kind:'pot'},
      {id:'a-fun',owner:'alex',name:'Fun',kind:'pot'},
      {id:'a-save',owner:'alex',name:'Savings',kind:'saving',fallback:true},
      {id:'s-main',owner:'sam',name:'Main',kind:'main'}],
    income: [{id:'a-pay',person:'alex',name:'Pay',amount:2000,account:'a-main',isPay:true,unit:'month',on:'29',start:'2026-10-01'}],
    bills: [], budgets: [{id:'a-budget',person:'alex',name:'Fun',amount:200,mode:'daily',account:'a-fun'}],
    settings: [{id:'alex:start',person:'alex',key:'start',value:'2026-10-01'}],
    valuations: [],transactions: [],moves: [],exceptions: [],loans: [],loanItems: [],goals: [],settlements: []
  };
}
function envFor(t) {
  const e = makeEnv(), c = e.ctx; c.setup();
  for (const [table, rows] of Object.entries(t)) {
    const sh=e.sheets[table]; if (!sh) continue;
    const head=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
    rows.forEach(r=>sh.appendRow(head.map(h=>r[h]===undefined?'':r[h])));
  }
  c.CACHE_={};
  const RealDate=Date;
  c.Date=class extends RealDate {constructor(...a){super(...(a.length?a:[day+'T12:00:00Z']));} static now(){return RealDate.parse(day+'T12:00:00Z');} static [Symbol.hasInstance](x){return x instanceof RealDate;}};
  vm.runInContext(fs.readFileSync(path.join(repo,'apps-script/BankFeeds.gs'),'utf8'),c);
  return e;
}
const txn = (id,amount,extra={})=>({id,date:day,amount,acc:'ext-main',name:'Example Phone',card:true,pending:false,...extra});
const data = (txns,provider='monzo')=>({provider,accounts:[{extId:'ext-main',kind:'main'}],txns});
const rows = (c,t)=>{c.CACHE_={};return c.readTable_(t).rows.map(c.strip_);};
const out=[];
function record(name, details){out.push({name,...details});}
{
  const t=household();t.bills=[{id:'phone',person:'alex',name:'Example Phone',amount:40,account:'a-bills',unit:'month',on:'29',start:'2026-10-01'}];
  const e=envFor(t),c=e.ctx;
  c.bankApply_('alex',data([txn('phone-payment',40)],'starling'));
  const before=rows(c,'exceptions');
  c.bankApply_('alex',data([txn('phone-payment',40,{reversed:true})],'starling'));
  const after=rows(c,'exceptions');
  assert(!after.some(x=>x.item==='phone'&&x.action==='paid'&&!x.deleted));
  // Existing installations have markers without provenance: a unique old match also unwinds.
  const old=household();old.bills=t.bills;old.exceptions=[{id:'x-phone-2026-10-29-bankpaid-alex',item:'phone',date:day,action:'paid',by:'bank'}];
  const migrated=envFor(old);migrated.ctx.bankApply_('alex',data([txn('old-phone',40,{reversed:true})],'starling'));
  assert(rows(migrated.ctx,'exceptions').every(x=>x.deleted));
  for(const reverseOrder of [false,true]) {
    const next=envFor(t),nc=next.ctx;
    nc.bankApply_('alex',data([txn('phone-payment',40)],'starling'));
    const payments=[txn('phone-payment',40,{reversed:true}),txn('replacement-phone',40)];
    nc.bankApply_('alex',data(reverseOrder?payments.reverse():payments,'starling'));
    assert(rows(nc,'exceptions').some(x=>x.action==='paid'&&!x.deleted&&x.bankId==='replacement-phone'),'replacement takes precedence regardless of feed order');
  }
  record('Reversed planned bill still marked paid',{before,after});
}
{
  const t=household();t.transactions=[{id:'manual',person:'alex',date:day,amount:27,account:'a-main',budget:'a-budget',note:'Example Cafe'}];
  const e=envFor(t),c=e.ctx;
  c.bankApply_('alex',data([txn('linked-payment',27,{name:'Example Cafe'})],'starling'));
  c.bankApply_('alex',data([txn('linked-payment',27,{name:'Example Cafe',reversed:true})],'starling'));
  const after=rows(c,'transactions');
  assert(after.some(x=>x.id==='manual'&&x.bankId==='linked-payment'&&x.deleted));
  c.bankApply_('alex',data([txn('linked-payment',27,{name:'Example Cafe'})],'starling'));
  assert(rows(c,'transactions').some(x=>x.id==='manual'&&!x.deleted));
  record('Reversed payment linked to manual entry remains spent',{after});
}
{
  const t=household(),e=envFor(t),c=e.ctx;
  c.bankApply_('alex',data([txn('salary',-2000,{card:false,name:'Example Payroll'}),txn('sale',-1250,{card:false,name:'Marketplace sale'})]));
  const after=rows(c,'transactions');
  assert(after.some(x=>x.bankId==='sale'&&x.amount===-1250&&x.review));
  record('Unrelated pay-sized money in is silently omitted',{transactions:after,exceptions:rows(c,'exceptions')});
}
{
  const t=household();t.valuations=[{id:'v1',account:'a-main',date:day,amount:0},{id:'v2',account:'a-fun',date:day,amount:0},{id:'v3',account:'a-save',date:day,amount:0}];
  t.moves=[{id:'already-sorted',person:'alex',date:day,from:'a-main',to:'a-fun',amount:200,key:'pay:2026-10-29:a-fun'}];
  t.transactions=[{id:'spend',person:'alex',date:day,amount:35,account:'a-main',budget:'a-budget'}];
  const items=B.todo(B.load(t,day),'alex',day).filter(x=>!x.payday&&x.type==='move');
  assert(items.some(x=>x.from==='a-fun'&&x.amount===35&&x.short));
  record('Move offered from empty budget pot',{items});
}
{
  const t=household();t.loans=[{id:'iou',lender:'alex',borrower:'sam',name:'Shared purchases',amount:80,date:'2026-10-10',repay:20,repayDay:'29'}];
  t.loanItems=[{id:'item',loan:'iou',name:'Example chair',cost:160,share:80}];
  const e=envFor(t),c=e.ctx;
  c.applyOne_('alex',{op:'delete',table:'loanItems',id:'item'},Date.now());
  const result=B.loans(B.load(c.allTables_(),day),'alex',day);
  assert(result[0].left===0 && result[0].items.length===0);
  record('Deleting final IOU item leaves full debt',{result});
}
{
  const t=household();t.valuations=[{id:'v1',account:'a-fun',date:'2026-10-29',amount:2000}];
  const a=B.today(B.load(t,'2026-11-01'),'alex','2026-11-01'),b=B.today(B.load(t,'2026-11-02'),'alex','2026-11-02');
  assert(a.safe===b.safe);
  record('Daily amount changes with no spending or moves',{first:{day:a.date,safe:a.safe,days:a.daysLeft},second:{day:b.date,safe:b.safe,days:b.daysLeft}});
}
{
  const t=household();t.accounts.push({id:'a-credit',owner:'alex',name:'Credit account',kind:'credit'});
  t.bills=[{id:'card-bill',person:'alex',name:'Credit statement payment',amount:50,account:'a-bills',unit:'month',on:'5',start:'2026-11-01'}];
  t.transactions=[{id:'credit-purchase',person:'alex',date:day,amount:50,account:'a-credit',budget:'a-budget'}];
  t.valuations=[{id:'v-credit',account:'a-credit',date:day,amount:-50},{id:'v-fun',account:'a-fun',date:day,amount:200},{id:'v-bill',account:'a-bills',date:day,amount:50}];
  t.moves=[{id:'sorted-fun',person:'alex',date:day,from:'a-main',to:'a-fun',amount:200,key:'pay:2026-10-29:a-fun'},{id:'sorted-bills',person:'alex',date:day,from:'a-main',to:'a-bills',amount:50,key:'pay:2026-10-29:a-bills'}];
  const d=B.load(t,day),items=B.todo(d,'alex',day).filter(x=>x.to==='a-credit');
  t.bills[0].creditAccount='a-credit';const linked=B.load(t,day);
  assert(B.todo(linked,'alex',day).every(x=>x.to!=='a-credit'));
  assert(B.balances(linked,'2026-11-06')['a-credit']===0);
  record('Credit bill does not discharge liability and spending asks for separate payoff',{items,creditAfterStatement:B.balances(d,'2026-11-06')['a-credit']});
}
{
  const t=household();t.budgets[0].amount=0;
  t.transactions=[{id:'old-purchase',person:'alex',date:'2026-10-10',amount:80,account:'a-main',budget:'a-budget',loanItem:'shared-item',iouShare:40},{id:'refund',person:'alex',date:day,amount:-80,account:'a-main',budget:'a-budget',refundOf:'old-purchase'}];
  t.loans=[{id:'share-iou',lender:'alex',borrower:'sam',name:'Shared purchases',amount:40,date:'2026-10-10'}];
  t.loanItems=[{id:'shared-item',loan:'share-iou',name:'Example refunded item',cost:80,share:40}];
  const d=B.load(t,day),result=B.today(d,'alex',day),loan=B.loans(d,'alex',day)[0];
  assert(result.tiles[0].left===0&&loan.left===0);
  assert(B.flows(d,'2026-10-28',day).some(x=>x.amount===80&&x.date===day));
  const env=envFor(t),c=env.ctx,privateView=c.sync_('sam',0,true),privateDb=B.load(privateView.rows,day);
  assert(!privateView.rows.transactions.some(x=>x.id==='old-purchase'||x.id==='refund'));
  assert(B.loans(privateDb,'sam',day)[0].left===0,'both phones agree without exposing private payments');
  t.transactions[1].amount=-20;
  const partial=envFor(t),view=partial.ctx.sync_('sam',0,true);
  assert(B.loans(B.load(view.rows,day),'sam',day)[0].left===30,'partial refund is shared as an IOU credit');
  assert(view.rows.loanItems[0].share===40&&view.rows.loanItems[0].refundCredit===10);
  const stolen=partial.ctx.applyOps_('sam',[{op:'put',table:'transactions',row:{id:'s-bad-refund',person:'sam',date:day,amount:-20,account:'s-main',refundOf:'old-purchase'}}]);
  assert(stolen.rejected.length===1,'a refund cannot name someone else’s private purchase');
  t.transactions[1].amount=-80;t.settlements=[{id:'paid-share',date:day,from:'sam',to:'alex',amount:40,loan:'share-iou'}];
  const over=envFor(t),oc=over.ctx,od=B.load(oc.allTables_(),day);
  assert(B.todo(od,'alex',day).some(x=>x.key==='loanreturn:share-iou'&&x.amount===40));
  assert(B.netWorth(od,'alex',day).owe>=40);
  const ret={date:day,from:'alex',to:'sam',amount:40,loan:'share-iou',key:'loanreturn:share-iou'};
  oc.applyOne_('alex',{op:'put',table:'settlements',row:{id:'returned',...ret}},Date.now());
  oc.applyOne_('sam',{op:'put',table:'settlements',row:{id:'returned-twice',...ret}},Date.now());
  assert(rows(oc,'settlements').find(x=>x.id==='returned-twice').deleted);
  assert(B.loanPaid(B.load(oc.allTables_(),day),B.load(oc.allTables_(),day).byId['share-iou'])===0);
  record('Old purchase refund reopens paused budget and leaves IOU unchanged',{budgetLeft:result.tiles[0].left,iouLeft:loan.left});
}
{
  const t=household();t.budgets=[];t.valuations=[{id:'v-main',account:'a-main',date:day,amount:1000,updated:1},{id:'v-save',account:'a-save',date:day,amount:100,updated:1}];
  t.accounts.push({id:'a-future',owner:'alex',name:'Future',kind:'saving'});
  t.bills=[{id:'daily',person:'alex',name:'Daily challenge',amount:1,account:'a-main',unit:'day',start:'2026-10-01'}];
  t.settings.push({id:'alex:spare.rules',person:'alex',key:'spare.rules',value:JSON.stringify({version:1,since:'2026-10-01',buffer:100,emergency:'a-save',target:200,savings:'a-future',when:'soon',unspent:true,oneoff:true,repayments:true,ended:true})});
  const d=B.load(t,day),spare=B.spareMoney(d,'alex',day);
  assert(spare.reserve===30);assert(spare.moves.length===2&&spare.moves[0].amount===100&&spare.moves[1].amount===770);
  const env=envFor(t),c=env.ctx;
  for(const [i,m] of spare.moves.entries())c.applyOne_('alex',{op:'put',table:'moves',row:{id:'saving-'+i,person:'alex',date:day,key:m.key,from:m.from,to:m.to,amount:m.amount}},Date.now());
  const afterSweep=c.allTables_();afterSweep.moves.push({id:'bk-example-sweep',person:'alex',date:day,from:'a-main',to:'a-future',amount:770,key:'bank:example',updated:Date.now()});assert(B.load(afterSweep,day).moves.find(x=>x.id==='bk-example-sweep').dup,'a bank-seen saving move and its confirmation count once');
  const stale=spare.moves[1];c.applyOne_('alex',{op:'put',table:'moves',row:{id:'saving-twice',person:'alex',date:day,key:stale.key,from:stale.from,to:stale.to,amount:stale.amount}},Date.now());
  assert(rows(c,'moves').find(x=>x.id==='saving-twice').deleted,'two stale phones cannot sweep the same money twice');

  t.income.push({id:'future-pay',person:'alex',name:'Expected',amount:5000,account:'a-main',unit:'once',start:'2026-11-04'});
  assert(B.spareMoney(B.load(t,day),'alex',day).available===spare.available);
  t.settings[1].value=t.settings[1].value.replace('a-future','s-main');
  assert(B.spareMoney(B.load(t,day),'alex',day).moves.every(x=>x.to!=='s-main'));
  const cash=household();cash.budgets[0].account='a-main';cash.valuations=[{id:'actual-cash',account:'a-main',date:day,amount:20}];
  cash.income.push({id:'later-money',person:'alex',name:'Expected later',amount:5000,account:'a-main',unit:'once',start:'2026-11-04'});
  assert(B.today(B.load(cash,day),'alex',day).cashFree===20,'future money is not spendable today');
}
{
  const t=household();t.bills=[{id:'phone',person:'alex',name:'Example Phone',amount:40,account:'a-bills',unit:'month',on:'29',start:'2026-10-01'}];
  const e=envFor(t),c=e.ctx;
  const receipt={id:'receipt',person:'alex',date:'2026-10-28',amount:42,account:'a-main',budget:'a-budget',billId:'phone',billDate:day};
  c.applyOne_('alex',{op:'put',table:'transactions',row:receipt},Date.now());
  let d=B.load(c.allTables_(),day),flows=B.flows(d,'2026-10-27',day);
  assert(flows.filter(x=>x.amount===-42).length===1,'the matched bill debits once');
  assert(flows.some(x=>x.amount===-42&&x.account==='a-main'),'cash leaves the actual paying account');
  assert(B.today(d,'alex',day).tiles[0].spent===0,'a bill receipt does not also use a spending budget');
  assert(B.occurrences(d,d.byId.phone,'2026-10-27','2026-10-30')[0].paid);
  const other=c.applyOps_('alex',[{op:'put',table:'transactions',row:{...receipt,id:'second'}}]);
  assert(other.rejected.length===1,'two receipts cannot pay the same bill');
  c.applyOne_('alex',{op:'put',table:'transactions',row:{id:'receipt',date:day}},Date.now());
  assert(rows(c,'exceptions').find(x=>x.action==='move').deleted,'moving back clears the old moved date');
  c.applyOne_('alex',{op:'put',table:'transactions',row:{id:'receipt',billId:'',billDate:''}},Date.now());
  assert(rows(c,'exceptions').every(x=>x.deleted),'unlinking restores the original unpaid bill');
  c.applyOne_('alex',{op:'put',table:'transactions',row:{id:'receipt',billId:'phone',billDate:day}},Date.now());
  c.applyOne_('alex',{op:'put',table:'exceptions',row:{id:'x-phone-'+day+'-bankpaid-alex',item:'phone',date:day,action:'paid',bankId:'new-bank-source'}},Date.now(),'bank',{sys:true});
  c.applyOne_('alex',{op:'delete',table:'transactions',id:'receipt'},Date.now());
  assert(!rows(c,'exceptions').find(x=>x.action==='paid').deleted,'undo never removes a replacement bank match');
}
{
  const t=household();t.settings.push({id:'alex:bank.map.ext-pot',person:'alex',key:'bank.map.ext-pot',value:'a-fun'});
  t.moves=[{id:'bk-starling-group',person:'alex',date:day,from:'a-main',to:'a-fun',amount:10,key:'back:a:'+day+':a-main',by:'bank'},
    {id:'bk-starling-group~2',person:'alex',date:day,from:'a-main',to:'a-fun',amount:20,key:'back:b:'+day+':a-main',by:'bank'}];
  const e=envFor(t),c=e.ctx,feed=data([txn('group',30,{pot:'ext-pot',reversed:true})],'starling');
  feed.accounts.push({extId:'ext-pot',kind:'pot'});c.bankApply_('alex',feed);
  assert(rows(c,'moves').filter(x=>x.id.startsWith('bk-starling-group')).every(x=>x.deleted),'a grouped reversal removes every part');
  feed.txns[0].reversed=false;c.bankApply_('alex',feed);
  assert(rows(c,'moves').filter(x=>x.id.startsWith('bk-starling-group')).every(x=>!x.deleted),'a reinstated grouped move restores all parts once');
}
{
  const t=household();t.budgets=[];t.bills=[{id:'challenge',person:'alex',name:'Daily saving',unit:'day',start:'2026-10-28',end:'2027-01-02',amount:1.21,dailyIncrease:0.01,account:'a-main',toAccount:'a-save'}];
  t.valuations=[{id:'base',account:'a-main',date:'2026-10-27',amount:1000,updated:1}];
  let d=B.load(t,day);assert(B.amountAt(d,d.byId.challenge,'2026-11-01')===1.25);assert(B.amountAt(d,d.byId.challenge,'2027-01-01')===1.86);
  const forecast=B.flows(d,'2026-10-27',day);assert(B.round(forecast.filter(x=>x.account==='a-main'&&x.amount<0).reduce((n,x)=>n+x.amount,0))===-2.43);
  t.moves=[{id:'bk-daily',person:'alex',date:day,from:'a-main',to:'a-save',amount:1.22,key:'bank:daily'}];d=B.load(t,day);
  assert(B.flows(d,'2026-10-28',day).filter(x=>x.account==='a-main'&&x.amount<0).length===1,'a daily bank transfer counts once');assert(B.outgoings(d,'alex',{start:day,next:'2026-10-30'},day)[0].status==='paid');
  t.bills.push({...t.bills[0],id:'challenge-two'});d=B.load(t,day);assert(B.outgoings(d,'alex',{start:day,next:'2026-10-30'},day).filter(x=>x.status==='paid').length===1,'one bank move cannot pay two saving rules');t.bills.pop();
  t.moves[0].deleted=true;d=B.load(t,day);assert(B.outgoings(d,'alex',{start:day,next:'2026-10-30'},day)[0].status==='due','reversed daily transfer returns to due');
  const c=envFor(t).ctx;assert(c.applyOps_('sam',[{op:'put',table:'bills',row:{id:'stolen-saving',person:'sam',name:'Bad',amount:1,unit:'day',start:day,account:'s-main',toAccount:'a-save'}}]).rejected.length===1);
}
{
  const t=household();t.accounts.push({id:'a-credit',owner:'alex',name:'Credit',kind:'credit'});t.transactions=[{id:'credit-purchase',person:'alex',date:day,amount:25,account:'a-fun',creditAccount:'a-credit',budget:'a-budget',bankId:'example-bank'}];
  let d=B.load(t,day);assert(d.transactions.find(x=>x.id==='credit-purchase').observedAccount==='a-fun'&&d.transactions.find(x=>x.id==='credit-purchase').account==='a-credit');assert(B.flows(d,'2026-10-28',day).some(x=>x.account==='a-credit'&&x.amount===-25));
  const c=envFor(t).ctx;c.applyOne_('alex',{op:'put',table:'transactions',row:{id:'credit-purchase',creditAccount:'a-credit',account:'a-main'}},Date.now());assert(rows(c,'transactions')[0].account==='a-fun','the observed bank account stays immutable');
  const bad=c.applyOps_('sam',[{op:'put',table:'transactions',row:{id:'bad-credit',person:'sam',amount:5,date:day,account:'s-main',creditAccount:'a-credit'}}]);assert(bad.rejected.length===1);
}
{
  const t=household();t.moves=[{id:'partial-1',person:'alex',date:day,from:'a-fun',to:'a-main',amount:3,key:'back:budget:'+day+':a-main',batch:'one'}, {id:'partial-2',person:'alex',date:day,from:'a-fun',to:'a-main',amount:6,key:'back:budget:'+day+':a-main',batch:'two'}, {id:'bk-seen-1',person:'alex',date:day,from:'a-fun',to:'a-main',amount:3,key:'bank:seen1'}, {id:'bk-seen-2',person:'alex',date:day,from:'a-fun',to:'a-main',amount:6,key:'bank:seen2'}];
  const d=B.load(t,day);assert(d.moves.filter(x=>x.dup).length===2,'separate partial reimbursements each reconcile once');
}
{ const summary=B.summary(B.load(household(),day),'alex',day);assert(summary.tiles[0].left===200,'partner summary carries the actual amount left'); }
{
  const t=household();t.budgets=[];t.accounts.push({id:'a-card',owner:'alex',name:'Credit',kind:'credit'});t.valuations=[{id:'card-balance',account:'a-card',date:'2026-10-27',amount:-50}];t.bills=[{id:'repayment',person:'alex',name:'Repayment',amount:50,account:'a-bills',creditAccount:'a-card',unit:'once',start:'2026-10-28'}];
  assert(B.balances(B.load(t,day),day)['a-card']===-50,'a due date alone must not clear an unobserved credit debt');
  t.exceptions=[{id:'x-repayment-2026-10-28-paid',item:'repayment',date:'2026-10-28',action:'paid'}];assert(B.balances(B.load(t,day),day)['a-card']===0,'an observed or confirmed repayment clears the debt');
}
{
 const t=household();t.valuations=[{id:'observed-main',account:'a-main',date:day,amount:12}];
 let summary=B.summary(B.load(t,day),'alex',day);assert(!summary.mainBalance,'totals and categories never grant balance sharing');
 t.settings.push({id:'alex:sharepayments',person:'alex',key:'share.payments',value:'true'});
 summary=B.summary(B.load(t,day),'alex',day);assert(summary.mainBalance.amount===12&&summary.mainBalance.date===day,'shared observed bank cash is separate from budget left');
}
{
 const t=household();t.budgets[0].account='a-main';t.valuations=[{id:'main-cash',account:'a-main',date:day,amount:300},{id:'reserve',account:'a-save',date:day,amount:100}];t.transactions=[{id:'overspend',person:'alex',date:day,amount:250,budget:'a-budget',account:'a-main'}];
 const d=B.load(t,day);assert(!B.todo(d,'alex',day).some(x=>x.from==='a-save'&&x.to==='a-main'),'an observed cash balance can absorb overspending without emergency money');
 assert(B.today(d,'alex',day).overs.some(x=>x.id==='a-budget'),'the overspend remains visible');
}
console.log('All 18 experience regression scenarios passed');
