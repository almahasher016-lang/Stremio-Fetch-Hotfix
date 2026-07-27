import { config } from '../config.js';

export function vaultPageHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Personal Vault · ${config.app.name}</title>
  <style>
    :root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:24px auto;padding:0 16px;line-height:1.7;max-width:1050px}
    input,textarea,button,select{font:inherit;padding:.6rem;margin:.25rem 0;box-sizing:border-box}input,textarea,select{width:100%}
    textarea{height:220px;direction:ltr;unicode-bidi:embed}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.5rem}
    .drop{border:2px dashed #64748b;border-radius:12px;padding:1rem;text-align:center}.drop.drag{border-color:#16a34a;background:#16a34a18}
    button{cursor:pointer;width:auto}.danger{color:#fff;background:#b91c1c;border:0;border-radius:6px}.actions{display:flex;gap:.5rem;flex-wrap:wrap}
    table{border-collapse:collapse;width:100%;font-size:.92rem}td,th{border:1px solid #94a3b8;padding:.45rem;text-align:right}
    code,pre{direction:ltr;unicode-bidi:embed}pre{white-space:pre-wrap;border:1px solid #94a3b8;border-radius:8px;padding:.7rem}
    footer{margin-top:2rem;color:#64748b}
  </style>
</head>
<body>
  <h1>مخزن الترجمات الشخصي</h1>
  <p>أضف ملف ترجمة عربيًا مضبوطًا واربطه بـ IMDb أو بصمة الفيديو. يقبل الرفع المباشر الترميزات التي يعالجها الخادم، ومنها UTF وWindows‑1256.</p>
  <label>رمز الإدارة</label>
  <input id="token" type="password" autocomplete="current-password" placeholder="ADMIN_TOKEN">
  <form id="vault-form">
    <div class="grid">
      <input name="name" placeholder="اسم الترجمة">
      <input name="imdbId" placeholder="tt1375666">
      <input name="season" inputmode="numeric" placeholder="الموسم">
      <input name="episode" inputmode="numeric" placeholder="الحلقة">
      <input name="videoHash" placeholder="Video hash اختياري">
      <input name="releaseName" placeholder="اسم الإصدار الدقيق">
    </div>
    <div id="drop" class="drop">
      <strong>أسقط ملف الترجمة هنا أو اختره</strong>
      <input id="subtitle-file" type="file" accept=".srt,.vtt,.ass,.ssa,text/plain">
      <small id="file-name">لم يُختر ملف</small>
    </div>
    <textarea name="text" placeholder="أو الصق محتوى الترجمة هنا"></textarea>
    <button>حفظ الترجمة</button>
  </form>
  <pre id="status">أدخل رمز الإدارة ثم حدّث القائمة.</pre>
  <div class="actions">
    <button id="refresh" type="button">تحديث القائمة</button>
    <button id="backup" type="button">تنزيل نسخة احتياطية</button>
    <select id="import-mode" style="width:auto"><option value="merge">دمج النسخة</option><option value="replace">استبدال المخزن</option></select>
    <input id="backup-file" type="file" accept=".json,application/json" style="width:auto">
    <button id="restore" type="button">استعادة النسخة</button>
  </div>
  <div id="list"></div>
  <footer><small>الإصدار ${config.app.version} · معالجة حتمية بدون ذكاء اصطناعي</small></footer>
  <script>
    const form=document.getElementById('vault-form');
    const token=document.getElementById('token');
    const status=document.getElementById('status');
    const list=document.getElementById('list');
    const fileInput=document.getElementById('subtitle-file');
    const drop=document.getElementById('drop');
    let droppedFile=null;
    token.value=sessionStorage.getItem('m7md-admin-token')||'';
    token.addEventListener('change',()=>sessionStorage.setItem('m7md-admin-token',token.value));
    const esc=value=>String(value??'').replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
    const headers=()=>token.value?{'x-admin-token':token.value}:{};
    async function read(response){const json=await response.json();if(!response.ok)throw new Error(json.error||json.message||'فشل الطلب');return json}
    function setFile(file){droppedFile=file||null;document.getElementById('file-name').textContent=file?file.name:'لم يُختر ملف'}
    fileInput.addEventListener('change',()=>setFile(fileInput.files[0]));
    for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('drag')});
    for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('drag')});
    drop.addEventListener('drop',event=>setFile(event.dataTransfer.files[0]));
    function bytesToBase64(buffer){const bytes=new Uint8Array(buffer);let binary='';for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));return btoa(binary)}
    async function refresh(){
      try{
        const json=await read(await fetch('/api/vault',{headers:headers()}));
        list.innerHTML='<h2>الموجود ('+json.count+')</h2><table><thead><tr><th>الاسم</th><th>IMDb</th><th>الحلقة</th><th>الإصدار</th><th>الحجم</th><th></th></tr></thead><tbody>'+
          json.items.map(item=>'<tr><td>'+esc(item.name)+'</td><td>'+esc(item.imdbId||'')+'</td><td>'+esc((item.season||'')+':'+(item.episode||''))+'</td><td>'+esc(item.releaseName||'')+'</td><td>'+esc(item.bytes||'')+'</td><td><button class="danger" data-delete="'+esc(item.id)+'">حذف</button></td></tr>').join('')+
          '</tbody></table>';
      }catch(error){status.textContent=error.message}
    }
    form.addEventListener('submit',async event=>{
      event.preventDefault();status.textContent='جارٍ الحفظ...';
      const body=Object.fromEntries(new FormData(form).entries());
      const file=droppedFile||fileInput.files[0];
      if(file){body.subtitleBase64=bytesToBase64(await file.arrayBuffer());delete body.text}
      try{
        const json=await read(await fetch('/api/vault',{method:'POST',headers:{'content-type':'application/json',...headers()},body:JSON.stringify(body)}));
        status.textContent='تم حفظ '+json.item.name;
        form.reset();setFile(null);await refresh();
      }catch(error){status.textContent=error.message}
    });
    list.addEventListener('click',async event=>{
      const id=event.target.dataset.delete;if(!id)return;
      if(!confirm('حذف هذه الترجمة من المخزن؟'))return;
      try{await read(await fetch('/api/vault/'+encodeURIComponent(id),{method:'DELETE',headers:headers()}));await refresh()}catch(error){status.textContent=error.message}
    });
    document.getElementById('refresh').onclick=refresh;
    document.getElementById('backup').onclick=async()=>{
      try{
        const response=await fetch('/api/vault/export',{headers:headers()});
        if(!response.ok)throw new Error((await response.json()).error||'فشل التصدير');
        const blob=await response.blob();const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='m7md-vault-backup.json';link.click();URL.revokeObjectURL(link.href);
      }catch(error){status.textContent=error.message}
    };
    document.getElementById('restore').onclick=async()=>{
      const file=document.getElementById('backup-file').files[0];if(!file){status.textContent='اختر ملف النسخة الاحتياطية أولًا';return}
      const mode=document.getElementById('import-mode').value;
      if(mode==='replace'&&!confirm('سيُستبدل المخزن الحالي بالكامل. هل تريد المتابعة؟'))return;
      try{
        const snapshot=JSON.parse(await file.text());
        const json=await read(await fetch('/api/vault/import?mode='+mode,{method:'POST',headers:{'content-type':'application/json',...headers()},body:JSON.stringify(snapshot)}));
        status.textContent='تم استيراد '+json.result.imported+' ترجمة';await refresh();
      }catch(error){status.textContent=error.message}
    };
  </script>
</body>
</html>`;
}
