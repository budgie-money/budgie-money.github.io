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
  async function go(p,s){await p.evaluate(s=>{document.querySelector('#sheets').innerHTML='';window.BudgieApp.go(s);},s);await p.waitForTimeout(30);ok(s+' renders',!(/Something went wrong/.test(await text(p))));}
  async function settled(p){await p.waitForFunction(()=>!window.BudgieApp.S.syncing&&!window.BudgieApp.S.data.queue.length,null,{timeout:15000});}
  async function seed(p,table,row){const result=await p.evaluate(async({table,row})=>{const S=window.BudgieApp.S,r=await fetch(S.cfg.u,{method:'POST',body:JSON.stringify({key:S.cfg.k,ops:[{op:'put',table,row}]})});return r.json();},{table,row});ok('test row accepted '+row.id,result.ok&&!result.rejected.length);await p.evaluate(()=>window.BudgieApp.sync(true));}
  let p=await pageFor('ethan');
  await go(p,'today');ok('Today explains the purpose',/Needs you/.test(await text(p))&&/Left in your budgets/.test(await text(p)));
  await go(p,'plan');ok('budget has jobs and editing paths',/Keep your bills covered/.test(await text(p))&&/Choose what you can spend/.test(await text(p)));
  await go(p,'money');ok('one timeline has Today and filters',await p.locator('.ex-todayline').count()===1&&await p.locator('[data-a="exfilter"]').count()===4);
  for(const f of ['bills','spending','pot','all']){await p.locator('[data-a="exfilter"][data-v="'+f+'"]').click();ok('timeline '+f+' does not crash',!(/Something went wrong/.test(await text(p))));}
  await seed(p,'transactions',{id:'t-ex-plan',date:'2026-11-02',person:'ethan',amount:30,budget:'e-fun',account:'e-main',note:'Example desk',review:true});
  await go(p,'today');await p.locator('[data-a="payedit1"][data-v="t-ex-plan"]').click();await p.locator('[data-a="explan"]').click();await p.locator('#exNext').fill('2026-12-02');await p.locator('#exPlanHalf').check();await p.locator('[data-a="exsavePlan"]').click();await settled(p);
  let plan=await p.evaluate(()=>{const d=window.BudgieApp.db();return {bills:d.bills.filter(x=>x.name==='Example desk'),items:d.loanItems.filter(x=>x.name==='Example desk'),x:d.transactions.find(x=>x.id==='t-ex-plan')};});
  ok('plan has two future payments, first is not duplicated',plan.bills.length===1&&plan.bills[0].dates==='2026-12-02, 2027-01-02'&&plan.x.purchaseTotal===90&&plan.x.planId===plan.bills[0].id);
  ok('half the complete plan is itemised once',plan.items.length===1&&plan.items[0].share===45&&plan.x.iouShare===15&&!plan.x.split);
  await go(p,'today');await p.locator('[data-a="exundoCheck"]').click();await settled(p);
  ok('undo removes the whole created plan and IOU item',await p.evaluate(()=>{const d=window.BudgieApp.db();return !d.bills.some(x=>x.name==='Example desk')&&!d.loanItems.some(x=>x.name==='Example desk')&&!d.transactions.find(x=>x.id==='t-ex-plan').planId;}));
  await go(p,'today');await p.locator('[data-a="payedit1"][data-v="t-ex-plan"]').click();await p.locator('[data-a="explan"]').click();await p.locator('#exNext').fill('2026-12-02');await p.locator('#exPlanHalf').check();await p.locator('[data-a="exsavePlan"]').click();await settled(p);
  await go(p,'today');await p.locator('[data-a="payedit1"][data-v="t-ex-plan"]').click();await p.locator('[data-a="explan"]').click();ok('an existing plan can be changed in the app',await p.locator('[data-f="name"]').inputValue()==='Example desk');
  await seed(p,'bills',{id:'b-ex-regular',person:'ethan',name:'Example monthly bill',amount:12,account:'e-main',unit:'month',on:'2',start:'2026-11-01'});
  await seed(p,'transactions',{id:'t-ex-regular',person:'ethan',date:'2026-11-02',amount:12,account:'e-main',note:'Example monthly bill',review:true});
  await go(p,'today');await p.locator('[data-a="payedit1"][data-v="t-ex-regular"]').click();await p.locator('[data-a="exbill"]').click();await p.locator('#exExistingBill').selectOption('b-ex-regular');await p.locator('[data-a="exmatchBill"]').click();await p.locator('[data-a="exlinkBill"]').first().click();await settled(p);
  ok('a receipt can match an existing bill',await p.evaluate(()=>window.BudgieApp.db().transactions.find(x=>x.id==='t-ex-regular').isBillPayment));
  await go(p,'today');await p.locator('[data-a="exundoCheck"]').click();await settled(p);
  ok('undo restores an unmatched payment and bill',await p.evaluate(()=>{const d=window.BudgieApp.db();return !d.transactions.find(x=>x.id==='t-ex-regular').billId&&!d.exceptions.some(x=>x.item==='b-ex-regular');}));
  await seed(p,'transactions',{id:'t-ex-refund',date:'2026-11-02',person:'ethan',amount:-30,account:'e-main',note:'Example desk refund',review:true});
  await go(p,'review');await p.locator('[data-a="exguess"][data-v="t-ex-refund"]').click();await p.locator('#exOriginal').selectOption('t-ex-plan');await p.locator('[data-a="exsaveRefund"]').click();await settled(p);
  const refund=await p.evaluate(()=>{const d=window.BudgieApp.db(),x=d.transactions.find(x=>x.id==='t-ex-refund');return {x,loan:window.Budgie.loans(d,'ethan','2026-11-02').find(l=>l.name==='Shared purchases')};});
  ok('refund links to the correct purchase',refund.x.refundOf==='t-ex-plan'&&!refund.x.review);
  ok('partial plan refund reduces IOU proportionately',refund.loan.left===30);
  await go(p,'today');await p.locator('[data-a="exundoCheck"]').click();await settled(p);ok('undo restores unmatched refund',await p.evaluate(()=>!window.BudgieApp.db().transactions.find(x=>x.id==='t-ex-refund').refundOf));
  await go(p,'spare');await p.locator('#exBuffer').fill('125');await p.locator('#exSavings').selectOption('e-isa');await p.locator('#exWhen').selectOption('soon');await p.locator('[data-a="exsaveSpare"]').click();await settled(p);
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
  p=await pageFor('sophie');await go(p,'today');ok('shortfall is not labelled On track',!(/On track/.test(await text(p)))&&/needs attention/.test(await text(p)));
  await p.context().close();
  // Exercise every current screen and the new sheets on both phones, including text enlargement.
  const screens=['today','money','plan','spare','add','partner','more','payday','pots','bills','goals','lisa','house','networth','debts','insights','gifts','settings','themes','bank','review','linked','emailset','sharing','sync','importcsv'];
  const layout=[];
  for(const width of [295,320,384,412])for(const size of ['normal','larger'])for(const who of ['ethan','sophie']){
   p=await pageFor(who,width);await p.evaluate(sz=>{window.BudgieApp.S.prefs.size=sz;},size);
   for(const screen of screens){await go(p,screen);let found=await p.evaluate(problems);if(found.length)layout.push({width,size,who,screen,found});
    if(width===384&&size==='normal'&&['today','money','plan','spare','partner','payday'].includes(screen)){await p.evaluate(()=>document.querySelector('#toast').innerHTML='');await p.screenshot({path:path.join(out,who+'-'+screen+'.png'),fullPage:true});}
   }
   if(who==='ethan'){
    await go(p,'today');await p.locator('[data-a="payedit1"][data-v="t-ex-waiting"]').click();
    for(const action of ['explan','exbill','exdetails','exshare']){
     if(action!=='explan'){await p.evaluate(()=>document.querySelector('#sheets').innerHTML='');await go(p,'today');await p.locator('[data-a="payedit1"][data-v="t-ex-waiting"]').click();}
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
