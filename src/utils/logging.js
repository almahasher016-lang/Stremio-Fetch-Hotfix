const SENSITIVE_QUERY_KEYS = new Set(['token', 'vault_token', 'registry_token']);

export function redactRequestUrl(value) {
  const raw = String(value || '');
  if (!raw) return raw;
  const redactedPath = raw.replace(
    /\/((?:proxy|preview)\/encoding)\/[^/?#]+/gi,
    '/$1/[redacted]',
  );
  try {
    const parsed = new URL(redactedPath, 'http://request.local');
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) parsed.searchParams.set(key, '[redacted]');
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return redactedPath.replace(
      /([?&](?:token|vault_token|registry_token)=)[^&#]*/gi,
      '$1[redacted]',
    );
  }
}
