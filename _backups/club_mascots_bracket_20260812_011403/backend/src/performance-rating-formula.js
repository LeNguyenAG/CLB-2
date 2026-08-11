'use strict';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}
function resultBonus(match, clubId) {
  const home = number(match.home_score);
  const away = number(match.away_score);
  if (home === away) return 0.05;
  const won = Number(match.winner_club_id) === Number(clubId)
    || (Number(match.home_club_id) === Number(clubId) && home > away)
    || (Number(match.away_club_id) === Number(clubId) && away > home);
  return won ? 0.25 : -0.15;
}
function calculateRating(stat, match) {
  const position = stat.position || 'MF';
  if (!stat.appeared) return { rating: 0, breakdown: { formulaVersion: '2.0.14', appeared: false, reason: 'Không thi đấu' } };
  const minutes = clamp(number(stat.minutes_played, 90), 1, 130);
  const goalWeights = { GK: 1.5, DF: 1.35, MF: 1.1, FW: 0.9 };
  const cleanWeights = { GK: 0.75, DF: 0.55, MF: 0.2, FW: 0.1 };
  const concededWeights = { GK: 0.18, DF: 0.08, MF: 0.02, FW: 0 };
  const durationAdjustment = minutes < 20 ? -0.35 : minutes < 45 ? -0.15 : minutes >= 90 ? 0.08 : 0;
  const parts = {
    base: 6,
    duration: durationAdjustment,
    result: resultBonus(match, stat.club_id),
    goals: number(stat.goals) * goalWeights[position],
    assists: number(stat.assists) * 0.65,
    shots_on_target: number(stat.shots_on_target) * 0.05,
    key_passes: number(stat.key_passes) * 0.08,
    tackles_won: number(stat.tackles_won) * (position === 'DF' ? 0.06 : 0.04),
    interceptions: number(stat.interceptions) * (position === 'DF' ? 0.07 : 0.05),
    saves: number(stat.saves) * (position === 'GK' ? 0.1 : 0),
    penalties_saved: number(stat.penalties_saved) * (position === 'GK' ? 0.8 : 0),
    clean_sheet: stat.clean_sheet ? cleanWeights[position] : 0,
    goals_conceded: -number(stat.goals_conceded) * concededWeights[position],
    yellow_cards: -number(stat.yellow_cards) * 0.25,
    red_cards: -number(stat.red_cards) * 1.2,
    own_goals: -number(stat.own_goals) * 0.8
  };
  const raw = Object.values(parts).reduce((sum, value) => sum + number(value), 0);
  const rating = round(clamp(raw, 1, 10), 2);
  return { rating, breakdown: { formulaVersion: '2.0.14', position, minutes, parts, raw: round(raw, 3), final: rating } };
}
module.exports = { calculateRating };
