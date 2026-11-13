/**
 * ============================================================
 *  VIRELO ACADEMY — Online Examination System (Backend)
 *  Grade 11 (Second Secondary) | ICT | Unit 2
 *  Google Apps Script Web App + Google Sheets database
 * ============================================================
 *
 *  SECURITY MODEL
 *  - The answer key lives ONLY in the "Questions" sheet and is evaluated here.
 *    It is never sent to the browser (unless SHOW_REVIEW_AFTER_SUBMIT = true,
 *    and then only AFTER the attempt is submitted).
 *  - The client never sends a score. It only sends answers; the server grades.
 *  - Every attempt has a secret token. Only its SHA-256 hash is stored.
 *  - All timing uses SERVER time. Late submissions are graded using the last
 *    answers saved before the deadline.
 *  - LockService prevents duplicate attempts / duplicate grading.
 *
 *  DEPLOY: Deploy > New deployment > Web app
 *          Execute as: Me   |   Who has access: Anyone
 */

/* ------------------------------------------------------------
 * 1) CONFIGURATION  (edit only this block)
 * ---------------------------------------------------------- */
const CONFIG = {
  // Leave '' if this script was created from inside the Google Sheet
  // (Extensions > Apps Script). Otherwise paste the Spreadsheet ID.
  SPREADSHEET_ID: '',

  EXAM_TITLE: 'امتحان الوحدة الثانية',
  DURATION_SECONDS: 1800,          // 30 minutes
  SUBMIT_GRACE_SECONDS: 20,        // network tolerance for the final submit

  // null = calculate automatically from the "Marks" column of the Questions sheet.
  // A number overrides it (only use it if you know the sheet total differs).
  TOTAL_MARKS: null,

  MAX_ATTEMPTS: 1,                 // submitted attempts allowed per phone number

  // If a student closes the browser / changes device before submitting,
  // allow them to continue the SAME attempt (the timer never resets).
  ALLOW_RESUME_WITH_PHONE: true,
  RESUME_REQUIRES_SAME_NAME: true, // extra safety for resuming

  // Exam availability
  EXAM_OPEN: true,                 // master switch
  AVAILABLE_FROM: '',              // e.g. '2026-11-20T09:00:00+02:00'  ('' = no limit)
  AVAILABLE_UNTIL: '',             // e.g. '2026-11-20T23:59:00+02:00'  ('' = no limit)

  // Show correct answers + explanations on the results page AFTER submission.
  SHOW_REVIEW_AFTER_SUBMIT: false,

  QUESTION_CACHE_SECONDS: 300      // server-side cache of the question bank
};

const SHEET_NAMES = {
  students: 'Students',
  attempts: 'Exam Attempts',
  answers: 'Student Answers',
  questions: 'Questions'
};

const STUDENT_HEADERS  = ['Student ID', 'Full Name', 'Phone Number', 'Registration Date'];
const ATTEMPT_HEADERS  = [
  'Attempt ID', 'Student ID', 'Student Name', 'Phone', 'Start Time', 'Submission Time',
  'Duration (sec)', 'Status', 'Score', 'Total Marks', 'Percentage',
  // --- internal columns (added by the system) ---
  'Deadline', 'Token Hash', 'Draft Answers', 'Last Saved', 'Final Answers',
  'Correct', 'Incorrect', 'Unanswered', 'Submit Type'
];
const ATTEMPT_KEYS = [
  'id', 'studentId', 'name', 'phone', 'start', 'submit',
  'duration', 'status', 'score', 'total', 'pct',
  'deadline', 'tokenHash', 'draft', 'lastSaved', 'final',
  'correct', 'incorrect', 'unanswered', 'submitType'
];
const ANSWER_HEADERS   = ['Attempt ID', 'Question ID', 'Student Answer', 'Is Correct', 'Marks Earned'];
const QUESTION_HEADERS = ['Question ID', 'Question Text', 'Question Type', 'Options',
                          'Correct Answer', 'Marks', 'Explanation', 'Image URL'];

const OPTION_LETTERS = 'ABCDEFGH';
const CACHE_KEY = 'virelo_unit2_questions_v1';

/* ------------------------------------------------------------
 * 2) WEB APP ENTRY POINTS
 * ---------------------------------------------------------- */
function doGet() {
  return jsonOut_({ ok: true, service: 'Virelo Academy Exam API', time: Date.now() });
}

function doPost(e) {
  let out;
  try {
    const req = parseRequest_(e);
    out = route_(req);
  } catch (err) {
    out = errorResponse_(err);
  }
  return jsonOut_(out);
}

function route_(req) {
  switch (req.action) {
    case 'config':    return getPublicConfig_();
    case 'start':     return startAttempt_(req);
    case 'questions': return getQuestionsAction_(req);
    case 'save':      return saveAnswers_(req);
    case 'state':     return getState_(req);
    case 'submit':    return submitExam_(req);
    case 'result':    return getResult_(req);
    default: throw apiError_('BAD_REQUEST', 'طلب غير معروف.');
  }
}

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) throw apiError_('BAD_REQUEST', 'طلب غير صالح.');
  if (e.postData.contents.length > 200000) throw apiError_('BAD_REQUEST', 'حجم الطلب كبير جدًا.');
  let req;
  try { req = JSON.parse(e.postData.contents); }
  catch (_) { throw apiError_('BAD_REQUEST', 'صيغة الطلب غير صحيحة.'); }
  if (!req || typeof req !== 'object' || typeof req.action !== 'string') {
    throw apiError_('BAD_REQUEST', 'طلب غير صالح.');
  }
  return req;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function apiError_(code, message) { return { apiError: true, code: code, message: message }; }

function errorResponse_(err) {
  if (err && err.apiError) return { ok: false, code: err.code, message: err.message };
  console.error(err && err.stack ? err.stack : err);
  return { ok: false, code: 'SERVER_ERROR', message: 'حدث خطأ غير متوقع. حاول مرة أخرى.' };
}

/* ------------------------------------------------------------
 * 3) PUBLIC ACTIONS
 * ---------------------------------------------------------- */
function getPublicConfig_() {
  const avail = availability_();
  let total = 0;
  try { total = loadQuestions_().list.length; } catch (_) { total = 0; }
  return {
    ok: true,
    examTitle: CONFIG.EXAM_TITLE,
    durationSeconds: CONFIG.DURATION_SECONDS,
    totalQuestions: total,
    isOpen: avail.open,
    closedMessage: avail.open ? '' : avail.message,
    reviewEnabled: !!CONFIG.SHOW_REVIEW_AFTER_SUBMIT,
    serverNow: Date.now()
  };
}

/** Register the student (or find them) and create / resume an attempt. */
function startAttempt_(req) {
  const name  = validateName_(req.fullName);
  const phone = validatePhone_(req.phone);
  const avail = availability_();
  if (!avail.open) throw apiError_('EXAM_CLOSED', avail.message);

  // Make sure the question bank is valid BEFORE a student's timer starts.
  const bank = loadQuestions_();

  return withLock_(function () {
    const student  = ensureStudent_(name, phone);
    const attempts = listAttemptsByPhone_(phone);

    // Auto-finalize any expired attempt that was never submitted.
    attempts.forEach(function (a) {
      if (a.status === 'IN_PROGRESS' && Date.now() > a.deadline) finalizeAttempt_(a);
    });

    const inProgress = attempts.filter(function (a) { return a.status === 'IN_PROGRESS'; })[0];
    if (inProgress) {
      if (!CONFIG.ALLOW_RESUME_WITH_PHONE) {
        throw apiError_('ATTEMPT_IN_PROGRESS', 'لديك محاولة جارية بالفعل بهذا الرقم.');
      }
      if (CONFIG.RESUME_REQUIRES_SAME_NAME &&
          normalizeName_(inProgress.name) !== normalizeName_(name)) {
        throw apiError_('ATTEMPT_IN_PROGRESS',
          'لديك محاولة جارية بهذا الرقم. اكتب نفس الاسم الذي سجلت به لمتابعة الامتحان.');
      }
      const token = newToken_();
      inProgress.tokenHash = hash_(token);
      writeAttempt_(inProgress);
      return startPayload_(inProgress, token, bank, true);
    }

    const used = attempts.filter(function (a) { return a.status !== 'IN_PROGRESS'; }).length;
    if (used >= CONFIG.MAX_ATTEMPTS) {
      throw apiError_('LIMIT_REACHED', 'لقد استنفدت عدد المحاولات المسموح بها لهذا الرقم.');
    }

    const startMs = Date.now();
    const token = newToken_();
    const attempt = {
      row: 0,
      id: 'ATT-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase(),
      studentId: student.id, name: name, phone: phone,
      start: startMs, submit: null, duration: '', status: 'IN_PROGRESS',
      score: '', total: '', pct: '',
      deadline: startMs + CONFIG.DURATION_SECONDS * 1000,
      tokenHash: hash_(token), draft: '{}', lastSaved: startMs, final: '',
      correct: '', incorrect: '', unanswered: '', submitType: ''
    };
    createAttempt_(attempt);
    return startPayload_(attempt, token, bank, false);
  });
}

function startPayload_(a, token, bank, resumed) {
  return {
    ok: true,
    resumed: resumed,
    attemptId: a.id,
    token: token,
    studentName: a.name,
    examTitle: CONFIG.EXAM_TITLE,
    startTime: a.start,
    endTime: a.deadline,
    durationSeconds: CONFIG.DURATION_SECONDS,
    serverNow: Date.now(),
    answers: safeParse_(a.draft, {}),
    questions: publicQuestions_(bank)
  };
}

function getQuestionsAction_(req) {
  const a = authAttempt_(req);
  if (a.status !== 'IN_PROGRESS') throw apiError_('LOCKED', 'تم تسليم هذه المحاولة بالفعل.');
  return { ok: true, questions: publicQuestions_(loadQuestions_()), serverNow: Date.now() };
}

/** Auto-save. Writes only to the student's own row; no global lock needed. */
function saveAnswers_(req) {
  const a = authAttempt_(req);
  if (a.status !== 'IN_PROGRESS') {
    return { ok: true, locked: true, status: a.status, serverNow: Date.now() };
  }
  if (Date.now() > a.deadline) {
    return { ok: true, expired: true, serverNow: Date.now() };
  }
  const clean = sanitizeAnswers_(req.answers, loadQuestions_());
  const sh = sheet_('attempts');
  const col = ATTEMPT_KEYS.indexOf('draft') + 1;
  const now = new Date();
  sh.getRange(a.row, col, 1, 2).setValues([[JSON.stringify(clean), now]]);
  return {
    ok: true,
    savedAt: now.getTime(),
    serverNow: Date.now(),
    remainingSeconds: Math.max(0, Math.round((a.deadline - Date.now()) / 1000))
  };
}

/** Restore everything the browser needs after a refresh / lost local storage. */
function getState_(req) {
  const a = authAttempt_(req);
  if (a.status === 'IN_PROGRESS' && Date.now() > a.deadline) {
    withLock_(function () {
      const fresh = getAttemptByRow_(a.row);
      if (fresh.status === 'IN_PROGRESS') finalizeAttempt_(fresh);
    });
    return getResult_(req);
  }
  if (a.status !== 'IN_PROGRESS') {
    const r = getResult_(req);
    r.submitted = true;
    return r;
  }
  return {
    ok: true,
    submitted: false,
    attemptId: a.id,
    studentName: a.name,
    examTitle: CONFIG.EXAM_TITLE,
    startTime: a.start,
    endTime: a.deadline,
    durationSeconds: CONFIG.DURATION_SECONDS,
    serverNow: Date.now(),
    answers: safeParse_(a.draft, {}),
    questions: publicQuestions_(loadQuestions_())
  };
}

/** Final submission — graded once, on the server. Idempotent. */
function submitExam_(req) {
  const first = authAttempt_(req);   // fast reject of bad tokens before waiting for the lock
  return withLock_(function () {
    const a = getAttemptByRow_(first.row);

    // Already submitted: return the stored result (never grade twice).
    if (a.status !== 'IN_PROGRESS') {
      const r = buildResult_(a);
      r.alreadySubmitted = true;
      return r;
    }

    const now = Date.now();
    const withinWindow = now <= a.deadline + CONFIG.SUBMIT_GRACE_SECONDS * 1000;
    const timedOut = now >= a.deadline - 2000;
    let answers;
    if (withinWindow) {
      // Use the final answers sent by the browser, validated against the question bank.
      answers = sanitizeAnswers_(req.answers, loadQuestions_());
    } else {
      // Too late: only what was saved before the deadline counts.
      answers = sanitizeAnswers_(safeParse_(a.draft, {}), loadQuestions_());
    }
    const type = (timedOut || req.reason === 'timeout') ? 'AUTO' : 'MANUAL';
    gradeAndStore_(a, answers, type, Math.min(now, a.deadline + CONFIG.SUBMIT_GRACE_SECONDS * 1000));
    return buildResult_(a);
  });
}

function getResult_(req) {
  const a = authAttempt_(req);
  if (a.status === 'IN_PROGRESS') {
    if (Date.now() > a.deadline) {
      withLock_(function () {
        const fresh = getAttemptByRow_(a.row);
        if (fresh.status === 'IN_PROGRESS') finalizeAttempt_(fresh);
      });
      return buildResult_(getAttemptByRow_(a.row));
    }
    throw apiError_('NOT_SUBMITTED', 'لم يتم تسليم الامتحان بعد.');
  }
  return buildResult_(a);
}

/* ------------------------------------------------------------
 * 4) GRADING ENGINE (server-side only)
 * ---------------------------------------------------------- */

/** Grade, write "Student Answers" rows, and update the attempt row. Caller holds the lock. */
function gradeAndStore_(a, answers, submitType, submitMs) {
  const bank = loadQuestions_();
  let score = 0, sum = 0, correct = 0, incorrect = 0, unanswered = 0;
  const rows = [];

  bank.list.forEach(function (q) {
    sum += q.marks;
    const given = answers[q.id] || '';
    let isCorrect = '', earned = 0;
    if (!given) {
      unanswered++;
    } else if (given === q.correct) {
      isCorrect = true; earned = q.marks; correct++;
    } else {
      isCorrect = false; incorrect++;
    }
    score += earned;
    rows.push([a.id, q.id, given, isCorrect, earned]);
  });

  const total = (CONFIG.TOTAL_MARKS !== null && CONFIG.TOTAL_MARKS > 0) ? CONFIG.TOTAL_MARKS : sum;
  const pct = total > 0 ? round2_((score / total) * 100) : 0;

  // 1) Detailed answers
  const ansSheet = sheet_('answers');
  const start = ansSheet.getLastRow() + 1;
  if (rows.length) ansSheet.getRange(start, 1, rows.length, ANSWER_HEADERS.length).setValues(rows);

  // 2) Attempt summary
  a.submit = Math.max(submitMs, a.start);
  a.duration = Math.max(0, Math.round((Math.min(a.submit, a.deadline) - a.start) / 1000));
  a.status = submitType === 'AUTO' ? 'AUTO_SUBMITTED' : 'SUBMITTED';
  a.score = round2_(score);
  a.total = round2_(total);
  a.pct = pct;
  a.final = JSON.stringify(answers);
  a.correct = correct;
  a.incorrect = incorrect;
  a.unanswered = unanswered;
  a.submitType = submitType;
  writeAttempt_(a);
}

/** Finalize an expired attempt using its last saved draft. Caller holds the lock. */
function finalizeAttempt_(a) {
  const answers = sanitizeAnswers_(safeParse_(a.draft, {}), loadQuestions_());
  gradeAndStore_(a, answers, 'AUTO', a.deadline);
}

/**
 * Optional: run on a time-driven trigger (every 5 minutes) so abandoned
 * attempts are graded even if the student never returns.
 */
function finalizeExpiredAttempts() {
  withLock_(function () {
    const sh = sheet_('attempts');
    const last = sh.getLastRow();
    if (last < 2) return;
    const data = sh.getRange(2, 1, last - 1, ATTEMPT_HEADERS.length).getValues();
    data.forEach(function (arr, i) {
      const a = rowToAttempt_(arr, i + 2);
      if (a.status === 'IN_PROGRESS' && Date.now() > a.deadline + CONFIG.SUBMIT_GRACE_SECONDS * 1000) {
        finalizeAttempt_(a);
      }
    });
  });
}

function buildResult_(a) {
  const res = {
    ok: true,
    submitted: true,
    attemptId: a.id,
    studentName: a.name,
    examTitle: CONFIG.EXAM_TITLE,
    status: a.status,
    submitType: a.submitType,
    submittedAt: a.submit,
    durationSeconds: a.duration,
    score: a.score,
    totalMarks: a.total,
    percentage: a.pct,
    correct: a.correct,
    incorrect: a.incorrect,
    unanswered: a.unanswered,
    totalQuestions: a.correct + a.incorrect + a.unanswered,
    reviewEnabled: !!CONFIG.SHOW_REVIEW_AFTER_SUBMIT,
    serverNow: Date.now()
  };
  if (CONFIG.SHOW_REVIEW_AFTER_SUBMIT) {
    const answers = safeParse_(a.final, {});
    res.review = loadQuestions_().list.map(function (q) {
      const given = answers[q.id] || '';
      return {
        id: q.id,
        text: q.text,
        image: q.image,
        options: q.options,
        yourAnswer: given,
        correctAnswer: q.correct,
        isCorrect: given ? given === q.correct : null,
        marks: q.marks,
        explanation: q.explanation
      };
    });
  }
  return res;
}

/* ------------------------------------------------------------
 * 5) QUESTION BANK
 * ---------------------------------------------------------- */

/** Reads the "Questions" sheet. Result is cached server-side (never sent to the client as-is). */
function loadQuestions_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CACHE_KEY);
  if (hit) { try { return JSON.parse(hit); } catch (_) { /* fall through */ } }

  const parsed = parseQuestionSheet_();
  if (parsed.errors.length) {
    console.error('Question bank errors:\n' + parsed.errors.join('\n'));
    throw apiError_('BANK_INVALID', 'بنك الأسئلة غير مكتمل. يرجى مراجعة المشرف.');
  }
  if (!parsed.list.length) {
    throw apiError_('NO_QUESTIONS', 'لم يتم إضافة أسئلة للامتحان بعد.');
  }
  try {
    const s = JSON.stringify(parsed);
    if (s.length < 90000) cache.put(CACHE_KEY, s, CONFIG.QUESTION_CACHE_SECONDS);
  } catch (_) { /* cache is optional */ }
  return parsed;
}

function parseQuestionSheet_() {
  const sh = sheet_('questions');
  const last = sh.getLastRow();
  const out = { list: [], errors: [] };
  if (last < 2) return out;

  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  const col = {};
  QUESTION_HEADERS.forEach(function (h) { col[h] = header.indexOf(h); });
  ['Question ID', 'Question Text', 'Question Type', 'Correct Answer'].forEach(function (h) {
    if (col[h] < 0) out.errors.push('Missing column: ' + h);
  });
  if (out.errors.length) return out;

  const data = sh.getRange(2, 1, last - 1, header.length).getValues();
  const seen = {};
  data.forEach(function (r, i) {
    const rowNo = i + 2;
    const get = function (h) { return col[h] >= 0 ? r[col[h]] : ''; };
    const id = String(get('Question ID')).trim();
    const text = String(get('Question Text')).trim();
    if (!id && !text) return; // blank row
    if (!id)   { out.errors.push('Row ' + rowNo + ': empty Question ID'); return; }
    if (!text) { out.errors.push('Row ' + rowNo + ': empty Question Text'); return; }
    if (seen[id]) { out.errors.push('Row ' + rowNo + ': duplicate Question ID ' + id); return; }
    seen[id] = true;

    let type = String(get('Question Type')).trim().toUpperCase().replace(/[\s\-\/]/g, '_');
    if (type === 'TRUE_FALSE' || type === 'TF' || type === 'TRUEFALSE') type = 'TF';
    else if (type === 'MCQ' || type === 'MULTIPLE_CHOICE') type = 'MCQ';
    else { out.errors.push('Row ' + rowNo + ': Question Type must be MCQ or TF'); return; }

    let options = String(get('Options')).split(/\r?\n|\|/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    if (type === 'TF' && options.length === 0) options = ['صح', 'خطأ'];
    if (options.length < 2) { out.errors.push('Row ' + rowNo + ': at least 2 options required'); return; }
    if (options.length > OPTION_LETTERS.length) { out.errors.push('Row ' + rowNo + ': too many options'); return; }

    const correct = resolveCorrect_(get('Correct Answer'), type, options);
    if (!correct) { out.errors.push('Row ' + rowNo + ': cannot resolve Correct Answer'); return; }

    const marksRaw = get('Marks');
    const marks = (marksRaw === '' || marksRaw === null) ? 1 : Number(marksRaw);
    if (!isFinite(marks) || marks < 0) { out.errors.push('Row ' + rowNo + ': invalid Marks'); return; }

    out.list.push({
      id: id, text: text, type: type,
      options: options.map(function (t, k) { return { key: OPTION_LETTERS[k], text: t }; }),
      correct: correct,
      marks: marks,
      explanation: String(get('Explanation') || '').trim(),
      image: String(get('Image URL') || '').trim()
    });
  });
  return out;
}

/** Accepts A-H, 1-8, أ/ب/ج/د, exact option text, or (TF) true/false/صح/خطأ. Returns a letter or null. */
function resolveCorrect_(raw, type, options) {
  const s = String(raw === null || raw === undefined ? '' : raw).trim();
  if (!s) return null;
  const up = s.toUpperCase();
  if (/^[A-H]$/.test(up) && OPTION_LETTERS.indexOf(up) < options.length) return up;
  if (/^[1-8]$/.test(s) && Number(s) <= options.length) return OPTION_LETTERS[Number(s) - 1];
  const ar = { 'أ': 0, 'ا': 0, 'ب': 1, 'ج': 2, 'د': 3 };
  if (ar[s] !== undefined && ar[s] < options.length) return OPTION_LETTERS[ar[s]];
  const idx = options.map(function (o) { return o.trim(); }).indexOf(s);
  if (idx >= 0) return OPTION_LETTERS[idx];
  if (type === 'TF') {
    if (['TRUE', 'T', 'صح', 'صحيح', 'YES'].indexOf(up) >= 0 || s === 'صح' || s === 'صحيحة') return 'A';
    if (['FALSE', 'F', 'خطأ', 'خطا', 'NO'].indexOf(up) >= 0 || s === 'خطأ' || s === 'خاطئة') return 'B';
  }
  return null;
}

/** What the browser may see: NO correct answers, NO explanations. */
function publicQuestions_(bank) {
  return bank.list.map(function (q, i) {
    return {
      id: q.id, number: i + 1, text: q.text, type: q.type,
      options: q.options, marks: q.marks, image: q.image
    };
  });
}

/** Keep only known question IDs and valid option letters. */
function sanitizeAnswers_(raw, bank) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  bank.list.forEach(function (q) {
    const v = raw[q.id];
    if (typeof v !== 'string') return;
    const k = v.trim().toUpperCase();
    const valid = q.options.some(function (o) { return o.key === k; });
    if (valid) out[q.id] = k;
  });
  return out;
}

/* ------------------------------------------------------------
 * 6) VALIDATION
 * ---------------------------------------------------------- */
function toLatinDigits_(s) {
  return String(s)
    .replace(/[\u0660-\u0669]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
    .replace(/[\u06F0-\u06F9]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
}

function normalizeName_(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function validateName_(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!name) throw apiError_('VALIDATION', 'الرجاء إدخال الاسم بالكامل.');
  if (name.length > 80) throw apiError_('VALIDATION', 'الاسم طويل جدًا.');
  if (!/^[\p{L}\p{M}][\p{L}\p{M}\s'.\-]*$/u.test(name)) {
    throw apiError_('VALIDATION', 'الاسم يجب أن يحتوي على حروف عربية أو إنجليزية فقط.');
  }
  const parts = name.split(' ').filter(function (p) { return p.length >= 2; });
  if (parts.length < 2) throw apiError_('VALIDATION', 'الرجاء كتابة الاسم الأول والثاني على الأقل.');
  return name;
}

/** Egyptian mobile: 010 / 011 / 012 / 015 + 8 digits. Accepts +20 / 0020 / 20 prefixes. */
function validatePhone_(raw) {
  let p = toLatinDigits_(raw || '').replace(/[\s\-().]/g, '');
  if (!p) throw apiError_('VALIDATION', 'الرجاء إدخال رقم الهاتف.');
  if (p.indexOf('+20') === 0) p = '0' + p.substring(3);
  else if (p.indexOf('0020') === 0) p = '0' + p.substring(4);
  else if (/^20\d{10}$/.test(p)) p = '0' + p.substring(2);
  if (!/^01[0125]\d{8}$/.test(p)) {
    throw apiError_('VALIDATION', 'رقم الهاتف غير صحيح. مثال: 01012345678');
  }
  return p;
}

function samePhone_(a, b) {
  const da = toLatinDigits_(a).replace(/\D/g, '');
  const db = toLatinDigits_(b).replace(/\D/g, '');
  return da.slice(-10) === db.slice(-10) && da.length > 0;
}

/* ------------------------------------------------------------
 * 7) AVAILABILITY
 * ---------------------------------------------------------- */
function availability_() {
  if (!CONFIG.EXAM_OPEN) return { open: false, message: 'الامتحان غير متاح حاليًا.' };
  const now = Date.now();
  if (CONFIG.AVAILABLE_FROM) {
    const from = new Date(CONFIG.AVAILABLE_FROM).getTime();
    if (isFinite(from) && now < from) return { open: false, message: 'لم يبدأ موعد الامتحان بعد.' };
  }
  if (CONFIG.AVAILABLE_UNTIL) {
    const until = new Date(CONFIG.AVAILABLE_UNTIL).getTime();
    if (isFinite(until) && now > until) return { open: false, message: 'انتهى موعد الامتحان.' };
  }
  return { open: true, message: '' };
}

/* ------------------------------------------------------------
 * 8) SHEETS ACCESS LAYER
 * ---------------------------------------------------------- */
function ss_() {
  return CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(key) {
  const sh = ss_().getSheetByName(SHEET_NAMES[key]);
  if (!sh) throw apiError_('NOT_INITIALIZED', 'قاعدة البيانات غير مهيأة. شغّل initializeDatabase أولًا.');
  return sh;
}

function toMs_(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v).getTime();
  return isFinite(t) ? t : null;
}

function toCell_(ms) { return (ms === null || ms === undefined || ms === '') ? '' : new Date(ms); }

function rowToAttempt_(arr, rowNo) {
  const a = { row: rowNo };
  ATTEMPT_KEYS.forEach(function (k, i) { a[k] = arr[i]; });
  a.id = String(a.id); a.studentId = String(a.studentId);
  a.name = String(a.name); a.phone = String(a.phone);
  a.start = toMs_(a.start); a.submit = toMs_(a.submit);
  a.deadline = toMs_(a.deadline); a.lastSaved = toMs_(a.lastSaved);
  a.tokenHash = String(a.tokenHash); a.draft = String(a.draft || '{}'); a.final = String(a.final || '');
  ['duration', 'score', 'total', 'pct', 'correct', 'incorrect', 'unanswered'].forEach(function (k) {
    a[k] = (a[k] === '' || a[k] === null) ? 0 : Number(a[k]);
  });
  return a;
}

function attemptToRow_(a) {
  return ATTEMPT_KEYS.map(function (k) {
    if (k === 'start' || k === 'submit' || k === 'deadline' || k === 'lastSaved') return toCell_(a[k]);
    return (a[k] === undefined || a[k] === null) ? '' : a[k];
  });
}

function writeAttempt_(a) {
  sheet_('attempts').getRange(a.row, 1, 1, ATTEMPT_HEADERS.length).setValues([attemptToRow_(a)]);
}

function createAttempt_(a) {
  const sh = sheet_('attempts');
  a.row = sh.getLastRow() + 1;
  sh.getRange(a.row, ATTEMPT_KEYS.indexOf('phone') + 1).setNumberFormat('@');
  writeAttempt_(a);
}

function getAttemptByRow_(row) {
  const sh = sheet_('attempts');
  const arr = sh.getRange(row, 1, 1, ATTEMPT_HEADERS.length).getValues()[0];
  return rowToAttempt_(arr, row);
}

function findAttemptRow_(attemptId) {
  const sh = sheet_('attempts');
  const last = sh.getLastRow();
  if (last < 2) return 0;
  const f = sh.getRange(2, 1, last - 1, 1).createTextFinder(attemptId).matchEntireCell(true).matchCase(true).findNext();
  return f ? f.getRow() : 0;
}

function listAttemptsByPhone_(phone) {
  const sh = sheet_('attempts');
  const last = sh.getLastRow();
  if (last < 2) return [];
  const data = sh.getRange(2, 1, last - 1, ATTEMPT_HEADERS.length).getValues();
  const out = [];
  data.forEach(function (arr, i) {
    if (samePhone_(arr[ATTEMPT_KEYS.indexOf('phone')], phone)) out.push(rowToAttempt_(arr, i + 2));
  });
  return out;
}

/** Verify attemptId + token. Returns the attempt (fresh read). */
function authAttempt_(req) {
  const id = String(req.attemptId || '').trim();
  const token = String(req.token || '').trim();
  if (!id || !token || id.length > 40 || token.length > 200) {
    throw apiError_('UNAUTHORIZED', 'جلسة غير صالحة. ابدأ من جديد.');
  }
  const row = findAttemptRow_(id);
  if (!row) throw apiError_('UNAUTHORIZED', 'جلسة غير صالحة. ابدأ من جديد.');
  const a = getAttemptByRow_(row);
  if (a.tokenHash !== hash_(token)) throw apiError_('UNAUTHORIZED', 'جلسة غير صالحة. ابدأ من جديد.');
  return a;
}

function ensureStudent_(name, phone) {
  const sh = sheet_('students');
  const last = sh.getLastRow();
  if (last >= 2) {
    const data = sh.getRange(2, 1, last - 1, STUDENT_HEADERS.length).getValues();
    for (let i = 0; i < data.length; i++) {
      if (samePhone_(data[i][2], phone)) return { id: String(data[i][0]), row: i + 2 };
    }
  }
  const id = 'STU-' + Utilities.getUuid().replace(/-/g, '').substring(0, 8).toUpperCase();
  const row = last + 1;
  sh.getRange(row, 3).setNumberFormat('@');
  sh.getRange(row, 1, 1, STUDENT_HEADERS.length).setValues([[id, name, phone, new Date()]]);
  return { id: id, row: row };
}

/* ------------------------------------------------------------
 * 9) UTILITIES
 * ---------------------------------------------------------- */
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) {
    throw apiError_('BUSY', 'الخادم مشغول حاليًا. حاول مرة أخرى بعد لحظات.');
  }
  try { return fn(); } finally { lock.releaseLock(); }
}

function newToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function hash_(s) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function safeParse_(s, fallback) {
  try { const v = JSON.parse(s); return (v && typeof v === 'object') ? v : fallback; }
  catch (_) { return fallback; }
}

function round2_(n) { return Math.round(Number(n) * 100) / 100; }

/* ------------------------------------------------------------
 * 10) ADMIN TOOLS (run from the Apps Script editor or the Sheet menu)
 * ---------------------------------------------------------- */

/** Creates the 4 sheets with headers and formatting. Safe to run more than once. */
function initializeDatabase() {
  const ss = ss_();
  const defs = [
    ['students', STUDENT_HEADERS],
    ['attempts', ATTEMPT_HEADERS],
    ['answers', ANSWER_HEADERS],
    ['questions', QUESTION_HEADERS]
  ];
  defs.forEach(function (d) {
    let sh = ss.getSheetByName(SHEET_NAMES[d[0]]);
    if (!sh) sh = ss.insertSheet(SHEET_NAMES[d[0]]);
    const headers = d[1];
    if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
    const h = sh.getRange(1, 1, 1, headers.length);
    h.setValues([headers])
     .setBackground('#071A33').setFontColor('#D4AF37').setFontWeight('bold')
     .setHorizontalAlignment('center').setVerticalAlignment('middle');
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 32);
  });

  // Phone columns as plain text so the leading 0 is preserved
  ss.getSheetByName(SHEET_NAMES.students).getRange('C:C').setNumberFormat('@');
  ss.getSheetByName(SHEET_NAMES.attempts).getRange('D:D').setNumberFormat('@');

  // Dates
  ss.getSheetByName(SHEET_NAMES.students).getRange('D2:D').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  ['E2:F', 'L2:L', 'O2:O'].forEach(function (r) {
    ss.getSheetByName(SHEET_NAMES.attempts).getRange(r).setNumberFormat('yyyy-mm-dd hh:mm:ss');
  });

  // Questions sheet: type dropdown, wrapped text, helpful widths
  const q = ss.getSheetByName(SHEET_NAMES.questions);
  q.getRange('C2:C1000').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['MCQ', 'TF'], true).setAllowInvalid(false).build());
  q.getRange('A:H').setWrap(true).setVerticalAlignment('top');
  q.setColumnWidth(2, 380); q.setColumnWidth(4, 320); q.setColumnWidth(7, 260);
  q.getRange('B:B').setHorizontalAlignment('right');
  q.getRange('D:D').setHorizontalAlignment('right');

  // Hide internal columns on the attempts sheet (token hash, drafts, JSON)
  const att = ss.getSheetByName(SHEET_NAMES.attempts);
  [13, 14, 16].forEach(function (c) { att.hideColumns(c); });

  const def = ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 4 && def.getLastRow() === 0) ss.deleteSheet(def);

  clearCache();
  Logger.log('Virelo exam database initialized.');
  return 'OK';
}

/** Checks the Questions sheet and logs every problem it finds. */
function validateQuestionBank() {
  const parsed = parseQuestionSheet_();
  if (parsed.errors.length) {
    Logger.log('PROBLEMS FOUND (' + parsed.errors.length + '):\n' + parsed.errors.join('\n'));
  } else {
    const total = parsed.list.reduce(function (s, q) { return s + q.marks; }, 0);
    Logger.log('OK — ' + parsed.list.length + ' questions, total marks = ' + total);
  }
  return parsed;
}

function clearCache() { CacheService.getScriptCache().remove(CACHE_KEY); }

/** Adds a "Virelo Exam" menu when the script is bound to the Sheet. */
function onOpen() {
  try {
    SpreadsheetApp.getUi().createMenu('Virelo Exam')
      .addItem('Initialize database', 'initializeDatabase')
      .addItem('Validate question bank', 'validateQuestionBankUi_')
      .addItem('Clear question cache', 'clearCache')
      .addItem('Grade expired attempts', 'finalizeExpiredAttempts')
      .addToUi();
  } catch (_) { /* not bound to a spreadsheet */ }
}

function validateQuestionBankUi_() {
  const p = validateQuestionBank();
  const ui = SpreadsheetApp.getUi();
  if (p.errors.length) ui.alert('Question bank problems', p.errors.slice(0, 20).join('\n'), ui.ButtonSet.OK);
  else ui.alert('Question bank OK', p.list.length + ' questions.', ui.ButtonSet.OK);
}
