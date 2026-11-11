// Cooldown in a real browser against the fake backend. Every name and amount is invented.
// Run on a fresh fake server: node test/server.js, then node test/cooldown-ui.test.js
const {chromium}=require('playwright'),assert=require('assert');
const links=require('./.links.json');
let passes=0;const errors=[];
const ok=(name,v,extra)=>{assert(v,name+(extra!==undefined?' '+JSON.stringify(extra):''));passes++;};
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
  async function pageFor(who,width=384){const c=await browser.newContext({viewport:{width,height:854},isMobile:true,hasTouch:true,locale:'en-GB',timezoneId:'Europe/London',serviceWorkers:'block'});await c.addInitScript(()=>{for(const n of ['ethan','sophie'])localStorage.setItem('budgie.tour.'+n,'true');localStorage.setItem('budgie.checkSeen',JSON.stringify('2026-11-02'));});const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));await p.clock.install({time:new Date('2026-11-02T12:00:00Z')});await p.goto(links[who]);await p.waitForFunction(()=>window.BudgieApp&&!!window.BudgieApp.S.data.me);return p;}
  const go=async(p,s)=>{await p.evaluate(s=>{document.querySelector('#sheets').innerHTML='';window.BudgieApp.go(s);},s);await p.waitForTimeout(40);ok(s+' renders',!/Something went wrong/.test(await p.locator('main').innerText()));};
  const settled=p=>p.waitForFunction(()=>!window.BudgieApp.S.syncing&&!window.BudgieApp.S.data.queue.length,null,{timeout:15000});
  const rows=p=>p.evaluate(()=>(window.BudgieApp.db().cooldown||[]).map(x=>Object.assign({},x)));
  const row=async(p,name)=>(await rows(p)).find(x=>x.name===name);
  const layout=async(p,tag)=>{const f=await p.evaluate(problems);ok('layout '+tag,!f.length,f);};
  async function park(p,name,price,source,hype,days){await p.locator('[data-a="coolPark"]').first().click();await p.locator('#coolName').fill(name);await p.locator('#coolPrice').fill(String(price));if(source)await p.locator('#coolSource').selectOption(source);if(days)await p.locator('#coolDays').selectOption(String(days));await p.locator('[data-a="coolHype"][data-v="'+hype+'"]').click();await p.locator('[data-a="coolSave"]').click();await settled(p);}

  let p=await pageFor('ethan');
  const seeded=await p.evaluate(async()=>{const S=window.BudgieApp.S,r=await fetch(S.cfg.u,{method:'POST',body:JSON.stringify({key:S.cfg.k,ops:[{op:'put',table:'goals',row:{id:'g-car',owners:'ethan',name:'Example car',target:2500,accounts:'e-isa',kind:'car'}},{op:'put',table:'valuations',row:{id:'v-cool-isa',account:'e-isa',date:'2026-11-01',amount:1000}}]})});return r.json();});
  ok('example goal added',seeded.ok&&seeded.applied.length===2);await p.evaluate(()=>window.BudgieApp.sync(false));await settled(p);
  await go(p,'more');ok('More has a Cooldown tile',await p.locator('.more [data-v="cooldown"]').count()===1);
  ok('More tiles stay in even rows',await p.locator('.more>button').count()%2===0);
  await go(p,'today');ok('Today has Cooldown beside Can I buy this?',await p.locator('#c-budget [data-v="cooldown"]').count()===1&&await p.locator('#c-budget [data-v="purchase"]').count()===1);
  await layout(p,'today');
  await p.locator('#c-budget [data-v="cooldown"]').click();ok('opens Cooldown',/Nothing cooling/.test(await p.locator('main').innerText()));
  await p.locator('[data-a="coolPark"]').click();
  await p.locator('#coolPrice').fill('120');ok('suggested period follows the price',await p.locator('#coolDays').inputValue()==='7');
  await p.locator('#coolPrice').fill('400');ok('£400 cools for 30 days',await p.locator('#coolDays').inputValue()==='30');
  await p.locator('#coolPrice').fill('14.99');ok('under £15 cools for a day',await p.locator('#coolDays').inputValue()==='1'&&/Green tomorrow/.test(await p.locator('#coolHint').innerText()));
  await layout(p,'park sheet');await p.locator('[data-a="sheetclose"]').click();
  await park(p,'Example cable',9.5,'e-fun',3);
  await park(p,'Example speaker',240,'e-fun',5,3);
  await park(p,'Example game',45,'next',4);
  await park(p,'Example tent',200,'e-isa',4,14);
  await park(p,'Example mug',20,'e-fun',2);
  let all=await rows(p);
  ok('five parked, synced with their details',all.length===5&&all.every(x=>x.person==='ethan'&&x.status==='cooling'&&x.date==='2026-11-02'),all);
  ok('days saved: suggested or chosen',[['Example cable',1],['Example speaker',3],['Example game',3],['Example tent',14],['Example mug',3]].every(([n,d])=>all.find(x=>x.name===n).days===d));
  const server=await p.evaluate(async()=>(await (await fetch('/dump?cooldown')).json()));ok('in the sheet too',server.filter(x=>x.person==='ethan').length===5);
  await go(p,'cooldown');ok('all cooling at first',await p.locator('.cool-card').count()===5&&/5\s*cooling/.test(await p.locator('.cool-stats').innerText()));
  await layout(p,'cooling list');
  // extend, and let go early
  const mug=await row(p,'Example mug');await p.locator('[data-a="coolExtend"][data-v="'+mug.id+'"]').click();await settled(p);ok('Add 3 days',(await row(p,'Example mug')).days===6);
  await p.locator('[data-a="coolDrop"][data-v="'+mug.id+'"]').click();await layout(p,'let go sheet');await p.locator('[data-a="coolDropYes"]').click();await settled(p);
  ok('let go early',(await row(p,'Example mug')).status==='letgo'&&/£20\.00/.test(await p.locator('.cool-stats').innerText()));
  // a day later: the cable is green; a few days later the speaker is cooled but Fun can't cover it
  await p.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));await go(p,'cooldown');
  const txt=await p.locator('main').innerText();
  ok('ready to buy',/Ready to buy[\s\S]*Example cable/.test(txt)&&await p.locator('.cool-card.ready').count()===1);
  ok('cooled, waiting for money, with what Fun has',/Cooled, waiting for money[\s\S]*Example speaker[\s\S]*Fun has £/.test(txt));
  ok('next month waits for payday',/Waiting for payday on Thu 26 Nov/.test(txt));
  ok('savings item shows the car goal',/Example car: £1,000\.00 → £800\.00 of £2,500\.00/.test(txt),txt);
  await layout(p,'mixed list');
  await go(p,'today');ok('Today shows how many are ready',await p.locator('#c-budget [data-v="cooldown"] .cool-badge').innerText()==='1');await layout(p,'today with badge');
  await go(p,'cooldown');
  // still want it: excitement holds, so it's bought, and logging opens the usual screen filled in
  const cable=await row(p,'Example cable');await p.locator('[data-a="coolCheck"][data-v="'+cable.id+'"]').click();await layout(p,'re-rate sheet');
  await p.locator('[data-a="coolRate"][data-v="'+cable.id+'|3"]').click();await settled(p);
  ok('bought at the same excitement',(await row(p,'Example cable')).status==='bought'&&(await row(p,'Example cable')).rehype===3);
  ok('offers to log it against Fun',/Log £9\.50 against Fun/.test(await p.locator('#sheets').innerText()));await layout(p,'log offer');
  await p.locator('[data-a="coolLog"]').click();
  ok('Add is filled in',await p.locator('#addAmt').inputValue()==='9.5'&&await p.locator('.budtile[aria-pressed="true"]').innerText()==='Fun'&&/Example cable/.test(await p.locator('main').innerText()));
  await p.locator('[data-a="addsave"]').click();await settled(p);
  ok('logged as a normal payment',await p.evaluate(()=>window.BudgieApp.db().transactions.some(x=>x.note==='Example cable'&&x.amount===9.5&&x.budget==='e-fun')));
  // payday: the next-month game turns green; excitement dropped below the lower of 4 and its first score, so it's let go
  await p.clock.setFixedTime(new Date('2026-11-26T12:00:00Z'));await go(p,'cooldown');
  const game=await row(p,'Example game');ok('green after payday',await p.locator('.cool-card.ready [data-v="'+game.id+'"]').count()>0);
  await p.locator('[data-a="coolCheck"][data-v="'+game.id+'"]').click();await p.locator('[data-a="coolRate"][data-v="'+game.id+'|3"]').click();await settled(p);
  ok('let go when excitement drops',(await row(p,'Example game')).status==='letgo'&&/£65\.00/.test(await p.locator('.cool-stats').innerText()));
  ok('history lists both',/History[\s\S]*Example game[\s\S]*/.test(await p.locator('main').innerText())&&await p.locator('.cool-hist .li').count()===3);
  // changing one while it cools
  const tent=await row(p,'Example tent');await p.locator('[data-a="coolEdit"][data-v="'+tent.id+'"]').click();await p.locator('#coolDays').selectOption('30');await p.locator('#coolPrice').fill('210');await p.locator('[data-a="coolSave"]').click();await settled(p);
  ok('period and price can be changed',(await row(p,'Example tent')).days===30&&(await row(p,'Example tent')).price===210&&(await row(p,'Example tent')).date==='2026-11-02');
  // Can I buy this? can park the item instead
  await go(p,'purchase');await p.locator('#flowBuyAmount').fill('60');await p.locator('#flowBuyBudget').selectOption('e-fun');await p.locator('[data-a="flowBuyCheck"]').click();
  await p.locator('[data-a="coolPark"][data-v="purchase"]').click();ok('purchase check fills the price and budget',await p.locator('#coolPrice').inputValue()==='60'&&await p.locator('#coolSource').inputValue()==='e-fun');
  await p.locator('[data-a="sheetclose"]').click();
  await p.context().close();
  // Sophie never sees Ethan's
  const s=await pageFor('sophie');await go(s,'cooldown');ok('partner sees none of it',(await rows(s)).length===0&&/Nothing cooling/.test(await s.locator('main').innerText()));await s.context().close();
  // widths and larger text
  for(const width of [320,768]){const q=await pageFor('ethan',width);await q.clock.setFixedTime(new Date('2026-11-06T12:00:00Z'));await go(q,'cooldown');await layout(q,'list at '+width);await q.locator('[data-a="coolPark"]').first().click();await layout(q,'form at '+width);await q.context().close();}
  ok('no page errors',!errors.length,errors);
 }finally{await browser.close();}
 console.log('All '+passes+' cooldown UI checks passed.');
})().catch(e=>{console.error(e);process.exit(1);});
