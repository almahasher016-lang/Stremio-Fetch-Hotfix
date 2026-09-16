import { config } from '../config.js';
import { buildUniversalVideoProfile } from '../utils/universalVideoIdentity.js';
import { searchStremioOpenSubtitles } from './stremioOpenSubtitles.js';

function sourceFamily(item) {
  return buildUniversalVideoProfile(item).sourceFamily;
}

function uniqueCandidates(rows, maxItems) {
  const seen = new Set();
  const output = [];
  for (const item of rows) {
    const key = String(item.providerId || item.id || item.download || '');
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
    if (output.length >= maxItems) break;
  }
  return output;
}

/**
 * A successful playback-hint request may still return only subtitles for a different
 * distribution (e.g. WEB subtitles for BluRay playback). In that case also query the
 * unhinted catalog and retain candidates for V5's independent identity/timing proof.
 * Matching a source family is discovery evidence, NEVER hash/timeline verification.
 */
export async function searchStremioWithSourceRecovery(variant, {
  searchImpl = searchStremioOpenSubtitles,
  maxItems = config.providers.maxProviderItems,
} = {}) {
  const targeted = await searchImpl(variant);
  if (!Array.isArray(targeted) || !targeted.length || variant.reason !== 'exact-metadata') return targeted;
  const targetFamily = buildUniversalVideoProfile({ filename: variant.playbackFilename || variant.filename }).sourceFamily;
  if (!targetFamily || targeted.some(item => sourceFamily(item) === targetFamily)) return targeted;

  let catalog;
  try {
    // Clearing *both* hints is essential: a filename alone triggers the same narrowed
    // route in the underlying Stremio provider. The original catalog identity remains.
    catalog = await searchImpl({ ...variant, playbackFilename: '', playbackHash: null });
  } catch (error) {
    if (variant.signal?.aborted || error?.name === 'AbortError') throw error;
    // A catalog failure must not erase a usable targeted result.
    console.warn('[provider:stremio] Source-family catalog recovery failed:', error?.message || error);
    return targeted;
  }
  if (!Array.isArray(catalog) || !catalog.length) return targeted;
  const matching = catalog.filter(item => sourceFamily(item) === targetFamily);
  const other = catalog.filter(item => sourceFamily(item) !== targetFamily);
  const limit = Math.max(1, Math.floor(Number(maxItems) || 1));
  return uniqueCandidates([...matching, ...targeted, ...other], limit);
}
