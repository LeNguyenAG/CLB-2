'use strict';

const assert = require('assert');
const { allocateConfederationQuotas, drawNationalKnockout } = require('../src/national-tournament-algorithms');

const quotas = allocateConfederationQuotas([
  { confederation: 'AFC', available_country_count: 14, strong_country_count: 7 },
  { confederation: 'CAF', available_country_count: 12, strong_country_count: 4 },
  { confederation: 'CONCACAF', available_country_count: 9, strong_country_count: 3 },
  { confederation: 'CONMEBOL', available_country_count: 7, strong_country_count: 5 },
  { confederation: 'OFC', available_country_count: 4, strong_country_count: 1 },
  { confederation: 'UEFA', available_country_count: 12, strong_country_count: 12 },
  { confederation: 'OTHER', available_country_count: 100, strong_country_count: 100 }
], 32);
assert.equal(quotas.reduce((sum, row) => sum + row.slot_count, 0), 32);
assert(quotas.every((row) => row.slot_count >= 1));
assert(quotas.every((row) => row.slot_count <= row.available_country_count));
assert(quotas.every((row) => row.slot_count >= row.minimum_slot_count));
assert(quotas.every((row) => row.slot_count <= row.maximum_slot_count));
assert.equal(quotas.some((row) => row.confederation === 'OTHER'), false);
assert(quotas.find((row) => row.confederation === 'UEFA').slot_count > quotas.find((row) => row.confederation === 'OFC').slot_count);
assert.equal(quotas.find((row) => row.confederation === 'CONMEBOL').maximum_slot_count, 7);

const capacityLimited = allocateConfederationQuotas([
  { confederation: 'AFC', available_country_count: 7, strong_country_count: 7 },
  { confederation: 'CAF', available_country_count: 8, strong_country_count: 0 },
  { confederation: 'CONCACAF', available_country_count: 8, strong_country_count: 0 },
  { confederation: 'OFC', available_country_count: 8, strong_country_count: 0 },
  { confederation: 'UEFA', available_country_count: 8, strong_country_count: 0 }
], 32);
const limitedAfc = capacityLimited.find((row) => row.confederation === 'AFC');
assert.equal(limitedAfc.slot_count, 7);
assert.equal(limitedAfc.is_capacity_limited, true);
assert(capacityLimited.every((row) => row.slot_count <= row.available_country_count));
assert.throws(() => allocateConfederationQuotas([
  { confederation: 'AFC', available_country_count: 15 },
  { confederation: 'UEFA', available_country_count: 16 }
], 32), /cần ít nhất 32 quốc gia/);

const noRanking = allocateConfederationQuotas([
  { confederation: 'AFC', available_country_count: 20 },
  { confederation: 'CAF', available_country_count: 16 },
  { confederation: 'CONCACAF', available_country_count: 10 },
  { confederation: 'CONMEBOL', available_country_count: 7 },
  { confederation: 'OFC', available_country_count: 4 },
  { confederation: 'UEFA', available_country_count: 23 }
], 32);
assert.equal(noRanking.reduce((sum, row) => sum + row.slot_count, 0), 32);
assert(noRanking.every((row) => Math.abs(row.strength_share - row.availability_share) < 0.000001));

// Kiểm thử thuộc tính với nhiều phân bố khác nhau để khóa ba điều kiện nghiệp vụ:
// đủ đúng tổng suất, không âm và không bao giờ vượt số quốc gia khả dụng.
let randomState = 0x2f0a18;
const random = () => {
  randomState = (randomState * 1664525 + 1013904223) >>> 0;
  return randomState / 0x100000000;
};
for (let run = 0; run < 750; run += 1) {
  const generated = ['AFC', 'CAF', 'CONCACAF', 'CONMEBOL', 'OFC', 'UEFA'].map((confederation) => ({
    confederation,
    available_country_count: 5 + Math.floor(random() * 30),
    strong_country_count: Math.floor(random() * 36)
  }));
  const result = allocateConfederationQuotas(generated, 32);
  assert.equal(result.reduce((sum, row) => sum + row.slot_count, 0), 32);
  assert(result.every((row) => row.slot_count >= 1));
  assert(result.every((row) => row.slot_count <= row.available_country_count));
  assert(result.every((row) => row.slot_count >= row.minimum_slot_count));
  assert(result.every((row) => row.slot_count <= row.maximum_slot_count));
}

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
assert.equal(draw.explicit_seed_count, 8);
assert(draw.pairs.every((pair) => !(
  Number(pair[0].seed_rank) > 0 && Number(pair[0].seed_rank) <= 8
  && Number(pair[1].seed_rank) > 0 && Number(pair[1].seed_rank) <= 8
)));
assert.equal(draw.same_confederation_matches, 0);

const randomDraw = drawNationalKnockout(entries.map((entry) => ({ ...entry, seed_rank: null })), 'SEEDED_CONSTRAINED');
assert.equal(randomDraw.used_seeding, false);
assert.equal(randomDraw.pairs.length, 16);

console.log('NATIONAL_TOURNAMENT_ALGORITHMS_OK');
