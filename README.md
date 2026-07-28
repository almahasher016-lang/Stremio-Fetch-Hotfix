# m7md Arabic Resolver v3.4.0

إضافة Stremio شخصية لجلب الترجمات العربية وفحصها وتحويلها إلى SRT بدون ذكاء اصطناعي. لا تولّد الإضافة نصًا ولا تترجمه؛ وتستبعد النتائج التي يوسمها المزود بأنها مترجمة آليًا.

## التثبيت في Stremio

احذف النسخة القديمة ثم ثبّت:

<https://pleasing-gentleness-production.up.railway.app/manifest.json>

بعد التثبيت أغلق Stremio وافتحه مجددًا، ثم اختر ترجمة يبدأ اسمها بـ `m7md Arabic`.

## ما الجديد في 3.4.0

- حفظ تنسيق `ASS/SSA` الأصلي كخيار إضافي مع الألوان والمواضع والخطوط، مع إبقاء نسخة `SRT` الآمنة.
- إصلاح CORS لمسار الترجمة المنسقة ليعمل من Stremio Desktop وStremio Web.
- تمييز نسخ `Extended` و`Director's Cut` و`Theatrical` و`Unrated` و`IMAX` و`Remastered` عند الترتيب.
- منع ترجمة إصدار عادي من تجاوز ترجمة النسخة الخاصة المطابقة، حتى لو كان مزودها أعلى أولوية.
- قراءة FPS والدقة وترميز الفيديو وHDR والصوت والقنوات والحاوية فعليًا عبر `ffprobe`.
- حفظ الموسم والحلقة والهوية التقنية من Companion واستعادتها عند طلب Stremio اللاحق.
- فحص مجلد الوسائط كاملًا ومراقبته دوريًا، مع فهرس محلي يمنع إعادة هاش الملفات التي لم تتغير.

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

يُحفظ فهرس المراقبة باسم `.m7md-companion-index.json` داخل المجلد. استخدم `--rescan` لإعادة فحص جميع الملفات عمدًا.

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
{"status":"ok","version":"3.4.0","ai":false}
```

تفاصيل المزودات والمقاييس موجودة في `/admin.html` و`/api/admin/health` و`/metrics` وتتطلب رمز الإدارة.
