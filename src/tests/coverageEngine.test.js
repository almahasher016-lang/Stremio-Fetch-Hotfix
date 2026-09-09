import test from 'node:test';
import assert from 'node:assert/strict';
import {
  availabilityTier,
  createCoverageLedger,
  createExhaustiveCoveragePlan,
  eligibleProviderNames,
  finalizeCoverageLedger,
  recordCoverageAttempt,
  recordCoverageFailure,
  recordCoverageStage,
  recordCoverageSuccess,
} from '../services/coverageEngine.js';

function provider(name, supports = { movie: true, series: true }) {
  return { name, configured: () => true, supports };
}

const definitions = {
  opensubtitles: provider('opensubtitles', { movie: true, series: true, hash: true, reference: true }),
  stremio: provider('stremio', { movie: true, series: true, hash: false, reference: true }),
  subdl: provider('subdl', { movie: true, series: true, hash: false, reference: true }),
  subsource: provider('subsource', { movie: true, series: true, hash: false, reference: true }),
  yify: provider('yify', { movie: true, series: false, hash: false, reference: false }),
};
const enabled = Object.keys(definitions);

test('exhaustive movie coverage includes every eligible provider, not only the first four', () => {
  const plan = createExhaustiveCoveragePlan({
    type: 'movie',
    imdbId: 'tt33296751',
    title: 'Tuner',
    filename: 'Tuner.2025.BluRay.1080p.REMUX-GROUP.mkv',
    year: 2025,
    catalogYear: 2026,
    aliases: ['The Tuner'],
  }, definitions, enabled);

  assert.ok(plan.length > 0);
  for (const stage of plan) assert.deepEqual(stage.providers, enabled);
  assert.ok(plan.some(stage => stage.name === 'coverage-metadata-yearless'));
  assert.ok(plan.some(stage => stage.name === 'coverage-title-yearless'));
  const yearVariants = plan.find(stage => stage.name === 'coverage-title-year-window').variants;
  const queries = yearVariants.map(variant => variant.query);
  assert.ok(queries.includes('Tuner 2025'));
  assert.ok(queries.includes('Tuner 2026'));
  assert.ok(queries.includes('Tuner 2024'));
  assert.ok(queries.includes('Tuner 2027'));
});

test('series coverage excludes movie-only providers and adds safe episode query forms', () => {
  const search = {
    type: 'series',
    imdbId: 'tt0944947',
    title: 'Game of Thrones',
    season: 1,
    episode: 2,
    episodeTitle: 'The Kingsroad',
  };
  const eligible = eligibleProviderNames(definitions, enabled, { mediaType: 'series' });
  assert.deepEqual(eligible, ['opensubtitles', 'stremio', 'subdl', 'subsource']);

  const plan = createExhaustiveCoveragePlan(search, definitions, enabled);
  const stage = plan.find(item => item.name === 'coverage-episode-pattern');
  assert.ok(stage);
  const queries = stage.variants.map(variant => variant.query);
  assert.ok(queries.includes('Game of Thrones S01E02'));
  assert.ok(queries.includes('Game of Thrones 1x02'));
  assert.ok(queries.includes('Game of Thrones The Kingsroad'));
  assert.ok(stage.providers.every(name => name !== 'yify'));
});

test('coverage ledger distinguishes confirmed empty from incomplete search', () => {
  const complete = createCoverageLedger({ type: 'movie', imdbId: 'tt1' }, ['a', 'b']);
  recordCoverageStage(complete, 'coverage-title-yearless');
  for (const name of ['a', 'b']) {
    recordCoverageAttempt(complete, name);
    recordCoverageSuccess(complete, name, 0);
  }
  const completeSummary = finalizeCoverageLedger(complete);
  assert.equal(completeSummary.coverageRatio, 1);
  assert.equal(completeSummary.status, 'complete');
  assert.equal(completeSummary.zeroResultState, 'confirmed-empty');

  const degraded = createCoverageLedger({ type: 'movie', imdbId: 'tt1' }, ['a', 'b']);
  recordCoverageAttempt(degraded, 'a');
  recordCoverageSuccess(degraded, 'a', 0);
  recordCoverageAttempt(degraded, 'b');
  recordCoverageFailure(degraded, 'b');
  const degradedSummary = finalizeCoverageLedger(degraded);
  assert.equal(degradedSummary.coverageRatio, 1);
  assert.equal(degradedSummary.status, 'degraded');
  assert.equal(degradedSummary.zeroResultState, 'search-incomplete');
  assert.deepEqual(degradedSummary.failedProviders, ['b']);
});

test('proof decisions expose stable availability tiers', () => {
  assert.equal(availabilityTier({ matchedByHash: true }, 'recovery'), 'EXACT');
  assert.equal(availabilityTier({}, 'certified'), 'CERTIFIED');
  assert.equal(availabilityTier({}, 'safe'), 'SAFE');
  assert.equal(availabilityTier({}, 'recovery'), 'RECOVERY');
  assert.equal(availabilityTier({}, 'withhold'), 'UNKNOWN');
});
