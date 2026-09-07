from pathlib import Path
ROOT=Path('.')
def r(p): return (ROOT/p).read_text(encoding='utf-8')
def w(p,s): (ROOT/p).write_text(s,encoding='utf-8')
def rep(s,a,b,label):
    if a not in s: raise SystemExit(f'anchor not found: {label}')
    return s.replace(a,b,1)

p='src/configCore.js'; s=r(p)
s=rep(s,"      enabled: toBool(get('TIMING_EVIDENCE_ENABLED'), true),\n      maxCues:","      enabled: toBool(get('TIMING_EVIDENCE_ENABLED'), true),\n      topN: toInt(get('TIMING_EVIDENCE_TOP_N'), 8, 1, 10),\n      maxCues:",'timing topN config')
w(p,s)

p='src/services/accuracyPreflight.js'; s=r(p)
old="""  const targets = ranked.slice(0, Math.min(config.accuracyPreflight.topN, ranked.length));\n"""
new="""  const timingTargetCount = config.timingEvidence.enabled\n    && ranked.some(item => item?.exactTimingReference?.exactVideoHash)\n    ? config.timingEvidence.topN\n    : 0;\n  const targetCount = Math.max(config.accuracyPreflight.topN, timingTargetCount);\n  const targets = ranked.slice(0, Math.min(targetCount, ranked.length));\n"""
s=rep(s,old,new,'broader timing target pool')
w(p,s)

p='src/tests/actualTimingEvidence.test.js'; s=r(p)
append='''\n\ntest('timing evidence can rescue an aligned candidate outside the legacy top-5 quality window', async () => {\n  const shiftedProfile=buildTimingProfile(srt(baseStarts.map(v=>v+8500)));\n  const alignedProfile=buildTimingProfile(srt(baseStarts));\n  const candidates=Array.from({length:8},(_,i)=>candidate(i===7?'aligned':`shifted-${i}`,900-i*40)).map((item,i)=>({\n    ...item,\n    providerId:String(200+i), fileId:String(200+i), download:`/downloads/opensubtitles/${200+i}.srt`,\n  }));\n  const results=await applyAccuracyPreflight(candidates,{filename:'Movie.2026.2160p.BluRay.Remux.mkv',videoHash:'abc'}, {\n    ...noCache,\n    preflightImpl:async item=>({quality:{valid:true,score:90,reasons:[]},timingProfile:item.id==='aligned'?alignedProfile:shiftedProfile}),\n    referencePreflightImpl:async()=>({timingProfile:referenceProfile}),\n  });\n  assert.equal(results[0].id,'aligned');\n  assert.equal(results[0].actualTimingEvidence.verdict,'aligned');\n});\n'''
if 'outside the legacy top-5 quality window' not in s: s+=append
w(p,s)

p='README.md'; s=r(p)
s=rep(s,'- تستخدم أفضل الترجمات العربية فحصًا زمنيًا محدودًا (Temporal Anchors + DTW)', '- تقيس المنظومة افتراضيًا أفضل 8 مرشحين من أصل Top 10 بقياس زمني محدود (Temporal Anchors + DTW)', 'README pool wording')
w(p,s)
print('v4.5.0 timing pool refined')