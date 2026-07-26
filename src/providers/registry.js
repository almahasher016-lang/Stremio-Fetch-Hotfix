import { config } from '../config.js';
import { searchOpenSubtitles } from './openSubtitles.js';
import { searchSubdl } from './subdl.js';
import { searchSubsource } from './subsource.js';
import { searchYify } from './yify.js';

export const providerDefinitions = Object.freeze({
  opensubtitles: {
    name: 'opensubtitles',
    label: 'OpenSubtitles',
    search: searchOpenSubtitles,
    supports: { movie: true, series: true, hash: true, reference: true },
    configured: () => Boolean(config.openSubtitles.apiKey),
  },
  subdl: {
    name: 'subdl',
    label: 'SubDL',
    search: searchSubdl,
    supports: { movie: true, series: true, hash: false, reference: true },
    configured: () => Boolean(config.subdl.apiKey),
  },
  subsource: {
    name: 'subsource',
    label: 'SubSource',
    search: searchSubsource,
    supports: { movie: true, series: true, hash: false, reference: true },
    configured: () => Boolean(config.subsource.apiKey && config.subsource.baseUrl),
  },
  yify: {
    name: 'yify',
    label: 'YIFY Subtitles',
    search: searchYify,
    supports: { movie: true, series: false, hash: false, reference: false },
    configured: () => Boolean(config.yify.enabled),
  },
});

export function getEnabledProviderDefinitions() {
  return config.providers.enabled
    .map(name => providerDefinitions[name])
    .filter(Boolean)
    .filter(provider => provider.configured());
}

export function getProviderDefinition(name) {
  return providerDefinitions[name] || null;
}
