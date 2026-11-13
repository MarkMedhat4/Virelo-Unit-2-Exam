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
let now = Date.now();
const cacheStore = {};
const sandbox = {
  console, Logger:{log:()=>{}},
  SpreadsheetApp:{ getActiveSpreadsheet:()=>ss, openById:()=>ss, newDataValidation:()=>({requireValueInList(){return this;},setAllowInvalid(){return this;},build(){return {};}}), getUi:()=>{throw new Error('no ui');} },
  LockService:{ getScriptLock:()=>({ tryLock:()=>true, releaseLock(){} }) },
  CacheService:{ getScriptCache:()=>({ get:k=>cacheStore[k]||null, put:(k,v)=>{cacheStore[k]=v}, remove:k=>{delete cacheStore[k]} }) },
  Utilities:{ getUuid:()=>crypto.randomUUID(), computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s).digest()].map(b=>b>127?b-256:b),
    DigestAlgorithm:{SHA_256:1}, Charset:{UTF_8:1} },
  ContentService:{ createTextOutput:t=>({ t, setMimeType(){return this;} }), MimeType:{JSON:1} },
  Date: class extends Date { constructor(...a){ if(a.length===0) super(now); else super(...a); } static now(){ return now; } }
};
vm.createContext(sandbox); vm.runInContext(src, sandbox);
const call = body => JSON.parse(vm.runInContext('doPost', sandbox)({postData:{contents:JSON.stringify(body)}}).t);

let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;} else {fail++; console.log('FAIL:',m);} };

// init + questions
vm.runInContext('initializeDatabase()', sandbox);
const q = sheets['Questions'];
// test-only dummy rows (NOT real exam content)
q.data.push(['T1','نص تجريبي 1','MCQ','خيار 1|خيار 2|خيار 3|خيار 4','B',2,'شرح 1','']);
q.data.push(['T2','نص تجريبي 2','TF','','صح',1,'','']);
q.data.push(['T3','نص تجريبي 3','MCQ','a\nb\nc','3',3,'','']);

let r = call({action:'config'}); ok(r.ok && r.totalQuestions===3 && r.isOpen, 'config');
r = call({action:'start', fullName:'', phone:''}); ok(r.code==='VALIDATION','empty rejected');
r = call({action:'start', fullName:'أحمد', phone:'01012345678'}); ok(r.code==='VALIDATION','one-word name rejected');
r = call({action:'start', fullName:'أحمد محمد', phone:'0123'}); ok(r.code==='VALIDATION','bad phone');
r = call({action:'start', fullName:'أحمد 123', phone:'01012345678'}); ok(r.code==='VALIDATION','digits in name rejected');
r = call({action:'start', fullName:'أحمد محمد علي', phone:'٠١٠١٢٣٤٥٦٧٨'}); ok(r.ok && r.attemptId, 'start w/ arabic digits');
const A = r; 
ok(!JSON.stringify(r).includes('"correct"') && !JSON.stringify(r).includes('شرح 1'), 'no answer key / explanation leaked in start');
ok(r.questions.length===3 && r.questions[1].options[0].text==='صح', 'TF default options');
ok(r.endTime - r.startTime === 1800000, 'deadline 30m');

// phone stored with leading zero
ok(String(sheets['Students'].data[1][2])==='01012345678','phone normalized & stored');

// bad token
r = call({action:'save', attemptId:A.attemptId, token:'x', answers:{}}); ok(r.code==='UNAUTHORIZED','bad token');

// resume with same name; duplicate prevention with other name
r = call({action:'start', fullName:'أحمد محمد علي', phone:'+201012345678'}); ok(r.ok && r.resumed && r.attemptId===A.attemptId,'resume same attempt');
const tok = r.token;
r = call({action:'save', attemptId:A.attemptId, token:A.token, answers:{T1:'B'}}); ok(r.code==='UNAUTHORIZED','old token rotated out');
r = call({action:'start', fullName:'محمود سعيد', phone:'01012345678'}); ok(r.code==='ATTEMPT_IN_PROGRESS','other name blocked');

// autosave + state
r = call({action:'save', attemptId:A.attemptId, token:tok, answers:{T1:'B', T2:'Z', FAKE:'A'}}); ok(r.ok && !r.expired,'save');
r = call({action:'state', attemptId:A.attemptId, token:tok}); ok(r.ok && r.answers.T1==='B' && !r.answers.T2 && !r.answers.FAKE,'state restores sanitized draft');
ok(r.endTime===A.endTime,'deadline unchanged after resume');

// submit with tampered extras (client score ignored)
r = call({action:'submit', attemptId:A.attemptId, token:tok, answers:{T1:'B', T2:'B', T3:'C'}, score:999, percentage:100});
ok(r.ok && r.score===5 && r.totalMarks===6 && r.correct===2 && r.incorrect===1 && r.unanswered===0, 'server grading: '+JSON.stringify(r));
ok(r.percentage===83.33,'percentage '+r.percentage);
ok(!r.review,'no review when disabled');
// duplicate submit returns stored result; no extra answer rows
const rowsBefore = sheets['Student Answers'].getLastRow();
const r2 = call({action:'submit', attemptId:A.attemptId, token:tok, answers:{T1:'A',T2:'A',T3:'A'}});
ok(r2.ok && r2.alreadySubmitted && r2.score===5,'duplicate submit idempotent');
ok(sheets['Student Answers'].getLastRow()===rowsBefore && rowsBefore===4,'no duplicate answer rows');
r = call({action:'save', attemptId:A.attemptId, token:tok, answers:{T1:'A'}}); ok(r.locked,'save after submit is locked');
r = call({action:'result', attemptId:A.attemptId, token:tok}); ok(r.ok && r.score===5,'result retrieval');

// max attempts
r = call({action:'start', fullName:'أحمد محمد علي', phone:'01012345678'}); ok(r.code==='LIMIT_REACHED','max attempts enforced');

// timeout: use last saved draft, ignore late payload
r = call({action:'start', fullName:'منى خالد حسن', phone:'01512345678'}); const B=r; ok(r.ok,'second student');
call({action:'save', attemptId:B.attemptId, token:B.token, answers:{T1:'B'}});
now += 1800*1000 + 60*1000; // 1 min past deadline (grace is 20s)
r = call({action:'submit', attemptId:B.attemptId, token:B.token, answers:{T1:'A',T2:'A',T3:'C'}, reason:'timeout'});
ok(r.ok && r.status==='AUTO_SUBMITTED' && r.score===2 && r.unanswered===2,'late submit uses saved draft only: '+JSON.stringify(r));

// expired & never submitted -> finalized on restart
now += 10; r = call({action:'start', fullName:'سلمى علي حسن', phone:'01112345678'}); const C2=r;
now += 1800*1000+1000;
r = call({action:'save', attemptId:C2.attemptId, token:C2.token, answers:{T1:'B'}}); ok(r.expired,'save after deadline reports expired');
r = call({action:'state', attemptId:C2.attemptId, token:C2.token}); ok(r.ok && r.submitted && r.status==='AUTO_SUBMITTED','state finalizes expired attempt');

// invalid bank is blocked
q.data.push(['T4','سؤال بدون إجابة','MCQ','a|b','',1,'','']);
vm.runInContext('clearCache()', sandbox);
r = call({action:'start', fullName:'يوسف أحمد كمال', phone:'01212345678'}); ok(r.code==='BANK_INVALID','invalid bank blocks start');
q.data.pop(); vm.runInContext('clearCache()', sandbox);

// availability
vm.runInContext('CONFIG.EXAM_OPEN=false', sandbox);
r = call({action:'start', fullName:'يوسف أحمد كمال', phone:'01212345678'}); ok(r.code==='EXAM_CLOSED','closed exam');
vm.runInContext('CONFIG.EXAM_OPEN=true; CONFIG.SHOW_REVIEW_AFTER_SUBMIT=true', sandbox);
r = call({action:'result', attemptId:A.attemptId, token:tok}); ok(r.review && r.review[0].correctAnswer==='B' && r.review[0].explanation==='شرح 1','review when enabled');

r = call({action:'nope'}); ok(r.code==='BAD_REQUEST','unknown action');
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail?1:0);
