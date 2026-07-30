# m7md Arabic Resolver v3.5.0

إضافة Stremio شخصية لجلب الترجمات العربية وفحصها وتحويلها إلى SRT بدون ذكاء اصطناعي. لا تولّد الإضافة نصًا ولا تترجمه؛ وتستبعد النتائج التي يوسمها المزود بأنها مترجمة آليًا.

## التثبيت والتحديث في Stremio

استخدم رابط Manifest الثابت نفسه للتثبيت أو التحديث:

<https://pleasing-gentleness-production.up.railway.app/manifest.json>

معرّف الإضافة ثابت، ولذلك يحافظ الإصدار الجديد على تسجيل الإضافة الحالي. بعد اكتمال نشر Railway أغلق Stremio وافتحه مجددًا ليعيد قراءة Manifest.

## ما الجديد في 3.5.0

- حدود طلبات موزعة عبر Redis بدل عدادات مستقلة لكل نسخة خادم.
- Singleflight محلي وقفل Redis موزع لمنع تكرار جلب المزودات عند الطلبات المتزامنة.
- تشغيل Docker كمستخدم غير root، بصورة Node مثبتة على Digest، ودعم نظام ملفات Read-only.
- تثبيت جميع GitHub Actions على SHA كامل غير قابل للتحريك.
- إضافة ESLint وTypeScript كبوابات فحص إلزامية.
- إضافة OpenTelemetry لتتبّع Express وHTTP وUndici عبر OTLP/HTTP.
- إضافة CodeQL وCycloneDX SBOM وTrivy وDependabot لسلسلة التوريد.
- تفعيل Content Security Policy باستخدام Nonce تلقائي لجميع واجهات HTML.

تعتمد المطابقة الأدق على `videoHash` أولًا، ثم اسم ملف الفيديو الذي يرسله Stremio. عند توفر اسم الإصدار، لا تستطيع أولوية المزود وحدها دفع نتيجة أقل تطابقًا إلى المركز الأول.

## Companion المحلي

لفحص ملف واحد وحفظ هويته:

```powershell
npm run companion:scan -- "D:\Movies\Movie.mkv" --server https://pleasing-gentleness-production.up.railway.app --imdb tt1375666
```

لمراقبة مكتبة كاملة وفحص الملفات الجديدة فقط:

```powershell
npm run companion:scan -- --watch "D:\Media" --server https://pleasing-gentleness-production.up.railway.app --extract-arabic
```

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

اربط Redis بالخدمة واضبط `REDIS_URL` حتى تصبح حدود الطلبات والكاش وأقفال Singleflight مشتركة بين جميع النسخ. عند غياب Redis يستمر التطبيق بالعمل بكاش وحدود محلية.

لتفعيل التتبّع اضبط `ENABLE_TRACING=true` و`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` على مسار OTLP/HTTP منتهيًا بـ `/v1/traces`.

للاحتفاظ بمحتوى Vault وسجل النسخ بعد إعادة النشر، اربط Railway Volume بالمسار `/app/data` ثم اضبط:

- `PERSONAL_VAULT_PATH=/app/data/personal-vault.json`
- `VERSION_REGISTRY_PATH=/app/data/version-registry.json`

## التحقق

يجب أن يعيد `/health`:

```json
{"status":"ok","version":"3.5.0","ai":false}
```

تفاصيل المزودات والكاش والتتبّع موجودة في `/admin.html` و`/api/admin/health` و`/metrics` وتتطلب رمز الإدارة.
