# Changelog

## 2.3.3 - Stremio Fetch/CORS Hotfix
- Fixed Stremio Desktop/Web `Failed to fetch` manifest issue by adding explicit unconditional cross-origin headers.
- Disabled Helmet cross-origin resource blocking for manifest/subtitle resources.
- Fixed wildcard origin handling so `ALLOWED_ORIGINS=*` remains a true wildcard instead of an array value.


## v2.3.3 — Fully Locked Private Ready

- نقل جميع أرقام التشغيل الخاصة بالمشروع إلى `src/config.js` داخل `PRIVATE_DEFAULTS`.
- تثبيت مفاتيح OpenSubtitles وSubDL وسر البروكسي وتوكن Personal Vault داخل المشروع كما طلب المستخدم.
- جعل `setting()` يرجع القيم الداخلية مباشرة بدل الاعتماد على Railway Variables.
- تثبيت ترتيب Stremio وعدد النتائج داخل المشروع: `TOP_N=5`, `MAX_PROVIDER_ITEMS=60`, `STREMIO_MAX_SUBTITLES=6`.
- تثبيت YIFY وPersonal Vault وReference Sync وCache وRate Limit داخل المشروع.
- تحديث اسم الإضافة والإصدار إلى `m7md Arabic Direct 2.3.3`.
- تنظيف `.env.example` ليؤكد أن Railway Variables غير مطلوبة لهذه النسخة الخاصة.
- لا يوجد `package-lock.json` داخل الحزمة.

## v2.3.1 — Ranking Precision Private Ready

- شد ترتيب النتائج حسب Hash/Release/Quality/Source/Synchronization.
- تقليل النتائج الظاهرة داخل Stremio.
- جعل Reference Sync يظهر فقط لأفضل النتائج.
