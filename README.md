# m7md Arabic Resolver v3.2.0

إضافة Stremio شخصية لجلب الترجمات العربية وفحصها وتحويلها إلى SRT بدون ذكاء اصطناعي. لا تولّد الإضافة نصًا ولا تترجمه؛ وتستبعد النتائج التي يوسمها المزود بأنها مترجمة آليًا.

## التثبيت في Stremio

احذف النسخة القديمة ثم ثبّت:

<https://pleasing-gentleness-production.up.railway.app/manifest.json>

بعد التثبيت أغلق Stremio وافتحه مجددًا، ثم اختر ترجمة يبدأ اسمها بـ `m7md Arabic`.

## ما الجديد في 3.2.0

- بوابة جودة فعلية تفحص عدد المقاطع ونسبة الحروف العربية والتغطية الزمنية.
- انتقال آمن إلى بديل عربي عند تعطل الرابط أو فشل الملف في فحص الجودة.
- كل بديل يستخدم خطة التوقيت أو المرجع الخاص به، ولا يرث مرجع نتيجة أخرى.
- إصلاح تطابق صفحة المعاينة مع المرشح الذي يتم اعتماده أو رفضه.
- استبعاد الترجمة الآلية عند الحد النهائي للنتائج، بما في ذلك نتائج السجل الموثقة.
- توكنات ترجمة مضغوطة وموقعة ومحدودة الحجم.
- حماية Vault والسجل والمقاييس وصفحات البحث الإدارية برمز واحد.
- لا توجد مفاتيح أو كلمات مرور مضمّنة في المستودع.

## روابط الاستخدام

- [الصفحة الرئيسية](https://pleasing-gentleness-production.up.railway.app/)
- [Manifest](https://pleasing-gentleness-production.up.railway.app/manifest.json)
- [الحالة العامة](https://pleasing-gentleness-production.up.railway.app/health)
- [البحث والمعاينة](https://pleasing-gentleness-production.up.railway.app/resolver.html)
- [Personal Vault](https://pleasing-gentleness-production.up.railway.app/vault.html)

صفحتا Resolver وVault تطلبان `ADMIN_TOKEN`. أما Manifest ومسارات الترجمات الموقعة فتبقى عامة لأن Stremio يحتاج إلى جلبها مباشرة.

## إعداد Railway

متغيرات الإنتاج الإلزامية:

- `NODE_ENV=production`
- `ENCODING_PROXY_SECRET`: قيمة عشوائية بطول 32 بايت على الأقل.
- `ADMIN_TOKEN`: قيمة عشوائية مختلفة بطول 32 بايت على الأقل.

مفاتيح المزودات اختيارية بحسب المزود المفعّل:

- `OPENSUBTITLES_API_KEY`
- `OPENSUBTITLES_TOKEN`
- `SUBDL_API_KEY`
- `SUBSOURCE_API_KEY`

عند إضافة مفتاح SubSource أضف `subsource` كذلك إلى `SUBTITLE_PROVIDERS`.

للاحتفاظ بمحتوى Vault وسجل النسخ بعد إعادة النشر، اربط Railway Volume بالمسار `/app/data` ثم اضبط:

- `PERSONAL_VAULT_PATH=/app/data/personal-vault.json`
- `VERSION_REGISTRY_PATH=/app/data/version-registry.json`

بدون Volume تظل الخدمة والترجمات الخارجية تعمل، لكن بيانات Vault والسجل المحلي قد تضيع عند إعادة بناء الحاوية.

## التحقق

يجب أن يعيد `/health` استجابة مختصرة مثل:

```json
{"status":"ok","version":"3.2.0","ai":false}
```

تفاصيل المزودات والمقاييس موجودة في `/api/admin/health` و`/metrics` وتتطلب رمز الإدارة.
