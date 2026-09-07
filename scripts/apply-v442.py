from pathlib import Path
import json

ROOT=Path('.')
def r(p): return (ROOT/p).read_text(encoding='utf-8')
def w(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def rep(s,a,b,label):
    if a not in s: raise SystemExit(f'anchor not found: {label}')
    return s.replace(a,b,1)

# Version bump: change only this project's version fields. Never rewrite dependency versions.
pkg=json.loads(r('package.json'))
pkg['version']='4.4.2'
w('package.json',json.dumps(pkg,ensure_ascii=False,indent=2)+'\n')
lock=json.loads(r('package-lock.json'))
lock['version']='4.4.2'
lock.setdefault('packages',{}).setdefault('',{})['version']='4.4.2'
w('package-lock.json',json.dumps(lock,ensure_ascii=False,indent=2)+'\n')
p='src/release.js'; s=r(p); s=rep(s,'4.4.1','4.4.2','release version'); w(p,s)
p='README.md'; s=r(p); s=rep(s,'# m7md Arabic Resolver v4.4.1','# m7md Arabic Resolver v4.4.2','README current title'); w(p,s)

# Reconcile degraded response with Final LKG before returning it to Stremio.
p='src/services/subtitleService.js'; s=r(p)
anchor='''async function searchCore(search) {\n  const outcome = await core.searchSubtitlesWithStatus(search);\n  return { ...outcome, results: await applyAccuracyPreflight(outcome.results, search) };\n}\n'''
insert='''async function searchCore(search) {\n  const outcome = await core.searchSubtitlesWithStatus(search);\n  return { ...outcome, results: await applyAccuracyPreflight(outcome.results, search) };\n}\n\nexport async function reconcileDegradedAvailability(search, outcome, lkg) {\n  const fresh = Array.isArray(outcome?.results) ? outcome.results : [];\n  if (outcome?.cycleStatus !== 'degraded' || !usable(fresh) || !lkg?.hit || !usable(lkg.value)) {\n    return fresh;\n  }\n  const merged = core.preserveAccurateCandidates(search, fresh, lkg.value);\n  return applyAccuracyPreflight(merged, search);\n}\n'''
s=rep(s,anchor,insert,'reconcile helper')
old='''    const outcome = await runDistributed(search, key);\n    const fresh = outcome.results;\n    if (usable(fresh)) {\n      if (outcome.cycleStatus === 'complete') await writeAvailabilityLkg(search, fresh, 'replace');\n      else if (outcome.cycleStatus === 'degraded') await writeAvailabilityLkg(search, fresh, 'merge');\n      return fresh;\n    }\n    if (lkg?.hit && usable(lkg.value)) return lkg.value;\n    return fresh;'''
new='''    const outcome = await runDistributed(search, key);\n    const fresh = outcome.results;\n    if (usable(fresh)) {\n      if (outcome.cycleStatus === 'complete') {\n        await writeAvailabilityLkg(search, fresh, 'replace');\n        return fresh;\n      }\n      if (outcome.cycleStatus === 'degraded') {\n        if (lkg?.hit && usable(lkg.value)) {\n          const reconciled = await reconcileDegradedAvailability(search, outcome, lkg);\n          await writeAvailabilityLkg(search, reconciled, 'merge');\n          return reconciled;\n        }\n        // A degraded first-ever search is useful for the current request, but it is not\n        // authoritative enough to become the Final Last-Known-Good pool.\n        return fresh;\n      }\n      return fresh;\n    }\n    if (lkg?.hit && usable(lkg.value)) return lkg.value;\n    return fresh;'''
s=rep(s,old,new,'response reconciliation')
w(p,s)

# Regression test at pure availability level. Candidates intentionally have no fetchable URLs,
# keeping Accuracy Preflight deterministic and network-free in this policy test.
p='src/tests/degradedAvailability.test.js'
w(p,'''import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { reconcileDegradedAvailability } from '../services/subtitleService.js';\n\ntest('degraded response merges the current partial pool with Final LKG before returning', async () => {\n  const search = { filename: 'House.of.the.Dragon.S01E07.2160p.BluRay.Remux.mkv' };\n  const fresh = [\n    { id:'web', provider:'opensubtitles', releaseName:'House.of.the.Dragon.S01E07.2160p.WEB-DL-GRP', score:1326, lang:'ara', releaseMatch:{targetFields:3,tier:2,priority:21000,criticalMismatches:0,mismatched:['source']} },\n  ];\n  const lkg = { hit:true, value:[\n    { id:'bluray', provider:'opensubtitles', releaseName:'House.of.the.Dragon.S01E07.720p.BluRay.x264-BLOODY', score:1298, lang:'ara', releaseMatch:{targetFields:3,tier:2,priority:18000,criticalMismatches:0,mismatched:['quality']} },\n    { id:'webrip', provider:'opensubtitles', releaseName:'House.of.the.Dragon.S01E07.WEBRIP-GRP', score:1210, lang:'ara', releaseMatch:{targetFields:3,tier:1,priority:10000,criticalMismatches:0,mismatched:['source']} },\n  ]};\n  const results = await reconcileDegradedAvailability(search, { results:fresh, cycleStatus:'degraded' }, lkg);\n  assert.equal(results.length, 3);\n  assert.equal(results[0].id, 'bluray');\n});\n\ntest('complete response does not merge old LKG', async () => {\n  const search = { filename: 'Movie.2026.2160p.BluRay.Remux.mkv' };\n  const fresh = [{ id:'new', provider:'opensubtitles', releaseName:'Movie.2026.2160p.BluRay.Remux-GRP', score:1000, lang:'ara' }];\n  const lkg = { hit:true, value:[{ id:'old', provider:'subdl', releaseName:'Movie.2026.720p.BluRay-OLD', score:900, lang:'ara' }]};\n  const results = await reconcileDegradedAvailability(search, { results:fresh, cycleStatus:'complete' }, lkg);\n  assert.deepEqual(results.map(item => item.id), ['new']);\n});\n''')

# Changelog / README release notes.
p='CHANGELOG.md'; s=r(p)
entry='''## 4.4.2 - 2026-09-07\n\n- Reconcile degraded provider responses with the Final Arabic Last-Known-Good pool before returning the response to Stremio, not only before cache writes.\n- Never promote a degraded first-ever partial result into the Final LKG when no prior good pool exists.\n- Re-run current Accuracy Preflight and Accuracy-First ordering over the reconciled degraded pool.\n- Add regression coverage for first-response partial-result poisoning.\n\n'''
if not s.startswith('## 4.4.2'): s=entry+s
w(p,s)
p='README.md'; s=r(p)
needle='## ما الجديد في 4.4.2\n'
if needle not in s:
    marker='## ما الجديد في 4.4.1\n'
    section='''## ما الجديد في 4.4.2\n\n- في دورة `degraded` يتم دمج النتائج الجزئية مع Final Arabic LKG **قبل إرسال الاستجابة إلى Stremio**، وليس فقط عند تحديث Redis.\n- إذا لم يوجد Last-Good سابق، تُعرض النتيجة الجزئية الحالية للمستخدم لكنها لا تُعتمد كـFinal LKG.\n- بعد الدمج يعاد Accuracy Preflight + Accuracy-First بالقواعد الحالية قبل الإرجاع.\n\n'''
    if marker in s: s=s.replace(marker,section+marker,1)
    else: s=section+s
w(p,s)
print('v4.4.2 applied')