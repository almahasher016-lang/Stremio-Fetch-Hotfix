import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { isArabicLanguage, normalizeStremioLanguage } from '../utils/language.js';
import { parseRelease, stableFingerprint } from '../utils/releaseParser.js';

const vaultItems = new Map();
let loaded = false;
let dirty = false;
let saveTimer = null;

function sha(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function cleanImdb(value) {
  const match = String(value || '').match(/tt\d{5,12}/i);
  return match ? match[0].toLowerCase() : null;
}

function normalizeText(value) {
  return String(value || '').replace(/\r\n/g, '\n').trim();
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
  loaded = true;
  try {
    const raw = await fs.readFile(config.vault.storagePath, 'utf8');
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    for (const item of items) {
      if (item?.id && item?.text) vaultItems.set(item.id, item);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') console.warn('[vault:load]', err.message);
  }
}

async function flushNow() {
  if (!dirty || !config.vault.enabled) return;
  dirty = false;
  try {
    await fs.mkdir(path.dirname(config.vault.storagePath), { recursive: true });
    const items = [...vaultItems.values()].slice(-config.vault.maxItems);
    await fs.writeFile(config.vault.storagePath, JSON.stringify({ version: 1, items }, null, 2));
  } catch (err) {
    console.warn('[vault:save]', err.message);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await flushNow();
  }, 250).unref?.();
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
  const text = normalizeText(input.text || input.subtitle || input.srt);
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (!text || text.length < 12) throw new Error('Subtitle text is required');
  if (byteLength > config.vault.maxSubtitleBytes) throw new Error('Subtitle is too large');
  const id = input.id || sha(`${input.imdbId || ''}:${input.season || ''}:${input.episode || ''}:${input.videoHash || ''}:${input.releaseName || input.filename || ''}:${text}`).slice(0, 32) || randomUUID();
  const item = {
    id,
    name: String(input.name || input.releaseName || input.filename || 'Personal Arabic Subtitle').slice(0, 180),
    imdbId: cleanImdb(input.imdbId || input.id || input.query) || null,
    tmdbId: input.tmdbId || null,
    season: normalizeEpisode(input.season),
    episode: normalizeEpisode(input.episode),
    videoHash: input.videoHash ? String(input.videoHash).toLowerCase() : null,
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
  if (!item.keys.length) throw new Error('Add imdbId or videoHash to index this subtitle');
  vaultItems.set(item.id, item);
  while (vaultItems.size > config.vault.maxItems) vaultItems.delete(vaultItems.keys().next().value);
  scheduleSave();
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

export async function deleteVaultSubtitle(id) {
  if (!config.vault.enabled) return false;
  await ensureLoaded();
  const ok = vaultItems.delete(String(id));
  if (ok) scheduleSave();
  return ok;
}

export async function getVaultStatus() {
  await ensureLoaded();
  return {
    enabled: config.vault.enabled,
    uploadEnabled: config.vault.uploadEnabled,
    items: vaultItems.size,
    storagePath: config.vault.storagePath,
  };
}
