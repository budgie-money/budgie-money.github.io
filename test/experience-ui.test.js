// Current experience, real browser + fake backend. All new examples are invented.
const {chromium}=require('playwright'),fs=require('fs'),path=require('path'),assert=require('assert');
const links=require('./.links.json'),out=process.env.SHOTS||path.join(__dirname,'../../preview-shots');
fs.mkdirSync(out,{recursive:true});
let passes=0;const errors=[];
const ok=(name,v)=>{assert(v,name);passes++;};
const text=p=>p.locator('main').innerText();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function problems(){
 const issues=[],shown=e=>!!e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden';
 if(document.documentElement.scrollWidth>innerWidth+1)issues.push('page overflow');
 document.querySelectorAll('button,.btn').forEach(e=>{if(!shown(e))return;const s=getComputedStyle(e);if(e.scrollWidth>e.clientWidth+2)issues.push('button overflow: '+e.textContent.trim());if(e.matches('.btn,.chip,.detail,.linkbtn,.seg>button')&&!e.querySelector('.what,div,p')){const mids=[];for(const n of e.childNodes){if(n.nodeType!==3)continue;const r=document.createRange();r.selectNodeContents(n);for(const box of r.getClientRects()){const mid=box.top+box.height/2;if(!mids.some(x=>Math.abs(x-mid)<box.height*.45))mids.push(mid);}}if(mids.length>1)issues.push('button wraps: '+e.textContent.trim());}});
 document.querySelectorAll('.two.fit,.ex-subnav,.ex-filters').forEach(e=>{const kids=[...e.children].filter(shown);if(kids.length<2)return;const rs=kids.map(k=>k.getBoundingClientRect()),tops=[...new Set(rs.map(r=>Math.round(r.top)))];if(tops.length>1&&rs.some(r=>r.width<e.clientWidth-4)&&rs.some((r,i)=>rs.filter(q=>Math.abs(q.top-r.top)<2).length!==rs.filter(q=>Math.abs(q.top-rs[0].top)<2).length))issues.push('ragged buttons');});
 return issues;
}
(async()=>{
 const browser=await chromium.launch();
 try{
  async function pageFor(who,width=384){const c=await browser.newContext({viewport:{width,height:854},isMobile:true,hasTouch:true,locale:'en-GB',timezoneId:'Europe/London',serviceWorkers:'block'});await c.addInitScript(()=>{for(const n of ['ethan','sophie','alex','sam'])localStorage.setItem('budgie.tour.'+n,'true');localStorage.setItem('budgie.checkSeen',JSON.stringify('2026-11-02'));});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-11-02T12:00:00Z')});await p.goto(links[who]);await p.waitForFunction(()=>window.BudgieApp&&!!window.BudgieApp.S.data.me);return p;}
  async function go(p,s){await p.evaluate(s=>{document.querySelector('#sheets').innerHTML='';if(s==='money')window.BudgieApp.S.ui.cMoney='budget';window.BudgieApp.go(s);},s);await p.waitForTimeout(30);ok(s+' renders',!(/Something went wrong/.test(await text(p))));}
  async function settled(p){await p.waitForFunction(()=>!window.BudgieApp.S.syncing&&!window.BudgieApp.S.data.queue.length,null,{timeout:15000});}
  async function seed(p,table,row){const result=await p.evaluate(async({table,row})=>{const S=window.BudgieApp.S,r=await fetch(S.cfg.u,{method:'POST',body:JSON.stringify({key:S.cfg.k,ops:[{op:'put',table,row}]})});return r.json();},{table,row});ok('test row accepted '+row.id,result.ok&&!result.rejected.length);await p.evaluate(()=>window.BudgieApp.sync(true));}
  let p=await pageFor('ethan');
  await go(p,'today');ok('Today shows category budgets and a category-aware daily guide',await p.locator('.c-budget-head').count()===1&&await p.locator('.c-guide-parts').count()===1);
  await p.locator('[data-a="herosheet"]').click();ok('daily explanation is a category breakdown',!(/Your cash allows|Your budgets allow|Still needed before payday/.test(await p.locator('#sheets').innerText()))&&/Daily guide/.test(await p.locator('#sheets').innerText()));
  await go(p,'plan');ok('budget uses Budget Spent Left without slogans',/Budget/.test(await text(p))&&/Spent/.test(await text(p))&&/Left/.test(await text(p))&&!/Every pound|Money to work with|Choose what/.test(await text(p)));
  await go(p,'money');await p.locator('[data-a="cTab"][data-v="activity"]').click();
  const dates=await p.locator('.c-date').allTextContents();ok('recent activity is newest first',await p.evaluate(()=>{const ids=[...document.querySelectorAll('[data-a="cActivity"]')].map(e=>e.dataset.v),rows=ids.map(id=>window.BudgieApp.S.ui.cActivity[id]);return rows.every((r,i)=>!i||r.date<=rows[i-1].date);}));
  for(const f of ['in','out','all']){await p.locator('[data-a="cFlow"][data-v="'+f+'"]').click();ok('activity '+f+' renders',!(/Something went wrong/.test(await text(p))));}
  await p.locator('[data-a="cWhen"][data-v="due"]').click();ok('scheduled items have a separate view',await p.locator('[data-a="cFlow"]').count()===0);
  await go(p,'more');ok('More restores icon tiles',await p.locator('.more button .ic').count()>=12);
  async function openPayment(p,id){await go(p,'money');await p.locator('[data-a="cTab"][data-v="activity"]').click();await p.locator('[data-a="cWhen"][data-v="recent"]').click();await p.locator('[data-a="cFlow"][data-v="all"]').click();await p.locator('[data-a="cActivity"][data-v="'+id+'"]').click();}
  await go(p,'money');await p.locator('.c-budget-row[data-a="payments"]').first().click();ok('a budget opens its expenses with the same Budget Spent Left columns',await p.locator('.c-budget-head').count()===1&&await p.getByRole('button',{name:'Change budget',exact:true}).count()===1);
  await seed(p,'accounts',{id:'ex-small-pot',owner:'ethan',name:'Example small pot',kind:'pot'});await seed(p,'budgets',{id:'ex-pot-budget',person:'ethan',name:'Example category',amount:100,mode:'daily',account:'ex-small-pot'});await seed(p,'transactions',{id:'ex-pot-spend',person:'ethan',date:'2026-11-02',amount:9,account:'e-main',budget:'ex-pot-budget',note:'Example pot purchase'});await seed(p,'valuations',{id:'ex-pot-value',account:'ex-small-pot',date:'2026-11-02',amount:3});
  await go(p,'today');let action=await p.evaluate(()=>window.BudgieApp.S.ui.cActions.findIndex(x=>x.from==='ex-small-pot'&&x.to==='e-main'));ok('only the available part of a reimbursement is suggested',action>=0&&await p.evaluate(i=>window.BudgieApp.S.ui.cActions[i].amount===3,action));if(!await p.locator('[data-a="cAction"][data-v="'+action+'"]').count())await p.locator('[data-a="cAll"]').click();await p.locator('[data-a="cAction"][data-v="'+action+'"]').click();ok('a move explains bank action before recording it',/Make this move in/.test(await p.locator('#sheets').innerText()));await p.locator('[data-a="cMoved"]').click();await settled(p);ok('only the partial move is recorded with a reconciliation batch',await p.evaluate(()=>{const d=window.BudgieApp.db(),m=d.moves.filter(x=>x.from==='ex-small-pot');return m.length===1&&m[0].amount===3&&!!m[0].batch&&window.Budgie.balances(d,'2026-11-02')['ex-small-pot']===0;}));
  await seed(p,'accounts',{id:'ex-credit',owner:'ethan',name:'Example credit',kind:'credit'});
  await seed(p,'transactions',{id:'ex-credit-buy',person:'ethan',date:'2026-11-02',amount:10,budget:'e-fun',account:'e-main',note:'Example credit purchase'});
  await openPayment(p,'ex-credit-buy');await p.locator('[data-a="exdetails"]').click();await p.locator('#peCredit').selectOption('ex-credit');await p.locator('[data-a="pesave"]').click();await settled(p);
  ok('credit funding can be corrected in payment details',await p.evaluate(()=>window.BudgieApp.db().transactions.find(x=>x.id==='ex-credit-buy').account==='ex-credit'));
  await go(p,'debts');await p.locator('[data-a="cCredit"][data-v="ex-credit"]').click();await p.locator('#cCreditOwed').fill('400');await p.locator('[data-a="cCreditSave"]').click();await settled(p);
  ok('positive amount owed saves a negative credit balance',await p.evaluate(()=>window.Budgie.balances(window.BudgieApp.db(),'2026-11-02')['ex-credit']===-400));
  await go(p,'bills');await p.getByRole('button',{name:'Add a bill',exact:true}).click();await p.locator('[data-f="name"]').fill('Example daily saving');await p.locator('[data-f="amount"]').fill('1.23');await p.locator('[data-f="how"]').selectOption('day');await p.locator('[data-f="start"]').fill('2026-11-02');await p.locator('[data-f="end"]').fill('2026-11-05');await p.locator('[data-f="dailyIncrease"]').fill('0.01');await p.locator('[data-f="toAccount"]').selectOption('e-isa');await p.getByRole('button',{name:'Save',exact:true}).click();await settled(p);
  const dailyId=await p.evaluate(()=>window.BudgieApp.db().bills.find(x=>x.name==='Example daily saving').id);
  await p.clock.setFixedTime(new Date('2026-11-03T12:00:00Z'));await go(p,'bills');await p.locator('[data-a="edit"][data-v="bills:'+dailyId+'"]').click();
  ok('editing a daily rule preserves the first amount',await p.locator('[data-f="amount"]').inputValue()==='1.23');await p.getByRole('button',{name:'Save',exact:true}).click();await settled(p);
  ok('daily increases remain correct after editing',await p.evaluate(id=>{const d=window.BudgieApp.db();return window.Budgie.amountAt(d,d.byId[id],'2026-11-05')===1.26;},dailyId));await p.clock.setFixedTime(new Date('2026-11-02T12:00:00Z'));
  await seed(p,'transactions',{id:'t-ex-plan',date:'2026-11-02',person:'ethan',amount:30,budget:'e-fun',account:'e-main',note:'Example desk',review:true});
  await openPayment(p,'t-ex-plan');await p.locator('[data-a="explan"]').click();await p.locator('#exNext').fill('2026-12-02');await p.locator('#exPlanHalf').check();await p.locator('[data-a="exsavePlan"]').click();await settled(p);
  let plan=await p.evaluate(()=>{const d=window.BudgieApp.db();return {bills:d.bills.filter(x=>x.name==='Example desk'),items:d.loanItems.filter(x=>x.name==='Example desk'),x:d.transactions.find(x=>x.id==='t-ex-plan')};});
  ok('plan has two future payments, first is not duplicated',plan.bills.length===1&&plan.bills[0].dates==='2026-12-02, 2027-01-02'&&plan.x.purchaseTotal===90&&plan.x.planId===plan.bills[0].id);
  ok('half the complete plan is itemised once',plan.items.length===1&&plan.items[0].share===45&&plan.x.iouShare===15&&!plan.x.split);
  await go(p,'today');await p.locator('[data-a="exundoCheck"]').click();await settled(p);
  ok('undo removes the whole created plan and IOU item',await p.evaluate(()=>{const d=window.BudgieApp.db();return !d.bills.some(x=>x.name==='Example desk')&&!d.loanItems.some(x=>x.name==='Example desk')&&!d.transactions.find(x=>x.id==='t-ex-plan').planId;}));
  await openPayment(p,'t-ex-plan');await p.locator('[data-a="explan"]').click();await p.locator('#exNext').fill('2026-12-02');await p.locator('#exPlanHalf').check();await p.locator('[data-a="exsavePlan"]').click();await settled(p);
  await openPayment(p,'t-ex-plan');await p.locator('[data-a="explan"]').click();ok('an existing plan can be changed in the app',await p.locator('[data-f="name"]').inputValue()==='Example desk');
  await seed(p,'bills',{id:'b-ex-regular',person:'ethan',name:'Example monthly bill',amount:12,account:'e-main',unit:'month',on:'2',start:'2026-11-01'});
  await seed(p,'transactions',{id:'t-ex-regular',person:'ethan',date:'2026-11-02',amount:12,account:'e-main',note:'Example monthly bill',review:true});
  await openPayment(p,'t-ex-regular');await p.locator('[data-a="exbill"]').click();await p.locator('#exExistingBill').selectOption('b-ex-regular');await p.locator('[data-a="exmatchBill"]').click();await p.locator('[data-a="exlinkBill"]').first().click();await settled(p);
  ok('a receipt can match an existing bill',await p.evaluate(()=>window.BudgieApp.db().transactions.find(x=>x.id==='t-ex-regular').isBillPayment));
  await go(p,'today');await p.locator('[data-a="exundoCheck"]').click();await settled(p);
  ok('undo restores an unmatched payment and bill',await p.evaluate(()=>{const d=window.BudgieApp.db();return !d.transactions.find(x=>x.id==='t-ex-regular').billId&&!d.exceptions.some(x=>x.item==='b-ex-regular');}));
  await seed(p,'transactions',{id:'t-ex-refund',date:'2026-11-02',person:'ethan',amount:-30,account:'e-main',note:'Example desk refund',review:true});
  await go(p,'review');await p.locator('[data-a="exguess"][data-v="t-ex-refund"]').click();await p.locator('#exOriginal').selectOption('t-ex-plan');await p.locator('[data-a="exsaveRefund"]').click();await settled(p);
  const refund=await p.evaluate(()=>{const d=window.BudgieApp.db(),x=d.transactions.find(x=>x.id==='t-ex-refund');return {x,loan:window.Budgie.loans(d,'ethan','2026-11-02').find(l=>l.name==='Shared purchases')};});
  ok('refund links to the correct purchase',refund.x.refundOf==='t-ex-plan'&&!refund.x.review);
  ok('partial plan refund reduces IOU proportionately',refund.loan.left===30);
  await go(p,'today');await p.locator('[data-a="exundoCheck"]').click();await settled(p);ok('undo restores unmatched refund',await p.evaluate(()=>!window.BudgieApp.db().transactions.find(x=>x.id==='t-ex-refund').refundOf));
  await go(p,'spare');await p.locator('#exBuffer').fill('125');await p.locator('#exSavings').selectOption('e-isa');await p.locator('summary').click();await p.locator('#exWhen').selectOption('soon');await p.locator('[data-a="exsaveSpare"]').click();await settled(p);
  const cfg=await p.evaluate(()=>window.Budgie.spareRules(window.BudgieApp.db(),'ethan','2026-11-02'));ok('priorities persist and migrate prospectively',cfg.buffer===125&&cfg.savings==='e-isa'&&cfg.when==='soon'&&cfg.replaceFrom==='2026-11-26');
  // Retryable writes survive arbitrarily long failures, then reach the backend once.
  await p.route('**/exec',async route=>{const body=JSON.parse(route.request().postData()||'{}');if(body.action)return route.continue();const response=await route.fetch({postData:JSON.stringify({...body,ops:[],full:true,since:0})}),j=await response.json();j.rejected=(body.ops||[]).map((op,i)=>({i,retry:true,error:'Temporary spreadsheet outage'}));await route.fulfill({json:j});});
  const kept=await p.evaluate(async()=>{const A=window.BudgieApp,S=A.S,row={id:'t-ex-waiting',date:'2026-11-02',person:S.data.me,amount:12.34,account:'e-main',budget:'e-fun',note:'Example unsent payment'};S.data.tables.transactions.push(row);S.data.queue=[{op:'put',table:'transactions',row,tries:12,failedAt:Date.now()-48*3600000}];await A.sync(false);return {queue:S.data.queue.length,present:S.data.tables.transactions.some(x=>x.id===row.id)};});ok('a two-day retryable outage never loses the edit',kept.queue===1&&kept.present);
  await p.unroute('**/exec');await p.evaluate(()=>window.BudgieApp.sync(false));await settled(p);ok('recovery applies the payment once',await p.evaluate(()=>window.BudgieApp.S.data.tables.transactions.filter(x=>x.id==='t-ex-waiting').length===1));
  await p.route('**/exec',route=>route.abort('internetdisconnected'));
  await p.evaluate(()=>{IDBObjectStore.prototype.put=function(){throw new DOMException('Simulated full IndexedDB','QuotaExceededError');};});
  await go(p,'add');await p.locator('#addAmt').fill('8.76');await p.locator('[data-a="addsave"]').click();
  await p.waitForFunction(()=>JSON.parse(localStorage.getItem('budgie.kv.data')||'null')?.queue.length>0);
  const offlineId=await p.evaluate(()=>window.BudgieApp.S.data.queue[0].row.id);
  await p.reload();await p.waitForFunction(()=>window.BudgieApp&&window.BudgieApp.S.data.me);
  ok('the newer fallback survives a reload over stale IndexedDB',await p.evaluate(id=>window.BudgieApp.S.data.queue.some(x=>x.row?.id===id),offlineId));
  await p.unroute('**/exec');await p.evaluate(()=>window.BudgieApp.sync(false));await settled(p);
  ok('fallback recovery syncs the offline payment once',await p.evaluate(id=>window.BudgieApp.S.data.tables.transactions.filter(x=>x.id===id).length===1,offlineId));
  await p.context().close();
  p=await pageFor('sophie');await go(p,'today');ok('shortfall is not labelled On track',!(/On track/.test(await text(p)))&&/needs attention/i.test(await text(p)));
  await p.context().close();
  // Exercise every current screen and the new sheets on both phones, including text enlargement.
  const screens=['today','money','plan','spare','add','partner','more','payday','pots','bills','goals','lisa','house','networth','debts','insights','gifts','settings','themes','bank','review','linked','emailset','sharing','sync','importcsv'];
  const layout=[];
  for(const width of [295,320,384,412])for(const size of ['normal','larger'])for(const who of ['ethan','sophie']){
   p=await pageFor(who,width);await p.evaluate(sz=>{window.BudgieApp.S.prefs.size=sz;},size);
   for(const screen of screens){await go(p,screen);let found=await p.evaluate(problems);if(found.length)layout.push({width,size,who,screen,found});
    if(width===384&&size==='normal'&&['today','money','plan','spare','partner','payday'].includes(screen)){await p.evaluate(()=>document.querySelector('#toast').innerHTML='');await p.screenshot({path:path.join(out,who+'-'+screen+'.png'),fullPage:true});}
   }
   await go(p,'money');for(const tab of ['activity','pots','budget']){await p.locator('[data-a="cTab"][data-v="'+tab+'"]').click();const found=await p.evaluate(problems);if(found.length)layout.push({width,size,who,screen:'money '+tab,found});}
   if(who==='ethan'){
    await openPayment(p,'t-ex-waiting');
    for(const action of ['explan','exbill','exdetails','exshare']){
     if(action!=='explan'){await p.evaluate(()=>document.querySelector('#sheets').innerHTML='');await openPayment(p,'t-ex-waiting');}
     await p.locator('#sheets [data-a="'+action+'"]').click();const found=await p.evaluate(problems);if(found.length)layout.push({width,size,who,screen:action,found});
    }
    await p.evaluate(()=>document.querySelector('#sheets').innerHTML='');await go(p,'review');await p.locator('[data-a="exguess"][data-v="t-ex-refund"]').click();const found=await p.evaluate(problems);if(found.length)layout.push({width,size,who,screen:'refund picker',found});
    await p.evaluate(()=>document.querySelector('#sheets').innerHTML='');
   }
   // Tour is seven live-data steps, has routes, and fits on both phones.
   await go(p,'more');await p.locator('[data-a="tour"]').click();for(let i=0;i<7;i++){ok('tour step '+(i+1),await p.locator('#sheets h2').count()===1);const found=await p.evaluate(problems);if(found.length)layout.push({width,size,who,screen:'tour '+i,found});if(i<6)await p.locator('#sheets [data-a="tournext"]').click();else await p.locator('#sheets [data-a="tourskip"]').click();}
   await p.context().close();
  }
  fs.writeFileSync(path.join(out,'layout-results.json'),JSON.stringify(layout,null,2));ok('all current screens and tour buttons fit',layout.length===0);ok('no browser runtime errors',errors.length===0);
  console.log('All '+passes+' UI checks passed; 16 user/width/text combinations.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
