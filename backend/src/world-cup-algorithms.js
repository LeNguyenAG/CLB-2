'use strict';

const crypto = require('crypto');

function algorithmError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function shuffle(items) {
  const array = [...items];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const randomIndex = crypto.randomInt(index + 1);
    [array[index], array[randomIndex]] = [array[randomIndex], array[index]];
  }
  return array;
}

function canPlaceByConfederation(group, entry) {
  const same = group.filter((item) => item.confederation === entry.confederation).length;
  if (entry.confederation === 'UEFA') return same < 2;
  if (entry.confederation === 'OTHER') return true;
  return same < 1;
}

function drawPots(entries) {
  const sorted = [...entries].sort((a, b) => {
    const rankA = Number(a.seed_rank || 9999);
    const rankB = Number(b.seed_rank || 9999);
    if (rankA !== rankB) return rankA - rankB;
    return Number(a.id) - Number(b.id);
  });

  const pots = [0, 1, 2, 3].map((potIndex) => sorted.slice(potIndex * 12, (potIndex + 1) * 12));
  for (let potIndex = 0; potIndex < pots.length; potIndex += 1) {
    pots[potIndex].forEach((entry) => { entry.pot_no = potIndex + 1; });
  }

  for (let attempt = 0; attempt < 500; attempt += 1) {
    const groups = Array.from({ length: 12 }, () => []);
    let valid = true;
    for (const originalPot of pots) {
      const pot = shuffle(originalPot);
      const availableGroupIndexes = shuffle(Array.from({ length: 12 }, (_, index) => index));
      const assigned = new Set();

      for (const entry of pot) {
        const candidates = availableGroupIndexes.filter(
          (groupIndex) => !assigned.has(groupIndex) && canPlaceByConfederation(groups[groupIndex], entry)
        );
        if (!candidates.length) {
          valid = false;
          break;
        }
        const groupIndex = candidates[crypto.randomInt(candidates.length)];
        groups[groupIndex].push(entry);
        assigned.add(groupIndex);
      }
      if (!valid) break;
    }
    if (valid && groups.every((group) => group.length === 4)) {
      return { groups, warning: null };
    }
  }

  const groups = Array.from({ length: 12 }, () => []);
  pots.forEach((pot) => {
    shuffle(pot).forEach((entry, groupIndex) => groups[groupIndex].push(entry));
  });
  return {
    groups,
    warning: 'Không thể thỏa toàn bộ giới hạn liên đoàn sau nhiều lần bốc thăm; hệ thống vẫn bảo đảm mỗi bảng có một đội từ mỗi nhóm hạt giống.'
  };
}

function drawFullRandom(entries) {
  const shuffled = shuffle(entries);
  return {
    groups: Array.from({ length: 12 }, (_, index) => shuffled.slice(index * 4, index * 4 + 4)),
    warning: null
  };
}

function groupRoundRobinPairs(entryIds) {
  if (entryIds.length !== 4) throw algorithmError('Một bảng World Cup phải có đúng 4 quốc gia.');
  return [
    [entryIds[0], entryIds[3]],
    [entryIds[1], entryIds[2]],
    [entryIds[0], entryIds[2]],
    [entryIds[3], entryIds[1]],
    [entryIds[0], entryIds[1]],
    [entryIds[2], entryIds[3]]
  ];
}

function constrainedSeededPairs(seeded, unseeded) {
  function solve(left, right, pairs = []) {
    if (!left.length) return pairs;
    const [seed, ...restSeeds] = left;
    const candidateIndexes = shuffle(
      right.map((item, index) => ({ item, index }))
        .filter(({ item }) => Number(item.group_id) !== Number(seed.group_id))
    );
    for (const { item, index } of candidateIndexes) {
      const remaining = [...right.slice(0, index), ...right.slice(index + 1)];
      const solved = solve(restSeeds, remaining, [...pairs, [seed, item]]);
      if (solved) return solved;
    }
    return null;
  }

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const pairs = solve(shuffle(seeded), shuffle(unseeded));
    if (pairs) return pairs;
  }
  throw algorithmError('Không thể tạo cặp đấu không trùng bảng. Hãy dùng chế độ ngẫu nhiên hoặc kiểm tra dữ liệu vòng bảng.');
}

function constrainedRandomPairs(entries) {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const pool = shuffle(entries);
    const pairs = [];
    let valid = true;
    for (let index = 0; index < pool.length; index += 2) {
      if (Number(pool[index].group_id) === Number(pool[index + 1].group_id)) {
        valid = false;
        break;
      }
      pairs.push([pool[index], pool[index + 1]]);
    }
    if (valid) return pairs;
  }
  throw algorithmError('Không thể bốc thăm ngẫu nhiên mà tránh tái đấu cùng bảng.');
}

module.exports = {
  shuffle,
  canPlaceByConfederation,
  drawPots,
  drawFullRandom,
  groupRoundRobinPairs,
  constrainedSeededPairs,
  constrainedRandomPairs
};
