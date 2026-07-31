'use strict';

const assert = require('assert');
const {
  drawPots,
  drawFullRandom,
  groupRoundRobinPairs,
  constrainedSeededPairs,
  constrainedRandomPairs
} = require('../src/world-cup-algorithms');

function buildEntries() {
  const confeds = [
    ...Array(16).fill('UEFA'),
    ...Array(9).fill('CAF'),
    ...Array(8).fill('AFC'),
    ...Array(6).fill('CONCACAF'),
    ...Array(6).fill('CONMEBOL'),
    'OFC', 'OTHER', 'OTHER'
  ];
  return confeds.slice(0, 48).map((confederation, index) => ({
    id: index + 1,
    entry_id: index + 1,
    country_name: `Country ${index + 1}`,
    country_code: `C${String(index + 1).padStart(2, '0')}`,
    confederation,
    seed_rank: index + 1,
    group_id: Math.floor(index / 4) + 1,
    group_code: String.fromCharCode(65 + Math.floor(index / 4))
  }));
}

function verifyDraw(groups, requirePots) {
  assert.strictEqual(groups.length, 12, 'Phải có 12 bảng');
  const ids = new Set();
  for (const group of groups) {
    assert.strictEqual(group.length, 4, 'Mỗi bảng phải có 4 quốc gia');
    group.forEach((entry) => ids.add(entry.id));
    if (requirePots) {
      assert.deepStrictEqual(
        [...group.map((entry) => entry.pot_no)].sort(),
        [1, 2, 3, 4],
        'Mỗi bảng phải có một đội từ mỗi pot'
      );
    }
  }
  assert.strictEqual(ids.size, 48, '48 quốc gia phải xuất hiện đúng một lần');
}

for (let attempt = 0; attempt < 100; attempt += 1) {
  const entries = buildEntries();
  verifyDraw(drawPots(entries).groups, true);
  verifyDraw(drawFullRandom(entries).groups, false);
}

assert.strictEqual(groupRoundRobinPairs([1, 2, 3, 4]).length, 6, 'Bảng 4 đội phải có 6 trận');

const qualified = buildEntries().slice(0, 32).map((entry, index) => ({
  ...entry,
  group_id: (index % 12) + 1,
  group_code: String.fromCharCode(65 + (index % 12))
}));
const seeded = qualified.slice(0, 16);
const unseeded = qualified.slice(16);
for (let attempt = 0; attempt < 100; attempt += 1) {
  const pairs = constrainedSeededPairs(seeded, unseeded);
  assert.strictEqual(pairs.length, 16);
  assert(pairs.every(([home, away]) => Number(home.group_id) !== Number(away.group_id)), 'Không được tái đấu cùng bảng');

  const randomPairs = constrainedRandomPairs(qualified);
  assert.strictEqual(randomPairs.length, 16);
  assert(randomPairs.every(([home, away]) => Number(home.group_id) !== Number(away.group_id)), 'Bốc thăm ngẫu nhiên vẫn phải tránh cùng bảng');
}

console.log('WORLD_CUP_ALGORITHM_OK: 48 quốc gia, 12 bảng, 72 trận vòng bảng và nhánh 32 đội đã vượt kiểm tra thuật toán.');
