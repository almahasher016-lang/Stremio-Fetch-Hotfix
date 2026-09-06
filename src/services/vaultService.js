import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { isArabicLanguage, normalizeStremioLanguage } from '../utils/language.js';
import { parseRelease, stableFingerprint } from '../utils/releaseParser.js';
import { processSubtitleBuffer } from '../utils/subtitleProcessor.js';
import { httpError } from '../utils/httpError.js';
import { isPostgresConfigured, queryDatabase, withDatabaseTransaction } from '../storage/postgres.js';

const TIMED_CUE_RE = /\d{2,3}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2,3}:\d{2}:\d{2},\d{3}/;
const vaultItems = new Map();
let localLoaded = false;
let localLoadPromise = null;
let writeQueue = Promise.resolve();
let migrationPromise = null;

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
  const processed = processSubtitleBuffer(buffer, { stripSdh: false, stripMusicNotes: false });
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

async function ensureLocalLoaded() {
  if (localLoaded || !config.vault.enabled) return;
  if (!localLoadPromise) {
    localLoadPromise = (async () => {
      try {
        const raw = await fs.readFile(config.vault.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        for (const item of Array.isArray(parsed?.items) ? parsed.items : []) {
          if (item?.id && item?.text) vaultItems.set(item.id, item);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('[vault:load]', error.message);
      } finally {
        localLoaded = true;
        localLoadPromise = null;
      }
    })();
  }
  await localLoadPromise;
}

async function persistLocalVault() {
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
  writeQueue = operation.catch(error => console.warn('[vault:save]', error.message));
  return operation;
}

async function migrateLocalVaultIfNeeded() {
  if (!isPostgresConfigured() || !config.vault.enabled) return;
  if (!migrationPromise) {
    migrationPromise = (async () => {
      const countResult = await queryDatabase('SELECT COUNT(*)::int AS count FROM m7md_vault_subtitles');
      if (Number(countResult.rows[0]?.count || 0) > 0) return;
      let items = [];
      try {
        const raw = await fs.readFile(config.vault.storagePath, 'utf8');
        const parsed = JSON.parse(raw);
        items = (Array.isArray(parsed?.items) ? parsed.items : []).filter(item => item?.id && item?.text);
      } catch (error) {
        if (error.code !== 'ENOENT') console.warn('[vault:migrate-read]', error.message);
      }
      if (!items.length) return;
      await withDatabaseTransaction(async client => {
        for (const item of items.slice(-config.vault.maxItems)) {
          await client.query(
            'INSERT INTO m7md_vault_subtitles (id, payload, updated_at) VALUES ($1, $2::jsonb, COALESCE($3::timestamptz, NOW())) ON CONFLICT (id) DO NOTHING',
            [item.id, JSON.stringify(item), item.updatedAt || item.createdAt || null],
          );
        }
      });
      console.log(`[vault:migrate] imported ${items.length} local item(s) into PostgreSQL`);
    })().catch(error => {
      migrationPromise = null;
      throw error;
    });
  }
  await migrationPromise;
}

async function sharedItems(limit = config.vault.maxItems) {
  await migrateLocalVaultIfNeeded();
  const result = await queryDatabase(
    'SELECT payload FROM m7md_vault_subtitles ORDER BY updated_at DESC LIMIT $1',
    [Math.max(1, Math.min(Number(limit) || config.vault.maxItems, config.vault.maxItems))],
  );
  return result.rows.map(row => row.payload).filter(Boolean);
}

async function upsertSharedItem(item, client = null) {
  const params = [item.id, JSON.stringify(item), item.updatedAt || new Date().toISOString()];
  const sql = 'INSERT INTO m7md_vault_subtitles (id, payload, updated_at) VALUES ($1, $2::jsonb, $3::timestamptz) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = EXCLUDED.updated_at';
  if (client) await client.query(sql, params);
  else await queryDatabase(sql, params);
}

async function trimSharedVault(client = null) {
  const sql = 'DELETE FROM m7md_vault_subtitles WHERE id IN (SELECT id FROM m7md_vault_subtitles ORDER BY updated_at DESC OFFSET $1)';
  if (client) await client.query(sql, [config.vault.maxItems]);
  else await queryDatabase(sql, [config.vault.maxItems]);
}

async function ensureReady() {
  if (!config.vault.enabled) return;
  if (isPostgresConfigured()) await migrateLocalVaultIfNeeded();
  else await ensureLocalLoaded();
}

function toProviderItem(item, search = {}) {
  const release = parseRelease(item.releaseName || item.filename || item.name || '');
  const matchKeys = new Set(searchKeys(search));
  const keys = item.keys || itemKeys(item);
  const exactHash = keys.some(key => key.startsWith('hash:') && matchKeys.has(key));
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

function buildVaultItem(input, { requireId = false } = {}) {
  const text = normalizeText(input);
  const requestedId = String(input.id || '').trim();
  if (requireId && !requestedId) throw httpError(400, 'Vault subtitle ID is required');
  if (requestedId && !/^[A-Za-z0-9_-]{1,64}$/.test(requestedId)) throw httpError(400, 'Invalid vault subtitle ID');
  const videoHash = String(input.videoHash || '').trim().toLowerCase();
  if (videoHash.length > 128 || /[^a-z0-9_-]/i.test(videoHash)) throw httpError(400, 'Invalid video hash');
  const id = requestedId || sha(`${input.imdbId || ''}:${input.season || ''}:${input.episode || ''}:${videoHash}:${input.releaseName || input.filename || ''}:${text}`).slice(0, 32) || randomUUID();
  const createdAt = Number.isFinite(Date.parse(input.createdAt)) ? new Date(input.createdAt).toISOString() : new Date().toISOString();
  const item = {
    id,
    name: String(input.name || input.releaseName || input.filename || 'Personal Arabic Subtitle').slice(0, 180),
    imdbId: cleanImdb(input.imdbId || input.query) || null,
    tmdbId: input.tmdbId || null,
    season: normalizeEpisode(input.season),
    episode: normalizeEpisode(input.episode),
    videoHash: videoHash || null,
    filename: String(input.filename || '').slice(0, 260),
    releaseName: String(input.releaseName || input.filename || '').slice(0, 260),
    lang: normalizeStremioLanguage(input.lang || 'ar'),
    hearingImpaired: Boolean(input.hearingImpaired),
    text,
    bytes: Buffer.byteLength(text, 'utf8'),
    keys: [],
    createdAt,
    updatedAt: Number.isFinite(Date.parse(input.updatedAt)) ? new Date(input.updatedAt).toISOString() : new Date().toISOString(),
  };
  item.keys = itemKeys(item);
  if (!item.keys.length) throw httpError(400, 'Add imdbId or videoHash to index this subtitle');
  return item;
}

export async function searchVault(search = {}) {
  if (!config.vault.enabled) return [];
  await ensureReady();
  const wanted = new Set(searchKeys(search));
  if (!wanted.size) return [];
  const sourceItems = isPostgresConfigured() ? await sharedItems() : [...vaultItems.values()];
  const out = [];
  for (const item of sourceItems) {
    if (!isArabicLanguage(item.lang || 'ar')) continue;
    const keys = item.keys || itemKeys(item);
    if (keys.some(key => wanted.has(key))) out.push(toProviderItem({ ...item, keys }, search));
  }
  out.sort((a, b) => (b.score || 0) - (a.score || 0));
  return out.slice(0, Math.min(config.providers.topN, 10));
}

export async function addVaultSubtitle(input = {}) {
  if (!config.vault.enabled) throw new Error('Personal Vault is disabled');
  await ensureReady();
  const item = buildVaultItem(input);
  if (isPostgresConfigured()) {
    await upsertSharedItem(item);
    await trimSharedVault();
  } else {
    vaultItems.set(item.id, item);
    while (vaultItems.size > config.vault.maxItems) vaultItems.delete(vaultItems.keys().next().value);
    await persistLocalVault();
  }
  return { ...item, text: undefined };
}

export async function getVaultSubtitle(id) {
  if (!config.vault.enabled) return null;
  await ensureReady();
  if (!isPostgresConfigured()) return vaultItems.get(String(id)) || null;
  const result = await queryDatabase('SELECT payload FROM m7md_vault_subtitles WHERE id = $1', [String(id)]);
  return result.rows[0]?.payload || null;
}

export async function listVaultSubtitles() {
  if (!config.vault.enabled) return [];
  await ensureReady();
  const items = isPostgresConfigured() ? await sharedItems() : [...vaultItems.values()];
  return items.map(item => ({ ...item, text: undefined })).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function exportVaultSnapshot() {
  if (!config.vault.enabled) throw httpError(403, 'Personal Vault is disabled');
  await ensureReady();
  const items = isPostgresConfigured() ? await sharedItems() : [...vaultItems.values()];
  return { version: 3, appVersion: config.app.version, storage: isPostgresConfigured() ? 'postgres' : 'local-file', exportedAt: new Date().toISOString(), count: items.length, items };
}

export async function importVaultSnapshot(snapshot, { mode = 'merge' } = {}) {
  if (!config.vault.enabled) throw httpError(403, 'Personal Vault is disabled');
  await ensureReady();
  const normalizedMode = String(mode || 'merge').toLowerCase();
  if (!['merge', 'replace'].includes(normalizedMode)) throw httpError(400, 'Vault import mode must be merge or replace');
  if (!snapshot || !Array.isArray(snapshot.items)) throw httpError(400, 'Invalid Vault backup');
  if (snapshot.items.length > config.vault.maxItems) throw httpError(413, 'Vault backup contains too many items');
  const imported = snapshot.items.map(raw => buildVaultItem(raw, { requireId: true }));

  if (isPostgresConfigured()) {
    await withDatabaseTransaction(async client => {
      if (normalizedMode === 'replace') await client.query('DELETE FROM m7md_vault_subtitles');
      for (const item of imported) await upsertSharedItem(item, client);
      await trimSharedVault(client);
    });
    const count = await queryDatabase('SELECT COUNT(*)::int AS count FROM m7md_vault_subtitles');
    return { mode: normalizedMode, imported: imported.length, total: Number(count.rows[0]?.count || 0), storage: 'postgres' };
  }

  if (normalizedMode === 'replace') vaultItems.clear();
  for (const item of imported) vaultItems.set(item.id, item);
  while (vaultItems.size > config.vault.maxItems) vaultItems.delete(vaultItems.keys().next().value);
  await persistLocalVault();
  return { mode: normalizedMode, imported: imported.length, total: vaultItems.size, storage: 'local-file' };
}

export async function deleteVaultSubtitle(id) {
  if (!config.vault.enabled) return false;
  await ensureReady();
  if (isPostgresConfigured()) {
    const result = await queryDatabase('DELETE FROM m7md_vault_subtitles WHERE id = $1', [String(id)]);
    return result.rowCount > 0;
  }
  const ok = vaultItems.delete(String(id));
  if (ok) await persistLocalVault();
  return ok;
}

export async function flushVaultWrites() {
  if (!isPostgresConfigured()) await writeQueue;
}

export async function getVaultStatus() {
  await ensureReady();
  if (isPostgresConfigured()) {
    const count = await queryDatabase('SELECT COUNT(*)::int AS count FROM m7md_vault_subtitles');
    return { enabled: config.vault.enabled, uploadEnabled: config.vault.uploadEnabled, items: Number(count.rows[0]?.count || 0), backupVersion: 3, storage: 'postgres', shared: true };
  }
  return { enabled: config.vault.enabled, uploadEnabled: config.vault.uploadEnabled, items: vaultItems.size, backupVersion: 3, storage: 'local-file', shared: false, storagePath: config.vault.storagePath };
}
