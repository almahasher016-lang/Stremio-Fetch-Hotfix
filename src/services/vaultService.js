import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { isArabicLanguage, normalizeStremioLanguage } from '../utils/language.js';
import { parseRelease, stableFingerprint } from '../utils/releaseParser.js';
import { processSubtitleBuffer } from '../utils/subtitleProcessor.js';
import { httpError } from '../utils/httpError.js';

const TIMED_CUE_RE = /\d{2,3}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2,3}:\d{2}:\d{2},\d{3}/;

const vaultItems = new Map();
let loaded = false;
let loadPromise = null;
let writeQueue = Promise.resolve();

function sha(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function cleanImdb(value) {
  const match = String(value || '').match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : null;
}

function decodeBase64(value) {
  const normalized = String(value || '').replace(/\s+/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw httpError(400, 'Invalid subtitle base64');
  }
  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw httpError(400, 'Invalid subtitle base64');
  }
  return buffer;
}

function normalizeText(input) {
  const encoded = input?.subtitleBase64 || input?.base64;
  const raw = input?.text || input?.subtitle || input?.srt;
  const buffer = encoded ? decodeBase64(encoded) : Buffer.from(String(raw || ''), 'utf8');
  if (buffer.byteLength < 12) throw httpError(400, 'Subtitle text is required');
  if (buffer.byteLength > config.vault.maxSubtitleBytes) throw httpError(413, 'Subtitle is too large');
  const processed = processSubtitleBuffer(buffer, {
    stripSdh: false,
    stripMusicNotes: false,
  });
  if (!TIMED_CUE_RE.test(processed.text)) throw httpError(422, 'Subtitle text does not contain valid timed cues');
  return processed.text;
}

function normalizeEpisode(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function searchKeys(search = {}) {
  const imdbId = cleanImdb(search.imdbId || search.id || search.query);
  const season = normalizeEpisode(search.season);
  const episode = normalizeEpisode(search.episode);
  const videoHash = String(search.videoHash || search.hash || '').toLowerCase() || null;
  const filename = stableFingerprint(search.filename || search.query || '');
  const keys = [];
  if (videoHash) keys.push(`hash:${videoHash}`);
  if (imdbId && season && episode) keys.push(`episode:${imdbId}:s${season}:e${episode}`);
  if (imdbId && !season && !episode) keys.push(`movie:${imdbId}`);
  if (imdbId && filename) keys.push(`release:${imdbId}:${sha(filename).slice(0, 24)}`);
  return keys;
}

function itemKeys(item = {}) {
  const imdbId = cleanImdb(item.imdbId || item.id || item.query);
  const season = normalizeEpisode(item.season);
  const episode = normalizeEpisode(item.episode);
  const videoHash = String(item.videoHash || item.hash || '').toLowerCase() || null;
  const filename = stableFingerprint(item.filename || item.releaseName || item.name || '');
  const keys = [];
  if (videoHash) keys.push(`hash:${videoHash}`);
  if (imdbId && season && episode) keys.push(`episode:${imdbId}:s${season}:e${episode}`);
  if (imdbId && !season && !episode) keys.push(`movie:${imdbId}`);
  if (imdbId && filename) keys.push(`release:${imdbId}:${sha(filename).slice(0, 24)}`);
  return keys;
}

async function ensureLoaded() {
  if (loaded || !config.vault.enabled) return;
  if (!loadPromise) {
    loadPromise = (async () => {
      try {
        const raw = await fs.readFile(config.vault.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        const items = Array.isArray(parsed?.items) ? parsed.items : [];
        for (const item of items) {
          if (item?.id && item?.text) vaultItems.set(item.id, item);
        }
      } catch (err) {
        if (err.code !== 'ENOENT') console.warn('[vault:load]', err.message);
      } finally {
        loaded = true;
        loadPromise = null;
      }
    })();
  }
  await loadPromise;
}

async function persistVault() {
  if (!config.vault.enabled) return;
  const items = [...vaultItems.values()].slice(-config.vault.maxItems);
  const snapshot = JSON.stringify({ version: 1, items }, null, 2);
  const temporaryPath = `${config.vault.storagePath}.${process.pid}.${randomUUID()}.tmp`;
  const operation = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(config.vault.storagePath), { recursive: true });
    try {
      await fs.writeFile(temporaryPath, snapshot, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporaryPath, config.vault.storagePath);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => {});
      throw error;
    }
  });
  writeQueue = operation.catch(error => {
    console.warn('[vault:save]', error.message);
  });
  return operation;
}

function toProviderItem(item, search = {}) {
  const release = parseRelease(item.releaseName || item.filename || item.name || '');
  const matchKeys = new Set(searchKeys(search));
  const keys = item.keys || itemKeys(item);
  const exactHash = keys.some(k => k.startsWith('hash:') && matchKeys.has(k));
  return {
    provider: 'vault',
    id: `vault-${item.id}`,
    providerId: item.id,
    name: item.name || item.releaseName || 'Personal Vault Arabic',
    releaseName: item.releaseName || item.filename || item.name || '',
    fileName: item.filename || '',
    lang: normalizeStremioLanguage(item.lang || 'ar'),
    downloads: 999999,
    rating: 5,
    season: item.season || null,
    episode: item.episode || null,
    imdbId: cleanImdb(item.imdbId) || null,
    tmdbId: item.tmdbId || null,
    movieHash: item.videoHash || null,
    trusted: true,
    hearingImpaired: Boolean(item.hearingImpaired),
    machineTranslated: false,
    sourceType: exactHash ? 'personal-vault-exact-hash' : 'personal-vault',
    searchReason: exactHash ? 'vault-hash' : 'vault-match',
    score: exactHash ? 5000 : 4200,
    parsedRelease: release,
    download: `/vault/subtitles/${item.id}.srt`,
    raw: { vault: true, keys },
  };
}

export async function searchVault(search = {}) {
  if (!config.vault.enabled) return [];
  await ensureLoaded();
  const wanted = new Set(searchKeys(search));
  if (!wanted.size) return [];
  const out = [];
  for (const item of vaultItems.values()) {
    if (!isArabicLanguage(item.lang || 'ar')) continue;
    const keys = item.keys || itemKeys(item);
    if (keys.some(k => wanted.has(k))) out.push(toProviderItem({ ...item, keys }, search));
  }
  out.sort((a, b) => (b.score || 0) - (a.score || 0));
  return out.slice(0, Math.min(config.providers.topN, 10));
}

export async function addVaultSubtitle(input = {}) {
  if (!config.vault.enabled) throw new Error('Personal Vault is disabled');
  await ensureLoaded();
  const text = normalizeText(input);
  const byteLength = Buffer.byteLength(text, 'utf8');
  const requestedId = String(input.id || '').trim();
  if (requestedId && !/^[A-Za-z0-9_-]{1,64}$/.test(requestedId)) throw httpError(400, 'Invalid vault subtitle ID');
  const videoHash = String(input.videoHash || '').trim().toLowerCase();
  if (videoHash.length > 128 || /[^a-z0-9_-]/i.test(videoHash)) throw httpError(400, 'Invalid video hash');
  const id = requestedId || sha(`${input.imdbId || ''}:${input.season || ''}:${input.episode || ''}:${videoHash}:${input.releaseName || input.filename || ''}:${text}`).slice(0, 32) || randomUUID();
  const item = {
    id,
    name: String(input.name || input.releaseName || input.filename || 'Personal Arabic Subtitle').slice(0, 180),
    imdbId: cleanImdb(input.imdbId || input.id || input.query) || null,
    tmdbId: input.tmdbId || null,
    season: normalizeEpisode(input.season),
    episode: normalizeEpisode(input.episode),
    videoHash: videoHash || null,
    filename: String(input.filename || '').slice(0, 260),
    releaseName: String(input.releaseName || input.filename || '').slice(0, 260),
    lang: normalizeStremioLanguage(input.lang || 'ar'),
    hearingImpaired: Boolean(input.hearingImpaired),
    text,
    bytes: byteLength,
    keys: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  item.keys = itemKeys(item);
  if (!item.keys.length) throw httpError(400, 'Add imdbId or videoHash to index this subtitle');
  vaultItems.set(item.id, item);
  while (vaultItems.size > config.vault.maxItems) vaultItems.delete(vaultItems.keys().next().value);
  await persistVault();
  return { ...item, text: undefined };
}

export async function getVaultSubtitle(id) {
  if (!config.vault.enabled) return null;
  await ensureLoaded();
  return vaultItems.get(String(id)) || null;
}

export async function listVaultSubtitles() {
  if (!config.vault.enabled) return [];
  await ensureLoaded();
  return [...vaultItems.values()].map(item => ({ ...item, text: undefined })).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function exportVaultSnapshot() {
  if (!config.vault.enabled) throw httpError(403, 'Personal Vault is disabled');
  await ensureLoaded();
  const items = [...vaultItems.values()];
  return {
    version: 2,
    appVersion: config.app.version,
    exportedAt: new Date().toISOString(),
    count: items.length,
    items,
  };
}

export async function importVaultSnapshot(snapshot, { mode = 'merge' } = {}) {
  if (!config.vault.enabled) throw httpError(403, 'Personal Vault is disabled');
  await ensureLoaded();
  const normalizedMode = String(mode || 'merge').toLowerCase();
  if (!['merge', 'replace'].includes(normalizedMode)) throw httpError(400, 'Vault import mode must be merge or replace');
  if (!snapshot || !Array.isArray(snapshot.items)) throw httpError(400, 'Invalid Vault backup');
  if (snapshot.items.length > config.vault.maxItems) throw httpError(413, 'Vault backup contains too many items');

  const imported = [];
  for (const raw of snapshot.items) {
    if (!raw || typeof raw !== 'object') throw httpError(400, 'Invalid Vault backup item');
    const text = normalizeText(raw);
    const requestedId = String(raw.id || '').trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(requestedId)) throw httpError(400, 'Invalid vault subtitle ID');
    const videoHash = String(raw.videoHash || '').trim().toLowerCase();
    if (videoHash.length > 128 || /[^a-z0-9_-]/i.test(videoHash)) throw httpError(400, 'Invalid video hash');
    const item = {
      id: requestedId,
      name: String(raw.name || raw.releaseName || raw.filename || 'Personal Arabic Subtitle').slice(0, 180),
      imdbId: cleanImdb(raw.imdbId || raw.query) || null,
      tmdbId: raw.tmdbId || null,
      season: normalizeEpisode(raw.season),
      episode: normalizeEpisode(raw.episode),
      videoHash: videoHash || null,
      filename: String(raw.filename || '').slice(0, 260),
      releaseName: String(raw.releaseName || raw.filename || '').slice(0, 260),
      lang: normalizeStremioLanguage(raw.lang || 'ar'),
      hearingImpaired: Boolean(raw.hearingImpaired),
      text,
      bytes: Buffer.byteLength(text, 'utf8'),
      keys: [],
      createdAt: Number.isFinite(Date.parse(raw.createdAt)) ? new Date(raw.createdAt).toISOString() : new Date().toISOString(),
      updatedAt: Number.isFinite(Date.parse(raw.updatedAt)) ? new Date(raw.updatedAt).toISOString() : new Date().toISOString(),
    };
    item.keys = itemKeys(item);
    if (!item.keys.length) throw httpError(400, `Vault item ${item.id} has no imdbId or videoHash`);
    imported.push(item);
  }

  if (normalizedMode === 'replace') vaultItems.clear();
  for (const item of imported) vaultItems.set(item.id, item);
  while (vaultItems.size > config.vault.maxItems) vaultItems.delete(vaultItems.keys().next().value);
  await persistVault();
  return { mode: normalizedMode, imported: imported.length, total: vaultItems.size };
}

export async function deleteVaultSubtitle(id) {
  if (!config.vault.enabled) return false;
  await ensureLoaded();
  const ok = vaultItems.delete(String(id));
  if (ok) await persistVault();
  return ok;
}

export async function flushVaultWrites() {
  await writeQueue;
}

export async function getVaultStatus() {
  await ensureLoaded();
  return {
    enabled: config.vault.enabled,
    uploadEnabled: config.vault.uploadEnabled,
    items: vaultItems.size,
    backupVersion: 2,
    storagePath: config.vault.storagePath,
  };
}
