# m7md Arabic Resolver v3.5.5

إضافة Stremio شخصية لجلب الترجمات العربية وفحصها وتحويلها إلى SRT بدون ذكاء اصطناعي.

## التثبيت والتحديث

استخدم رابط Manifest الثابت:

<https://pleasing-gentleness-production.up.railway.app/manifest.json>

معرّف الإضافة ثابت. بعد نشر Railway أغلق Stremio وافتحه مجددًا ليعيد قراءة Manifest.

## ما الجديد في 3.5.5

- إضافة محدد مستقل لمحاولات المصادقة الإدارية على `/api/*` و`/metrics` والتنزيلات الخاصة، مع عدم احتساب الطلبات الناجحة.
- جعل `CACHE_STALE_WHILE_REVALIDATE=false` القيمة الأساسية حتى تكتمل طبقة الكاش ثنائية العمر.
- تعطيل واجهة الاختبار افتراضيًا في الإنتاج، مع إبقائها قابلة للتفعيل الصريح.
- اشتراط `ADMIN_TOKEN` صراحةً في الإنتاج والتحذير من متغيرات التوكن القديمة.
- رفع الحد الأدنى لـMorgan إلى 1.11.0 وتثبيته عبر lockfile.
- إضافة إغلاق قسري للاتصالات المتبقية قبل مهلة الخروج، ومسار favicon بلا 404، واستجابة 404 موحدة.
- نقل الصفحة الرئيسية إلى `src/ui/homeHtml.js` وإضافة `SECURITY.md`.

## ما الجديد في 3.5.4

- إزالة الاعتراض العالمي على `express.application.use` و`res.end` الذي كان يتعارض مع `compression` ويقطع استجابات SRT وHTML.
- تجهيز الجسم داخل المسار نفسه عبر `sendSrtResponse` و`sendStyledSubtitleResponse` و`sendHtmlResponse`.
- استخدام مرسل SRT نفسه في `/proxy/encoding` وPersonal Vault، ومرسل مستقل لـASS وSSA.
- تطبيق تثبيت اتجاه العربية قبل الإرسال، ثم ضغط الأجسام النصية المكتملة فقط.
- استخدام nonce واحد من `res.locals.cspNonce` في ترويسة CSP ووسوم `script` و`style`، مع اختبار حي يمنع اختلافهما.
- إضافة اختبار Express حقيقي مع `compression` لـSRT صغير وكبير وASS وHTML بعد فك الضغط.
- إبقاء `ADDON_NAME` المخصص دون إضافة رقم الإصدار إليه.
- توحيد Redis على اتصال مشترك واحد يسمح بإعادة المحاولة بعد فشل مؤقت.
- إصلاح إيقاف OpenTelemetry وأنواع إشارات Node.
- إبقاء `Original` أول خيار، مع تغيير معرّفات الخيارات حسب الإصدار لكسر كاش Stremio القديم.

## ملاحظات 3.5.1–3.5.3

أضاف 3.5.1 تثبيت علامات الترقيم العربية. أزال 3.5.2 التعديل المتأخر بعد اكتشاف خطر التعامل مع بيانات مضغوطة. حاول 3.5.3 إعادة التثبيت باعتراض عام للاستجابة، لكن اختبارًا تكامليًا كشف تعارضه مع `compression`. يستبدل 3.5.4 ذلك الأسلوب بالكامل بإرسال صريح داخل كل مسار.

## الإعداد

متغيرات الإنتاج الإلزامية:

- `NODE_ENV=production`
- `ENCODING_PROXY_SECRET`: قيمة مختلفة وعشوائية بطول 32 بايت على الأقل.
- `ADMIN_TOKEN`: قيمة مختلفة وعشوائية بطول 32 بايت على الأقل.

اربط Redis واضبط `REDIS_URL` لاستخدام الكاش وحدود الطلبات والأقفال الموزعة. يستخدم الكاش ومحدد المعدل اتصال Redis مشتركًا واحدًا.

اترك `CACHE_STALE_WHILE_REVALIDATE` غير مضبوط أو اضبطه على `false` حتى تُنفذ طبقة SWR الجديدة التي تفصل نتائج البحث عن روابط التنزيل قصيرة العمر.

لتفعيل التتبّع اضبط `ENABLE_TRACING=true` و`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`.

## الروابط

- [الحالة العامة](https://pleasing-gentleness-production.up.railway.app/health)
- [البحث والمعاينة](https://pleasing-gentleness-production.up.railway.app/resolver.html)
- [Personal Vault](https://pleasing-gentleness-production.up.railway.app/vault.html)
- [لوحة الإدارة](https://pleasing-gentleness-production.up.railway.app/admin.html)

## سلسلة التوريد

يجب الالتزام بملف `package-lock.json` المتزامن مع `package.json`، ثم استخدام `npm ci` في CI وDocker. يولّد CI أيضًا CycloneDX SBOM.

## التحقق

```json
{"status":"ok","version":"3.5.5","ai":false}
```

بوابات الدمج المطلوبة: ESLint، TypeScript، الاختبارات والتغطية، `npm audit --omit=dev --audit-level=high`، CodeQL، بناء Docker، وTrivy.
