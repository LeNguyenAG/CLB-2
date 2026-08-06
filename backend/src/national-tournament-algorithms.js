'use strict';

const crypto = require('crypto');

const CONFEDERATION_ORDER = ['AFC', 'CAF', 'CONCACAF', 'CONMEBOL', 'OFC', 'UEFA', 'OTHER'];

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = crypto.randomInt(index + 1);
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function allocateConfederationQuotas(rows, slotCount = 32) {
  const normalized = CONFEDERATION_ORDER
    .map((confederation) => ({
      confederation,
      available_country_count: Number(rows.find((row) => row.confederation === confederation)?.available_country_count || 0)
    }))
    .filter((row) => row.available_country_count > 0);
  const availableTotal = normalized.reduce((sum, row) => sum + row.available_country_count, 0);
  if (!availableTotal) throw new Error('Thư viện quốc gia chưa có dữ liệu liên đoàn để chia suất.');
  if (slotCount < normalized.length) throw new Error('Số suất nhỏ hơn số liên đoàn đang có quốc gia.');

  const quotas = normalized.map((row) => {
    const exact = row.available_country_count * slotCount / availableTotal;
    return { ...row, remainder: exact - Math.floor(exact), slot_count: Math.max(1, Math.floor(exact)) };
  });

  let assigned = quotas.reduce((sum, row) => sum + row.slot_count, 0);
  while (assigned < slotCount) {
    const candidate = [...quotas].sort((a, b) => b.remainder - a.remainder
      || b.available_country_count - a.available_country_count
      || CONFEDERATION_ORDER.indexOf(a.confederation) - CONFEDERATION_ORDER.indexOf(b.confederation))[0];
    candidate.slot_count += 1;
    candidate.remainder = -1;
    assigned += 1;
  }
  while (assigned > slotCount) {
    const candidate = [...quotas].filter((row) => row.slot_count > 1)
      .sort((a, b) => a.remainder - b.remainder
        || b.slot_count - a.slot_count
        || CONFEDERATION_ORDER.indexOf(b.confederation) - CONFEDERATION_ORDER.indexOf(a.confederation))[0];
    if (!candidate) throw new Error('Không thể cân bằng đủ số suất liên đoàn.');
    candidate.slot_count -= 1;
    assigned -= 1;
  }

  return quotas.map(({ remainder, ...row }) => row);
}

function sameConfederationPenalty(pairs) {
  return pairs.reduce((sum, pair) => sum + (pair[0].confederation === pair[1].confederation ? 1 : 0), 0);
}

function drawNationalKnockout(entries, mode = 'SEEDED_CONSTRAINED') {
  if (!Array.isArray(entries) || entries.length !== 32) throw new Error('Giải quốc gia đặc biệt cần đúng 32 đội.');
  const explicitSeeds = entries.filter((entry) => Number(entry.seed_rank) > 0)
    .sort((a, b) => Number(a.seed_rank) - Number(b.seed_rank) || Number(a.id) - Number(b.id));
  const useSeeds = mode === 'SEEDED_CONSTRAINED' && explicitSeeds.length > 0;
  const rankedIds = new Set(explicitSeeds.slice(0, 16).map((entry) => Number(entry.id)));
  const fillSeeds = shuffle(entries.filter((entry) => !rankedIds.has(Number(entry.id))))
    .slice(0, Math.max(0, 16 - rankedIds.size));
  const seeded = useSeeds ? [...explicitSeeds.slice(0, 16), ...fillSeeds] : [];
  const seededIds = new Set(seeded.map((entry) => Number(entry.id)));
  const unseeded = useSeeds ? entries.filter((entry) => !seededIds.has(Number(entry.id))) : [];

  let bestPairs = null;
  let bestPenalty = Number.POSITIVE_INFINITY;
  const attempts = useSeeds ? 2500 : 5000;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const pairs = [];
    if (useSeeds) {
      const remaining = shuffle(unseeded);
      for (const seed of shuffle(seeded)) {
        const differentIndex = remaining.findIndex((entry) => entry.confederation !== seed.confederation);
        const index = differentIndex >= 0 ? differentIndex : 0;
        pairs.push([seed, remaining.splice(index, 1)[0]]);
      }
    } else {
      const remaining = shuffle(entries);
      while (remaining.length) {
        const home = remaining.shift();
        const differentIndex = remaining.findIndex((entry) => entry.confederation !== home.confederation);
        const index = differentIndex >= 0 ? differentIndex : 0;
        pairs.push([home, remaining.splice(index, 1)[0]]);
      }
    }
    const penalty = sameConfederationPenalty(pairs);
    if (penalty < bestPenalty) {
      bestPairs = pairs;
      bestPenalty = penalty;
      if (penalty === 0) break;
    }
  }

  if (useSeeds) {
    bestPairs.sort((a, b) => Number(a[0].seed_rank || 9999) - Number(b[0].seed_rank || 9999)
      || Number(a[0].id) - Number(b[0].id));
    const bracketOrder = [0, 15, 7, 8, 3, 12, 4, 11, 1, 14, 6, 9, 2, 13, 5, 10];
    bestPairs = bracketOrder.map((index) => bestPairs[index]);
  } else {
    bestPairs = shuffle(bestPairs);
  }

  return {
    pairs: bestPairs,
    used_seeding: useSeeds,
    explicit_seed_count: explicitSeeds.length,
    same_confederation_matches: bestPenalty,
    warning: bestPenalty > 0
      ? `Không thể tránh hoàn toàn các cặp cùng liên đoàn; còn ${bestPenalty} cặp ở vòng 32 đội.`
      : null
  };
}

module.exports = { CONFEDERATION_ORDER, allocateConfederationQuotas, drawNationalKnockout, sameConfederationPenalty };
