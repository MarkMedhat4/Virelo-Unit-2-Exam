const vm = require('vm'), fs = require('fs'), crypto = require('crypto');
const src = fs.readFileSync(require('path').join(__dirname,'..','google-apps-script','Code.gs'),'utf8');

// ---------- in-memory Google Sheets ----------
class Sheet {
  constructor(name){ this.name=name; this.data=[]; }
  getLastRow(){ let l=0; this.data.forEach((r,i)=>{ if(r && r.some(v=>v!==''&&v!==undefined)) l=i+1; }); return l; }
  getLastColumn(){ return this.data.reduce((m,r)=>Math.max(m,r?r.length:0),0)||1; }
  getMaxColumns(){ return 40; }
  _cell(r,c){ return (this.data[r-1]||[])[c-1]; }
  _set(r,c,v){ while(this.data.length<r) this.data.push([]); const row=this.data[r-1]; while(row.length<c) row.push(''); row[c-1]=v; }
  getRange(r,c,nr=1,nc=1){
    const s=this;
    if(typeof r==='string') return new Proxy({}, {get:()=>()=>new Proxy(function(){}, {get:()=>()=>({}),apply:()=>({})})});
    const rg = {
      getValues(){ const out=[]; for(let i=0;i<nr;i++){ const row=[]; for(let j=0;j<nc;j++){ const v=s._cell(r+i,c+j); row.push(v===undefined?'':v);} out.push(row);} return out; },
      setValues(vals){ vals.forEach((row,i)=>row.forEach((v,j)=>s._set(r+i,c+j,v))); return rg; },
      setValue(v){ s._set(r,c,v); return rg; },
      setNumberFormat(){ return rg; },
      createTextFinder(t){ let entire=false, cs=false; const f={ matchEntireCell(b){entire=b;return f;}, matchCase(b){cs=b;return f;},
        findNext(){ for(let i=0;i<nr;i++) for(let j=0;j<nc;j++){ const v=String(s._cell(r+i,c+j)??''); if(v===t) return { getRow:()=>r+i }; } return null; } }; return f; },
      setBackground(){return rg;}, setFontColor(){return rg;}, setFontWeight(){return rg;}, setHorizontalAlignment(){return rg;}, setVerticalAlignment(){return rg;}, setWrap(){return rg;}, setDataValidation(){return rg;}
    };
    return rg;
  }
  setFrozenRows(){} setRowHeight(){} setColumnWidth(){} insertColumnsAfter(){} hideColumns(){}
}
const sheets = {};
const ss = { getSheetByName:n=>sheets[n]||null, insertSheet:n=>sheets[n]=new Sheet(n), getSheets:()=>Object.values(sheets), deleteSheet(){} };
let skew = 0; const RealDate = Date;
const cacheStore = {};
const sandbox = {
  console, Logger:{log:()=>{}},
  SpreadsheetApp:{ getActiveSpreadsheet:()=>ss, openById:()=>ss, newDataValidation:()=>({requireValueInList(){return this;},setAllowInvalid(){return this;},build(){return {};}}), getUi:()=>{throw new Error('no ui');} },
  LockService:{ getScriptLock:()=>({ tryLock:()=>true, releaseLock(){} }) },
  CacheService:{ getScriptCache:()=>({ get:k=>cacheStore[k]||null, put:(k,v)=>{cacheStore[k]=v}, remove:k=>{delete cacheStore[k]} }) },
  Utilities:{ getUuid:()=>crypto.randomUUID(), computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s).digest()].map(b=>b>127?b-256:b),
    DigestAlgorithm:{SHA_256:1}, Charset:{UTF_8:1} },
  ContentService:{ createTextOutput:t=>({ t, setMimeType(){return this;} }), MimeType:{JSON:1} },
  Date: class extends RealDate { constructor(...a){ if(a.length===0) super(RealDate.now()+skew); else super(...a); } static now(){ return RealDate.now()+skew; } }
};
vm.createContext(sandbox); vm.runInContext(src, sandbox);

const http=require('http');
vm.runInContext('initializeDatabase()', sandbox);
const q=sheets['Questions'];
for(let i=1;i<=8;i++){ q.data.push(['T'+i,'سؤال تجريبي رقم '+i+' (اختبار آلي فقط)', i%4===0?'TF':'MCQ', i%4===0?'':'الخيار الأول|الخيار الثاني|الخيار الثالث|الخيار الرابع', i%4===0?'صح':'B', i%2?1:2,'','']); }
http.createServer((req,res)=>{
  let b=''; req.on('data',d=>b+=d); req.on('end',()=>{
    res.setHeader('Access-Control-Allow-Origin','*');
    if(req.url.startsWith('/__eval')){ const out=vm.runInContext(decodeURIComponent(req.url.split('?code=')[1]),sandbox); res.end(JSON.stringify({out})); return; }
    if(req.url.startsWith('/__advance')){ skew+=parseInt(req.url.split('=')[1]); res.end('{}'); return; }
    const o=vm.runInContext('doPost',sandbox)({postData:{contents:b}}); res.setHeader('Content-Type','application/json'); res.end(o.t);
  });
}).listen(8787,()=>console.log('mock api up'));
