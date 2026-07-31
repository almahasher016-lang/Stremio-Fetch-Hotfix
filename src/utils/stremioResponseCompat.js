const VERSION_SUFFIX_RE = /-v[0-9A-Za-z_]+$/u;

function versionTag(version) {
  return String(version || 'unknown').replace(/[^0-9A-Za-z]+/gu, '_').replace(/^_+|_+$/gu, '') || 'unknown';
}

function modeRank(id) {
  const value = String(id || '').replace(VERSION_SUFFIX_RE, '');
  if (/-orig$/u.test(value)) return 0;
  if (/-sync$/u.test(value)) return 1;
  if (/-refsync$/u.test(value)) return 2;
  if (/-styled-(?:ass|ssa)$/u.test(value)) return 3;
  return 4;
}

export function normalizeStremioSubtitleResponse(body, version) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.subtitles)) return body;
  const suffix = `-v${versionTag(version)}`;
  const subtitles = body.subtitles
    .map((item, index) => {
      const source = item && typeof item === 'object' ? item : {};
      const baseId = String(source.id || `subtitle-${index}`).replace(VERSION_SUFFIX_RE, '');
      return {
        ...source,
        id: `${baseId}${suffix}`,
        __compatIndex: index,
        __compatRank: modeRank(baseId),
      };
    })
    .sort((left, right) => left.__compatRank - right.__compatRank || left.__compatIndex - right.__compatIndex)
    .map(({ __compatIndex, __compatRank, ...item }) => item);
  return { ...body, subtitles };
}
