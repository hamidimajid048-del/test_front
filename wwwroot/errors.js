// Maps Violation API failure reasons (status.description) to user-facing Persian messages.
const ERROR_MESSAGES = {
  InvalidLogin: 'شمارهٔ لاگین معتبر نیست',
  InvalidRelatedLogin: 'لاگین مرتبط معتبر نیست یا با لاگین اصلی یکی است',
  InvalidPagination: 'شمارهٔ صفحه یا اندازهٔ صفحه نامعتبر است',
  InvalidWindow: 'بازهٔ ثانیه قبل/بعد باید بین ۰ و ۱۲۰ باشد',
  InvalidVolumeTolerance: 'درصد تحمل حجم باید بین ۰ و ۱۰۰ باشد',
  MinimumShareRequired: 'حداقل درصد یا حداقل تعداد اشتراک را وارد کنید',
  RelatedAccountNotFound: 'حساب لاگین مرتبط پیدا نشد',
  AccountNotFound: 'حسابی برای این لاگین پیدا نشد',
  AccountSelectionAmbiguous: 'بیش از یک حساب با این لاگین وجود دارد',
  AccountTimeRangeNotReady: 'بازهٔ داده‌های این حساب هنوز آماده نیست',
  AccountTimeRangeInvalid: 'بازهٔ داده‌های این حساب نامعتبر است',
  TypeRequired: 'نوع (IP یا CID) را انتخاب کنید',
  TooManyRelatedLogins: 'تعداد لاگین‌های مرتبط بیش از ۲۰۰۰ است؛ فیلتر را محدودتر کنید',
  TooManyRowsForXlsx: 'تعداد ردیف برای Excel زیاد است؛ خروجی CSV بگیرید',
};

const TIMEOUT_STATUS_CODE = 601;
const TIMEOUT_MESSAGE = 'زمان پاسخ تمام شد؛ فیلتر را محدودتر کنید و دوباره تلاش کنید';

// Returns the Persian message for a ResponseBase status; unknown reasons fall back to the raw description.
function translateStatus(status) {
  if (!status) return '';
  if (status.code === TIMEOUT_STATUS_CODE) return TIMEOUT_MESSAGE;
  return ERROR_MESSAGES[status.description] ?? status.description ?? status.value ?? '';
}
