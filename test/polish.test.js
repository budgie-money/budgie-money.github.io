const fs=require('fs'),vm=require('vm'),assert=require('assert');
let vars={};const c={window:{},document:{documentElement:{style:{setProperty:(k,v)=>vars[k]=v}},body:{classList:{toggle(){}}},querySelector(){return null}},matchMedia:()=>({matches:false})};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('themes.js','utf8'),c);
const T=c.BudgieThemes;
const lum=h=>{const a=h.replace('#','').match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;};
const ratio=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
let checks=0;
for(const theme of [...Object.keys(T.COLOURS).flatMap(colour=>['light','dark'].map(mode=>({colour,mode}))),...Object.keys(T.SPECIAL).map(special=>({special}))]){
 vars={};T.apply(theme);
 for(const [fg,bg]of[['ink','card'],['muted','card'],['hero-ink','hero'],['accent-ink','accent'],['warn','card'],['bad','card'],['ink','soft']]){const r=ratio(vars['--'+fg],vars['--'+bg]);assert(r>=4.5,JSON.stringify(theme)+' '+fg+'/'+bg+' contrast '+r.toFixed(2));checks++;}
}
assert(T.SPECIAL.dragon.vars.bg==='#0C0C0E'&&T.SPECIAL.dragon.vars.accent==='#E2BC61');
assert(T.SPECIAL.hyperspace&&T.SPECIAL.winter&&T.SPECIAL.nebula);
console.log('All '+checks+' theme contrast checks passed; 20 looks across light, dark and special themes.');
