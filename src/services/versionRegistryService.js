import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { normalizeStremioLanguage } from '../utils/language.js';
import { parseRelease } from '../utils/releaseParser.js';
import { assetKey, buildVideoIdentity, versionKeys } from '../utils/videoIdentity.js';
import { isPostgresConfigured, queryDatabase, withDatabaseTransaction } from '../storage/postgres.js';

function now() {
  return new Date().toISOString();
}

function sha(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function compactAsset(item = {}) {
  const key = assetKey(item);
  return {
    key,
    provider: String(item.originalProvider || item.provider || 'unknown').toLowerCase(),
    providerId: item.providerId || item.fileId || item.id || null,
    id: item.id || null,
    name: String(item.name || item.releaseName || item.fileName || 'Arabic subtitle').slice(0, 220),
    releaseName: String(item.releaseName || item.fileName || item.name || '').slice(0, 320),
    fileName: String(item.fileName || '').slice(0, 320),
    lang: normalizeStremioLanguage(item.lang || item.language || 'ar'),
    download: item.download || item.url || null,
    imdbId: item.imdbId || null,
    tmdbId: item.tmdbId || null,
    movieHash: item.movieHash || item.hash || null,
    hearingImpaired: Boolean(item.hearingImpaired || item.sdh),
    machineTranslated: Boolean(item.machineTranslated || item.automatedTranslated || item.autoTranslated),
    quality: item.quality || null,
    rankScore: Number(item.score || item.rankScore || 0),
    updatedAt: now(),
  };
}

function initialState() {
  return { version: 4, assets: {}, associations: {}, decisions: [], media: {} };
}

function normalizeState(parsed) {
  return {
    ...initialState(),
    ...(parsed && typeof parsed === 'object' ? parsed : {}),
    assets: parsed?.assets && typeof parsed.assets === 'object' ? parsed.assets : {},
    associations: parsed?.associations && typeof parsed.associations === 'object' ? parsed.associations : {},
    decisions: Array.isArray(parsed?.decisions) ? parsed.decisions : [],
    media: parsed?.media && typeof parsed.media === 'object' ? parsed.media : {},
    version: 4,
  };
}

function priority(association) {
  if (association.status === 'verified') return 3;
  if (association.status === 'suggested') return 2;
  return 1;
}

function upsertAssetInState(state, item, maxItems) {
  const asset = compactAsset(item);
  const previous = state.assets[asset.key] || {};
  state.assets[asset.key] = { ...previous, ...asset, createdAt: previous.createdAt || now() };
  const keys = Object.keys(state.assets);
  if (keys.length > maxItems) {
    keys
      .sort((left, right) => String(state.assets[left].updatedAt).localeCompare(String(state.assets[right].updatedAt)))
      .slice(0, keys.length - maxItems)
      .forEach(key => delete state.assets[key]);
  }
  return state.assets[asset.key];
}

function findMatchesInState(state, search = {}) {
  const identity = buildVideoIdentity(search);
  const wanted = new Set(versionKeys(identity));
  const matches = Object.values(state.associations)
    .filter(association => association.status !== 'rejected' && wanted.has(association.versionKey))
    .map(association => ({ association, asset: state.assets[association.assetKey] }))
    .filter(entry => entry.asset?.download)
    .sort((left, right) => priority(right.association) - priority(left.association) || right.association.rankScore - left.association.rankScore);
  const seenAssets = new Set();
  return matches.filter(({ asset }) => {
    if (seenAssets.has(asset.key)) return false;
    seenAssets.add(asset.key);
    return true;
  }).map(({ association, asset }) => ({
    ...asset,
    id: `registry-${association.id}`,
    provider: 'registry',
    originalProvider: asset.provider,
    providerId: asset.providerId || asset.id,
    movieHash: asset.movieHash || identity.videoHash || null,
    trusted: association.status === 'verified',
    sourceType: association.versionKey.startsWith('hash') ? 'version-registry-exact-hash' : 'version-registry',
    searchReason: association.status === 'verified' ? 'verified-version' : 'suggested-version',
    rankScore: association.rankScore,
    score: association.status === 'verified' ? 9000 : 6500,
    quality: asset.quality || null,
    parsedRelease: parseRelease(asset.releaseName || asset.fileName || asset.name),
    registryAssociationId: association.id,
  }));
}

function recordDecisionInState(state, maxItems, { action = 'verify', search = {}, candidate = {}, note = '' } = {}) {
  const identity = buildVideoIdentity(search);
  const asset = upsertAssetInState(state, candidate, maxItems);
  const keys = versionKeys(identity);
  if (!keys.length) throw new Error('Video hash or content identity is required');
  const created = [];
  for (const versionKey of keys) {
    const id = sha(`${versionKey}:${asset.key}`).slice(0, 32);
    const existing = state.associations[id] || {};
    state.associations[id] = {
      ...existing,
      id,
      versionKey,
      assetKey: asset.key,
      status: action === 'reject' ? 'rejected' : action === 'suggest' ? 'suggested' : 'verified',
      manual: action === 'verify',
      note: String(note || '').slice(0, 500),
      rankScore: Number(candidate.score || asset.rankScore || 0),
      qualityScore: Number(candidate.quality?.score || asset.quality?.score || 0),
      createdAt: existing.createdAt || now(),
      updatedAt: now(),
    };
    created.push(state.associations[id]);
  }
  state.decisions.unshift({
    id: randomUUID(),
    action,
    versionKeys: keys,
    assetKey: asset.key,
    note: String(note || '').slice(0, 500),
    createdAt: now(),
  });
  state.decisions = state.decisions.slice(0, maxItems * 3);
  return { identity, asset, associations: created };
}

export class VersionRegistry {
  constructor({ enabled = true, storagePath, maxItems = 5000 } = {}) {
    this.enabled = enabled;
    this.storagePath = storagePath;
    this.maxItems = maxItems;
    this.state = initialState();
    this.loaded = false;
    this.loadPromise = null;
    this.writeQueue = Promise.resolve();
    this.migrationPromise = null;
  }

  get shared() {
    return this.enabled && isPostgresConfigured();
  }

  async ensureLocalLoaded() {
    if (this.loaded || !this.enabled) return;
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const raw = await fs.readFile(this.storagePath, 'utf8');
          this.state = normalizeState(JSON.parse(raw));
        } catch (error) {
          if (error.code !== 'ENOENT') console.warn('[version-registry:load]', error.message);
        } finally {
          this.loaded = true;
          this.loadPromise = null;
        }
      })();
    }
    await this.loadPromise;
  }

  async persistLocal() {
    if (!this.enabled || !this.storagePath) return;
    const snapshot = JSON.stringify(this.state, null, 2);
    const temporaryPath = `${this.storagePath}.${process.pid}.${randomUUID()}.tmp`;
    const operation = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      try {
        await fs.writeFile(temporaryPath, snapshot, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporaryPath, this.storagePath);
      } catch (error) {
        await fs.unlink(temporaryPath).catch(() => {});
        throw error;
      }
    });
    this.writeQueue = operation.catch(error => console.warn('[version-registry:save]', error.message));
    return operation;
  }

  async migrateLocalIfNeeded() {
    if (!this.shared) return;
    if (!this.migrationPromise) {
      this.migrationPromise = (async () => {
        const existing = await queryDatabase('SELECT payload FROM m7md_version_registry_state WHERE id = 1');
        if (existing.rows[0]?.payload) return;
        let state = initialState();
        try {
          const raw = await fs.readFile(this.storagePath, 'utf8');
          state = normalizeState(JSON.parse(raw));
        } catch (error) {
          if (error.code !== 'ENOENT') console.warn('[version-registry:migrate-read]', error.message);
        }
        await queryDatabase(
          'INSERT INTO m7md_version_registry_state (id, payload, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO NOTHING',
          [JSON.stringify(state)],
        );
      })().catch(error => {
        this.migrationPromise = null;
        throw error;
      });
    }
    await this.migrationPromise;
  }

  async readState(callback) {
    if (!this.enabled) return callback(initialState());
    if (!this.shared) {
      await this.ensureLocalLoaded();
      return callback(this.state);
    }
    await this.migrateLocalIfNeeded();
    const result = await queryDatabase('SELECT payload FROM m7md_version_registry_state WHERE id = 1');
    const state = normalizeState(result.rows[0]?.payload);
    this.state = state;
    this.loaded = true;
    return callback(state);
  }

  async mutateState(callback) {
    if (!this.enabled) return callback(initialState());
    if (!this.shared) {
      await this.ensureLocalLoaded();
      const result = await callback(this.state);
      await this.persistLocal();
      return result;
    }
    await this.migrateLocalIfNeeded();
    return withDatabaseTransaction(async client => {
      await client.query(
        'INSERT INTO m7md_version_registry_state (id, payload, updated_at) VALUES (1, $1::jsonb, NOW()) ON CONFLICT (id) DO NOTHING',
        [JSON.stringify(initialState())],
      );
      const locked = await client.query('SELECT payload FROM m7md_version_registry_state WHERE id = 1 FOR UPDATE');
      const state = normalizeState(locked.rows[0]?.payload);
      const result = await callback(state);
      await client.query(
        'UPDATE m7md_version_registry_state SET payload = $1::jsonb, updated_at = NOW() WHERE id = 1',
        [JSON.stringify(state)],
      );
      this.state = state;
      this.loaded = true;
      return result;
    });
  }

  async ensureLoaded() {
    if (!this.enabled) return;
    await this.readState(() => null);
  }

  async persist() {
    if (!this.enabled || this.shared) return;
    await this.persistLocal();
  }

  async flush() {
    if (!this.shared) await this.writeQueue;
  }

  async upsertAsset(item) {
    return this.mutateState(state => upsertAssetInState(state, item, this.maxItems));
  }

  async recordDecision(options = {}) {
    if (!this.enabled) return null;
    return this.mutateState(state => recordDecisionInState(state, this.maxItems, options));
  }

  async recordObservation({ search = {}, candidate = {}, quality = null, sync = null } = {}) {
    if (!this.enabled) return null;
    return this.mutateState(state => {
      const asset = upsertAssetInState(state, { ...candidate, quality: quality || candidate.quality }, this.maxItems);
      state.assets[asset.key].lastUsedAt = now();
      state.assets[asset.key].lastSync = sync || null;
      return asset;
    });
  }

  async recordMedia(input = {}) {
    if (!this.enabled) return buildVideoIdentity(input);
    return this.mutateState(state => {
      const identity = buildVideoIdentity(input);
      const keys = versionKeys(identity);
      const key = keys[0] || `content:${identity.catalogId || identity.id}`;
      state.media[key] = {
        key,
        type: identity.type,
        catalogId: identity.catalogId,
        title: identity.title,
        videoHash: identity.videoHash,
        videoSize: identity.videoSize,
        filename: identity.filename,
        season: identity.season,
        episode: identity.episode,
        year: identity.year,
        durationMs: identity.durationMs,
        fps: identity.fps,
        width: identity.width,
        height: identity.height,
        resolution: identity.resolution,
        videoCodec: identity.videoCodec,
        pixelFormat: identity.pixelFormat,
        hdr: identity.hdr,
        audioCodec: identity.audioCodec,
        audioChannels: identity.audioChannels,
        container: identity.container,
        embeddedSubtitles: Array.isArray(input.embeddedSubtitles) ? input.embeddedSubtitles.slice(0, 24) : [],
        updatedAt: now(),
      };
      return identity;
    });
  }

  async hydrateIdentity(search = {}) {
    const identity = buildVideoIdentity(search);
    if (!this.enabled) return identity;
    return this.readState(state => {
      const directMatch = versionKeys(identity).map(key => state.media[key]).find(Boolean);
      const media = directMatch
        || (identity.videoHash ? Object.values(state.media).find(item => item.videoHash === identity.videoHash && (!identity.videoSize || Number(item.videoSize) === identity.videoSize)) : null)
        || (identity.catalogId ? Object.values(state.media).find(item => item.catalogId === identity.catalogId && (identity.season == null || item.season === identity.season) && (!identity.episode || item.episode === identity.episode)) : null);
      if (!media) return identity;
      return buildVideoIdentity({
        ...identity,
        filename: identity.filename || media.filename,
        durationMs: identity.durationMs || media.durationMs,
        fps: identity.fps || media.fps,
        width: identity.width || media.width,
        height: identity.height || media.height,
        resolution: identity.resolution || media.resolution,
        videoCodec: identity.videoCodec || media.videoCodec,
        pixelFormat: identity.pixelFormat || media.pixelFormat,
        hdr: identity.hdr || media.hdr,
        audioCodec: identity.audioCodec || media.audioCodec,
        audioChannels: identity.audioChannels || media.audioChannels,
        container: identity.container || media.container,
        season: identity.season ?? media.season,
        episode: identity.episode || media.episode,
        year: identity.year || media.year,
        extra: {
          ...identity.extra,
          fps: identity.extra?.fps || media.fps,
          resolution: identity.extra?.resolution || media.resolution,
          videoCodec: identity.extra?.videoCodec || media.videoCodec,
          hdr: identity.extra?.hdr || media.hdr,
          audioCodec: identity.extra?.audioCodec || media.audioCodec,
          audioChannels: identity.extra?.audioChannels || media.audioChannels,
        },
      });
    });
  }

  async findMatches(search = {}) {
    if (!this.enabled) return [];
    return this.readState(state => findMatchesInState(state, search));
  }

  async isRejected(search = {}, candidate = {}) {
    if (!this.enabled) return false;
    return this.readState(state => {
      const wanted = new Set(versionKeys(buildVideoIdentity(search)));
      const key = assetKey(candidate);
      return Object.values(state.associations).some(association => association.status === 'rejected' && association.assetKey === key && wanted.has(association.versionKey));
    });
  }

  async suggestUpgrade(search = {}, candidates = []) {
    if (!this.enabled || !candidates.length) return null;
    return this.mutateState(state => {
      const current = findMatchesInState(state, search);
      const currentScore = current.reduce((highest, item) => Math.max(highest, Number(item.rankScore || 0)), 0);
      const candidate = candidates.find(item => Number(item.score || 0) > currentScore + config.resolver.upgradeMinDelta);
      if (!candidate) return null;
      return recordDecisionInState(state, this.maxItems, { action: 'suggest', search, candidate, note: 'Automatic upgrade suggestion' });
    });
  }

  async list({ limit = 200 } = {}) {
    return this.readState(state => Object.values(state.associations)
      .map(association => ({ ...association, asset: state.assets[association.assetKey] || null }))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 200, 2000))));
  }

  async status() {
    if (!this.enabled) return { enabled: false, storage: this.shared ? 'postgres' : 'local-file', shared: this.shared };
    return this.readState(state => {
      const associations = Object.values(state.associations);
      return {
        enabled: this.enabled,
        storage: this.shared ? 'postgres' : 'local-file',
        shared: this.shared,
        ...(this.shared ? {} : { storagePath: this.storagePath }),
        assets: Object.keys(state.assets).length,
        verified: associations.filter(item => item.status === 'verified').length,
        suggested: associations.filter(item => item.status === 'suggested').length,
        rejected: associations.filter(item => item.status === 'rejected').length,
        media: Object.keys(state.media || {}).length,
      };
    });
  }
}

export const versionRegistry = new VersionRegistry({
  enabled: config.versionRegistry.enabled,
  storagePath: config.versionRegistry.storagePath,
  maxItems: config.versionRegistry.maxItems,
});
