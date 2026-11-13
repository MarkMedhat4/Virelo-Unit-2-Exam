import json, urllib.request, re, sys, os
from playwright.sync_api import sync_playwright
BASE='http://localhost:8000/'; API='https://script.google.com/macros/s/TEST/exec'
res=[]; 
def check(c,m):
    res.append((c,m)); print(('PASS ' if c else 'FAIL ')+m)
def forward(route):
    body=route.request.post_data or '{}'
    r=urllib.request.urlopen(urllib.request.Request('http://localhost:8787',data=body.encode(),method='POST'))
    route.fulfill(status=200,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=r.read().decode())
def setup(ctx):
    ctx.route(re.compile(r'fonts\.(googleapis|gstatic)\.com'),lambda r:r.abort())
    ctx.route(API,forward)
    def cfg(route):
        txt=open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','js','config.js')).read().replace('PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE',API)
        route.fulfill(status=200,content_type='application/javascript',body=txt)
    ctx.route('**/js/config.js',cfg)
def ev(code): return json.load(urllib.request.urlopen('http://localhost:8787/__eval?code='+urllib.parse.quote(code)))
import urllib.parse
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={'width':1280,'height':800},locale='ar-EG'); setup(ctx)
    pg=ctx.new_page(); errs=[]
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('console',lambda m: errs.append(m.text) if m.type=='error' and 'fonts' not in m.text and 'ERR_FAILED' not in m.text else None)
    pg.goto(BASE); pg.wait_for_selector('#screen-register:not([hidden])')
    check(pg.is_visible('#screen-register'),'registration screen shows first')
    check('8 سؤال' in pg.inner_text('#pill-questions-text'),'question count pill from server')
    pg.wait_for_timeout(700); pg.screenshot(path='/tmp/s_register.png')
    # validation
    pg.click('#btn-start'); check('الاسم' in pg.inner_text('#e-name'),'empty name error')
    pg.fill('#f-name','أحمد محمد علي'); pg.fill('#f-phone','0123'); pg.click('#btn-start')
    check('غير صحيح' in pg.inner_text('#e-phone'),'bad phone error')
    pg.fill('#f-phone','٠١٠١٢٣٤٥٦٧٨'); check(pg.input_value('#f-phone')=='01012345678','arabic digits converted live')
    pg.click('#btn-start'); pg.wait_for_selector('#screen-exam:not([hidden])')
    check(pg.is_visible('#timer'),'exam opened')
    t=pg.inner_text('#timer-text'); check(t in ('30:00','29:59','29:58'),'timer starts ~30:00 -> '+t)
    check(pg.inner_text('#st-total')=='8','total questions 8')
    pg.wait_for_timeout(700); pg.screenshot(path='/tmp/s_exam.png')
    # answer Q1 B, go next, answer Q2 C
    pg.click('.option:nth-child(2)'); check(pg.inner_text('#st-answered')=='1','answered count 1')
    pg.click('#btn-next'); pg.click('.option:nth-child(3)'); check(pg.inner_text('#st-answered')=='2','answered count 2')
    check(pg.locator('.nav-btn.answered').count()==2,'nav shows 2 answered')
    pg.wait_for_timeout(1800)
    check('تم حفظ' in pg.inner_text('#save-state'),'autosave indicator ok')
    # refresh recovery
    pg.wait_for_timeout(500); pg.reload(); pg.wait_for_selector('#screen-exam:not([hidden])')
    check(pg.inner_text('#st-answered')=='2','answers restored after refresh')
    t2=pg.inner_text('#timer-text'); check(t2<=t and t2!='30:00','timer not reset after refresh '+t2)
    check(pg.locator('.q-number .n').inner_text()=='02','returns to same question')
    # TF question (4th) renders 2 options
    pg.click('.nav-btn:nth-child(4)'); check(pg.locator('.option').count()==2,'TF has 2 options')
    # submit modal
    pg.click('#btn-submit'); check(pg.is_visible('#modal-submit'),'confirm modal')
    check(pg.inner_text('#m-answered')=='2' and pg.inner_text('#m-unanswered')=='6','modal counts')
    pg.wait_for_timeout(700); pg.screenshot(path='/tmp/s_modal.png')
    pg.click('#m-cancel'); check(not pg.is_visible('#modal-submit'),'return to exam')
    pg.click('#btn-submit'); pg.click('#m-confirm'); pg.wait_for_selector('#screen-result:not([hidden])')
    check(pg.inner_text('#res-name')=='أحمد محمد علي','results name')
    check(pg.inner_text('#res-correct')=='1' and pg.inner_text('#res-incorrect')=='1' and pg.inner_text('#res-unanswered')=='6','results counts 1/1/6')
    print('score',pg.inner_text('#res-score'),'/',pg.inner_text('#res-total'),pg.inner_text('#res-pct'))
    check(not pg.is_visible('#btn-review'),'review hidden when disabled')
    pg.wait_for_timeout(1500); pg.screenshot(path='/tmp/s_result.png',full_page=True)
    pg.reload(); pg.wait_for_selector('#screen-result:not([hidden])'); check(True,'results persist after refresh')
    # duplicate: new context same phone
    ctx2=b.new_context(viewport={'width':1280,'height':800}); setup(ctx2); p2=ctx2.new_page(); p2.goto(BASE); p2.wait_for_selector('#screen-register:not([hidden])')
    p2.fill('#f-name','أحمد محمد علي'); p2.fill('#f-phone','01012345678'); p2.click('#btn-start'); p2.wait_for_selector('#reg-notice:not([hidden])')
    check('المحاولات' in p2.inner_text('#reg-notice-text'),'second attempt blocked on same phone')
    # timeout auto-submit
    ev('CONFIG.DURATION_SECONDS=6')
    ctx3=b.new_context(viewport={'width':390,'height':780},is_mobile=True,has_touch=True); setup(ctx3); p3=ctx3.new_page()
    p3.goto(BASE); p3.wait_for_selector('#screen-register:not([hidden])')
    p3.fill('#f-name','منى خالد حسن'); p3.fill('#f-phone','01512345678'); p3.click('#btn-start'); p3.wait_for_selector('#screen-exam:not([hidden])')
    p3.click('.option:nth-child(2)')
    check(p3.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'mobile: no horizontal scroll (exam)')
    p3.wait_for_timeout(700); p3.screenshot(path='/tmp/s_mobile_exam.png')
    p3.click('#btn-sheet'); p3.wait_for_timeout(400); check(p3.is_visible('#nav-grid'),'mobile question sheet opens'); p3.screenshot(path='/tmp/s_mobile_sheet.png')
    p3.wait_for_selector('#screen-result:not([hidden])',timeout=20000)
    check('تلقائيًا' in p3.inner_text('#res-meta'),'auto-submit on timeout')
    check(p3.inner_text('#res-correct')=='1','timeout: answer was counted ('+p3.inner_text('#res-correct')+')')
    check(p3.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'mobile: no horizontal scroll (results)')
    p3.wait_for_timeout(700); p3.screenshot(path='/tmp/s_mobile_result.png',full_page=True)
    # mobile register
    ctx4=b.new_context(viewport={'width':390,'height':780},is_mobile=True); setup(ctx4); p4=ctx4.new_page(); p4.goto(BASE); p4.wait_for_selector('#screen-register:not([hidden])')
    check(p4.evaluate('document.documentElement.scrollWidth<=window.innerWidth'),'mobile: no horizontal scroll (register)'); p4.screenshot(path='/tmp/s_mobile_reg.png')
    check(not errs,'no JS errors: '+str(errs[:3]))
    b.close()
bad=[m for c,m in res if not c]; print('\n',len(res)-len(bad),'passed',len(bad),'failed'); sys.exit(1 if bad else 0)
