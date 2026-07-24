export function resolverHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>m7md Arabic Resolver v3</title>
  <style>
    body{font-family:system-ui;margin:24px;line-height:1.65;max-width:1120px;background:#fafafa;color:#16202a}
    h1{margin-bottom:.15rem}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:.6rem}
    input,select,button{font:inherit;padding:.65rem;border:1px solid #cbd5e1;border-radius:.5rem;width:100%;box-sizing:border-box}
    button{cursor:pointer;background:#0f766e;color:#fff;border:0;font-weight:700}.secondary{background:#475569}.danger{background:#b91c1c}
    .card{background:#fff;border:1px solid #dbe4ee;border-radius:.7rem;padding:1rem;margin:.8rem 0;box-shadow:0 1px 2px #0000000a}
    .meta{color:#475569;font-size:.9rem}.actions{display:flex;gap:.5rem;margin-top:.7rem;align-items:center}.actions button{width:auto}
    .preview{display:inline-block;background:#475569;color:#fff;padding:.65rem;border-radius:.5rem;text-decoration:none;font-weight:700}
    .status{white-space:pre-wrap;background:#0f172a;color:#e2e8f0;padding:.9rem;border-radius:.5rem;min-height:1.4rem}
    code{direction:ltr;unicode-bidi:embed}table{border-collapse:collapse;width:100%;background:#fff}th,td{border:1px solid #dbe4ee;padding:.5rem;text-align:right;font-size:.9rem}
  </style>
</head>
<body>
  <h1>m7md Arabic Resolver v3</h1>
  <p>ابحث، افحص النتيجة، ثم اعتمدها أو ارفضها لنفس نسخة الفيديو.</p>
  <form id="search">
    <div class="grid">
      <input name="q" value="tt1375666" placeholder="IMDb أو العنوان">
      <select name="type"><option value="movie">فيلم</option><option value="series">مسلسل</option></select>
      <input name="filename" placeholder="اسم ملف الفيديو">
      <input name="videoHash" placeholder="OpenSubtitles hash">
      <input name="videoSize" placeholder="حجم الفيديو بالبايت">
      <input name="token" type="password" placeholder="رمز الإدارة">
    </div>
    <p><button>بحث وفحص</button></p>
  </form>
  <div id="status" class="status">جاهز.</div>
  <div id="results"></div>
  <h2>سجل النسخ</h2>
  <p><button id="loadRegistry" class="secondary" type="button">تحديث السجل</button></p>
  <div id="registry"></div>
  <script>
    const form = document.getElementById('search');
    const status = document.getElementById('status');
    const results = document.getElementById('results');
    const registry = document.getElementById('registry');
    let lastSearch = {};
    let lastItems = [];

    function esc(value) {
      return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
    }

    function token() {
      return new FormData(form).get('token') || '';
    }

    function requestHeaders() {
      const value = token();
      return { 'content-type': 'application/json', ...(value ? { 'x-vault-token': value } : {}) };
    }

    async function readJson(response) {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || data.message || 'فشل الطلب');
      return data;
    }

    async function decision(action, index) {
      const candidate = lastItems[index];
      if (!candidate) return;
      try {
        const data = await readJson(await fetch('/api/versions/' + action, {
          method: 'POST',
          headers: requestHeaders(),
          body: JSON.stringify({ search: lastSearch, candidate }),
        }));
        status.textContent = JSON.stringify(data, null, 2);
        await loadRegistry();
      } catch (error) {
        status.textContent = error.message;
      }
    }

    function render(items) {
      results.innerHTML = items.map((item, index) => {
        const quality = item.quality?.score ? ' · جودة ' + esc(item.quality.score) : '';
        const reasons = esc(item.quality?.reasons?.join(', ') || 'لم يُفحص الملف بعد');
        const preview = item.previewUrl ? '<a class="preview" href="' + esc(item.previewUrl) + '" target="_blank" rel="noopener">معاينة</a>' : '';
        return '<article class="card"><strong>' + esc(item.name) + '</strong><div class="meta">' + esc(item.provider) + ' · ' + esc(item.searchReason || '') + ' · score ' + esc(item.score || '') + quality + '</div><div class="meta">' + reasons + '</div><div class="actions"><button type="button" data-action="verify" data-index="' + index + '">اعتماد لهذه النسخة</button><button type="button" class="danger" data-action="reject" data-index="' + index + '">رفض</button>' + preview + '</div></article>';
      }).join('') || '<p>لا توجد نتائج.</p>';
    }

    async function loadRegistry() {
      try {
        const data = await readJson(await fetch('/api/versions', { headers: token() ? { 'x-vault-token': token() } : {} }));
        registry.innerHTML = data.items?.length ? '<table><thead><tr><th>الحالة</th><th>النسخة</th><th>الترجمة</th><th>المزود</th></tr></thead><tbody>' + data.items.map(item => '<tr><td>' + esc(item.status) + '</td><td><code>' + esc(item.versionKey) + '</code></td><td>' + esc(item.asset?.name || '') + '</td><td>' + esc(item.asset?.provider || '') + '</td></tr>').join('') + '</tbody></table>' : '<p>السجل فارغ.</p>';
      } catch (error) {
        registry.innerHTML = '<pre>' + esc(error.message) + '</pre>';
      }
    }

    form.addEventListener('submit', async event => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form).entries());
      lastSearch = { q: data.q, type: data.type, filename: data.filename, videoHash: data.videoHash, videoSize: data.videoSize, id: data.q, query: data.q };
      status.textContent = 'يجري البحث...';
      try {
        const response = await readJson(await fetch('/api/preview?' + new URLSearchParams(lastSearch).toString()));
        lastItems = response.results || [];
        status.textContent = JSON.stringify({ count: response.count, ms: response.ms }, null, 2);
        render(lastItems);
      } catch (error) {
        status.textContent = error.message;
        results.innerHTML = '';
      }
    });

    results.addEventListener('click', event => {
      const button = event.target.closest('button[data-action]');
      if (button) decision(button.dataset.action, Number(button.dataset.index));
    });

    document.getElementById('loadRegistry').addEventListener('click', loadRegistry);
  </script>
</body>
</html>`;
}
