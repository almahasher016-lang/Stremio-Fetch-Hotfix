# m7md Arabic Resolver v3.1.3

إضافة Stremio شخصية لأبو عبدالرحمن، مخصصة لجلب الترجمات العربية وفحصها وتحويلها إلى SRT بدون ذكاء اصطناعي. ترفض الملفات الموسومة عربيًا بالخطأ، وتنتقل تلقائيًا إلى أفضل بديل عربي متاح.

## التثبيت الصحيح في Stremio

احذف أي نسخة قديمة من الإضافة، ثم ثبّت الرابط التالي:

<https://pleasing-gentleness-production.up.railway.app/manifest.json>

بعد التثبيت أغلق Stremio وافتحه مجددًا، ثم اختر ترجمة يبدأ اسمها بـ `m7md Arabic`.

## روابط الاستخدام

- [الصفحة الرئيسية](https://pleasing-gentleness-production.up.railway.app/)
- [اختبار فيلم أو مسلسل](https://pleasing-gentleness-production.up.railway.app/test.html)
- [البحث والمعاينة والاعتماد أو الرفض](https://pleasing-gentleness-production.up.railway.app/resolver.html)
- [إدارة الترجمات الشخصية](https://pleasing-gentleness-production.up.railway.app/vault.html)
- [حالة الخادم والمزوّدين](https://pleasing-gentleness-production.up.railway.app/health)

## خيارات الترجمة داخل Stremio

- `Reference Sync`: يضبط التوقيت بالاعتماد على ترجمة مرجعية متوافقة.
- `Original`: يعرض الترجمة بتوقيتها الأصلي.
- عند اكتشاف ملف غير عربي أو رابط متعطل، تنتقل الإضافة تلقائيًا إلى المرشح العربي التالي.

## إذا لم تظهر الترجمة العربية

1. افتح [حالة الخادم](https://pleasing-gentleness-production.up.railway.app/health) وتأكد أن `status` يساوي `ok` وأن الإصدار هو `3.1.3`.
2. احذف الإضافة القديمة من Stremio وثبّت رابط Manifest الموجود أعلاه.
3. أغلق Stremio بالكامل ثم افتحه من جديد.
4. استخدم [صفحة الاختبار](https://pleasing-gentleness-production.up.railway.app/test.html) للتأكد من وجود نتائج للعمل نفسه.

## ملاحظات تخص المشروع

- لا تحتاج إلى تشغيل خادم أو كتابة أوامر؛ Railway يشغّل المشروع ويحدّثه تلقائيًا من GitHub.
- لا تحتاج إلى إضافة Variables أو إدخال مفاتيح عند الاستخدام.
- يعمل المشروع بدون ذكاء اصطناعي.
- بيانات الاعتماد والترجمات التي تحفظها عبر Vault تبقى بعد إعادة النشر فقط عند ربط Railway Volume بالمسار `/app/data`.
