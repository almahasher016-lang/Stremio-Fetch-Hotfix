from pathlib import Path
import re

p = Path(__file__).resolve().parents[1] / 'src/services/accuracyPreflight.js'
text = p.read_text(encoding='utf-8')
pattern = re.compile(
    r"  const survivors = decorated\.filter\(item => item\.accuracyPreflight\?\.state !== 'rejected'\);\n"
    r"(?:.|\n)*?\n}\n$"
)
replacement = """  const survivors = decorated.filter(item => item.accuracyPreflight?.state !== 'rejected');
  if (survivors.length > 0) return prioritizeAccurateSubtitles(survivors, search);

  // Availability invariant: content preflight may demote the last candidates, but it may
  // not erase an otherwise non-empty Arabic provider result. Delivery-time quality gates
  // still validate the selected source and can fall through to its fallback chain.
  const failOpen = (decorated.length ? decorated : ranked).map(item => ({
    ...item,
    accuracyPreflightFallback: 'all-candidates-rejected',
  }));
  return failOpen;
}
"""
updated, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'preflight tail patch count={count}')
p.write_text(updated, encoding='utf-8')
print('v4.3.0 preflight tail patched')
