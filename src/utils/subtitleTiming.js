const SRT_TIME_RE = /(\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}[,.]\d{3})/g;

export function timeToMs(value) {
  const normalized = String(value || '').replace(',', '.');
  const match = normalized.match(/^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/);
  if (!match) return null;
  const [, hh, mm, ss, ms] = match;
  return Number(hh) * 3600000 + Number(mm) * 60000 + Number(ss) * 1000 + Number(ms);
}

export function msToTime(value) {
  const safe = Math.max(0, Math.round(Number(value) || 0));
  const hh = Math.floor(safe / 3600000);
  const mm = Math.floor((safe % 3600000) / 60000);
  const ss = Math.floor((safe % 60000) / 1000);
  const ms = safe % 1000;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export function shiftSubtitleTiming(text, offsetMs = 0) {
  return String(text || '').replace(SRT_TIME_RE, (_line, start, end) => {
    const s = timeToMs(start);
    const e = timeToMs(end);
    if (s === null || e === null) return _line;
    return `${msToTime(s + offsetMs)} --> ${msToTime(e + offsetMs)}`;
  });
}

export function stretchSubtitleTiming(text, ratio = 1, pivotMs = 0) {
  const safeRatio = Number.isFinite(Number(ratio)) && Number(ratio) > 0 ? Number(ratio) : 1;
  return String(text || '').replace(SRT_TIME_RE, (_line, start, end) => {
    const s = timeToMs(start);
    const e = timeToMs(end);
    if (s === null || e === null) return _line;
    return `${msToTime(pivotMs + (s - pivotMs) * safeRatio)} --> ${msToTime(pivotMs + (e - pivotMs) * safeRatio)}`;
  });
}

export function fpsRatio(sourceFps, targetFps) {
  const source = Number(sourceFps);
  const target = Number(targetFps);
  if (!Number.isFinite(source) || !Number.isFinite(target) || source <= 0 || target <= 0) return 1;
  return source / target;
}

export function detectSyncPlan({ subtitleRelease = {}, videoRelease = {}, extra = {} } = {}) {
  const hints = [];
  let confidence = 0;
  let ratio = 1;
  let offsetMs = 0;

  const sourceFps = Number(subtitleRelease.fps || extra.subtitleFps || 0);
  const targetFps = Number(videoRelease.fps || extra.fps || extra.videoFps || 0);
  if (sourceFps && targetFps && Math.abs(sourceFps - targetFps) > 0.01) {
    ratio = fpsRatio(sourceFps, targetFps);
    confidence += 75;
    hints.push(`fps:${sourceFps}->${targetFps}`);
  }

  const manualOffset = Number(extra.offsetMs ?? extra.subtitleOffsetMs ?? 0);
  if (Number.isFinite(manualOffset) && manualOffset !== 0) {
    offsetMs = manualOffset;
    confidence += 90;
    hints.push(`offset:${manualOffset}`);
  }

  if (subtitleRelease.source && videoRelease.source && subtitleRelease.source === videoRelease.source) confidence += 8;
  if (subtitleRelease.quality && videoRelease.quality && subtitleRelease.quality === videoRelease.quality) confidence += 8;
  if (subtitleRelease.releaseGroup && videoRelease.releaseGroup && subtitleRelease.releaseGroup === videoRelease.releaseGroup) confidence += 12;

  confidence = Math.min(100, confidence);
  return {
    enabled: confidence >= 70 && (Math.abs(ratio - 1) > 0.0001 || offsetMs !== 0),
    ratio,
    offsetMs,
    confidence,
    hints,
  };
}

export function applySyncPlan(text, plan = {}) {
  let output = String(text || '');
  if (!plan || !plan.enabled) return output;
  const anchors = Array.isArray(plan.anchorPoints) ? plan.anchorPoints
    .filter(anchor => Number.isFinite(Number(anchor.sourceMs)) && Number.isFinite(Number(anchor.referenceMs)))
    .sort((left, right) => Number(left.sourceMs) - Number(right.sourceMs)) : [];
  if (plan.type === 'reference-piecewise' && anchors.length >= 4) {
    const mapTime = value => {
      const time = Number(value);
      if (!Number.isFinite(time)) return 0;
      let left = anchors[0];
      let right = anchors[1];
      for (let index = 1; index < anchors.length; index += 1) {
        if (time <= Number(anchors[index].sourceMs)) {
          left = anchors[index - 1];
          right = anchors[index];
          break;
        }
        left = anchors[Math.max(0, index - 1)];
        right = anchors[index];
      }
      const sourceDelta = Number(right.sourceMs) - Number(left.sourceMs);
      const referenceDelta = Number(right.referenceMs) - Number(left.referenceMs);
      const ratio = sourceDelta > 0 ? referenceDelta / sourceDelta : Number(plan.ratio || 1);
      return Number(left.referenceMs) + (time - Number(left.sourceMs)) * ratio;
    };
    return output.replace(SRT_TIME_RE, (_line, start, end) => {
      const sourceStart = timeToMs(start);
      const sourceEnd = timeToMs(end);
      if (sourceStart === null || sourceEnd === null) return _line;
      const mappedStart = mapTime(sourceStart);
      const mappedEnd = Math.max(mappedStart + 1, mapTime(sourceEnd));
      return `${msToTime(mappedStart)} --> ${msToTime(mappedEnd)}`;
    });
  }
  if (Math.abs(Number(plan.ratio || 1) - 1) > 0.0001) output = stretchSubtitleTiming(output, Number(plan.ratio));
  if (Number(plan.offsetMs || 0) !== 0) output = shiftSubtitleTiming(output, Number(plan.offsetMs));
  return output;
}
