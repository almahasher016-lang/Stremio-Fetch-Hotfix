# m7md Arabic Resolver v3.3.0

إضافة Stremio شخصية لجلب الترجمات العربية وفحصها وتحويلها إلى SRT بدون ذكاء اصطناعي. لا تولّد الإضافة نصًا ولا تترجمه؛ وتستبعد النتائج التي يوسمها المزود بأنها مترجمة آليًا.

## التثبيت في Stremio

احذف النسخة القديمة ثم ثبّت:

<https://pleasing-gentleness-production.up.railway.app/manifest.json>

بعد التثبيت أغلق Stremio وافتحه مجددًا، ثم اختر ترجمة يبدأ اسمها بـ `m7md Arabic`.

## ما الجديد في 3.3.0

- ترتيب حاسم حسب إصدار الفيديو قبل شعبية المزود: الدقة والمصدر وخدمة البث والترميز وHDR والصوت والقنوات وFPS وRelease Group.
- تمييز `WEBRip` عن `WEB-DL` وتوحيد أسماء `AMZN / NF / DSNP / ATVP / HMAX` ومرادفات `x265 / HEVC` حتميًا.
- إظهار `🎯 Exact Release` أو `✅ Release Match` داخل Stremio للنتائج الأقوى.
- قاطع أعطال كامل بحالة Half‑Open ومحاولة اختبار واحدة وExponential Backoff وإعادة ضبط يدوية.
- Retry يحترم `Retry-After` ويستخدم Exponential Backoff مع jitter.
- حد تزامن وفاصل طلبات مستقل لكل مزود، بدل مشاركة حد واحد بين الجميع.
- مقاييس P50/P95 وHistogram وزمن المزودات ونسبة إصابة L1/Redis.
- لوحة إدارة لمسح كاش البحث أو المعالجة، ومشاهدة المزودات، وإعادة ضبط Circuit Breaker.
- رفع ملفات الترجمة إلى Vault بالسحب والإفلات مع تصدير واستعادة نسخة JSON موثوقة.

تعتمد المطابقة الأدق على `videoHash` أولًا، ثم اسم ملف الفيديو الذي يرسله Stremio. عند توفر اسم الإصدار، لا تستطيع أولوية المزود وحدها دفع نتيجة أقل تطابقًا إلى المركز الأول.

## روابط الاستخدام

- [الصفحة الرئيسية](https://pleasing-gentleness-production.up.railway.app/)
- [Manifest](https://pleasing-gentleness-production.up.railway.app/manifest.json)
- [الحالة العامة](https://pleasing-gentleness-production.up.railway.app/health)
- [البحث والمعاينة](https://pleasing-gentleness-production.up.railway.app/resolver.html)
- [Personal Vault](https://pleasing-gentleness-production.up.railway.app/vault.html)
- [لوحة الإدارة](https://pleasing-gentleness-production.up.railway.app/admin.html)

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
{"status":"ok","version":"3.3.0","ai":false}
```

تفاصيل المزودات والمقاييس موجودة في `/admin.html` و`/api/admin/health` و`/metrics` وتتطلب رمز الإدارة.
