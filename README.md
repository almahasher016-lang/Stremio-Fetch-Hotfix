# m7md Arabic Resolver v4.5.0

إضافة Stremio شخصية لجلب الترجمات العربية وفحصها وتحويلها إلى SRT بدون ذكاء اصطناعي.

## التثبيت والتحديث

استخدم رابط Manifest الثابت:

<https://pleasing-gentleness-production.up.railway.app/manifest.json>

معرّف الإضافة ثابت. بعد نشر Railway أغلق Stremio وافتحه مجددًا ليعيد قراءة Manifest.

## ما الجديد في 4.5.0

- أصبح اختيار الترجمة يقيس **توقيت الـcues الفعلي** مقابل مرجع إنجليزي مطابق لـ`videoHash` نفسه، بدل الاكتفاء باسم الإصدار وBluRay/WEB/FPS.
- تستخدم أفضل الترجمات العربية فحصًا زمنيًا محدودًا (Temporal Anchors + DTW) وتظهر الترجمة المصطفّة فعليًا قبل ترجمة تحمل اسم إصدار أفضل لكنها مختلفة زمنيًا.
- إذا لم توجد ترجمة مصطفّة لكن وُجدت ترجمة قابلة للتصحيح بثقة عالية جدًا، يمكن تصحيح توقيتها تلقائيًا **فقط** بمرجع Exact-Hash لنفس الفيديو.
- المزامنة العامة المبنية على التخمين أو اسم الملف ما زالت مغلقة افتراضيًا.
- لا توجد قواعد خاصة بفيلم أو مسلسل بعينه؛ الاختبارات تغطي اختلاف الـcuts والنسخ كحالات عامة.

## ما الجديد في 4.4.2

- في دورة `degraded` يتم دمج النتائج الجزئية مع Final Arabic LKG **قبل إرسال الاستجابة إلى Stremio**، وليس فقط عند تحديث Redis.
- إذا لم يوجد Last-Good سابق، تُعرض النتيجة الجزئية الحالية للمستخدم لكنها لا تُعتمد كـFinal LKG.
- بعد الدمج يعاد Accuracy Preflight + Accuracy-First بالقواعد الحالية قبل الإرجاع.

## ما الجديد في 4.4.1

- منع `partial-result poisoning`: تعطل بعض المزودات لا يسمح لقائمة جزئية من نتيجة أو نتيجتين بمسح مجموعة مرشحين أفضل محفوظة سابقًا.
- دمج نتائج البحث الجديدة مع آخر Candidate Pool صالح ثم إعادة ترتيبها بالقواعد الحالية قبل تحديث Redis.
- تطبيق الحماية نفسها على background refresh وFinal Arabic LKG مع إبقاء Exact Hash أقوى دليل.
- أصبح `minRankScore` فلترًا بعد Accuracy-First، مع إنقاذ المرشح ذي الدليل الزمني القوي بدل حذفه مبكرًا.
- دورة المزودات تُصنّف `complete/degraded/failed`: الدمج مع النتائج القديمة يحدث فقط عند تدهور حقيقي، أما الدورة الكاملة فتستبدل الكاش.
- أضيف Regression Corpus دائم لحالات التوافق، يبدأ بحالة House of the Dragon BluRay مقابل WEB.

## ما الجديد في 4.4.0

- تطبيق Accuracy-First على كامل مجموعة المرشحين قبل قص `TOP_N` حتى لا تختفي ترجمة متوافقة زمنيًا بسبب Score أولي أقل.
- جعل مرحلة exact-hash تعتمد على `videoHash + videoSize` دون خلطها مع filename/IMDb/TMDB الأضعف.
- إضافة Exact-Hash English Timing Reference كدليل ترتيب سلبي/آمن عند توفره، دون تشغيل مزامنة زمنية تلقائية عامة.
- إزالة الانحياز الدائري من Reference lookup: المرجع يُبحث بهوية ملف الفيديو الحقيقي لا باسم ترجمة عربية مرشحة.
- توسيع Source Family لتمييز `WEB.Remux/WEBMux` عن `BDRemux/BDMV/BluRay REMUX`.
- تحويل Final Arabic LKG إلى fallback للتوافر فقط بدل أن يجمد ترتيبًا أقدم، وخفض Search cache الافتراضي إلى 15 دقيقة لاكتشاف ترجمات أفضل أسرع.

## ما الجديد في 4.0.0

- Accuracy Preflight يفحص محتوى أفضل 3 مرشحين فعليًا قبل العرض، مع مهلة قصيرة وكاش Redis مشترك.
- الإقصاء الصلب مقتصر على فشل محتوى مؤكد مثل ملف غير عربي أو بلا cues صالحة؛ Hash/Release evidence لا يُهزم بمجرد درجة جودة أقل.
- Explainability منظّم يوضح لماذا جاءت كل ترجمة في ترتيبها عبر `/api/explain` وواجهة preview.
- SLO runtime evaluator عبر `/api/admin/slo` مع HTTP p95/p99، 5xx ratio، Event Loop، provider health، وpreflight availability.
- Prometheus alert rules وGrafana dashboard جاهزان تحت `ops/`، مع metrics جديدة للـAccuracy Preflight.
- يستمر التشغيل على PostgreSQL + Redis و2 Railway replicas مع نفس Addon ID.

## ما الجديد في 3.9.0

- YIFY Last-Known-Good parsed results are retained in Redis and used during anti-bot/layout/upstream outages.
- Text/HTML provider requests now propagate `Retry-After` just like JSON providers.
- Provider concurrency and start intervals adapt deterministically to 429/5xx/high-latency pressure, then recover after healthy calls.
- Existing Circuit Breaker and retry pipeline remains authoritative; no duplicate resilience stack was added.

## ما الجديد في 3.8.0

- Shared durable state: Personal Vault uses PostgreSQL when `DATABASE_URL` is configured.
- Version Registry writes are serialized with PostgreSQL row locks for safe multi-replica operation.
- Existing JSON files remain a local-development fallback and one-time migration source.
- Admin health now reports PostgreSQL pool/connectivity status without exposing credentials.

## ما الجديد في 3.7.0

- Enterprise Edge foundation: stable version-bound subtitle asset URLs for effective CDN caching.
- Dedicated fast path for subtitle assets before logging and rate-limit middleware.
- CDN/Cloudflare cache headers with long immutable caching for successfully resolved primary assets and short TTL for fallback assets.
- Shared Railway Redis enabled for cross-instance cache and distributed refresh locks.
- Prometheus HTTP latency and event-loop delay metrics for baseline/p95/p99 observability.

## ما الجديد في 3.6.4

- إصلاح ترتيب الترجمات بحيث تتقدم عائلة مصدر الفيديو المتوافقة زمنيًا (BluRay/Web/HDTV/DVD/CAM) على تطابق الدقة وحده.
- الاحتفاظ بتطابق Hash والموسم والحلقة والإصدار كأقوى إشارات المطابقة.
- إضافة اختبار واقعي لحالة House of the Dragon S01E07 لمنع رجوع المشكلة.

## ما الجديد في 3.6.3

- أصبحت الترجمة العربية الأدق تظهر أولًا: تطابق Hash المؤكد ثم مطابقة إصدار الفيديو، ثم جودة الترجمة والثقة، قبل شعبية المزود.
- تم تحسين محلل YIFY حتى لا يفقد رابط الترجمة الصحيح عندما يسبقه رابط آخر داخل صف النتيجة.
- بقي معرّف الإضافة ثابتًا حتى يتعرف Stremio على هذه النسخة كتحديث لنفس الإضافة.

## ما الجديد في 3.6.2

- تُرفض نتائج SubDL التي لا تحتوي رابط تنزيل صالح، مع دعم حروف العربية الممتدة في استعلامات البحث.
- ينتظر الإغلاق الآمن اكتمال تحديثات الكاش الخلفية قبل إغلاق Redis، بدل فقدانها أثناء إعادة تشغيل Railway.
- أصبحت حماية CORS الإدارية مختبرة صراحةً ضد المصادر غير المسموحة، مع دعم `PUBLIC_BASE_URL` و`ADMIN_ALLOWED_ORIGINS` والمصدر الذاتي للخدمة.
- لم يعد سطر حوار صحيح يُحذف لمجرد انتهائه بعلامة موسيقية، ولا يُعامل السطر الإنجليزي الغالب كسطر عربي بسبب أول حرف فقط.
- أزيل الكشف المكرر عن صيغة الترجمة، وحُسن تنويع النتائج باستخدام `Set` دون تغيير ترتيب الأدلة أو أولوية الترجمات.
- رُفع كاش SRT المعالج إلى `encoding:v12` وكاش Styled إلى `styled:v4` لمنع عرض نتائج معالجة قديمة.

## ما الجديد في 3.6.1

- أصبحت طلبات OpenSubtitles واستجاباته دوالًا نقية قابلة لاختبارات العقد مع بقاء التطبيع واللغة والحقول ومسار التنزيل الداخلي دون تغيير.
- أصبحت حزم مواسم SubDL تحتفظ فقط بملفات الموسم والحلقة المطلوبة، مع استخدام أرقام المزود أولًا واسم `S01E01` أو `1x01` كدليل احتياطي دقيق.
- أضيف `client=stremio` إلى SubDL، وحُفظت حقول `format` و`size` و`md5` لتحسين التحقق وإزالة التكرار دون تغيير أوضاع البحث الحالية.
- أضيفت اختبارات عقود ثابتة لـOpenSubtitles وSubDL واختبار فاصل بداية الطلبات في المحدد، مع بقاء الاختبار الحي الأسبوعي محدودًا ومشروطًا بالأسرار.
- تعرض لوحة الإدارة الآن استهلاك Heap وRSS، وأضيف Probe يدوي محدود الحجم لـPodnapisi لاكتشاف بنية الاستجابة فقط دون تسجيل المزود أو تنزيل ملفاته.

لتشغيل Probe الاستكشافي يدويًا خارج الإنتاج:

```bash
npm run probe:podnapisi
```

## ما الجديد في 3.6.0

- أضيف محرك توافق نصي موحّد يحوّل SRT وWebVTT وASS/SSA وTTML/DFXP وYouTube XML وSAMI وMicroDVD وMPL2 وSubViewer/SBV وLRC وRealText إلى SRT آمن قبل معالجة اتجاه العربية.
- أضيف فك UTF-8 وUTF-16 وUTF-32 بنوعي الترتيب ومع البادئة أو دونها، مع كشف Windows-1256 وISO-8859-6 وDOS CP720 وIBM CP864 وMacArabic بدل افتراض Windows-1256 لكل ملف قديم.
- أصبحت الكسور الزمنية من منزلة إلى تسع منازل، والساعات الاختيارية، والنقطة أو الفاصلة تُوحّد إلى ميلي ثانية؛ ويستخدم MicroDVD معدل الإطارات المضمّن أو الموثوق من سياق الفيديو ولا يخمّنه.
- أضيف فك آمن للكيانات المسماة والرقمية، وتنظيف وسوم الترجمة، وتطبيع أشكال الحروف العربية التقديمية، مع منع تعريفات XML الخارجية وكياناتها.
- توسع اختيار ملفات ZIP ليشمل الامتدادات النصية الجديدة ويقيّم المحتوى العربي والصيغة والتوقيت، مع بقاء حدود الحجم وعدد الملفات ومنع المسارات غير الآمنة.
- بقيت معالجة Person of Interest العامة قائمة على دليل متكرر في الملف وليست خاصة بحلقة واحدة، مع الحفاظ على سياسة علامات الاقتباس والترقيم المثبتة سابقًا دون توسيع قد يغيّر ملفات سليمة.
- رُفع كاش SRT المعالج إلى `encoding:v11` وكاش Styled إلى `styled:v3`، مع إبقاء رسومات ASS ووسومه وترويساته خارج أي تعديل نصي.
- لا يشمل هذا المحرك PGS/SUP أو VobSub أو EBU STL الثنائي لأنها صور أو تنسيقات ثنائية تحتاج OCR/مكتبات كبيرة؛ إدخالها في خدمة Stremio النصية سيزيد الحمل ويخفض الدقة.

## ما الجديد في 3.5.12

- إصلاح تنسيق الأقواس القديم المؤكد في ترجمات `Person of Interest S01E01` ونسخ SRT عربية مشابهة.
- لا يُفعّل الإصلاح بسبب سطر منفرد؛ يجب أن يثبت الملف نمطًا متكررًا من قوسين افتتاحيين أو إغلاقيين غير متوازنين قبل تغيير أي حرف ظاهر.
- تُحوّل الحالات الحتمية مثل `(أنا أُدعى (كارتر` إلى `أنا أُدعى (كارتر)`، وتُعاد الفواصل والنقاط الطرفية من بداية السطر إلى نهايته داخل الملفات القديمة المكتشفة فقط.
- تبقى ملفات SRT الحديثة والحالات المعزولة والسطور ذات الأقواس الصحيحة دون تغيير، ثم تطبق طبقة BiDi الحالية بعد اكتمال الإصلاح البنيوي.
- رُفع كاش SRT المعالج إلى `encoding:v10` لمنع إعادة الملفات القديمة من Redis أو Stremio.

## ما الجديد في 3.5.11

- أضيف تثبيت اتجاه العربية إلى مساري `Styled ASS` و`Styled SSA` بدل إرسالهما مباشرة دون معالجة BiDi.
- يقرأ المعالج قسم `[Events]` وترتيب `Format` ويغيّر حقل `Text` في أسطر `Dialogue` فقط؛ الترويسات والأنماط والتعليقات لا تتغير.
- يعالج كل سطر بصري مفصول بـ`\\N` أو `\\n` بصورة مستقلة، ويحافظ على وسوم الموضع والألوان والكاروكي ووسوم HTML كما هي.
- تُترك أوامر رسومات ASS بين `\\p1` و`\\p0` دون أي حقن لعلامات الاتجاه.
- أضيفت اختبارات حية لمساري `/proxy/styled/*.ass` و`/proxy/styled/*.ssa`، ورُفع كاش Styled إلى `styled:v2`.

## ما الجديد في 3.5.10

- إصلاح الأقواس العربية المزدوجة التي كانت تنفصل بصريًا داخل Stremio، كما ظهر في السطر `(شخص يُقتل في مدينة نيويورك)` على التلفاز.
- السطر العربي الذي يحتوي زوج أقواس فعليًا وبداخله نص عربي يُعزل مرة واحدة باستخدام `RLI…PDI` حتى يعالج المشغّل القوسين ضمن سياق RTL واحد.
- لا تُضاف علامات بجانب كل قوس، ولا يُعزل السطر عند وجود قوس غير متوازن أو زوج يحتوي نصًا لاتينيًا فقط.
- تبقى معالجة الفواصل والنقاط في السطور الخالية من أزواج الأقواس كما كانت: `RLM` واحدة بعد علامة النهاية المحددة.
- تنظيف علامات الاتجاه القادمة من المزودات يسبق دائمًا إعادة المعالجة، مع اختبارات للصورة الفعلية والأقواس المتداخلة وإعادة المعالجة دون تكرار.

## ما الجديد في 3.5.9

- حُصرت إضافة `RLM` في علامات نهاية الجملة المحددة وأقواس/اقتباسات الإغلاق فقط، بدل جميع فئات الترقيم والرموز.
- لا تُضاف علامة اتجاه بعد الرموز العامة مثل `+` و`=` و`©` أو بعد الأقواس المفتوحة.
- وُحّد منطق تنظيف اتجاه النص وتثبيت السطر في `arabicBidi.js`، وأصبح `subtitleProcessor.js` يستخدم الدالة المشتركة نفسها.
- بقي تنظيف علامات BiDi القادمة من ملفات المزودات قبل التحويل، مع اختبارات تمنع تكرار العلامات أو تغيير الأقواس الداخلية.

## ما الجديد في 3.5.8

- تصحيح العرض البصري للترقيم النهائي العربي في Stremio: تُضاف علامة RLM واحدة بعد النقطة أو الفاصلة أو القوس النهائي فقط.
- لا يُغلّف السطر كاملًا ولا تُحرّك أي علامة ظاهرة، وتبقى الفواصل والنقاط الداخلية كما هي.
- إضافة اختبار انحدار مطابق للصورة الفعلية: `ربما أنك حلمت بهذا الحدث،` يجب ألا تظهر الفاصلة قبل كلمة «ربما».
- كسر كاش ملفات الترجمة ورفع رقم Manifest مع إبقاء معرّف الإضافة ثابتًا.

## ما الجديد في 3.5.7

- أزيل حقن علامات الاتجاه الخفية من طبقتي المعالجة والإرسال؛ يحذف المشروع العلامات الدخيلة فقط ويحافظ على الأقواس والنقاط والاقتباسات كما هي في ملف الترجمة.
- أصبحت الترجمات الأصلية أول ما يظهر، وارتفع عدد المرشحين الأصليين الافتراضي إلى عشرة.
- تُنفذ جميع مراحل البحث والمزودات المضبوطة قبل قص النتائج، ولا يتوقف البحث لمجرد امتلاء أول خمس خانات.
- أوقفت مزامنة FPS والمزامنة المرجعية البنيوية افتراضيًا لأنها لا تثبت توافق النسخة. لا تعمل إلا بعد تفعيل `ALLOW_EXPERIMENTAL_SYNC=true` صراحة.
- بقيت الإزاحة اليدوية الصريحة متاحة، وأضيفت اختبارات تمنع عودة حقن RTL أو تفعيل مزامنة غير مثبتة.

## ما الجديد في 3.5.6

- تصحيح ترتيب الترجمات ليعتمد على الأدلة الأقوى أولًا بدل جعل WEB-DL وBluRay والدقة والمجموعة حاسمة.
- تخفيض معلومات الإصدار إلى إشارات ثانوية، مع الحفاظ على Hash وVault والجودة الموثقة كأقوى الأدلة.
- تنويع البدائل القريبة حتى لا تمتلئ قائمة Stremio بنتائج متشابهة من نفس عائلة الإصدار.
- رفع رقم Manifest مع إبقاء معرّف الإضافة ثابتًا ليظهر تحديث Stremio.

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

للإبلاغ عن ثغرة أو مشكلة أمنية حساسة، اتبع سياسة الإفصاح الموجودة في [`SECURITY.md`](SECURITY.md) بدل نشر الأسرار في Issue عامة.

## التحقق

```json
{"status":"ok","version":"4.3.0","ai":false}
```

بوابات الدمج المطلوبة: ESLint، TypeScript، الاختبارات والتغطية، `npm audit --omit=dev --audit-level=high`، CodeQL، بناء Docker، وTrivy.


### v4.1.0

Zero-result recovery now separates strong-ID and fallback searches, performs a safe Arabic relaxed tier only when strict search is empty, keeps machine translations excluded, rejects hard identity conflicts, and uses measured content quality from the top five preflight candidates in final ordering.

### v4.2.0 Arabic availability guarantee

Subtitle-list responses are now client `no-store`, while positive Arabic search results remain cached in shared Redis. Empty searches are never persisted, replica-local memory cannot override shared Redis for subtitle searches, and a stale non-empty Last-Known-Good list is retained when a fresh provider attempt temporarily returns nothing. This prevents transient provider 403/429/timeouts from poisoning Stremio with an empty Arabic list.

### v4.3.0 Final Arabic availability

A post-preflight, version-independent Redis Last-Known-Good layer now protects the final Arabic list. Accuracy Preflight can still remove a bad candidate when another candidate survives, but it cannot turn a non-empty Arabic provider result into an empty Stremio list. Hard-rejection decisions are release-versioned and expire quickly, preventing stale false rejections from surviving deploys.

