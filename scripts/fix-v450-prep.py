from pathlib import Path

ROOT = Path('.')

def read(path):
    return (ROOT / path).read_text(encoding='utf-8')

def write(path, text):
    (ROOT / path).write_text(text, encoding='utf-8')

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'anchor not found: {label}')
    return text.replace(old, new, 1)

# Preserve the stable exact-hash marker after converting a reference into an encoding token source.
p = 'src/utils/encodingProxy.js'
s = read(p)
s = replace_once(
    s,
    "  return { ...source, candidate: null };\n}\n\nexport function proxiedSubtitleUrl",
    "  return { ...source, candidate: null, exactVideoHash: Boolean(reference.exactVideoHash) };\n}\n\nexport function proxiedSubtitleUrl",
    'exact-hash token reference marker',
)
write(p, s)

# The previous regression asserted bare-title strict search. v4.5.0 intentionally qualifies
# strict movie title fallback with the known year; relaxed recovery still tests the bare title path.
p = 'src/tests/zeroResultRecovery.test.js'
s = read(p)
s = replace_once(
    s,
    "assert.equal(title.variants[0].query, 'The Whisper Man');",
    "assert.equal(title.variants[0].query, 'The Whisper Man 2026');",
    'strict title-year regression expectation',
)
write(p, s)

print('v4.5.0 verification fixes applied')
