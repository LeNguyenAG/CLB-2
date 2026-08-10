'use strict';

const crypto = require('crypto');

const CONFEDERATION_ORDER = ['AFC', 'CAF', 'CONCACAF', 'CONMEBOL', 'OFC', 'UEFA'];

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const target = crypto.randomInt(index + 1);
    [copy[index], copy[target]] = [copy[target], copy[index]];
  }
  return copy;
}

function allocateConfederationQuotas(rows, slotCount = 32) {
  if (!Number.isInteger(slotCount) || slotCount < 1) throw new Error('Số suất phải là số nguyên dương.');
  const sourceRows = Array.isArray(rows) ? rows : [];
  const normalized = CONFEDERATION_ORDER
    .map((confederation) => {
      const confederationRows = sourceRows.filter((row) => row.confederation === confederation);
      const sum = (field) => confederationRows.reduce((total, row) => total + Math.max(0, Number(row[field] || 0)), 0);
      const availableCountryCount = Math.floor(sum('available_country_count'));
      return {
        confederation,
        available_country_count: availableCountryCount,
        strong_country_count: Math.min(availableCountryCount, Math.floor(sum('strong_country_count'))),
        world_cup_strength_points: 0,
        national_cup_strength_points: 0,
        historical_strength_points: 0,
        championship_count: 0,
        medal_count: 0
      };
    })
    .filter((row) => row.available_country_count > 0);
  const availableTotal = normalized.reduce((sum, row) => sum + row.available_country_count, 0);
  if (!availableTotal) throw new Error('Thư viện quốc gia chưa có dữ liệu liên đoàn để chia suất.');
  if (availableTotal < slotCount) {
    throw new Error(`Chỉ có ${availableTotal} quốc gia có cầu thủ đại diện hợp lệ; cần ít nhất ${slotCount} quốc gia.`);
  }
  if (slotCount < normalized.length) throw new Error('Số suất nhỏ hơn số liên đoàn đang có quốc gia.');

  const strongCountryTotal = normalized.reduce((sum, row) => sum + row.strong_country_count, 0);
  const quotas = normalized.map((row) => {
    const availabilityShare = row.available_country_count / availableTotal;
    const strengthShare = strongCountryTotal > 0
      ? row.strong_country_count / strongCountryTotal
      : availabilityShare;
    // 60% phản ánh số quốc gia thực có trong DB; 40% phản ánh số quốc gia
    // nằm trong nhóm xếp hạng mạnh hiện tại. Không dùng hạn ngạch ngoài đời.
    const allocationWeight = availabilityShare * 0.6 + strengthShare * 0.4;
    const proportionalTarget = availabilityShare * slotCount;
    const weightedTarget = allocationWeight * slotCount;
    const minimumSlots = 1;
    const maximumSlots = row.available_country_count;
    const initial = Math.min(maximumSlots, Math.max(minimumSlots, Math.floor(weightedTarget)));
    return {
      ...row,
      availability_share: availabilityShare,
      strength_share: strengthShare,
      allocation_weight: allocationWeight,
      proportional_slot_target: proportionalTarget,
      weighted_slot_target: weightedTarget,
      minimum_slot_count: minimumSlots,
      maximum_slot_count: maximumSlots,
      slot_count: initial
    };
  });

  let assigned = quotas.reduce((sum, row) => sum + row.slot_count, 0);
  // Hamilton có giới hạn sức chứa: cấp các suất còn thiếu theo phần dư lớn nhất.
  while (assigned < slotCount) {
    const candidate = [...quotas]
      .filter((row) => row.slot_count < row.maximum_slot_count)
      .sort((a, b) => (b.weighted_slot_target - b.slot_count) - (a.weighted_slot_target - a.slot_count)
      || b.strong_country_count - a.strong_country_count
      || b.available_country_count - a.available_country_count
      || CONFEDERATION_ORDER.indexOf(a.confederation) - CONFEDERATION_ORDER.indexOf(b.confederation))[0];
    if (!candidate) throw new Error('Không đủ quốc gia khả dụng để phân bổ đủ số suất.');
    candidate.slot_count += 1;
    assigned += 1;
  }
  while (assigned > slotCount) {
    const candidate = [...quotas].filter((row) => row.slot_count > row.minimum_slot_count)
      .sort((a, b) => (b.slot_count - b.weighted_slot_target) - (a.slot_count - a.weighted_slot_target)
        || a.strong_country_count - b.strong_country_count
        || b.slot_count - a.slot_count
        || CONFEDERATION_ORDER.indexOf(b.confederation) - CONFEDERATION_ORDER.indexOf(a.confederation))[0];
    if (!candidate) throw new Error('Không thể cân bằng đủ số suất liên đoàn.');
    candidate.slot_count -= 1;
    assigned -= 1;
  }

  return quotas.map((row) => ({
    ...row,
    availability_share: Number(row.availability_share.toFixed(6)),
    strength_share: Number(row.strength_share.toFixed(6)),
    allocation_weight: Number(row.allocation_weight.toFixed(6)),
    proportional_slot_target: Number(row.proportional_slot_target.toFixed(3)),
    weighted_slot_target: Number(row.weighted_slot_target.toFixed(3)),
    strength_adjustment_slots: Number((row.slot_count - row.proportional_slot_target).toFixed(3)),
    is_capacity_limited: row.slot_count === row.available_country_count
  }));
}

function sameConfederationPenalty(pairs) {
  return pairs.reduce((sum, pair) => sum + (pair[0].confederation === pair[1].confederation ? 1 : 0), 0);
}

function drawNationalKnockout(entries, mode = 'SEEDED_CONSTRAINED') {
  if (!Array.isArray(entries) || entries.length !== 32) throw new Error('Giải quốc gia đặc biệt cần đúng 32 đội.');
  const explicitSeeds = entries.filter((entry) => Number(entry.seed_rank) > 0)
    .sort((a, b) => Number(a.seed_rank) - Number(b.seed_rank) || Number(a.id) - Number(b.id));
  const useSeeds = mode === 'SEEDED_CONSTRAINED' && explicitSeeds.length > 0;
  const rankedIds = new Set(explicitSeeds.slice(0, 8).map((entry) => Number(entry.id)));
  const seeded = useSeeds ? explicitSeeds.slice(0, 8) : [];
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
      while (remaining.length) {
        const home = remaining.shift();
        const differentIndex = remaining.findIndex((entry) => entry.confederation !== home.confederation);
        const index = differentIndex >= 0 ? differentIndex : 0;
        pairs.push([home, remaining.splice(index, 1)[0]]);
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
    const seedPairs = bestPairs.filter((pair) => Number(pair[0].seed_rank) > 0 && Number(pair[0].seed_rank) <= 8)
      .sort((a, b) => Number(a[0].seed_rank) - Number(b[0].seed_rank));
    const otherPairs = bestPairs.filter((pair) => !(Number(pair[0].seed_rank) > 0 && Number(pair[0].seed_rank) <= 8));
    const seedOrder = [0, 7, 3, 4, 1, 6, 2, 5];
    bestPairs = seedOrder.flatMap((index) => [seedPairs[index], otherPairs.shift()]).filter(Boolean);
  } else {
    bestPairs = shuffle(bestPairs);
  }

  return {
    pairs: bestPairs,
    used_seeding: useSeeds,
    explicit_seed_count: seeded.length,
    same_confederation_matches: bestPenalty,
    warning: bestPenalty > 0
      ? `Không thể tránh hoàn toàn các cặp cùng liên đoàn; còn ${bestPenalty} cặp ở vòng 32 đội.`
      : null
  };
}

module.exports = { CONFEDERATION_ORDER, allocateConfederationQuotas, drawNationalKnockout, sameConfederationPenalty };
