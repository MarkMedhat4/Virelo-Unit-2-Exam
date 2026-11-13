/* ==========================================================
   VIRELO ACADEMY — Frontend configuration
   NOTE: nothing secret belongs here. The answer key and the
   spreadsheet live only in Google Apps Script (Code.gs).
   ========================================================== */
window.VIRELO_CONFIG = {
  // Paste the Web App URL obtained after deploying Code.gs
  // (it ends with /exec). See README section 11–12.
  API_URL: 'https://script.google.com/macros/s/AKfycbzlRufxPLm-yHWVisnHO_31KilBxFqstG11WrqCmOGJ5yTiW7McM7TyQ7zjA2gKGSY/exec',

  EXAM_TITLE: 'امتحان الوحدة الثانية',

  // Auto-save
  AUTOSAVE_INTERVAL_MS: 20000,   // periodic save while answers are unsaved
  AUTOSAVE_DEBOUNCE_MS: 700,     // save shortly after each answer change

  // Timer warnings (seconds remaining)
  WARN_SECONDS: 300,             // 5 minutes
  DANGER_SECONDS: 60,            // 1 minute

  // Results page — thresholds are by percentage (highest first)
  LEVELS: [
    { min: 85, key: 'excellent', label: 'أداء ممتاز',
      message: 'نتيجة رائعة تعكس تحضيرًا متميزًا. واصل بنفس المستوى.' },
    { min: 75, key: 'very-good', label: 'جيد جدًا',
      message: 'أداء قوي. مراجعة بسيطة للنقاط المتبقية ستصل بك إلى التميز.' },
    { min: 60, key: 'good', label: 'جيد',
      message: 'مستوى جيد. ننصحك بمراجعة الدروس التي أخطأت فيها لتحسين نتيجتك.' },
    { min: 0, key: 'needs', label: 'يحتاج إلى تحسين',
      message: 'لا تقلق، التحسن ممكن. راجع الوحدة بتركيز وتواصل مع مدرسك عند الحاجة.' }
  ],

  FEATURES: {
    PDF_DOWNLOAD: true,      // opens the browser's "Save as PDF" for the results page
    WHATSAPP_SHARE: true
  },

  STORAGE_KEY: 'virelo_unit2_session_v1',
  TIMEZONE: 'Africa/Cairo'
};
