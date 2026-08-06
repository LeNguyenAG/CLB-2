'use strict';

const FORMULA_VERSION = '2.0.16';

const DEFAULT_VALUATION_CONFIG = Object.freeze({
  minimumProvenValue: 10_000_000,
  scoreLinearValue: 4_800_000,
  scoreQuadraticValue: 55_000,
  roundingUnit: 1_000_000,
  nationalPointMultiplier: 1.15,
  marketPulseLimitPct: 1.75
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function roundMoney(value, unit) {
  const safeUnit = Math.max(1, number(unit, 1_000_000));
  return Math.max(0, Math.round(number(value) / safeUnit) * safeUnit);
}

function deterministicPulse(seed, playerId, limitPct) {
  let hash = (Number(seed) ^ (Number(playerId) * 2654435761)) >>> 0;
  hash ^= hash << 13;
  hash ^= hash >>> 17;
  hash ^= hash << 5;
  const normalized = (hash >>> 0) / 0xffffffff;
  return round((normalized * 2 - 1) * number(limitPct, 1.75), 3);
}

function weightedProduction(input) {
  const position = input.position || 'MF';
  const goals = number(input.goals) + number(input.national_goals) * 1.1;
  const assists = number(input.assists);
  const cleanSheets = number(input.clean_sheets) + number(input.national_clean_sheets) * 0.9;
  const conceded = number(input.goals_conceded) + number(input.national_goals_conceded);
  const shots = number(input.shots_on_target);
  const keyPasses = number(input.key_passes);
  const tackles = number(input.tackles_won);
  const interceptions = number(input.interceptions);
  const saves = number(input.saves);
  const penaltiesSaved = number(input.penalties_saved);

  if (position === 'FW') return goals + assists * 0.75 + shots * 0.06 + keyPasses * 0.025;
  if (position === 'MF') return goals * 0.9 + assists + keyPasses * 0.07 + tackles * 0.018 + interceptions * 0.025;
  if (position === 'DF') return goals * 1.25 + assists * 0.85 + cleanSheets * 0.5 + tackles * 0.035 + interceptions * 0.05;
  return cleanSheets * 1.1 + saves * 0.055 + penaltiesSaved * 1.8 - conceded * 0.035;
}

function medalWeight(input) {
  return number(input.gold_count) * 8
    + number(input.silver_count) * 5
    + number(input.bronze_count) * 3
    + number(input.national_gold_count) * 1.5
    + number(input.national_silver_count) * 0.9
    + number(input.national_bronze_count) * 0.6;
}

function calculatePlayerValuation(input, options = {}) {
  const config = { ...DEFAULT_VALUATION_CONFIG, ...(options.config || {}) };
  const appearances = number(input.appearances) + number(input.national_appearances);
  const ratingAppearances = number(input.rating_appearances);
  const rankingPoints = Math.max(0, number(input.club_ranking_points))
    + Math.max(0, number(input.national_ranking_points)) * config.nationalPointMultiplier;
  const individualAwards = number(input.individual_award_count);
  const medals = medalWeight(input);
  const evidenceCount = appearances + ratingAppearances + Math.max(0, number(input.ranking_rows))
    + individualAwards + number(input.gold_count) + number(input.silver_count) + number(input.bronze_count);

  if (evidenceCount <= 0) {
    return {
      formulaVersion: FORMULA_VERSION,
      eligible: false,
      evidenceCount: 0,
      score: 0,
      fairValue: 0,
      marketPulsePct: 0,
      marketValue: 0,
      components: {
        performance: 0, production: 0, mvp: 0, ranking: 0,
        individualAwards: 0, teamMedals: 0, momentum: 0, experience: 0, discipline: 0
      },
      reason: 'Chưa có dữ liệu thi đấu, điểm hoặc danh hiệu đã xác nhận.'
    };
  }

  const production = Math.max(0, weightedProduction(input));
  const productionPerAppearance = production / Math.max(1, appearances);
  const averageRating = number(input.average_rating);
  const recentAverageRating = number(input.recent_average_rating, averageRating);

  const performanceComponent = averageRating > 0
    ? clamp((averageRating - 5.2) * 12, 0, 38)
    : clamp(6 + productionPerAppearance * 5, 4, 22);
  const productionComponent = Math.log1p(production) * 4 + productionPerAppearance * 7;
  const mvpComponent = Math.sqrt(number(input.match_mvp_count)) * 5
    + Math.sqrt(number(input.team_mvp_count)) * 2;
  const rankingComponent = Math.sqrt(rankingPoints) * 0.7;
  const individualComponent = Math.sqrt(individualAwards) * 4
    + Math.sqrt(Math.max(0, number(input.individual_award_points))) * 0.25;

  const contributionFactor = appearances <= 0
    ? 0.12
    : clamp(0.2 + performanceComponent / 60 + Math.min(0.25, productionPerAppearance * 0.25)
      + Math.min(0.15, mvpComponent / 40), 0.2, 1);
  const medalComponent = Math.sqrt(Math.max(0, medals)) * 2.5 * contributionFactor;
  const momentumComponent = averageRating > 0
    ? clamp((recentAverageRating - averageRating) * 10 + (recentAverageRating - 6.5) * 2.5, -7, 8)
    : 0;
  const experienceComponent = Math.log1p(appearances) * 1.5;
  const disciplineComponent = -Math.min(8,
    number(input.yellow_cards) * 0.08 + number(input.red_cards) * 0.8 + number(input.own_goals) * 0.5);

  const components = {
    performance: round(performanceComponent),
    production: round(productionComponent),
    mvp: round(mvpComponent),
    ranking: round(rankingComponent),
    individualAwards: round(individualComponent),
    teamMedals: round(medalComponent),
    momentum: round(momentumComponent),
    experience: round(experienceComponent),
    discipline: round(disciplineComponent)
  };
  const score = round(Object.values(components).reduce((sum, value) => sum + value, 0));
  const positiveScore = Math.max(0, score);
  const rawFairValue = config.minimumProvenValue
    + positiveScore * config.scoreLinearValue
    + positiveScore * positiveScore * config.scoreQuadraticValue;
  const fairValue = Math.max(config.minimumProvenValue, roundMoney(rawFairValue, config.roundingUnit));
  const marketPulsePct = deterministicPulse(options.seed || 1, input.player_id || input.id || 0, config.marketPulseLimitPct);
  const marketValue = Math.max(config.minimumProvenValue,
    roundMoney(fairValue * (1 + marketPulsePct / 100), config.roundingUnit));

  return {
    formulaVersion: FORMULA_VERSION,
    eligible: true,
    evidenceCount: round(evidenceCount),
    score,
    fairValue,
    marketPulsePct,
    marketValue,
    components,
    contributionFactor: round(contributionFactor),
    metrics: {
      appearances: round(appearances),
      clubAppearances: round(input.appearances),
      nationalAppearances: round(input.national_appearances),
      goals: round(input.goals),
      nationalGoals: round(input.national_goals),
      assists: round(input.assists),
      cleanSheets: round(input.clean_sheets),
      averageRating: round(averageRating),
      recentAverageRating: round(recentAverageRating),
      teamMvp: round(input.team_mvp_count),
      matchMvp: round(input.match_mvp_count),
      clubRankingPoints: round(input.club_ranking_points),
      nationalRankingPoints: round(input.national_ranking_points),
      individualAwards: round(individualAwards),
      gold: round(input.gold_count),
      silver: round(input.silver_count),
      bronze: round(input.bronze_count)
    },
    reason: 'Giá sàn tự động theo phong độ, đóng góp trực tiếp, MVP, điểm, danh hiệu cá nhân và huy chương đã điều chỉnh theo mức cống hiến.'
  };
}

module.exports = {
  FORMULA_VERSION,
  DEFAULT_VALUATION_CONFIG,
  calculatePlayerValuation,
  deterministicPulse
};
