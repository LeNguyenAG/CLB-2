'use strict';

const assert = require('node:assert/strict');
const { calculatePlayerValuation } = require('../src/player-valuation-formula');

const common = {
  position: 'FW', appearances: 24, rating_appearances: 24, recent_average_rating: 7.6,
  goals: 12, assists: 5, shots_on_target: 30, key_passes: 10,
  club_ranking_points: 90, national_ranking_points: 0, ranking_rows: 12,
  yellow_cards: 2, red_cards: 0, own_goals: 0
};

const newPlayer = calculatePlayerValuation({ player_id: 1, position: 'FW' }, { seed: 10 });
assert.equal(newPlayer.marketValue, 0, 'Cầu thủ chưa có dữ liệu phải giữ giá 0.');

const carrier = calculatePlayerValuation({
  ...common, player_id: 2, average_rating: 7.7, match_mvp_count: 4, team_mvp_count: 7,
  individual_award_count: 2, individual_award_points: 65,
  gold_count: 0, silver_count: 0, bronze_count: 0
}, { seed: 10 });

const passenger = calculatePlayerValuation({
  player_id: 3, position: 'FW', appearances: 4, rating_appearances: 4, average_rating: 5.9,
  recent_average_rating: 5.7, goals: 0, assists: 0, club_ranking_points: 210, ranking_rows: 8,
  match_mvp_count: 0, team_mvp_count: 0, individual_award_count: 0, individual_award_points: 0,
  gold_count: 3, silver_count: 2, bronze_count: 1
}, { seed: 10 });
assert(carrier.marketValue > passenger.marketValue, 'Cầu thủ gánh đội phải được định giá cao hơn người chỉ hưởng huy chương.');

const nationalStar = calculatePlayerValuation({
  ...common, player_id: 4, average_rating: 7.4, recent_average_rating: 7.8,
  national_appearances: 7, national_goals: 8, national_clean_sheets: 2,
  national_ranking_points: 180, individual_award_count: 2, individual_award_points: 80,
  gold_count: 1, national_gold_count: 1, match_mvp_count: 2, team_mvp_count: 4
}, { seed: 10 });
assert(nationalStar.marketValue > 10_000_000, 'Thành tích quốc gia phải được tính vào giá.');

const strong = calculatePlayerValuation({
  ...common, player_id: 5, average_rating: 7.35, recent_average_rating: 7.5,
  match_mvp_count: 2, team_mvp_count: 4, individual_award_count: 1,
  individual_award_points: 35, gold_count: 1, silver_count: 0, bronze_count: 1
}, { seed: 10 });
assert(strong.marketValue >= 300_000_000 && strong.marketValue <= 1_100_000_000,
  'Cầu thủ mạnh điển hình nên nằm trong vùng giá thực dụng, chủ yếu dưới khoảng 1 tỷ.');

const pulseA = calculatePlayerValuation({ ...common, player_id: 6, average_rating: 7.2 }, { seed: 11 });
const pulseB = calculatePlayerValuation({ ...common, player_id: 6, average_rating: 7.2 }, { seed: 12 });
assert(Math.abs(pulseA.marketPulsePct) <= 1.75 && Math.abs(pulseB.marketPulsePct) <= 1.75,
  'Dao động thị trường phải bị giới hạn để không phá vỡ giá công bằng.');

console.log('PLAYER_VALUATION_TEST_OK', {
  newPlayer: newPlayer.marketValue,
  carrier: carrier.marketValue,
  passenger: passenger.marketValue,
  nationalStar: nationalStar.marketValue,
  strong: strong.marketValue,
  pulseA: pulseA.marketPulsePct,
  pulseB: pulseB.marketPulsePct
});
