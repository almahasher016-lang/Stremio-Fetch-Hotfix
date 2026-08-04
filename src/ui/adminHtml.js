import { config } from '../config.js';

export function adminPageHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>لوحة الإدارة · ${config.app.name}</title>
  <style>
    :root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:24px auto;padding:0 16px;max-width:1150px;line-height:1.65}
    input,button,select{font:inherit;padding:.55rem;margin:.25rem}input{width:min(100%,620px);box-sizing:border-box}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:.8rem}.card{border:1px solid #64748b;border-radius:12px;padding:1rem}
    .ok{color:#16a34a}.bad{color:#dc2626}.actions{display:flex;flex-wrap:wrap;gap:.4rem}button{cursor:pointer}
    table{width:100%;border-collapse:collapse;font-size:.9rem}th,td{border:1px solid #64748b;padding:.45rem;text-align:right}
    code,pre{direction:ltr;unicode-bidi:embed}pre{white-space:pre-wrap;max-height:260px;overflow:auto}footer{margin-top:2rem;color:#64748b}
  </style>
</head>
<body>
  <h1>لوحة الإدارة والمراقبة</h1>
  <label>رمز الإدارة</label><br>
  <input id="token" type="password" autocomplete="current-password" placeholder="ADMIN_TOKEN">
  <button id="refresh">تحديث</button>
  <p id="status">أدخل الرمز ثم اضغط تحديث.</p>
  <div class="actions">
    <button data-cache="search">مسح نتائج البحث</button>
    <button data-cache="encoding">مسح ملفات المعالجة</button>
    <button data-cache="all">مسح الكاش كله</button>
  </div>
  <div id="summary" class="cards"></div>
  <h2>المزودات</h2><div id="providers"></div>
  <h2>قواطع الأعطال</h2><div id="breakers"></div>
  <h2>الحدود المستقلة</h2><div id="limiters"></div>
  <footer><small>الإصدار ${config.app.version} · معالجة حتمية بدون ذكاء اصطناعي</small></footer>
  <script>
    const token=document.getElementById('token'),status=document.getElementById('status');
    token.value=sessionStorage.getItem('m7md-admin-token')||'';
    token.addEventListener('change',()=>sessionStorage.setItem('m7md-admin-token',token.value));
    const esc=value=>String(value??'').replace(/[&<>"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[char]));
    const headers=()=>token.value?{'x-admin-token':token.value}:{};
    async function json(response){const body=await response.json();if(!response.ok)throw new Error(body.error||body.message||'فشل الطلب');return body}
    function table(rows,columns){return '<table><thead><tr>'+columns.map(column=>'<th>'+esc(column[1])+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+columns.map(column=>'<td>'+column[2](row[column[0]],row)+'</td>').join('')+'</tr>').join('')+'</tbody></table>'}
    async function refresh(){
      try{
        status.textContent='جارٍ التحديث...';
        const data=await json(await fetch('/api/admin/health',{headers:headers()}));
        const cache=data.cache||{};
        document.getElementById('summary').innerHTML=
          '<div class="card"><strong>الإصدار</strong><br>'+esc(data.version)+'</div>'+
          '<div class="card"><strong>زمن التشغيل</strong><br>'+Math.round(data.uptime)+' ثانية</div>'+
          '<div class="card"><strong>نسبة إصابة الكاش</strong><br>'+esc(cache.hitRatio??'لا بيانات')+'</div>'+
          '<div class="card"><strong>L1 / Redis</strong><br>'+esc(cache.memoryHits||0)+' / '+esc(cache.redisHits||0)+'</div>'+
          '<div class="card"><strong>Heap / RSS</strong><br>'+esc(data.memory?.heapUsedMB??'—')+' / '+esc(data.memory?.rssMB??'—')+' MB</div>';
        const providerRows=Object.entries(data.providers||{}).map(([name,value])=>({name,...value,...(data.metrics?.[name]||{})}));
        document.getElementById('providers').innerHTML=table(providerRows,[['name','المزود',v=>esc(v)],['configured','مهيأ',v=>v?'<span class="ok">نعم</span>':'<span class="bad">لا</span>'],['successRate','النجاح',v=>esc(v??'—')],['p50Ms','P50 ms',v=>esc(v??0)],['p95Ms','P95 ms',v=>esc(v??0)],['lastError','آخر خطأ',v=>esc(v||'—')]]);
        const breakerRows=Object.entries(data.breakers||{}).map(([name,value])=>({name,...value}));
        document.getElementById('breakers').innerHTML=table(breakerRows,[['name','المزود',v=>esc(v)],['state','الحالة',v=>esc(v)],['failures','الإخفاقات',v=>esc(v)],['resetMs','مهلة الاستعادة',v=>esc(v)],['action','إجراء',(_v,row)=>'<button data-reset="'+esc(row.name)+'">إعادة ضبط</button>']]);
        const limiterRows=Object.entries(data.limiters||{}).map(([name,value])=>({name,...value}));
        document.getElementById('limiters').innerHTML=table(limiterRows,[['name','المزود',v=>esc(v)],['active','نشط',v=>esc(v)],['queued','منتظر',v=>esc(v)],['maxConcurrent','التوازي',v=>esc(v)],['minIntervalMs','الفاصل ms',v=>esc(v)]]);
        status.textContent='آخر تحديث: '+new Date().toLocaleTimeString('ar-SA');
      }catch(error){status.textContent=error.message}
    }
    document.getElementById('refresh').onclick=refresh;
    document.body.addEventListener('click',async event=>{
      const cache=event.target.dataset.cache;
      const provider=event.target.dataset.reset;
      if(!cache&&!provider)return;
      if(cache==='all'&&!confirm('مسح الكاش كله؟'))return;
      try{
        const url=cache?'/api/admin/cache/clear?scope='+encodeURIComponent(cache):'/api/admin/breakers/'+encodeURIComponent(provider)+'/reset';
        await json(await fetch(url,{method:'POST',headers:headers()}));await refresh();
      }catch(error){status.textContent=error.message}
    });
  </script>
</body>
</html>`;
}
