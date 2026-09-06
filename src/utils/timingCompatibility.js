function lower(value) {
  return String(value || '').toLowerCase();
}

function normalizeReleaseText(value) {
  return lower(value)
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sourceFamily(value) {
  const text = normalizeReleaseText(value);
  if (!text) return '';

  // WEB-derived remux/mux tags must win over the generic scene REMUX fallback.
  if (
    /\bweb\s*(?:dl\s*rip|dlrip|dl|rip|mux|remux)?\b/u.test(text)
    || /\b(?:webdl|webrip|webmux|webremux)\b/u.test(text)
  ) return 'web';

  if (
    /\b(?:blu\s*ray|bluray|bd\s*rip|bdrip|br\s*rip|brrip|bd\s*remux|bdremux|bdmv|uhd\s*blu\s*ray)\b/u.test(text)
  ) return 'bluray';

  // Bare REMUX in scene-style names is overwhelmingly BluRay/UHD-BluRay derived.
  if (/\bremux\b/u.test(text)) return 'bluray';
  if (/\bhdtv\b/u.test(text)) return 'hdtv';
  if (/\b(?:dvd\s*rip|dvdrip|dvd)\b/u.test(text)) return 'dvd';
  if (/\b(?:hdcam|cam|telesync|telecine)\b/u.test(text)) return 'cam';
  return '';
}

export function sameSourceFamily(left, right) {
  const a = sourceFamily(left);
  const b = sourceFamily(right);
  return Boolean(a && b && a === b);
}
