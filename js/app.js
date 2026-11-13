/* ==========================================================
   app.js — Bootstrap, API client, registration, session recovery
   ========================================================== */
(function () {
  'use strict';

  const C = window.VIRELO_CONFIG;
  const $ = function (id) { return document.getElementById(id); };
  const SCREENS = ['loading', 'register', 'exam', 'result', 'fatal'];

  /* ---------- Local storage (with in-memory fallback) ---------- */
  let mem = null;
  const Storage = {
    load: function () {
      try { const v = localStorage.getItem(C.STORAGE_KEY); return v ? JSON.parse(v) : mem; }
      catch (_) { return mem; }
    },
    save: function (patch) {
      const next = Object.assign({}, Storage.load() || {}, patch);
      mem = next;
      try { localStorage.setItem(C.STORAGE_KEY, JSON.stringify(next)); } catch (_) { /* private mode */ }
    },
    clear: function () { mem = null; try { localStorage.removeItem(C.STORAGE_KEY); } catch (_) { /* ignore */ } }
  };

  /* ---------- Server-synchronised clock ---------- */
  let clockOffset = (Storage.load() || {}).clockOffset || 0;
  function now() { return Date.now() + clockOffset; }

  /* ---------- API client ---------- */
  function ApiError(code, message) { this.code = code; this.message = message; }
  ApiError.prototype = Object.create(Error.prototype);

  function isConfigured() { return /^https:\/\/script\.google(usercontent)?\.com\//.test(C.API_URL); }

  async function api(action, payload, opts) {
    opts = opts || {};
    if (!isConfigured()) throw new ApiError('NOT_CONFIGURED', 'لم يتم ربط الامتحان بالخادم بعد.');
    const ctrl = new AbortController();
    const timer = setTimeout(function () { ctrl.abort(); }, opts.timeoutMs || 25000);
    const t0 = Date.now();
    let res, data;
    try {
      // text/plain avoids a CORS pre-flight, which Apps Script does not support
      res = await fetch(C.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action }, payload || {})),
        signal: ctrl.signal,
        redirect: 'follow'
      });
      data = await res.json();
    } catch (_) {
      throw new ApiError('NETWORK', 'تعذر الاتصال بالخادم. تحقق من الإنترنت وحاول مرة أخرى.');
    } finally { clearTimeout(timer); }

    if (data && typeof data.serverNow === 'number') {
      clockOffset = data.serverNow - (t0 + Date.now()) / 2;
      Storage.save({ clockOffset: clockOffset });
    }
    if (!data || data.ok !== true) {
      throw new ApiError((data && data.code) || 'SERVER_ERROR', (data && data.message) || 'حدث خطأ غير متوقع.');
    }
    return data;
  }

  /* ---------- UI helpers ---------- */
  function showScreen(name) {
    SCREENS.forEach(function (s) { const n = $('screen-' + s); if (n) n.hidden = s !== name; });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function toast(text, type, iconId) {
    const box = $('toasts');
    const t = document.createElement('div');
    t.className = 'toast' + (type === 'danger' ? ' danger' : '');
    t.setAttribute('role', 'status');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'icon');
    const use = document.createElementNS(ns, 'use'); use.setAttribute('href', '#i-' + (iconId || 'info'));
    svg.appendChild(use); t.appendChild(svg);
    t.appendChild(document.createTextNode(text));
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, 6000);
  }

  function fatal(title, text, retry) {
    $('fatal-title').textContent = title;
    $('fatal-text').textContent = text;
    $('btn-fatal-retry').onclick = retry || function () { location.reload(); };
    showScreen('fatal');
  }

  /* ---------- Validation (mirrors the server; the server is the authority) ---------- */
  function toLatinDigits(s) {
    return String(s).replace(/[\u0660-\u0669]/g, function (d) { return d.charCodeAt(0) - 0x0660; })
                    .replace(/[\u06F0-\u06F9]/g, function (d) { return d.charCodeAt(0) - 0x06F0; });
  }
  function validateName(raw) {
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!name) return { error: 'الرجاء إدخال الاسم بالكامل.' };
    if (name.length > 80) return { error: 'الاسم طويل جدًا.' };
    if (!/^[\p{L}\p{M}][\p{L}\p{M}\s'.\-]*$/u.test(name)) return { error: 'الاسم يجب أن يحتوي على حروف عربية أو إنجليزية فقط.' };
    if (name.split(' ').filter(function (p) { return p.length >= 2; }).length < 2) return { error: 'الرجاء كتابة الاسم الأول والثاني على الأقل.' };
    return { value: name };
  }
  function validatePhone(raw) {
    let p = toLatinDigits(raw || '').replace(/[\s\-().]/g, '');
    if (!p) return { error: 'الرجاء إدخال رقم الهاتف.' };
    if (p.indexOf('+20') === 0) p = '0' + p.substring(3);
    else if (p.indexOf('0020') === 0) p = '0' + p.substring(4);
    else if (/^20\d{10}$/.test(p)) p = '0' + p.substring(2);
    if (!/^01[0125]\d{8}$/.test(p)) return { error: 'رقم الهاتف غير صحيح. مثال: 01012345678' };
    return { value: p };
  }

  function setFieldError(inputId, errId, msg) {
    $(errId).textContent = msg || '';
    $(inputId).setAttribute('aria-invalid', msg ? 'true' : 'false');
  }
  function regNotice(msg) {
    $('reg-notice').hidden = !msg;
    $('reg-notice-text').textContent = msg || '';
  }

  /* ---------- Registration ---------- */
  function setupRegistration(cfg) {
    if (cfg) {
      $('exam-title').textContent = cfg.examTitle || C.EXAM_TITLE;
      $('pill-duration').textContent = Math.round(cfg.durationSeconds / 60) + ' دقيقة';
      if (cfg.totalQuestions > 0) {
        $('pill-questions').hidden = false;
        $('pill-questions-text').textContent = cfg.totalQuestions + ' سؤال';
      }
      if (!cfg.isOpen) { regNotice(cfg.closedMessage || 'الامتحان غير متاح حاليًا.'); $('btn-start').disabled = true; }
    }

    const nameEl = $('f-name'), phoneEl = $('f-phone');
    nameEl.addEventListener('input', function () { setFieldError('f-name', 'e-name', ''); });
    phoneEl.addEventListener('input', function () {
      phoneEl.value = toLatinDigits(phoneEl.value);
      setFieldError('f-phone', 'e-phone', '');
    });

    $('reg-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      regNotice('');
      const n = validateName(nameEl.value), p = validatePhone(phoneEl.value);
      setFieldError('f-name', 'e-name', n.error); setFieldError('f-phone', 'e-phone', p.error);
      if (n.error) { nameEl.focus(); return; }
      if (p.error) { phoneEl.focus(); return; }
      nameEl.value = n.value; phoneEl.value = p.value;

      const btn = $('btn-start');
      btn.disabled = true; $('btn-start-text').textContent = 'جاري التحضير…';
      try {
        const d = await api('start', { fullName: n.value, phone: p.value }, { timeoutMs: 40000 });
        Storage.clear();
        Storage.save({
          attemptId: d.attemptId, token: d.token, studentName: d.studentName, examTitle: d.examTitle,
          endTime: d.endTime, startTime: d.startTime, questions: d.questions, answers: d.answers || {},
          index: 0, clockOffset: clockOffset
        });
        window.VireloExam.begin(d);
        if (d.resumed) toast('تم استئناف محاولتك السابقة، والوقت لم يُعاد ضبطه.', 'gold', 'info');
      } catch (err) {
        if (err.code === 'VALIDATION') {
          const isPhone = /هاتف|رقم/.test(err.message);
          setFieldError(isPhone ? 'f-phone' : 'f-name', isPhone ? 'e-phone' : 'e-name', err.message);
        } else {
          regNotice(err.message);
        }
      } finally {
        btn.disabled = false; $('btn-start-text').textContent = 'ابدأ الامتحان';
      }
    });
  }

  /* ---------- Session recovery after refresh ---------- */
  async function restore(saved) {
    const common = {
      attemptId: saved.attemptId, token: saved.token, studentName: saved.studentName,
      examTitle: saved.examTitle, endTime: saved.endTime, index: saved.index
    };
    // Submission was in flight when the page closed: finish it first (server is idempotent).
    if (saved.pendingSubmit && saved.questions) {
      window.VireloExam.resumePendingSubmit(Object.assign({}, common, {
        questions: saved.questions, answers: saved.answers || {}, reason: saved.reason
      }));
      return;
    }
    try {
      const s = await api('state', { attemptId: saved.attemptId, token: saved.token });
      if (s.submitted) { onSubmitted(s); return; }
      // The device copy is the newest (it is written on every change); the server draft is the fallback.
      const answers = saved.answers ? saved.answers : (s.answers || {});
      Storage.save({ answers: answers, questions: s.questions, endTime: s.endTime });
      window.VireloExam.begin(Object.assign({}, common, {
        endTime: s.endTime, questions: s.questions, answers: answers, studentName: s.studentName, examTitle: s.examTitle
      }));
    } catch (err) {
      if (err.code === 'NETWORK' && saved.questions && saved.endTime) {
        // Offline recovery from the local copy; auto-save will sync when the network returns.
        window.VireloExam.begin(Object.assign({}, common, { questions: saved.questions, answers: saved.answers || {} }));
        toast('أنت غير متصل حاليًا. سنزامن إجاباتك عند عودة الاتصال.', 'danger', 'alert');
      } else if (err.code === 'NETWORK') {
        fatal('تعذر الاتصال', err.message, boot);
      } else {
        resetSession(err.code === 'UNAUTHORIZED' ? 'انتهت الجلسة. يرجى البدء من جديد.' : '');
      }
    }
  }

  function onSubmitted(result) {
    window.onbeforeunload = null;
    Storage.save({ result: result, pendingSubmit: false, answers: null, questions: null });
    window.VireloResults.show(result);
  }

  function resetSession(message) {
    Storage.clear();
    boot().then(function () { if (message) regNotice(message); });
  }

  /* ---------- Boot ---------- */
  let registrationBound = false;
  async function boot() {
    showScreen('loading');
    if (!isConfigured()) {
      fatal('الإعداد غير مكتمل',
        'لم يتم ربط الامتحان بالخادم بعد. يرجى من المشرف إضافة رابط Apps Script في الملف js/config.js.');
      $('btn-fatal-retry').hidden = true;
      return;
    }
    $('btn-fatal-retry').hidden = false;

    const saved = Storage.load();
    if (saved && saved.attemptId && saved.token) {
      if (saved.result && !saved.pendingSubmit) {
        // Show instantly, then confirm against the server in the background.
        window.VireloResults.show(saved.result);
        api('result', { attemptId: saved.attemptId, token: saved.token })
          .then(function (r) { Storage.save({ result: r }); window.VireloResults.show(r); })
          .catch(function () { /* keep local copy */ });
        return;
      }
      await restore(saved);
      return;
    }

    let cfg = null;
    try { cfg = await api('config'); }
    catch (err) { fatal('تعذر تحميل الامتحان', err.message, boot); return; }

    if (!registrationBound) { setupRegistration(cfg); registrationBound = true; }
    else if (cfg) { $('btn-start').disabled = !cfg.isOpen; }
    showScreen('register');
    $('f-name').focus({ preventScroll: true });
  }

  window.VireloApp = {
    api: api, Storage: Storage, now: now, showScreen: showScreen, toast: toast,
    onSubmitted: onSubmitted, resetSession: resetSession
  };

  document.addEventListener('DOMContentLoaded', boot);
})();
