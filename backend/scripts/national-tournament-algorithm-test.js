'use strict';

const assert = require('assert');
const { allocateConfederationQuotas, drawNationalKnockout } = require('../src/national-tournament-algorithms');

const quotas = allocateConfederationQuotas([
  { confederation: 'AFC', available_country_count: 47 },
  { confederation: 'CAF', available_country_count: 54 },
  { confederation: 'CONCACAF', available_country_count: 41 },
  { confederation: 'CONMEBOL', available_country_count: 10 },
  { confederation: 'OFC', available_country_count: 11 },
  { confederation: 'UEFA', available_country_count: 55 }
], 32);
assert.equal(quotas.reduce((sum, row) => sum + row.slot_count, 0), 32);
assert(quotas.every((row) => row.slot_count >= 1));
assert(quotas.find((row) => row.confederation === 'UEFA').slot_count > quotas.find((row) => row.confederation === 'OFC').slot_count);

const confederations = ['AFC', 'CAF', 'CONCACAF', 'CONMEBOL', 'OFC', 'UEFA'];
const entries = Array.from({ length: 32 }, (_, index) => ({
  id: index + 1,
  seed_rank: index < 12 ? index + 1 : null,
  confederation: confederations[index % confederations.length]
}));
const draw = drawNationalKnockout(entries, 'SEEDED_CONSTRAINED');
assert.equal(draw.pairs.length, 16);
assert.equal(new Set(draw.pairs.flat().map((entry) => entry.id)).size, 32);
assert.equal(draw.used_seeding, true);
assert.equal(draw.same_confederation_matches, 0);

const randomDraw = drawNationalKnockout(entries.map((entry) => ({ ...entry, seed_rank: null })), 'SEEDED_CONSTRAINED');
assert.equal(randomDraw.used_seeding, false);
assert.equal(randomDraw.pairs.length, 16);

console.log('NATIONAL_TOURNAMENT_ALGORITHMS_OK');
