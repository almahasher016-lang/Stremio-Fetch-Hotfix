function providerFamily(item = {}) {
  return String(item.originalProvider || item.provider || 'unknown').trim().toLowerCase();
}

function fingerprint(item = {}) {
  return String(item.quality?.fingerprint?.hash || item.accuracyPreflight?.quality?.fingerprint?.hash || '').trim();
}

export function buildTimelineConsensus(items = []) {
  const groups = new Map();
  for (const item of items) {
    const hash = fingerprint(item);
    if (!hash) continue;
    const group = groups.get(hash) || { providers: new Set(), items: [] };
    group.providers.add(providerFamily(item));
    group.items.push(item);
    groups.set(hash, group);
  }

  const evidence = new Map();
  for (const group of groups.values()) {
    const independentConsensusCount = group.providers.size;
    const timelineSimilarity = independentConsensusCount >= 2 ? 1 : 0;
    for (const item of group.items) {
      evidence.set(item, {
        independentConsensusCount,
        timelineSimilarity,
        fingerprint: fingerprint(item),
      });
    }
  }
  return evidence;
}
