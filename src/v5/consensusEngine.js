function normalized(value) {
  return String(value || '').trim().toLowerCase();
}

export function provenanceFamily(item = {}) {
  return normalized(
    item.provenanceFamily
    || item.upstreamFamily
    || item.sourceFamily
    || item.originFamily
    || item.originalProvider
    || item.provider
    || 'unknown',
  );
}

function quality(item = {}) {
  return item.quality || item.accuracyPreflight?.quality || {};
}

function fingerprint(item = {}) {
  return quality(item).fingerprint || null;
}

function timelineBounds(item = {}) {
  const value = quality(item);
  const startMs = Number(value.startMs);
  const endMs = Number(value.endMs);
  const durationMs = Number(value.durationMs || value.fingerprint?.durationMs);
  return {
    startMs: Number.isFinite(startMs) ? startMs : null,
    endMs: Number.isFinite(endMs) ? endMs : null,
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? durationMs : null,
  };
}

export function absoluteTimelineBoundsCompatible(leftItem = {}, rightItem = {}, {
  maxStartDeltaMs = 8_000,
  maxEndDeltaMs = 12_000,
  minDurationRatio = 0.99,
} = {}) {
  const left = timelineBounds(leftItem);
  const right = timelineBounds(rightItem);
  if (left.startMs == null || right.startMs == null || left.endMs == null || right.endMs == null) return false;
  if (Math.abs(left.startMs - right.startMs) > maxStartDeltaMs) return false;
  if (Math.abs(left.endMs - right.endMs) > maxEndDeltaMs) return false;
  if (left.durationMs && right.durationMs) {
    const ratio = Math.min(left.durationMs, right.durationMs) / Math.max(left.durationMs, right.durationMs);
    if (ratio < minDurationRatio) return false;
  }
  return true;
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

function pairSimilarity(leftItem, rightItem) {
  if (!absoluteTimelineBoundsCompatible(leftItem, rightItem)) return 0;
  const left = fingerprint(leftItem);
  const right = fingerprint(rightItem);
  if (!left || !right) return 0;
  if (left.hash && right.hash && left.hash === right.hash) return 1;
  return temporalFingerprintSimilarity(left, right);
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
    if (!fingerprint(items[left])) continue;
    for (let right = left + 1; right < items.length; right += 1) {
      if (!fingerprint(items[right])) continue;
      if (pairSimilarity(items[left], items[right]) >= threshold) union(left, right);
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
    const families = new Set(group.map(provenanceFamily));
    const independentConsensusCount = families.size;
    for (const item of group) {
      let bestSimilarity = 0;
      let absoluteBoundsMatched = false;
      for (const other of group) {
        if (other === item || provenanceFamily(other) === provenanceFamily(item)) continue;
        const similarity = pairSimilarity(item, other);
        if (similarity > 0) absoluteBoundsMatched = true;
        bestSimilarity = Math.max(bestSimilarity, similarity);
      }
      evidence.set(item, {
        independentConsensusCount,
        timelineSimilarity: Number(bestSimilarity.toFixed(4)),
        absoluteBoundsMatched,
        fingerprint: fingerprint(item)?.hash || '',
        provenanceFamily: provenanceFamily(item),
      });
    }
  }
  return evidence;
}
