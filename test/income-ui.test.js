// Invented household only: income evidence, commitments and slow bank checks.
const {chromium} = require('playwright'), assert = require('assert');
const links = require('./.links.json');
let checks = 0;
const ok = (v, label) => { assert(v, label); checks++; };
(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({viewport:{width:384,height:854},serviceWorkers:'block'});
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.clock.setFixedTime(new Date('2026-10-30T12:00:00Z'));
    await context.addInitScript(() => {
      localStorage.setItem('budgie.tour.sophie','true');
      localStorage.setItem('budgie.checkSeen',JSON.stringify('2026-10-30'));
    });
    await page.goto(links.sophie);
    await page.waitForFunction(() => window.BudgieApp && BudgieApp.S.data.me && !BudgieApp.S.syncing);
    const fixture = async (bank, paid) => page.evaluate(({bank,paid}) => {
      const a=BudgieApp, t=JSON.parse(JSON.stringify(a.S.data.tables));
      t.income=[{id:'side-example',person:'sophie',name:'Family support example',amount:240,account:'s-main',unit:'once',start:'2026-10-30'},
        {id:'salary-example',person:'sophie',name:'Future salary example',amount:1800,account:'s-main',unit:'month',on:'27',start:'2026-11-01',isPay:true}];
      t.bills=[{id:'personal-example',person:'sophie',name:'Personal bill example',amount:12,account:'s-main',unit:'once',start:'2026-11-01'},
        {id:'paid-example',person:'sophie',name:'Already paid example',amount:25,account:'s-main',unit:'once',start:'2026-10-29'},
        {id:'skipped-example',person:'sophie',name:'Skipped example',amount:18,account:'s-main',unit:'once',start:'2026-11-02'},
        {id:'pool-example',person:'sophie',name:'Pooled example',amount:50,account:'s-main',unit:'month',on:'29',start:'2026-10-01',pool:'2026-10-29'}];
      t.transfers=[{id:'rent-example',from:'sophie',to:'ethan',name:'Rent example',amount:400,fromAccount:'s-rent',toAccount:'e-main',unit:'once',start:'2026-11-13'}];
      t.loans=[{id:'loan-example',lender:'ethan',borrower:'sophie',name:'Example loan',amount:100,date:'2026-10-25',repay:100,repayFrom:'2026-11-12',repayDay:'12'}];
      t.settlements=[{id:'partial-example',loan:'loan-example',from:'sophie',to:'ethan',amount:30,date:'2026-10-29'}];
      t.exceptions=[{id:'example-paid',item:'paid-example',date:'2026-10-29',action:'paid'},
        {id:'example-skip',item:'skipped-example',date:'2026-11-02',action:'skip'}];
      if(paid)t.exceptions.push({id:paid==='bank'?'x-bankpaid-example':'manual-example',item:'side-example',date:'2026-10-30',action:'paid'});
      t.transactions=[{id:'pool-spend-example',person:'sophie',date:'2026-10-30',amount:20,budget:'pool-example',account:'s-main',note:'Pooled actual example'}];t.moves=[];
      t.valuations=[{id:bank?'bk-example':'manual-value',account:'s-main',date:'2026-10-30',amount:240}];
      Object.assign(a.db(),Budgie.load(t,'2026-10-30'));a.S.ui.cMoney='budget';a.S.ui.monthOff=0;a.go('money');
    },{bank,paid});
    await fixture(true,false);
    const subtotal=await page.locator('[data-a="cDue"]').innerText();
    ok(subtotal.includes('Payments still due') && subtotal.includes('£512.00'),'subtotal includes bill, shared rent, partial loan and unspent pool; excludes paid/skipped');
    await page.locator('[data-a="cDue"]').click();
    ok((await page.locator('main').innerText()).includes('Family support example'),'unconfirmed elapsed non-pay income remains due');
    ok((await page.getByRole('button',{name:/Pay Ethan back/}).innerText()).includes('£70.00'),'due list shows only unpaid part of loan');
    ok((await page.getByRole('button',{name:/Pooled example/}).innerText()).includes('£30.00'),'due list shows only unspent pool provision');
    await page.locator('[data-a="cWhen"][data-v="recent"]').click();
    ok(!(await page.locator('main').innerText()).includes('Family support example'),'date alone is not a received bank payment');
    await fixture(true,'bank');
    await page.evaluate(()=>{BudgieApp.S.ui.cMoney='activity';BudgieApp.S.ui.cWhen='recent';BudgieApp.go('money');});
    await page.getByRole('button',{name:/Family support example/}).click();
    ok((await page.locator('#sheets').innerText()).includes('Matched to a bank receipt.'),'matched income shows bank evidence');
    await page.locator('[data-a="sheetclose"]').click();
    await fixture(true,'manual');
    await page.evaluate(()=>{BudgieApp.S.ui.cMoney='activity';BudgieApp.S.ui.cWhen='recent';BudgieApp.go('money');});
    await page.getByRole('button',{name:/Family support example/}).click();
    ok((await page.locator('#sheets').innerText()).includes('Marked as received or paid'),'manual confirmation is distinguished from bank matching');
    await page.locator('[data-a="sheetclose"]').click();
    await fixture(false,false);
    await page.evaluate(()=>{BudgieApp.S.ui.cMoney='activity';BudgieApp.S.ui.cWhen='recent';BudgieApp.go('money');});
    ok((await page.locator('main').innerText()).includes('Family support example'),'unconnected calendar budget retains existing behaviour');
    // Exercise the rendered Check now control with a deliberately slow bank.
    let releaseBank, enteredBank, count=0, ledgerAfterBank=0, finished=false, fail=false;
    let holdNextSync=false, releaseOldSync, enteredOldSync;
    const oldEntered=new Promise(r=>enteredOldSync=r), oldGate=new Promise(r=>releaseOldSync=r);
    const entered=new Promise(r=>enteredBank=r), gate=new Promise(r=>releaseBank=r);
    await page.route('**/exec',async route=>{
      const body=route.request().postDataJSON();
      if(body.action==='bank.syncNow'){
        count++;enteredBank();await gate;finished=true;
        return route.fulfill({json:fail?{ok:false,error:'Example bank unavailable'}:{ok:true,added:1,updated:0}});
      }
      if(body.action==='bank.status')return route.fulfill({json:{ok:true,bank:{provider:'starling',connected:true,lastSync:Date.now(),accounts:[]}}});
      if(!body.action&&finished)ledgerAfterBank++;
      if(!body.action&&holdNextSync){holdNextSync=false;enteredOldSync();await oldGate;}
      return route.continue();
    });
    await page.evaluate(()=>{BudgieApp.S.bank={provider:'starling',connected:true,lastSync:Date.now(),accounts:[]};BudgieApp.go('bank');});
    await page.locator('[data-a="banksync"]').click();await entered;
    ok(!await page.locator('[data-a="banksync"]').isEnabled(),'Check now disabled while bank is running');
    await page.waitForTimeout(3200);
    ok(await page.getByRole('status').filter({hasText:'Checking Starling'}).isVisible(),'progress outlives temporary toast');
    await page.evaluate(()=>{const b=document.querySelector('[data-a="banksync"]');b.disabled=false;b.click();});
    ok(count===1,'repeat action cannot start a second bank request');
    await page.evaluate(()=>BudgieApp.go('today'));
    ok(await page.getByRole('status').filter({hasText:'Checking Starling'}).isVisible(),'progress survives navigation');
    holdNextSync=true;await page.evaluate(()=>{BudgieApp.sync(false);});await oldEntered;
    releaseBank();await page.getByRole('status').filter({hasText:'Bank check finished'}).waitFor();
    ok(await page.evaluate(()=>!!BudgieApp.S.bankSyncing),'pre-import sheet request does not end progress early');
    releaseOldSync();await page.waitForFunction(()=>!BudgieApp.S.bankSyncing);
    ok(ledgerAfterBank>0,'completion waits for a post-import ledger fetch');
    ok((await page.locator('#toast').innerText()).includes('Bank checked and budget updated'),'success only after budget refresh');
    fail=true;await page.evaluate(()=>BudgieApp.go('bank'));await page.locator('[data-a="banksync"]').click();
    await page.waitForFunction(()=>!BudgieApp.S.bankSyncing);
    ok(await page.locator('[data-a="banksync"]').isEnabled(),'bank error restores retry control');
    ok((await page.locator('#toast').innerText()).includes('Example bank unavailable'),'bank failure never claims completion');
    ok(!errors.length,'no page errors: '+errors.join(';'));
    await context.close();console.log('All '+checks+' income and bank-progress UI checks passed.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
