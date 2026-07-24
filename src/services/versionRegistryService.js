import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { normalizeStremioLanguage } from '../utils/language.js';
import { parseRelease } from '../utils/releaseParser.js';
import { assetKey, buildVideoIdentity, versionKeys } from '../utils/videoIdentity.js';

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
  return { version: 3, assets: {}, associations: {}, decisions: [], media: {} };
}

function priority(association) {
  if (association.status === 'verified') return 3;
  if (association.status === 'suggested') return 2;
  return 1;
}

export class VersionRegistry {
  constructor({ enabled = true, storagePath, maxItems = 5000 } = {}) {
    this.enabled = enabled;
    this.storagePath = storagePath;
    this.maxItems = maxItems;
    this.state = initialState();
    this.loaded = false;
    this.writeQueue = Promise.resolve();
  }

  async ensureLoaded() {
    if (this.loaded || !this.enabled) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.storagePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = {
        ...initialState(),
        ...parsed,
        assets: parsed?.assets && typeof parsed.assets === 'object' ? parsed.assets : {},
        associations: parsed?.associations && typeof parsed.associations === 'object' ? parsed.associations : {},
        decisions: Array.isArray(parsed?.decisions) ? parsed.decisions : [],
        media: parsed?.media && typeof parsed.media === 'object' ? parsed.media : {},
      };
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('[version-registry:load]', error.message);
    }
  }

  async persist() {
    if (!this.enabled || !this.storagePath) return;
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      const temporaryPath = `${this.storagePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporaryPath, snapshot, 'utf8');
      await fs.rename(temporaryPath, this.storagePath);
    }).catch(error => console.warn('[version-registry:save]', error.message));
    return this.writeQueue;
  }

  async upsertAsset(item) {
    await this.ensureLoaded();
    const asset = compactAsset(item);
    const previous = this.state.assets[asset.key] || {};
    this.state.assets[asset.key] = { ...previous, ...asset, createdAt: previous.createdAt || now() };
    const keys = Object.keys(this.state.assets);
    if (keys.length > this.maxItems) {
      keys
        .sort((left, right) => String(this.state.assets[left].updatedAt).localeCompare(String(this.state.assets[right].updatedAt)))
        .slice(0, keys.length - this.maxItems)
        .forEach(key => delete this.state.assets[key]);
    }
    return this.state.assets[asset.key];
  }

  async recordDecision({ action = 'verify', search = {}, candidate = {}, note = '' } = {}) {
    if (!this.enabled) return null;
    await this.ensureLoaded();
    const identity = buildVideoIdentity(search);
    const asset = await this.upsertAsset(candidate);
    const keys = versionKeys(identity);
    if (!keys.length) throw new Error('Video hash or content identity is required');
    const created = [];
    for (const versionKey of keys) {
      const id = sha(`${versionKey}:${asset.key}`).slice(0, 32);
      const existing = this.state.associations[id] || {};
      this.state.associations[id] = {
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
      created.push(this.state.associations[id]);
    }
    this.state.decisions.unshift({
      id: randomUUID(),
      action,
      versionKeys: keys,
      assetKey: asset.key,
      note: String(note || '').slice(0, 500),
      createdAt: now(),
    });
    this.state.decisions = this.state.decisions.slice(0, this.maxItems * 3);
    await this.persist();
    return { identity, asset, associations: created };
  }

  async recordObservation({ search = {}, candidate = {}, quality = null, sync = null } = {}) {
    if (!this.enabled) return null;
    await this.ensureLoaded();
    const asset = await this.upsertAsset({ ...candidate, quality: quality || candidate.quality });
    this.state.assets[asset.key].lastUsedAt = now();
    this.state.assets[asset.key].lastSync = sync || null;
    await this.persist();
    return asset;
  }

  async recordMedia(input = {}) {
    if (!this.enabled) return buildVideoIdentity(input);
    await this.ensureLoaded();
    const identity = buildVideoIdentity(input);
    const keys = versionKeys(identity);
    const key = keys[0] || `content:${identity.catalogId || identity.id}`;
    this.state.media[key] = {
      key,
      type: identity.type,
      catalogId: identity.catalogId,
      videoHash: identity.videoHash,
      videoSize: identity.videoSize,
      filename: identity.filename,
      durationMs: identity.durationMs,
      embeddedSubtitles: Array.isArray(input.embeddedSubtitles) ? input.embeddedSubtitles.slice(0, 24) : [],
      updatedAt: now(),
    };
    await this.persist();
    return identity;
  }

  async hydrateIdentity(search = {}) {
    const identity = buildVideoIdentity(search);
    if (!this.enabled) return identity;
    await this.ensureLoaded();
    const directMatch = versionKeys(identity).map(key => this.state.media[key]).find(Boolean);
    const media = directMatch
      || (identity.videoHash ? Object.values(this.state.media).find(item => item.videoHash === identity.videoHash && (!identity.videoSize || Number(item.videoSize) === identity.videoSize)) : null)
      || (identity.catalogId ? Object.values(this.state.media).find(item => item.catalogId === identity.catalogId && (!identity.season || item.season === identity.season) && (!identity.episode || item.episode === identity.episode)) : null);
    if (!media) return identity;
    return buildVideoIdentity({
      ...identity,
      filename: identity.filename || media.filename,
      durationMs: identity.durationMs || media.durationMs,
    });
  }

  async findMatches(search = {}) {
    if (!this.enabled) return [];
    await this.ensureLoaded();
    const identity = buildVideoIdentity(search);
    const wanted = new Set(versionKeys(identity));
    const matches = Object.values(this.state.associations)
      .filter(association => association.status !== 'rejected' && wanted.has(association.versionKey))
      .map(association => ({ association, asset: this.state.assets[association.assetKey] }))
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

  async isRejected(search = {}, candidate = {}) {
    if (!this.enabled) return false;
    await this.ensureLoaded();
    const wanted = new Set(versionKeys(buildVideoIdentity(search)));
    const key = assetKey(candidate);
    return Object.values(this.state.associations).some(association => association.status === 'rejected' && association.assetKey === key && wanted.has(association.versionKey));
  }

  async suggestUpgrade(search = {}, candidates = []) {
    if (!this.enabled || !candidates.length) return null;
    await this.ensureLoaded();
    const current = await this.findMatches(search);
    const currentScore = current.reduce((highest, item) => Math.max(highest, Number(item.rankScore || 0)), 0);
    const candidate = candidates.find(item => Number(item.score || 0) > currentScore + config.resolver.upgradeMinDelta);
    if (!candidate) return null;
    return this.recordDecision({ action: 'suggest', search, candidate, note: 'Automatic upgrade suggestion' });
  }

  async list({ limit = 200 } = {}) {
    await this.ensureLoaded();
    return Object.values(this.state.associations)
      .map(association => ({ ...association, asset: this.state.assets[association.assetKey] || null }))
      .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))
      .slice(0, Math.max(1, Math.min(Number(limit) || 200, 2000)));
  }

  async status() {
    await this.ensureLoaded();
    const associations = Object.values(this.state.associations);
    return {
      enabled: this.enabled,
      storagePath: this.storagePath,
      assets: Object.keys(this.state.assets).length,
      verified: associations.filter(item => item.status === 'verified').length,
      suggested: associations.filter(item => item.status === 'suggested').length,
      rejected: associations.filter(item => item.status === 'rejected').length,
      media: Object.keys(this.state.media || {}).length,
    };
  }
}

export const versionRegistry = new VersionRegistry({
  enabled: config.versionRegistry.enabled,
  storagePath: config.versionRegistry.storagePath,
  maxItems: config.versionRegistry.maxItems,
});
