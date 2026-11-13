# Virelo Academy — منصة امتحان الوحدة الثانية

**الصف الثاني الثانوي · تكنولوجيا المعلومات والاتصالات (ICT) · الوحدة الثانية · مدة الامتحان 30 دقيقة**

> لا ننافس على الجودة. نقودها — *WE DON'T COMPETE ON QUALITY. WE LEAD IT.*

هذا الدليل يشرح كل شيء من الصفر، بحيث يستطيع أي مطوّر تثبيت المنصة وربطها وتشغيلها دون الحاجة لأي تعليمات إضافية.

---

## الفهرس

1. [نظرة عامة (Project Overview)](#1-نظرة-عامة-project-overview)
2. [التقنيات المستخدمة (Technologies Used)](#2-التقنيات-المستخدمة-technologies-used)
3. [هيكل المشروع (Project Structure)](#3-هيكل-المشروع-project-structure)
4. [المتطلبات (Requirements)](#4-المتطلبات-requirements)
5. [إنشاء Google Sheet](#5-إنشاء-google-sheet)
6. [إنشاء شيتات قاعدة البيانات](#6-إنشاء-شيتات-قاعدة-البيانات)
7. [فتح Google Apps Script](#7-فتح-google-apps-script)
8. [ضبط Code.gs](#8-ضبط-codegs)
9. [ربط Google Sheets بالسكربت](#9-ربط-google-sheets-بالسكربت)
10. [نشر Apps Script كـ Web App](#10-نشر-apps-script-كـ-web-app)
11. [الحصول على رابط النشر (Deployment URL)](#11-الحصول-على-رابط-النشر-deployment-url)
12. [ضبط الواجهة الأمامية (Frontend)](#12-ضبط-الواجهة-الأمامية-frontend)
13. [رفع الشعار واستخدامه](#13-رفع-الشعار-واستخدامه)
14. [إضافة الأسئلة والإجابات](#14-إضافة-الأسئلة-والإجابات)
15. [اختبار الامتحان](#15-اختبار-الامتحان)
16. [النشر على GitHub](#16-النشر-على-github)
17. [النشر على Vercel](#17-النشر-على-vercel)
18. [تحديث الأسئلة](#18-تحديث-الأسئلة)
19. [تغيير مدة الامتحان](#19-تغيير-مدة-الامتحان)
20. [حل المشكلات الشائعة (Troubleshooting)](#20-حل-المشكلات-الشائعة-troubleshooting)
21. [حماية بيانات الطلاب ومفتاح الإجابات](#21-حماية-بيانات-الطلاب-ومفتاح-الإجابات)

---

## 1) نظرة عامة (Project Overview)

منصة امتحان إلكتروني بهوية **Virelo Academy** الرسمية (Navy + Gold + White، خط Cairo للعربية وMontserrat للإنجليزية، اتجاه RTL).

**رحلة الطالب:**

1. شاشة التسجيل: الاسم بالكامل + رقم الهاتف (تحقق من رقم موبايل مصري).
2. ضغط «ابدأ الامتحان» ← إنشاء **Attempt ID** وبدء عدّاد 30 دقيقة من **توقيت الخادم**.
3. واجهة الامتحان: سؤال واحد في كل شاشة، لوحة أسئلة، شريط تقدم، حفظ تلقائي.
4. تسليم يدوي (مع نافذة تأكيد) أو **تسليم تلقائي** عند انتهاء الوقت.
5. صفحة النتيجة: الدرجة، النسبة، صحيح/خطأ/بدون إجابة، مؤشر دائري، مستوى الأداء، تنزيل PDF، مشاركة واتساب.

**أهم ضمانات الأمان:**

| الضمان | كيف يتحقق |
|---|---|
| مفتاح الإجابات لا يصل للمتصفح أبدًا | يُخزَّن في شيت `Questions` ويُقيَّم داخل `Code.gs` فقط |
| لا يمكن التلاعب بالدرجة | المتصفح يرسل **الإجابات فقط**؛ الخادم هو من يحسب الدرجة |
| لا يمكن إعادة ضبط العدّاد | الموعد النهائي (`Deadline`) يُسجَّل على الخادم؛ التسليم المتأخر يُصحَّح من آخر حفظ قبل الموعد |
| لا يوجد تسليم مكرر | `LockService` + فحص حالة المحاولة (العملية idempotent) |
| لا محاولات مكررة | منع أكثر من `MAX_ATTEMPTS` لنفس رقم الهاتف |

---

## 2) التقنيات المستخدمة (Technologies Used)

- **Frontend:** HTML5 · CSS3 (Design Tokens) · JavaScript (Vanilla، بدون مكتبات أو Build)
- **Fonts:** Cairo + Montserrat (Google Fonts)
- **Icons:** SVG بأسلوب Lucide (Sprite مدمج في `index.html`)
- **Backend:** Google Apps Script (Web App) + `LockService` + `CacheService`
- **Database:** Google Sheets
- **Hosting:** Vercel (أو GitHub Pages / أي استضافة ملفات ثابتة)

---

## 3) هيكل المشروع (Project Structure)

```
virelo-unit2-exam/
├── index.html                  ← كل الشاشات (تسجيل، امتحان، نتيجة)
├── README.md
├── css/
│   └── style.css              ← الهوية البصرية + كل التصميم
├── js/
│   ├── config.js              ← ⚙️ إعدادات الواجهة (رابط API، المستويات…)
│   ├── app.js                 ← التشغيل، اتصال API، التسجيل، استرجاع الجلسة
│   ├── exam.js                ← واجهة الامتحان، الحفظ التلقائي، التسليم
│   ├── timer.js               ← العدّاد المتزامن مع الخادم
│   └── results.js             ← صفحة النتيجة
├── assets/
│   ├── logo.png               ← الشعار الرسمي (لا يُعدَّل)
│   └── icons/favicon.png
├── google-apps-script/
│   └── Code.gs                ← 🔒 الخادم + التصحيح (يُنسخ إلى Apps Script)
└── tests/                     ← اختبارات اختيارية للمطوّر (انظر القسم 15)
```

> مهم: مجلد `google-apps-script/` **لا يُرفع إلى Vercel كجزء من الموقع بأي أهمية**؛ يُنسخ يدويًا إلى Apps Script. لا يحتوي `Code.gs` على أي أسرار، لكن لا داعي لنشره.

---

## 4) المتطلبات (Requirements)

- حساب Google (Gmail).
- حساب GitHub (للنشر) وحساب Vercel (مجاني يكفي).
- متصفح حديث (Chrome / Edge / Safari 15+ / Firefox).
- الشعار الرسمي (موجود بالفعل في `assets/logo.png`).
- لا حاجة لـ Node.js أو أي أداة بناء لتشغيل المشروع.

---

## 5) إنشاء Google Sheet

1. افتح <https://sheets.google.com> وأنشئ **Blank spreadsheet**.
2. سمِّه مثلًا: `Virelo — Unit 2 Exam Database`.
3. **اترك الشيت خاصًا (Private)**: لا تضغط Share ولا تفعّل «Anyone with the link». لن يحتاج الطلاب إلى الشيت إطلاقًا.

> 📷 *[Screenshot placeholder: شيت جديد باسم Virelo — Unit 2 Exam Database]*

---

## 6) إنشاء شيتات قاعدة البيانات

لا حاجة لإنشائها يدويًا؛ `Code.gs` يُنشئها بضغطة واحدة (القسم 8). النتيجة أربع شيتات بالأسماء **الحرفية** التالية (لا تغيّرها):

### `Students`
| Student ID | Full Name | Phone Number | Registration Date |
|---|---|---|---|

### `Exam Attempts`
الأعمدة الإحدى عشر الأولى حسب المطلوب، وبعدها أعمدة داخلية يضيفها النظام:

| Attempt ID | Student ID | Student Name | Phone | Start Time | Submission Time | Duration (sec) | Status | Score | Total Marks | Percentage |
|---|---|---|---|---|---|---|---|---|---|---|

أعمدة داخلية (تُخفى تلقائيًا ما يلزم منها): `Deadline` · `Token Hash` · `Draft Answers` · `Last Saved` · `Final Answers` · `Correct` · `Incorrect` · `Unanswered` · `Submit Type`.

قيم `Status`: `IN_PROGRESS` · `SUBMITTED` · `AUTO_SUBMITTED` (عند انتهاء الوقت).

### `Student Answers`
| Attempt ID | Question ID | Student Answer | Is Correct | Marks Earned |
|---|---|---|---|---|

(`Is Correct` = `TRUE` / `FALSE`، وفارغة إذا لم يجب الطالب.)

### `Questions`
| Question ID | Question Text | Question Type | Options | Correct Answer | Marks | Explanation | Image URL |
|---|---|---|---|---|---|---|---|

العمود الأخير `Image URL` (اختياري) أُضيف لدعم صور الأسئلة.

---

## 7) فتح Google Apps Script

1. من داخل الشيت: **Extensions ← Apps Script**.
2. سيفتح محرر جديد ومعه ملف `Code.gs` فيه دالة `myFunction` — **احذف كل محتواه**.
3. افتح الملف `google-apps-script/Code.gs` من هذا المشروع، انسخ كل محتواه والصقه في المحرر.
4. اضغط **Save** (💾) وسمِّ المشروع `Virelo Exam API`.

> لأن السكربت أُنشئ من داخل الشيت (Bound Script)، يتصل بالشيت تلقائيًا ولا تحتاج إلى `Spreadsheet ID` (انظر القسم 9).

---

## 8) ضبط Code.gs

في أعلى الملف يوجد كائن `CONFIG`. كل الإعدادات هنا:

```javascript
const CONFIG = {
  SPREADSHEET_ID: '',            // اتركه فارغًا إذا أنشأت السكربت من داخل الشيت
  EXAM_TITLE: 'امتحان الوحدة الثانية',
  DURATION_SECONDS: 1800,        // 30 دقيقة
  SUBMIT_GRACE_SECONDS: 20,      // سماحية الشبكة عند التسليم الأخير
  TOTAL_MARKS: null,             // null = مجموع عمود Marks تلقائيًا
  MAX_ATTEMPTS: 1,               // عدد المحاولات لكل رقم هاتف
  ALLOW_RESUME_WITH_PHONE: true, // متابعة المحاولة الجارية من جهاز آخر (الوقت لا يُعاد)
  RESUME_REQUIRES_SAME_NAME: true,
  EXAM_OPEN: true,               // مفتاح الإغلاق العام
  AVAILABLE_FROM: '',            // '2026-11-20T09:00:00+02:00'
  AVAILABLE_UNTIL: '',           // '2026-11-20T23:59:00+02:00'
  SHOW_REVIEW_AFTER_SUBMIT: false, // true = إظهار الإجابات الصحيحة بعد التسليم
  QUESTION_CACHE_SECONDS: 300
};
```

**تهيئة قاعدة البيانات (مرة واحدة):**

1. في شريط المحرر اختر الدالة **`initializeDatabase`** من القائمة المنسدلة.
2. اضغط **Run ▶**.
3. في أول تشغيل ستظهر نافذة **Authorization required** ← *Review permissions* ← اختر حسابك ← *Advanced* ← *Go to Virelo Exam API (unsafe)* ← **Allow**. (هذا طبيعي لأن السكربت من تأليفك.)
4. ارجع إلى الشيت: ستجد الشيتات الأربعة بتنسيق Virelo (رأس Navy بخط Gold).

> بعد حفظ السكربت وإعادة فتح الشيت ستظهر قائمة **Virelo Exam** تحتوي: Initialize database · Validate question bank · Clear question cache · Grade expired attempts.

---

## 9) ربط Google Sheets بالسكربت

لديك طريقتان:

**أ) Bound Script (الموصى بها):** كما في القسم 7. اترك `SPREADSHEET_ID: ''`.

**ب) Standalone Script:** أنشئ مشروعًا من <https://script.google.com>، ثم ضع معرّف الشيت:

```javascript
SPREADSHEET_ID: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789',
```

المعرّف هو الجزء الطويل في رابط الشيت بين `/d/` و`/edit`:
`https://docs.google.com/spreadsheets/d/`**`1AbCd…6789`**`/edit`

---

## 10) نشر Apps Script كـ Web App

1. اضغط **Deploy ← New deployment**.
2. اضغط ⚙️ بجانب *Select type* واختر **Web app**.
3. اضبط:
   - **Description:** `Virelo Exam v1`
   - **Execute as:** **Me** (حسابك) — مهم، لكي يصل السكربت للشيت الخاص.
   - **Who has access:** **Anyone**
4. اضغط **Deploy** ووافق على الصلاحيات إن طُلب.

> ⚠️ «Anyone» تعني أن **الواجهة** تستطيع استدعاء الـ API، وليس أن أحدًا يستطيع قراءة الشيت. الشيت يبقى خاصًا، والسكربت لا يعيد إلا ما هو مسموح (أسئلة بدون إجابات، ونتيجة صاحب المحاولة فقط).

> 📷 *[Screenshot placeholder: نافذة New deployment مع Execute as: Me و Who has access: Anyone]*

**عند أي تعديل لاحق في `Code.gs`:** يجب **Deploy ← Manage deployments ← ✏️ Edit ← Version: New version ← Deploy**. الرابط يبقى كما هو. (مجرد Save لا يكفي.)

---

## 11) الحصول على رابط النشر (Deployment URL)

بعد النشر تظهر نافذة فيها **Web app URL** بالشكل:

```
https://script.google.com/macros/s/AKfycb…xxxxxxxx/exec
```

انسخه. للتأكد من عمله افتحه في المتصفح؛ يجب أن ترى:

```json
{"ok":true,"service":"Virelo Academy Exam API","time":1790000000000}
```

---

## 12) ضبط الواجهة الأمامية (Frontend)

افتح `js/config.js` وضع الرابط:

```javascript
window.VIRELO_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycb…/exec',
  // ...
};
```

إعدادات أخرى قابلة للتعديل في نفس الملف:

| الإعداد | الوظيفة |
|---|---|
| `AUTOSAVE_INTERVAL_MS` | فاصل الحفظ الدوري (افتراضي 20 ثانية) |
| `WARN_SECONDS` / `DANGER_SECONDS` | تنبيه 5 دقائق / دقيقة واحدة |
| `LEVELS` | **حدود مستويات الأداء** والرسائل (Excellent / Very Good / Good / Needs Improvement) |
| `FEATURES.PDF_DOWNLOAD` / `WHATSAPP_SHARE` | تفعيل أو إخفاء الأزرار |

مثال لتغيير حدود المستويات:

```javascript
LEVELS: [
  { min: 90, key: 'excellent', label: 'أداء ممتاز', message: '…' },
  { min: 80, key: 'very-good', label: 'جيد جدًا',  message: '…' },
  { min: 65, key: 'good',      label: 'جيد',        message: '…' },
  { min: 0,  key: 'needs',     label: 'يحتاج إلى تحسين', message: '…' }
],
```

> إذا لم يُضبط `API_URL` تظهر للطالب رسالة «الإعداد غير مكتمل» بدل أي نتائج وهمية.

---

## 13) رفع الشعار واستخدامه

- الشعار الرسمي موجود في `assets/logo.png` (مربع 180×180، خلفيته Navy).
- لاستبداله بنسخة أعلى جودة: ضع الملف الجديد **بنفس الاسم** `assets/logo.png` (يفضَّل مربع 512×512 أو أكبر).
- يُعرض في: شاشة التسجيل، رأس الامتحان، شاشة التسليم، صفحة النتيجة، وكعلامة مائية (opacity 7%).
- **لا تغيّر نسب الشعار ولا ألوانه.** الـ CSS يحافظ على `aspect-ratio: 1/1`.
- الأيقونة المصغّرة: `assets/icons/favicon.png`.

---

## 14) إضافة الأسئلة والإجابات

افتح شيت **`Questions`** وأضف سؤالًا في كل صف (من الصف 2). الأعمدة:

| العمود | الوصف |
|---|---|
| `Question ID` | معرّف فريد، مثل `Q01` |
| `Question Text` | نص السؤال كما هو |
| `Question Type` | `MCQ` (اختيار من متعدد) أو `TF` (صح/خطأ) — قائمة منسدلة |
| `Options` | الخيارات مفصولة بـ `\|` أو بسطر جديد داخل الخلية (Alt+Enter). من 2 إلى 8 خيارات |
| `Correct Answer` | حرف الخيار `A`/`B`/`C`/`D` (أو رقمه `1`–`8`، أو `أ`/`ب`/`ج`/`د`، أو نص الخيار نفسه) |
| `Marks` | درجة السؤال (فارغ = 1). تدعم درجات مختلفة لكل سؤال |
| `Explanation` | شرح اختياري — لا يظهر إلا إذا فعّلت `SHOW_REVIEW_AFTER_SUBMIT` |
| `Image URL` | رابط صورة اختياري (`https://…`) |

**شكل توضيحي للصفوف (قوالب فقط — ضع أسئلتك أنت):**

| Question ID | Question Text | Question Type | Options | Correct Answer | Marks |
|---|---|---|---|---|---|
| Q01 | `<نص السؤال>` | MCQ | `<الخيار 1>`\|`<الخيار 2>`\|`<الخيار 3>`\|`<الخيار 4>` | B | 1 |
| Q02 | `<نص السؤال>` | TF | *(فارغ = صح / خطأ)* | A | 1 |

ملاحظات:

- في `TF` إذا تركت `Options` فارغًا تظهر «صح» ثم «خطأ» (A = صح، B = خطأ). يمكنك كتابة `Correct Answer` بقيمة `صح` أو `خطأ` أيضًا.
- **لا تغيّر ترتيب الخيارات بعد بدء الامتحان**؛ لأن الإجابة المحفوظة هي حرف الخيار.
- النظام **لا يضيف ولا يعدّل** أي نص: كل ما تكتبه يظهر كما هو.

**التحقق من بنك الأسئلة:** من قائمة **Virelo Exam ← Validate question bank** (أو شغّل `validateQuestionBank` وراجع *Execution log*). يكشف: معرّفات مكررة، إجابة صحيحة غير مفهومة، خيارات أقل من 2، درجة غير صالحة. إذا كان البنك غير صالح **يرفض النظام بدء الامتحان** بدل أن يصحّح بشكل خاطئ.

---

## 15) اختبار الامتحان

**قبل الامتحان الحقيقي**، نفّذ هذه القائمة (جرّب بأرقام هواتف تجريبية ثم احذف صفوفها من الشيتات):

| # | الاختبار | المتوقع |
|---|---|---|
| 1 | تسجيل بدون اسم/هاتف | رسائل خطأ بالعربية |
| 2 | هاتف `0123` | «رقم الهاتف غير صحيح» |
| 3 | هاتف بأرقام عربية `٠١٠…` | يُحوَّل تلقائيًا |
| 4 | بدء الامتحان | يظهر العدّاد 30:00 وصف في `Exam Attempts` بحالة `IN_PROGRESS` |
| 5 | الإجابة ثم **Refresh** | الإجابات والسؤال الحالي كما هي، والعدّاد **لم يُعَد** |
| 6 | الإجابة ثم فحص `Draft Answers` | يظهر الحفظ التلقائي في الشيت |
| 7 | Previous / Next / لوحة الأسئلة | تعمل ويتحدّث عدد المُجاب |
| 8 | تسليم يدوي | نافذة التأكيد بالأعداد ← صفحة النتيجة |
| 9 | إعادة محاولة بنفس الهاتف | «استنفدت عدد المحاولات» |
| 10 | تسليم تلقائي: اضبط `DURATION_SECONDS: 60` مؤقتًا | تسليم عند الصفر وحالة `AUTO_SUBMITTED` |
| 11 | قطع الإنترنت لحظة التسليم | «سنعيد المحاولة تلقائيًا» ثم ينجح عند الرجوع، دون تكرار |
| 12 | هاتف/موبايل | بدون تمرير أفقي، الأزرار كبيرة، العدّاد ثابت أعلى الشاشة |
| 13 | تحقق من الدرجات يدويًا في `Student Answers` | تطابق الدرجة النهائية |

**اختبارات آلية (اختيارية للمطوّر):** مجلد `tests/` يحتوي:

- `gas_mock_test.js` — يشغّل `Code.gs` على نسخة وهمية من Google Sheets في Node.js ويتحقق من التصحيح، الأمان، منع التكرار، الموعد النهائي (`node tests/gas_mock_test.js`).
- `mock_server.js` + `e2e.py` — اختبار متصفح كامل (Playwright) لرحلة الطالب. تستخدم بيانات تجريبية داخلية فقط وليست من محتوى الامتحان.

> **حاليًا لا يحتوي شيت `Questions` على أي أسئلة** (بانتظار بنك الأسئلة الرسمي)، لذلك سيُظهر النظام «لم يتم إضافة أسئلة للامتحان بعد» حتى تضيفها.

---

## 16) النشر على GitHub

```bash
cd virelo-unit2-exam
git init
git add .
git commit -m "Virelo Academy – Unit 2 exam platform"
git branch -M main
git remote add origin https://github.com/<USERNAME>/virelo-unit2-exam.git
git push -u origin main
```

(أنشئ المستودع أولًا من <https://github.com/new>، ويفضَّل **Private**.) لا توجد أسرار في الواجهة؛ رابط الـ API وحده لا يكشف الشيت ولا مفتاح الإجابات.

---

## 17) النشر على Vercel

1. ادخل <https://vercel.com> ← **Add New… ← Project** ← **Import** مستودع GitHub.
2. **Framework Preset:** `Other` · **Build Command:** *(فارغ)* · **Output Directory:** *(فارغ / `.`)*.
3. اضغط **Deploy**. ستحصل على رابط مثل `https://virelo-unit2-exam.vercel.app`.
4. أي `git push` جديد يُنشر تلقائيًا.

*(بديل بلا GitHub: `npm i -g vercel` ثم `vercel --prod` داخل مجلد المشروع.)*

اختياري — ملف `vercel.json` لمنع الفهرسة وتحسين الأمان:

```json
{
  "headers": [{
    "source": "/(.*)",
    "headers": [
      { "key": "X-Robots-Tag", "value": "noindex" },
      { "key": "X-Content-Type-Options", "value": "nosniff" },
      { "key": "Referrer-Policy", "value": "no-referrer" }
    ]
  }]
}
```

---

## 18) تحديث الأسئلة

1. عدّل الصفوف في شيت `Questions`.
2. شغّل **Virelo Exam ← Validate question bank**.
3. شغّل **Clear question cache** (أو انتظر 5 دقائق — `QUESTION_CACHE_SECONDS`).
4. لا حاجة لإعادة نشر Apps Script ولا لتعديل الواجهة.

⚠️ لا تعدّل الأسئلة أو ترتيب الخيارات أثناء امتحان جارٍ.

---

## 19) تغيير مدة الامتحان

في `Code.gs`:

```javascript
DURATION_SECONDS: 2700,   // 45 دقيقة
```

ثم **Deploy ← Manage deployments ← Edit ← New version ← Deploy**.
الواجهة تقرأ المدة من الخادم تلقائيًا (لا تعدّل شيئًا في `js/`). المحاولات الجارية تحتفظ بموعدها الأصلي.

---

## 20) حل المشكلات الشائعة (Troubleshooting)

| المشكلة | السبب والحل |
|---|---|
| «الإعداد غير مكتمل» | لم يُضبط `API_URL` في `js/config.js`، أو لا يبدأ بـ `https://script.google.com/…` |
| «تعذر الاتصال بالخادم» | تأكد أن النشر **Anyone** و**Execute as: Me**؛ افتح الرابط في المتصفح وتأكد من ظهور JSON |
| التعديلات في `Code.gs` لا تظهر | لم تنشر **New version** (القسم 10) |
| «قاعدة البيانات غير مهيأة» | شغّل `initializeDatabase` |
| «لم يتم إضافة أسئلة للامتحان بعد» | شيت `Questions` فارغ |
| «بنك الأسئلة غير مكتمل» | شغّل **Validate question bank** وراجع الأخطاء |
| رقم الهاتف يفقد الصفر الأول | العمود يجب أن يكون **Plain text** (`initializeDatabase` يضبطه) |
| «الخادم مشغول» | ازدحام: السكربت يعالج الطلبات بالتتابع؛ يعيد الطالب المحاولة تلقائيًا |
| شاشة بيضاء/أخطاء في Console | افتح DevTools ← Console. تحقق من تحميل `js/*.js` بمساراتها الصحيحة |
| الخطوط لا تظهر | يحتاج الجهاز اتصالًا بـ Google Fonts؛ يوجد بديل (Tahoma/Segoe UI) |
| `Authorization required` عند Deploy | طبيعي في أول مرة: Review permissions ← Advanced ← Allow |
| طالب أغلق المتصفح قبل التسليم | يعود بنفس الاسم والهاتف ويكمل (الوقت لم يتوقف). وإن لم يعد، شغّل `finalizeExpiredAttempts` (انظر أدناه) |

**تصحيح المحاولات المتروكة تلقائيًا:** في Apps Script اختر **Triggers (⏰) ← Add Trigger** ← الدالة `finalizeExpiredAttempts` ← *Time-driven* ← *Minutes timer* ← *Every 5 minutes*. تصحّح أي محاولة انتهى وقتها ولم تُسلَّم، من آخر إجابات محفوظة.

**حدود Google (مهمة للطلبات الكبيرة):** حسابات Gmail المجانية لها حد لتنفيذات متزامنة (نحو 30). للمجموعات الكبيرة جدًا (مئات الطلاب في نفس اللحظة): استخدم حساب Google Workspace، وأخرِج بدء الطلاب على دفعات، وارفع `AUTOSAVE_INTERVAL_MS` إلى 30000.

---

## 21) حماية بيانات الطلاب ومفتاح الإجابات

- **الشيت خاص:** لا تشاركه إلا مع المشرفين بصلاحية *Editor* لأسماء محددة، ولا تفعّل رابط المشاركة العام.
- **مفتاح الإجابات:** موجود فقط في عمود `Correct Answer` داخل الشيت. الخادم لا يرسله في أي استجابة قبل التسليم، ولا يُرسَل بعده إلا إذا فعّلت `SHOW_REVIEW_AFTER_SUBMIT`.
- **رمز المحاولة (Token):** يُنشأ عشوائيًا لكل محاولة، ويُخزَّن **Hash (SHA-256)** فقط. كل طلب (حفظ/تسليم/نتيجة) يحتاج `Attempt ID + Token`، فلا يستطيع طالب قراءة نتيجة غيره.
- **الدرجات:** تُحسب على الخادم فقط؛ أي قيمة `score` يرسلها المتصفح تُتجاهل.
- **الوقت:** بتوقيت الخادم؛ تعديل ساعة الجهاز أو `localStorage` لا يطيل الوقت.
- **الأعمدة المخفية** (`Token Hash`, `Draft Answers`, `Final Answers`) إخفاؤها للتنظيم فقط، والحماية الحقيقية هي أن الشيت خاص.
- **خصوصية البيانات:** الاسم ورقم الهاتف بيانات شخصية؛ احذفها أو صدّرها بعد انتهاء الاستخدام، ولا تنشر ملف النتائج علنًا.
- **ما لا يمنعه النظام تقنيًا:** تصوير الشاشة أو مشاركة الأسئلة بين الطلاب أثناء الامتحان؛ هذه تحتاج رقابة تنظيمية.
- **نسخة احتياطية:** *File ← Make a copy* للشيت بعد كل امتحان.

---

### الهوية البصرية (Design Tokens)

كل الألوان والمسافات في أعلى `css/style.css` ضمن `:root`:

```css
--navy:#071A33; --navy-2:#102746; --gold:#D4AF37; --white:#FFFFFF;
--bg:#F5F7FA;  --text-2:#64748B; --success:#16A34A; --error:#DC2626;
```

سلّم المسافات 8px، ونصف الأقطار 8/12/16/20/24، والحركة 180–500ms بـ `ease-out`. يُستخدم الذهبي كلون تمييز فقط (حدود، تقدّم، حالة الاختيار)، وزر التسليم بنمط **Dark CTA** (كحلي) حتى لا يختلط بلون اختيار الإجابة.

**Virelo Academy — WE DON'T COMPETE ON QUALITY. WE LEAD IT.**
