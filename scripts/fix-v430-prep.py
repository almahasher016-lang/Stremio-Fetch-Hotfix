from pathlib import Path

p = Path(__file__).resolve().parents[1] / 'src/services/accuracyPreflight.js'
text = p.read_text(encoding='utf-8')
old = """  return prioritizeAccurateSubtitles(decorated.map(item => ({
    ...item,
    accuracyPreflightFallback: 'all-candidates-rejected',
  })), search);
"""
new = """  const failOpen = decorated.map(item => ({
    ...item,
    accuracyPreflightFallback: 'all-candidates-rejected',
  }));
  return failOpen.length ? failOpen : ranked;
"""
if old not in text:
    raise SystemExit('fail-open patch anchor not found')
p.write_text(text.replace(old, new, 1), encoding='utf-8')
print('v4.3.0 fail-open patch applied')
