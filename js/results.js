/* ==========================================================
   results.js — Results page
   Displays ONLY what the server returned. Nothing is computed
   or invented on the client apart from presentation.
   ========================================================== */
(function () {
  'use strict';

  const C = window.VIRELO_CONFIG;
  const $ = function (id) { return document.getElementById(id); };
  const CIRC = 2 * Math.PI * 52;   // matches r="52" in index.html

  function fmt(n) { return String(Math.round(Number(n) * 100) / 100); }

  function levelFor(pct) {
    for (let i = 0; i < C.LEVELS.length; i++) if (pct >= C.LEVELS[i].min) return C.LEVELS[i];
    return C.LEVELS[C.LEVELS.length - 1];
  }

  function formatDate(ms) {
    // Latin digits, 24h clock, Egypt time: "13/11/2026 — 23:17"
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: C.TIMEZONE
      }).format(new Date(ms));
      return parts.replace(', ', ' — ');
    } catch (_) { return new Date(ms).toLocaleString(); }
  }

  function metaItem(iconId, text) {
    const s = document.createElement('span');
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('class', 'icon');
    const use = document.createElementNS(ns, 'use'); use.setAttribute('href', '#i-' + iconId);
    svg.appendChild(use); s.appendChild(svg); s.appendChild(document.createTextNode(text));
    return s;
  }

  function show(r) {
    const pct = Number(r.percentage) || 0;
    $('res-exam').textContent = r.examTitle || C.EXAM_TITLE;
    $('res-name').textContent = r.studentName;
    $('res-date').textContent = r.submittedAt ? formatDate(r.submittedAt) : '—';
    $('res-score').textContent = fmt(r.score);
    $('res-total').textContent = fmt(r.totalMarks);
    $('res-pct').textContent = fmt(pct) + '%';
    $('res-correct').textContent = r.correct;
    $('res-incorrect').textContent = r.incorrect;
    $('res-unanswered').textContent = r.unanswered;
    $('res-ring-wrap').setAttribute('aria-label', 'النسبة المئوية ' + fmt(pct) + ' بالمئة');

    const lv = levelFor(pct);
    $('res-level-text').textContent = lv.label;
    $('res-level').classList.toggle('needs', lv.key === 'needs');
    $('res-feedback').textContent = lv.message;

    // meta line
    const meta = $('res-meta'); meta.replaceChildren();
    const m = Math.floor((r.durationSeconds || 0) / 60), s = (r.durationSeconds || 0) % 60;
    meta.appendChild(metaItem('clock', 'مدة الحل: ' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')));
    if (r.submitType === 'AUTO') meta.appendChild(metaItem('info', 'تم التسليم تلقائيًا عند انتهاء الوقت'));
    meta.appendChild(metaItem('file', 'رقم المحاولة: ' + r.attemptId));

    // ring animation (starts empty, then fills)
    const ring = $('res-ring');
    ring.style.strokeDasharray = String(CIRC);
    ring.style.strokeDashoffset = String(CIRC);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        ring.style.strokeDashoffset = String(CIRC * (1 - Math.min(Math.max(pct, 0), 100) / 100));
      });
    });

    // actions
    $('btn-pdf').hidden = !C.FEATURES.PDF_DOWNLOAD;
    $('btn-pdf').onclick = function () {
      const old = document.title;
      document.title = 'Virelo-Result-' + r.attemptId;
      window.print();
      setTimeout(function () { document.title = old; }, 500);
    };
    const wa = $('btn-wa');
    wa.hidden = !C.FEATURES.WHATSAPP_SHARE;
    const text = 'نتيجتي في ' + (r.examTitle || C.EXAM_TITLE) + ' — Virelo Academy\n' +
      'الدرجة: ' + fmt(r.score) + ' / ' + fmt(r.totalMarks) + ' (' + fmt(pct) + '%)\n' + lv.label;
    wa.href = 'https://wa.me/?text=' + encodeURIComponent(text);

    renderReview(r);
    window.VireloApp.showScreen('result');
  }

  /** Only rendered if the server decided to send the review (SHOW_REVIEW_AFTER_SUBMIT). */
  function renderReview(r) {
    const btn = $('btn-review'), box = $('review');
    box.replaceChildren(); box.hidden = true;
    if (!Array.isArray(r.review) || !r.review.length) { btn.hidden = true; return; }
    btn.hidden = false;
    r.review.forEach(function (q, i) {
      const status = q.isCorrect === null ? 'none' : (q.isCorrect ? 'ok' : 'bad');
      const item = document.createElement('div'); item.className = 'review-item ' + status;
      const t = document.createElement('div'); t.className = 'review-q';
      const n = document.createElement('span'); n.className = 'n'; n.textContent = String(i + 1).padStart(2, '0');
      t.appendChild(n); t.appendChild(document.createTextNode(q.text)); item.appendChild(t);
      q.options.forEach(function (o) {
        const row = document.createElement('div'); row.className = 'review-opt';
        if (o.key === q.correctAnswer) row.classList.add('correct');
        else if (o.key === q.yourAnswer) row.classList.add('wrong');
        const k = document.createElement('span'); k.className = 'k'; k.textContent = o.key;
        const tx = document.createElement('span'); tx.textContent = o.text;
        row.append(k, tx); item.appendChild(row);
      });
      if (q.explanation) {
        const e = document.createElement('div'); e.className = 'review-exp';
        e.textContent = 'التفسير: ' + q.explanation; item.appendChild(e);
      }
      box.appendChild(item);
    });
    btn.onclick = function () {
      box.hidden = !box.hidden;
      if (!box.hidden) box.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  }

  window.VireloResults = { show: show };
})();
