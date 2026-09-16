const SENSITIVE_QUERY_KEYS = new Set([
  'token', 'vault_token', 'registry_token', 'api_key', 'apikey', 'subdl_api_key',
  'videohash', 'video_hash', 'moviehash', 'movie_hash', 'filehash', 'file_hash',
]);

// Stremio transmits playback metadata as /filename=...&videoHash=....json,
// which is part of pathname, not URLSearchParams. Scrub BOTH representations.
const SENSITIVE_INLINE_VALUE = /([?&/](?:token|vault_token|registry_token|api_key|apikey|subdl_api_key|videoHash|video_hash|movieHash|movie_hash|fileHash|file_hash)=)[^&#/?]*/gi;

function redactInlineValues(value) {
  return value.replace(SENSITIVE_INLINE_VALUE, '$1[redacted]');
}

export function redactRequestUrl(value) {
  const raw = String(value || '');
  if (!raw) return raw;
  const redactedPath = redactInlineValues(raw.replace(
    /\/((?:proxy|preview)\/encoding)\/[^/?#]+/gi,
    '/$1/[redacted]',
  ));
  try {
    const parsed = new URL(redactedPath, 'http://request.local');
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) parsed.searchParams.set(key, '[redacted]');
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return redactInlineValues(redactedPath);
  }
}
