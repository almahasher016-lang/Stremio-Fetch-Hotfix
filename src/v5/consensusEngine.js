function providerFamily(item = {}) {
  return String(item.originalProvider || item.provider || 'unknown').trim().toLowerCase();
}

function fingerprint(item = {}) {
  return item.quality?.fingerprint || item.accuracyPreflight?.quality?.fingerprint || null;
}

function parsePoint(point) {
  const [position, duration, gap] = String(point || '').split(':').map(Number);
  if (![position, duration, gap].every(Number.isFinite)) return null;
  return { position, duration, gap };
}

export function temporalFingerprintSimilarity(left = {}, right = {}) {
  const leftPoints = Array.isArray(left.points) ? left.points.map(parsePoint).filter(Boolean) : [];
  const rightPoints = Array.isArray(right.points) ? right.points.map(parsePoint).filter(Boolean) : [];
  if (leftPoints.length < 12 || rightPoints.length < 12) return 0;

  const leftDuration = Number(left.durationMs || 0);
  const rightDuration = Number(right.durationMs || 0);
  if (leftDuration > 0 && rightDuration > 0) {
    const durationRatio = Math.min(leftDuration, rightDuration) / Math.max(leftDuration, rightDuration);
    if (durationRatio < 0.985) return 0;
  }

  const sampleCount = Math.min(leftPoints.length, rightPoints.length, 80);
  let error = 0;
  for (let index = 0; index < sampleCount; index += 1) {
    const leftIndex = Math.round((index / Math.max(1, sampleCount - 1)) * (leftPoints.length - 1));
    const rightIndex = Math.round((index / Math.max(1, sampleCount - 1)) * (rightPoints.length - 1));
    const a = leftPoints[leftIndex];
    const b = rightPoints[rightIndex];
    const positionError = Math.min(1, Math.abs(a.position - b.position) / 35);
    const durationError = Math.min(1, Math.abs(a.duration - b.duration) / 12);
    const gapError = Math.min(1, Math.abs(a.gap - b.gap) / 20);
    error += positionError * 0.72 + durationError * 0.18 + gapError * 0.10;
  }

  const averageError = error / sampleCount;
  return Math.max(0, Math.min(1, 1 - averageError));
}

function linkedComponents(items, threshold) {
  const parent = items.map((_, index) => index);
  const find = index => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };
  const union = (left, right) => {
    const a = find(left);
    const b = find(right);
    if (a !== b) parent[b] = a;
  };

  for (let left = 0; left < items.length; left += 1) {
    const a = fingerprint(items[left]);
    if (!a) continue;
    for (let right = left + 1; right < items.length; right += 1) {
      const b = fingerprint(items[right]);
      if (!b) continue;
      if (a.hash && b.hash && a.hash === b.hash) {
        union(left, right);
        continue;
      }
      if (temporalFingerprintSimilarity(a, b) >= threshold) union(left, right);
    }
  }

  const groups = new Map();
  for (let index = 0; index < items.length; index += 1) {
    if (!fingerprint(items[index])) continue;
    const root = find(index);
    const group = groups.get(root) || [];
    group.push(items[index]);
    groups.set(root, group);
  }
  return [...groups.values()];
}

export function buildTimelineConsensus(items = [], { similarityThreshold = 0.985 } = {}) {
  const evidence = new Map();
  for (const group of linkedComponents(items, similarityThreshold)) {
    const providers = new Set(group.map(providerFamily));
    const independentConsensusCount = providers.size;
    for (const item of group) {
      const own = fingerprint(item);
      let bestSimilarity = independentConsensusCount >= 2 ? 0 : 0;
      for (const other of group) {
        if (other === item || providerFamily(other) === providerFamily(item)) continue;
        const candidate = fingerprint(other);
        const similarity = own?.hash && candidate?.hash && own.hash === candidate.hash
          ? 1
          : temporalFingerprintSimilarity(own, candidate);
        bestSimilarity = Math.max(bestSimilarity, similarity);
      }
      evidence.set(item, {
        independentConsensusCount,
        timelineSimilarity: Number(bestSimilarity.toFixed(4)),
        fingerprint: own?.hash || '',
      });
    }
  }
  return evidence;
}
