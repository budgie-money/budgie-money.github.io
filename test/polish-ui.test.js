const {chromium}=require('playwright'),assert=require('assert'),fs=require('fs');const links=require('./.links.json');let n=0;const ok=(v,s)=>{assert(v,s);n++;};
(async()=>{const b=await chromium.launch();try{
const c=await b.newContext({viewport:{width:384,height:854},serviceWorkers:'block'});const p=await c.newPage();await c.addInitScript(()=>{localStorage.setItem('budgie.tour.ethan','true');localStorage.setItem('budgie.checkSeen',JSON.stringify('2026-11-02'));});await p.clock.setFixedTime(new Date('2026-11-02T12:00:00Z'));await p.goto(links.ethan);await p.waitForFunction(()=>window.BudgieApp&&window.BudgieApp.S.data.me&&!window.BudgieApp.S.syncing);
const go=async s=>{await p.evaluate(s=>window.BudgieApp.go(s),s);await p.waitForTimeout(50);};
const result=await p.evaluate(()=>({special:Object.keys(BudgieThemes.SPECIAL),colours:Object.keys(BudgieThemes.COLOURS)}));
for(const width of [295,320,384,560]){
 await p.setViewportSize({width,height:854});
 for(const theme of ['',...result.special]){
  await p.evaluate(t=>{BudgieApp.S.prefs.special=t;BudgieApp.S.prefs.size='larger';BudgieThemes.apply(BudgieApp.S.prefs);},theme);
  for(const s of ['today','money','partner','spare','more','themes','payday','goals','debts','bills','house','lisa','insights','settings','add']){
   await go(s);ok(!/Something went wrong/.test(await p.locator('main').innerText()),s+' render');
   ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),s+' overflow '+width+' '+theme);ok(await p.evaluate(()=>[...document.querySelectorAll('.c-budget-row')].every(x=>x.scrollWidth<=x.clientWidth+1)),s+' budget row fits '+width+' '+theme);
   if(s==='today'){
    ok(await p.evaluate(()=>[...document.querySelectorAll('.c-budget-row')].every(r=>{const a=r.querySelectorAll('.c-amount');return a.length<2||Math.abs(a[0].getBoundingClientRect().top-a[1].getBoundingClientRect().top)<1;})),'budget number baseline');
    ok(await p.evaluate(()=>{const groups={};document.querySelectorAll('.c-guide-parts>div').forEach(x=>{const k=Math.round(x.getBoundingClientRect().top);(groups[k]||(groups[k]=[])).push(x.querySelector('b').getBoundingClientRect().bottom);});return Object.values(groups).every(a=>Math.max(...a)-Math.min(...a)<1);}), 'guide amount baseline '+width+' '+theme);
   }
   if(s==='themes')ok(await p.evaluate(()=>{const a=[...document.querySelectorAll('.swatches button')].map(x=>x.getBoundingClientRect().width);return Math.max(...a)-Math.min(...a)<1;}),'equal swatches');
   if(s==='spare')ok(await p.evaluate(()=>{const a=document.querySelector('details').closest('.card').getBoundingClientRect(),b=document.querySelector('[data-a="exsaveSpare"]').getBoundingClientRect();return b.top-a.bottom>=10;}),'saving action spacing');
  }
 }
}
await p.setViewportSize({width:384,height:854});await p.evaluate(()=>{BudgieApp.S.prefs.special='hyperspace';BudgieApp.S.prefs.size='normal';BudgieThemes.apply(BudgieApp.S.prefs);});
await p.evaluate(async()=>{const S=BudgieApp.S;await fetch(S.cfg.u,{method:'POST',body:JSON.stringify({key:S.cfg.k,ops:[{op:'put',table:'transactions',row:{id:'polish-receipt',person:'ethan',date:'2026-11-02',amount:4,budget:'e-fun',account:'e-main',note:'Example receipt'}}]})});await BudgieApp.sync(true);});
await go('money');await p.locator('[data-a="cTab"][data-v="activity"]').click();const payment=await p.evaluate(()=>Object.values(BudgieApp.S.ui.cActivity).find(x=>x.kind==='payment'&&x.amount>0).id);await p.locator('[data-a="cActivity"][data-v="'+payment+'"]').click();
await p.locator('.sheet .c-choice-grid').waitFor();await p.waitForTimeout(250);ok(await p.locator('.sheet button').count()>=5,'payment actions are present');
ok(await p.evaluate(()=>{const a=[...document.querySelectorAll('.sheet button')].map(x=>x.getBoundingClientRect());return a.every((x,i)=>a.every((y,j)=>i===j||x.right<=y.left+1||y.right<=x.left+1||x.bottom+8<=y.top||y.bottom+8<=x.top));}),'payment actions have separate bounds');await p.screenshot({path:'../../outputs/Budgie-1.5.4-payment-demo.png'});
await go('more');await p.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));await p.locator('[data-a="tour"]').click();await p.locator('[data-a="extourShow"]').click();await p.waitForTimeout(350);
ok(await p.evaluate(()=>{const r=document.querySelector('#c-guide').getBoundingClientRect();return r.top>=0&&r.top<300;}),'Show me targets guide after scrolling');
for(const [i,target] of ['guide','actions','budget','activity','pots','payday','spare','partner','goals'].entries()){await go('more');await p.locator('[data-a="tour"]').click();for(let j=0;j<i;j++)await p.locator('[data-a="tournext"]').click();ok(await p.locator('[data-a="extourShow"]').getAttribute('data-v')===target,'tour step '+target);await p.locator('[data-a="extourShow"]').click();await p.waitForTimeout(350);ok(await p.locator('#sheets').innerText()==='','tour '+target+' closes sheet');}
await go('today');await p.evaluate(()=>window.scrollTo(0,0));await p.screenshot({path:'../../outputs/Budgie-1.5.4-hyperspace-demo.png',fullPage:true});await go('partner');ok(/category allowance/.test(await p.locator('main').innerText()),'partner distinguishes allowance from bank cash');
console.log('All '+n+' polish UI checks passed; 4 widths, 7 looks, 15 screens, larger text, tour destinations and payment spacing.');await c.close();
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
