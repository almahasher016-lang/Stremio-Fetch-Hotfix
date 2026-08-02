from pathlib import Path

path = Path('src/tests/encodingProxy.test.js')
text = path.read_text(encoding='utf-8')

replacements = [
    (
        "test('provider-backed reference sync never calls a protected self-download route', async () => {\n  const [referenceSubtitle] = toStremioSubtitles([{",
        "test('provider-backed reference sync never calls a protected self-download route', async () => {\n  config.ranking.enableReferenceAutoSync = true;\n  try {\n    const referenceOptions = toStremioSubtitles([{",
    ),
    (
        "  }], 'https://addon.example', { type: 'movie', id: 'tt1375666' });\n  const token = new URL(referenceSubtitle.url).pathname.match(/^\\/proxy\\/encoding\\/(.+)\\.srt$/)[1];",
        "    }], 'https://addon.example', { type: 'movie', id: 'tt1375666' });\n    const referenceSubtitle = referenceOptions.find(item => item.id.includes('-experimental-refsync-v'));\n    assert.ok(referenceSubtitle);\n    const token = new URL(referenceSubtitle.url).pathname.match(/^\\/proxy\\/encoding\\/(.+)\\.srt$/)[1];",
    ),
    (
        "  assert.deepEqual(resolvedIds, ['123456', '654321']);\n});\n\ntest('reference fallback selection scans past incompatible higher-ranked candidates', () => {",
        "    assert.deepEqual(resolvedIds, ['123456', '654321']);\n  } finally {\n    config.ranking.enableReferenceAutoSync = false;\n  }\n});\n\ntest('reference fallback selection scans past incompatible higher-ranked candidates', () => {\n  config.ranking.enableReferenceAutoSync = true;\n  try {",
    ),
    (
        "  const reference = subtitles.find(item => item.id === 'first-refsync');\n  const token = new URL(reference.url).pathname.match(/^\\/proxy\\/encoding\\/(.+)\\.srt$/)[1];",
        "    const reference = subtitles.find(item => item.id.includes('-experimental-refsync-v'));\n    assert.ok(reference);\n    const token = new URL(reference.url).pathname.match(/^\\/proxy\\/encoding\\/(.+)\\.srt$/)[1];",
    ),
    (
        "  assert.ok(payload.fallbacks[0].reference?.url);\n});",
        "    assert.ok(payload.fallbacks[0].reference?.url);\n  } finally {\n    config.ranking.enableReferenceAutoSync = false;\n  }\n});",
    ),
]

for old, new in replacements:
    if old not in text:
        raise SystemExit(f'expected test fragment not found: {old[:80]}')
    text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8')
print('Updated reference synchronization tests for explicit opt-in')
