/* Cooldown: park something you want, let it cool, and buy it only if you still want it and the money is there.
   The rows live in the cooldown table (synced like every other table); whether one is green comes from engine.js
   (Budgie.cooldown), worked out from today's numbers each time, so it follows the bank feed and both phones agree. */
(function(){'use strict';window.BudgieCooldown={install:function(A){
 var B=A.B,S=A.S,V=A.SCREENS,ACT=A.ACT,E=A.esc,M=A.M,db=A.db,me=A.me,now=A.today,card=A.card;
 if(!B.cooldown)return;
 var $=function(s){return document.querySelector(s);};
 var btn=function(t,a,v,cls){return '<button type="button" class="btn '+(cls||'ghost')+'" data-a="'+a+'"'+(v!==undefined?' data-v="'+E(v)+'"':'')+'>'+E(t)+'</button>';};
 var row2=function(s){return '<div class="two fit cool-acts">'+s+'</div>';};
 var DAYS=[[1,'1 day'],[3,'3 days'],[7,'1 week'],[14,'2 weeks'],[30,'30 days']];
 var css=document.createElement('style');css.textContent='.cool-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:14px}.cool-stats>div{background:var(--soft);border-radius:12px;padding:10px 12px;min-width:0}.cool-stats b{display:block;font:700 20px/1.2 var(--head);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cool-stats span{font-size:12px;color:var(--muted)}.cool-item{display:grid;grid-template-columns:56px minmax(0,1fr);gap:12px;align-items:start}.cool-card.ready{border-color:var(--good);box-shadow:0 0 0 2px color-mix(in srgb,var(--good) 25%,transparent)}.cool-ring{position:relative;width:56px;height:56px}.cool-ring svg{width:56px;height:56px;transform:rotate(-90deg)}.cool-ring b{position:absolute;inset:0;display:grid;place-items:center;font-size:14px;font-variant-numeric:tabular-nums;line-height:1}.cool-head{display:flex;justify-content:space-between;gap:10px;align-items:baseline;width:100%;background:none;border:0;padding:0;color:var(--ink);text-align:left;font:inherit}.cool-head strong{min-width:0;overflow-wrap:anywhere}.cool-body{min-width:0}.cool-body p{margin:4px 0 0}.cool-ok{color:var(--good);font-weight:600}.cool-wait{color:var(--warn);font-weight:600}.cool-why{font-style:italic}.cool-acts{gap:8px;margin-top:12px}.cool-acts>.btn{min-height:44px}.cool-hype{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;margin-top:6px}.cool-hype>.chip{padding:0}.cool-form .flow-grid,.cool-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 10px}.cool-grid>*{min-width:0}.cool-hint{min-height:1.5em;margin:12px 0 0}.cool-badge{display:inline-block;min-width:20px;padding:0 6px;margin-left:6px;border-radius:999px;background:var(--good);color:#fff;font-size:12px;line-height:20px;text-align:center}.cool-hist .li .num.saved{color:var(--good)}.flow-actions.fit>.btn{white-space:nowrap}@media (max-width:360px){.cool-grid{grid-template-columns:1fr}}';
 document.head.appendChild(css);
 A.TITLES.cooldown=function(){return ['Cooldown','Wait, then decide'];};

 function view(){return B.cooldown(db(),me(),now());}
 function sources(){return B.coolSources(db(),me(),now());}
 function item(id){return view().items.filter(function(x){return x.id===id;})[0];}
 
 function daysText(n){var d=DAYS.filter(function(x){return x[0]===n;})[0];return d?d[1]:n+' days';}
 function srcText(s){return s.kind==='next'?'Next month · after payday '+B.nice(s.payday):s.name+' · '+M(s.left)+(s.kind==='saving'?' saved':' left');}

 // how far through cooling it is, and what's left: hours on the last day, days before that
 function ring(x){
  var start=new Date(x.from+'T00:00:00').getTime(),end=new Date(x.readyOn+'T00:00:00').getTime(),t=Date.now(),frac=x.state==='cooling'?Math.max(0,Math.min(1,(t-start)/Math.max(1,end-start))):1;
  var col=x.state==='ready'?'var(--good)':x.state==='waiting'?'var(--warn)':'var(--accent)',r=24,c=2*Math.PI*r,ms=end-t,label=x.state==='ready'?'✓':x.state==='waiting'?'£':ms<=0?'0h':ms<48*36e5?Math.ceil(ms/36e5)+'h':Math.ceil(ms/864e5)+'d';
  return '<div class="cool-ring" aria-hidden="true"><svg viewBox="0 0 56 56"><circle cx="28" cy="28" r="'+r+'" fill="none" stroke="var(--line)" stroke-width="6"/><circle cx="28" cy="28" r="'+r+'" fill="none" stroke="'+col+'" stroke-width="6" stroke-linecap="round" stroke-dasharray="'+c.toFixed(2)+'" stroke-dashoffset="'+(c*(1-frac)).toFixed(2)+'"/></svg><b>'+label+'</b></div>';
 }
 function goalLine(x){return x.goals.map(function(g){return '<p class="small muted">'+(g.linked?E(g.name)+': '+M(g.saved)+' → '+M(g.after)+' of '+M(g.target):'That’s '+g.share+'% of your '+E(g.car?'car goal':g.name))+'</p>';}).join('');}
 function itemCard(x){
  var r=x.row,status=x.state==='ready'?'<p class="small cool-ok">'+E(x.kind==='next'?'Payday’s been':x.sourceName+' has '+M(x.has))+' · you can afford it</p>':x.state==='waiting'?'<p class="small cool-wait">'+E(x.kind==='next'?'Waiting for payday on '+B.nice(x.payday):x.kind==='missing'?'Choose where it comes from':x.sourceName+' has '+M(x.has))+'</p>':'<p class="small muted">'+E(x.sourceName)+' · green on '+E(B.nice(x.readyOn))+'</p>';
  var link=/^https?:\/\//i.test(String(r.link||''))?'<p class="small"><a class="linkbtn" style="padding:0;min-height:0" href="'+E(r.link)+'" target="_blank" rel="noopener noreferrer">Open link</a></p>':'';
  var acts=x.state==='ready'?row2(btn('Let it go','coolDrop',x.id)+btn('Still want it','coolCheck',x.id,'primary')):row2(btn('Let it go','coolDrop',x.id)+btn('Add 3 days','coolExtend',x.id));
  return card('<div class="cool-item">'+ring(x)+'<div class="cool-body"><button type="button" class="cool-head" data-a="coolEdit" data-v="'+E(x.id)+'" aria-label="Change '+E(r.name)+'"><strong>'+E(r.name)+'</strong>'+A.num(M(x.price))+'</button>'+status+(r.why?'<p class="small muted cool-why">'+E(r.why)+'</p>':'')+goalLine(x)+link+'</div></div>'+acts,'cool-card'+(x.state==='ready'?' ready':''));
 }
 V.cooldown=function(){
  var v=view(),by={ready:[],cooling:[],waiting:[],done:[]};
  v.items.forEach(function(x){(x.state==='bought'||x.state==='letgo'?by.done:by[x.state]).push(x);});
  by.cooling.sort(function(a,b){return a.readyOn<b.readyOn?-1:1;});by.done.sort(function(a,b){return String(b.row.end||'')<String(a.row.end||'')?-1:1;});
  var html=card('<div class="cool-stats"><div><b>'+v.count.cooling+'</b><span>cooling</span></div><div><b>'+v.count.ready+'</b><span>ready</span></div><div><b>'+M(v.notSpent)+'</b><span>not spent</span></div></div>'+btn('Park something','coolPark',undefined,'wide primary'));
  if(by.ready.length)html+='<h2 class="h2">Ready to buy</h2>'+by.ready.map(itemCard).join('');
  if(by.cooling.length)html+='<h2 class="h2">Cooling</h2>'+by.cooling.map(itemCard).join('');
  if(by.waiting.length)html+='<h2 class="h2">Cooled, waiting for money</h2>'+by.waiting.map(itemCard).join('');
  if(!by.ready.length&&!by.cooling.length&&!by.waiting.length)html+='<p class="empty">Nothing cooling. Next time something grabs you, park it here first.</p>';
  if(by.done.length)html+='<h2 class="h2">History</h2>'+card('<div class="list cool-hist">'+by.done.map(function(x){var r=x.row,go=x.state==='letgo';return A.li(E(r.name),E((go?'Let go':'Bought')+(r.end?' '+B.nice(r.end):'')+(r.rehype?' · excitement '+(r.hype||'?')+' → '+r.rehype:'')),'<span class="num'+(go?' saved':'')+'">'+(go?'+':'')+M(x.price)+'</span>');}).join('')+'</div>');
  return html;
 };

 // ----- parking something (and changing it while it cools)
 function form(d){
  var src=sources(),pick=function(kind){return src.filter(function(s){return s.kind===kind;}).map(function(s){return '<option value="'+E(s.id)+'"'+(s.id===d.source?' selected':'')+'>'+E(srcText(s))+'</option>';}).join('');};
  var known=src.some(function(s){return s.id===d.source;}),days=+d.days||0;
  return '<div class="cool-form"><label class="f" for="coolName">What is it?<input id="coolName" type="text" maxlength="80" value="'+E(d.name||'')+'"></label>'+
   '<div class="cool-grid"><label class="f" for="coolPrice">Price (£)<input id="coolPrice" type="number" inputmode="decimal" min="0" step="0.01" value="'+E(d.price===undefined?'':d.price)+'"></label>'+
   '<label class="f" for="coolDays">Cool for<select id="coolDays">'+DAYS.concat(days&&!DAYS.some(function(x){return x[0]===days;})?[[days,days+' days']]:[]).map(function(x){return '<option value="'+x[0]+'"'+(x[0]===(days||B.coolDays(d.price))?' selected':'')+'>'+x[1]+'</option>';}).join('')+'</select></label></div>'+
   '<label class="f" for="coolSource">Pay from<select id="coolSource">'+(known||!d.source?'':'<option value="'+E(d.source)+'" selected>Not found</option>')+'<optgroup label="Budgets">'+pick('budget')+'</optgroup>'+(src.some(function(s){return s.kind==='saving';})?'<optgroup label="Savings">'+pick('saving')+'</optgroup>':'')+'<optgroup label="Later">'+pick('next')+'</optgroup></select></label>'+
   '<label class="f" for="coolLink">Link (optional)<input id="coolLink" type="url" inputmode="url" placeholder="https://" value="'+E(d.link||'')+'"></label>'+
   '<label class="f" for="coolWhy">Why do you want it?<input id="coolWhy" type="text" maxlength="140" placeholder="One line for future you" value="'+E(d.why||'')+'"></label>'+
   '<label class="f" id="coolHypeLabel">How excited are you?</label><div class="cool-hype" role="group" aria-labelledby="coolHypeLabel">'+[1,2,3,4,5].map(function(n){return '<button type="button" class="chip" data-a="coolHype" data-v="'+n+'" aria-pressed="'+(n===(+d.hype||3))+'">'+n+'</button>';}).join('')+'</div>'+
   '<p class="small muted cool-hint" id="coolHint" aria-live="polite"></p></div>';
 }
 function hint(){
  var el=$('#coolHint');if(!el)return;var p=+($('#coolPrice')||{}).value||0,sel=$('#coolDays'),d=+(sel||{}).value||1,s=sources().filter(function(x){return x.id===($('#coolSource')||{}).value;})[0],t='';
  if(sel&&!S.ui.coolDaysSet&&p>0){sel.value=String(B.coolDays(p));d=+sel.value;}
  if(p>0){t='Green '+(d===1?'tomorrow':'in '+daysText(d))+(s&&s.kind==='next'?', after payday':'')+(d===B.coolDays(p)?' (suggested for its price).':'.');if(s&&s.kind!=='next'&&s.left<p)t+=' '+s.name+' has '+M(s.left)+' now.';}
  var x=s&&s.kind==='saving'&&p>0?B.coolState(db(),me(),now(),{id:'',price:p,source:s.id,days:1}):null;if(x)x.goals.forEach(function(g){t+=g.car?' That’s '+g.share+'% of your car goal.':'';});
  el.textContent=t;
 }
 var touched=function(e){var id=e.target&&e.target.id||'';if(id==='coolDays')S.ui.coolDaysSet=true;if(/^cool/.test(id))hint();};document.addEventListener('input',touched);document.addEventListener('change',touched);
 function openForm(d,id){S.ui.coolHype=+d.hype||3;S.ui.coolDaysSet=!!id;S.ui.coolEditing=id||'';A.openSheet('<h2>'+(id?'Change it':'Park something')+'</h2>'+form(d)+row2(btn('Cancel','sheetclose')+btn(id?'Save':'Start cooling','coolSave',undefined,'primary'))+(id?'<p style="text-align:center;margin:6px 0 0"><button type="button" class="linkbtn" data-a="coolRemove" data-v="'+E(id)+'">Remove it</button></p>':''));hint();}
 ACT.coolPark=function(v){
  var d={},src=sources(),f=S.ui.flowPurchase;
  if(v==='purchase'&&f){d.price=f.amount||'';if(src.some(function(s){return s.id===f.budget;}))d.source=f.budget;}
  if(!d.source){var fun=src.filter(function(s){return s.kind==='budget'&&/fun|ents/i.test(s.name);})[0]||src[0];d.source=fun?fun.id:'next';}
  openForm(d);
 };
 ACT.coolHype=function(v){S.ui.coolHype=+v;document.querySelectorAll('[data-a="coolHype"]').forEach(function(b){b.setAttribute('aria-pressed',String(b.dataset.v===String(v)));});};
 ACT.coolSave=function(){
  var name=$('#coolName').value.trim(),price=B.round(+$('#coolPrice').value),link=$('#coolLink').value.trim(),id=S.ui.coolEditing,old=id?(db().cooldown||[]).filter(function(x){return x.id===id;})[0]:null;
  if(!name){A.toast('Say what it is');$('#coolName').focus();return;}
  if(!(price>0)||price>100000){A.toast('Type the price');$('#coolPrice').focus();return;}
  if(link&&!/^https?:\/\//i.test(link))link='https://'+link;
  var row={id:id||A.newId('cd'),person:me(),name:name,price:price,source:$('#coolSource').value,link:link,why:$('#coolWhy').value.trim(),hype:S.ui.coolHype||3,days:+$('#coolDays').value||B.coolDays(price)};
  if(!old){row.date=now();row.status='cooling';}
  A.put('cooldown',row,true);A.toast(old?'Saved':'Cooling until '+B.nice(B.addDays(old?old.date:now(),row.days)));
  if(S.view.s!=='cooldown')A.go('cooldown');else{A.closeSheet();A.render();}
 };
 ACT.coolEdit=function(id){var r=(db().cooldown||[]).filter(function(x){return x.id===id;})[0];if(!r)return;if(r.status==='bought'||r.status==='letgo')return;openForm(r,id);};
 ACT.coolRemove=function(id){A.closeSheet();A.del('cooldown',id,true);A.toast('Removed',{t:'cooldown',ids:[id],restore:true});A.render();};
 ACT.coolExtend=function(id){var x=item(id);if(!x)return;A.put('cooldown',{id:id,days:x.days+3},true);A.toast('Green on '+B.nice(B.addDays(x.readyOn,3)));A.render();};
 ACT.coolDrop=function(id){var x=item(id);if(!x)return;A.openSheet('<h2>Let go of '+E(x.row.name)+'?</h2><p class="small muted">'+M(x.price)+' goes into not spent.</p>'+row2(btn('Keep cooling','sheetclose')+btn('Let it go','coolDropYes',id,'primary')));};
 ACT.coolDropYes=function(id){var x=item(id);A.closeSheet();if(!x)return;A.put('cooldown',{id:id,status:'letgo',end:now()},true);A.toast('Let go. '+M(x.price)+' not spent');A.render();};
 ACT.coolCheck=function(id){var x=item(id);if(!x||x.state!=='ready'){A.toast('That’s changed. Check it again');A.render();return;}A.openSheet('<h2>Still want it?</h2><p class="small muted">You were '+(x.row.hype||'?')+'/5 excited about '+E(x.row.name)+'. How about now?</p><div class="cool-hype" role="group" aria-label="How excited now">'+[1,2,3,4,5].map(function(n){return '<button type="button" class="chip" data-a="coolRate" data-v="'+E(id)+'|'+n+'">'+n+'</button>';}).join('')+'</div>');};
 ACT.coolRate=function(v){
  var k=String(v).split('|'),id=k[0],n=+k[1],x=item(id);if(!x){A.closeSheet();return;}
  if(!B.coolKeep(x.row.hype,n)){A.closeSheet();A.put('cooldown',{id:id,status:'letgo',rehype:n,end:now()},true);A.toast('Let go. '+M(x.price)+' not spent');A.render();return;}
  A.put('cooldown',{id:id,status:'bought',rehype:n,end:now()},true);A.render();
  // (one sheet straight after another, so the phone's Back still closes it)
  A.openSheet('<h2>Enjoy it</h2><p class="small muted">'+(x.kind==='next'?'Log '+M(x.price)+' when you buy it?':'Log '+M(x.price)+' against '+E(x.sourceName)+'?')+'</p>'+row2(btn('Not now','sheetclose')+btn('Log it','coolLog',id,'primary')));
 };
 // the usual Log it screen, filled in: the amount stays changeable in case the real price was different
 ACT.coolLog=function(id){
  var x=item(id);if(!x){A.closeSheet();return;}var a={mode:'spend',note:x.row.name,date:now()};
  if(x.kind==='budget')a.budget=x.source;
  if(x.kind==='saving'){var b=sources().filter(function(s){return s.kind==='budget';})[0];if(b)a.budget=b.id;a.account=x.source;a.touched={account:true};}
  S.ui.add=a;S.ui.keys=String(x.price);A.go('add');
 };

 // ----- where it shows up: More, Today (beside Can I buy this?) and a purchase check
 var more=V.more;V.more=function(){var html=more(),tile='<button type="button" data-a="go" data-v="cooldown"><span class="ic">'+A.icon('cool',20)+'</span><span style="font-weight:700">Cooldown</span><span class="tiny muted">Wait before you buy</span></button>';return html.replace(/(<button type="button" data-a="go" data-v="gifts">)/,tile+'$1');};
 var today=V.today;V.today=function(){
  var html=today(),n=view().count.ready,b='<button type="button" class="btn ghost" data-a="go" data-v="cooldown"'+(n?' aria-label="Cooldown, '+n+' ready"':'')+'>Cooldown'+(n?'<span class="cool-badge">'+n+'</span>':'')+'</button>';
  var box=document.createElement('div');box.innerHTML=html;var buy=box.querySelector('#c-budget [data-v="purchase"]');
  if(buy&&buy.parentNode){buy.parentNode.classList.add('two','fit');buy.insertAdjacentHTML('afterend',b);return box.innerHTML;}
  return html;
 };
 var purchase=V.purchase;if(purchase)V.purchase=function(){var html=purchase(),res=S.ui.flowPurchaseResult||'';return /flow-amount/.test(res)?html+row2(btn('Park it in Cooldown','coolPark','purchase','primary'))+'':html;};
}};})();
