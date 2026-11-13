/* ==========================================================
   exam.js — Exam interface
   Rendering, navigation, auto-save, timer wiring, submission.
   Uses DOM APIs (textContent) for all exam content: no HTML
   injection is possible from the question bank.
   ========================================================== */
(function () {
  'use strict';

  const C = window.VIRELO_CONFIG;
  const $ = function (id) { return document.getElementById(id); };
  const app = function () { return window.VireloApp; };
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  let S = null;            // current exam state
  let bannerTimer = null;

  /* ---------- tiny DOM helpers ---------- */
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function icon(id, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'icon' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + id);
    svg.appendChild(use);
    return svg;
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function safeImageUrl(u) {
    if (!u) return '';
    return /^(https:\/\/|assets\/|\.\/assets\/|data:image\/)/i.test(u) ? u : '';
  }

  /* ---------- Public: start / resume ---------- */
  function begin(d) {
    S = {
      attemptId: d.attemptId,
      token: d.token,
      name: d.studentName,
      examTitle: d.examTitle || C.EXAM_TITLE,
      endTime: d.endTime,
      questions: d.questions || [],
      answers: Object.assign({}, d.answers || {}),
      index: 0,
      dirty: false, saving: false, submitting: false,
      saveTimer: null, periodic: null, countdown: null,
      lastReason: 'manual'
    };
    S.index = Math.min(Math.max(parseInt(d.index, 10) || 0, 0), Math.max(S.questions.length - 1, 0));

    $('hdr-exam').textContent = S.examTitle;
    $('hdr-student').textContent = S.name;
    $('st-total').textContent = S.questions.length;

    app().showScreen('exam');
    renderAll(false);
    bindControls();
    startTimer();
    S.periodic = setInterval(function () { if (S.dirty) flushSave(); }, C.AUTOSAVE_INTERVAL_MS);
    window.addEventListener('beforeunload', onBeforeUnload);
  }

  /** Called after a refresh when a submission was in flight. */
  function resumePendingSubmit(d) {
    begin(d);
    submit(d.reason || 'timeout');
  }

  function onBeforeUnload(e) {
    if (S && !S.submitting) { e.preventDefault(); e.returnValue = ''; return ''; }
  }

  /* ---------- Rendering ---------- */
  function renderAll(animate) {
    renderQuestion(animate);
    renderNav();
    updateStats();
  }

  function answeredCount() {
    return S.questions.filter(function (q) { return !!S.answers[q.id]; }).length;
  }

  function renderQuestion(animate) {
    const q = S.questions[S.index];
    const card = $('q-card');
    card.replaceChildren();
    if (!q) return;

    // header
    const head = el('div', 'q-head');
    const num = el('div', 'q-number');
    num.appendChild(el('span', 'n num', pad2(S.index + 1)));
    num.appendChild(el('span', 'of', '/ ' + S.questions.length));
    const meta = el('div', 'q-meta');
    meta.appendChild(el('span', 'tag', q.type === 'TF' ? 'صح أو خطأ' : 'اختيار من متعدد'));
    const mk = el('span', 'tag gold');
    mk.appendChild(document.createTextNode('الدرجة: '));
    mk.appendChild(el('span', 'num', String(q.marks)));
    meta.appendChild(mk);
    head.append(num, meta);
    card.appendChild(head);
    card.appendChild(el('hr', 'q-divider'));

    // text + optional image
    const t = el('h2', 'q-text', q.text);
    t.id = 'q-text';
    card.appendChild(t);
    const img = safeImageUrl(q.image);
    if (img) {
      const im = el('img', 'q-image');
      im.src = img; im.alt = 'صورة توضيحية للسؤال ' + (S.index + 1); im.loading = 'eager';
      card.appendChild(im);
    }

    // options
    const group = el('div', 'options' + (q.type === 'TF' ? ' tf' : ''));
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', 'q-text');
    q.options.forEach(function (o) {
      const label = el('label', 'option');
      const input = el('input');
      input.type = 'radio'; input.name = 'q-' + q.id; input.value = o.key;
      input.checked = S.answers[q.id] === o.key;
      input.addEventListener('change', function () { selectAnswer(q.id, o.key); });
      const body = el('span', 'option-body');
      body.appendChild(el('span', 'opt-key', o.key));
      body.appendChild(el('span', 'opt-text', o.text));
      body.appendChild(icon('circle-check', 'opt-check'));
      label.append(input, body);
      group.appendChild(label);
    });
    card.appendChild(group);

    // tools
    const tools = el('div', 'q-tools');
    const save = el('span', 'save-state'); save.id = 'save-state';
    tools.appendChild(save);
    const clear = el('button', 'btn btn-ghost', 'مسح الإجابة');
    clear.type = 'button'; clear.id = 'btn-clear';
    clear.prepend(icon('x', 'icon-sm'));
    clear.hidden = !S.answers[q.id];
    clear.addEventListener('click', function () { clearAnswer(q.id); });
    tools.appendChild(clear);
    card.appendChild(tools);
    renderSaveState();

    if (animate) {
      card.classList.remove('enter'); void card.offsetWidth; card.classList.add('enter');
    }
    $('btn-prev').disabled = S.index === 0;
    $('btn-next').disabled = S.index >= S.questions.length - 1;
    $('bar-counter').textContent = 'سؤال ' + (S.index + 1) + ' من ' + S.questions.length;
  }

  function renderNav() {
    const grid = $('nav-grid');
    grid.replaceChildren();
    S.questions.forEach(function (q, i) {
      const b = el('button', 'nav-btn', String(i + 1));
      b.type = 'button'; b.setAttribute('role', 'listitem');
      const done = !!S.answers[q.id];
      if (done) b.classList.add('answered');
      if (i === S.index) { b.classList.add('current'); b.setAttribute('aria-current', 'true'); }
      b.setAttribute('aria-label', 'السؤال ' + (i + 1) + (done ? '، تمت الإجابة' : '، بدون إجابة'));
      b.addEventListener('click', function () { goTo(i); closeSheet(); });
      grid.appendChild(b);
    });
  }

  function updateStats() {
    const total = S.questions.length;
    const done = answeredCount();
    $('st-total').textContent = total;
    $('st-answered').textContent = done;
    $('st-left').textContent = total - done;
    $('progress-bar').style.width = (total ? (done / total) * 100 : 0) + '%';
    const ms = $('mobile-stats');
    ms.replaceChildren();
    const a = el('span', 'pill'); a.append(icon('circle-check'), document.createTextNode('تمت الإجابة على ' + done + ' من ' + total + ' سؤال'));
    ms.appendChild(a);
  }

  function renderSaveState() {
    const n = $('save-state'); if (!n || !S) return;
    n.className = 'save-state'; n.replaceChildren();
    const st = S.saveStatus;
    if (st === 'busy') { n.classList.add('busy'); n.append(icon('loader'), 'جاري الحفظ…'); }
    else if (st === 'ok') { n.classList.add('ok'); n.append(icon('circle-check'), 'تم حفظ إجاباتك'); }
    else if (st === 'err') { n.classList.add('err'); n.append(icon('alert'), 'تعذر الحفظ، سنعيد المحاولة تلقائيًا'); }
    else if (st === 'pending') { n.append(icon('loader'), 'تغييرات غير محفوظة…'); }
  }
  function setSaveStatus(s) { S.saveStatus = s; renderSaveState(); }

  /* ---------- Answers ---------- */
  function selectAnswer(qid, key) {
    S.answers[qid] = key;
    persistLocal();
    $('btn-clear').hidden = false;
    renderNav(); updateStats();
    scheduleSave();
  }
  function clearAnswer(qid) {
    delete S.answers[qid];
    persistLocal();
    renderAll(false);
    scheduleSave();
  }
  function persistLocal() {
    app().Storage.save({ answers: S.answers, index: S.index });
  }

  /* ---------- Auto-save ---------- */
  function scheduleSave() {
    if (S.submitting) return;
    S.dirty = true; setSaveStatus('pending');
    clearTimeout(S.saveTimer);
    S.saveTimer = setTimeout(flushSave, C.AUTOSAVE_DEBOUNCE_MS);
  }

  async function flushSave() {
    if (!S || S.submitting || S.saving || !S.dirty) return;
    S.saving = true; S.dirty = false; setSaveStatus('busy');
    const snapshot = JSON.stringify(S.answers);
    let ok = false;
    try {
      const r = await app().api('save', { attemptId: S.attemptId, token: S.token, answers: S.answers });
      if (r.locked) { await onAlreadySubmitted(); return; }
      if (r.expired) { submit('timeout'); return; }
      ok = true;
      if (JSON.stringify(S.answers) !== snapshot) S.dirty = true;
      setSaveStatus(S.dirty ? 'pending' : 'ok');
    } catch (e) {
      S.dirty = true; setSaveStatus('err');
      if (e.code === 'UNAUTHORIZED') app().resetSession('انتهت الجلسة. يرجى البدء من جديد.');
    } finally {
      if (S) { S.saving = false; if (ok && S.dirty) scheduleSave(); }
    }
  }

  async function onAlreadySubmitted() {
    teardown();
    try {
      const r = await app().api('result', { attemptId: S.attemptId, token: S.token });
      app().onSubmitted(r);
    } catch (_) { app().resetSession('تم تسليم هذه المحاولة بالفعل.'); }
  }

  /* ---------- Navigation ---------- */
  function goTo(i) {
    if (!S || i < 0 || i >= S.questions.length || i === S.index) return;
    S.index = i;
    persistLocal();
    renderAll(true);
    window.scrollTo({ top: 0, behavior: 'auto' });
    if (S.dirty) flushSave();      // save when navigating
  }

  function bindControls() {
    if (S.bound) return; S.bound = true;
    $('btn-prev').onclick = function () { goTo(S.index - 1); };
    $('btn-next').onclick = function () { goTo(S.index + 1); };
    $('btn-submit').onclick = openConfirm;
    $('btn-sheet').onclick = function () { $('side').classList.contains('open') ? closeSheet() : openSheet(); };
    $('sheet-backdrop').onclick = closeSheet;
    $('m-cancel').onclick = closeConfirm;
    $('m-confirm').onclick = function () { submit('manual'); };
    $('modal-submit').addEventListener('click', function (e) { if (e.target === this) closeConfirm(); });
    $('modal-submit').addEventListener('keydown', trapModalKeys);
    $('overlay-retry').onclick = function () { runSubmitLoop(); };
  }

  function openSheet() { $('side').classList.add('open'); $('sheet-backdrop').hidden = false; $('btn-sheet').setAttribute('aria-expanded', 'true'); }
  function closeSheet() { $('side').classList.remove('open'); $('sheet-backdrop').hidden = true; $('btn-sheet').setAttribute('aria-expanded', 'false'); }

  /* ---------- Timer ---------- */
  function startTimer() {
    const timer = $('timer');
    S.countdown = new window.VireloTimer.Countdown({
      endTime: S.endTime,
      now: function () { return app().now(); },
      warnAt: C.WARN_SECONDS,
      dangerAt: C.DANGER_SECONDS,
      onTick: function (r) {
        $('timer-text').textContent = window.VireloTimer.formatMMSS(r);
        timer.classList.toggle('danger', r <= C.DANGER_SECONDS);
        timer.classList.toggle('warn', r > C.DANGER_SECONDS && r <= C.WARN_SECONDS);
      },
      onWarn: function () {
        app().toast('متبقي 5 دقائق على انتهاء الامتحان', 'gold', 'clock');
        showBanner('متبقي 5 دقائق على انتهاء الامتحان', false);
      },
      onDanger: function () {
        showBanner('متبقي دقيقة واحدة. سيتم تسليم الامتحان تلقائيًا عند انتهاء الوقت.', true);
      },
      onEnd: function () { submit('timeout'); }
    });
    S.countdown.start();
  }

  function showBanner(text, danger) {
    const b = $('time-banner');
    b.textContent = text; b.className = 'time-banner' + (danger ? ' danger' : ''); b.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(function () { b.hidden = true; }, 12000);
  }

  /* ---------- Confirm modal ---------- */
  function openConfirm() {
    if (S.submitting) return;
    const done = answeredCount();
    $('m-answered').textContent = done;
    $('m-unanswered').textContent = S.questions.length - done;
    $('modal-submit').hidden = false;
    S.lastFocus = document.activeElement;
    $('m-cancel').focus();
  }
  function closeConfirm() {
    $('modal-submit').hidden = true;
    if (S && S.lastFocus && S.lastFocus.focus) S.lastFocus.focus();
  }
  function trapModalKeys(e) {
    if (e.key === 'Escape') { closeConfirm(); return; }
    if (e.key !== 'Tab') return;
    const f = Array.prototype.slice.call($('modal-submit').querySelectorAll('button'));
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /* ---------- Submission (idempotent on the server) ---------- */
  function teardown() {
    if (!S) return;
    S.submitting = true;
    if (S.countdown) S.countdown.stop();
    clearInterval(S.periodic); clearTimeout(S.saveTimer); clearTimeout(bannerTimer);
    window.removeEventListener('beforeunload', onBeforeUnload);
  }

  function submit(reason) {
    if (!S || S.submitting) return;
    S.lastReason = reason;
    teardown();
    closeConfirm(); closeSheet();
    // Survive a refresh while the request is in flight
    app().Storage.save({ pendingSubmit: true, reason: reason, answers: S.answers });
    $('overlay-submit').hidden = false;
    runSubmitLoop();
  }

  async function runSubmitLoop() {
    const ov = { title: $('overlay-title'), text: $('overlay-text'), retry: $('overlay-retry'), spin: $('overlay-spinner') };
    ov.retry.hidden = true; ov.spin.hidden = false;
    ov.title.textContent = S.lastReason === 'timeout' ? 'انتهى الوقت — جاري تسليم الامتحان…' : 'جاري تسليم الامتحان…';
    ov.text.textContent = 'من فضلك لا تغلق الصفحة.';
    for (;;) {
      try {
        const r = await app().api('submit', {
          attemptId: S.attemptId, token: S.token, answers: S.answers, reason: S.lastReason
        }, { timeoutMs: 30000 });
        $('overlay-submit').hidden = true;
        app().onSubmitted(r);
        return;
      } catch (e) {
        if (e.code === 'UNAUTHORIZED') { $('overlay-submit').hidden = true; app().resetSession('جلسة غير صالحة. يرجى البدء من جديد.'); return; }
        if (e.code && e.code !== 'NETWORK' && e.code !== 'BUSY') {
          ov.spin.hidden = true; ov.title.textContent = 'تعذر إتمام التسليم';
          ov.text.textContent = e.message || 'حدث خطأ. حاول مرة أخرى.'; ov.retry.hidden = false;
          return;
        }
        ov.text.textContent = 'تعذر الاتصال بالخادم. إجاباتك محفوظة وسنعيد المحاولة تلقائيًا…';
        await sleep(3000);
      }
    }
  }

  window.VireloExam = { begin: begin, resumePendingSubmit: resumePendingSubmit };
})();
