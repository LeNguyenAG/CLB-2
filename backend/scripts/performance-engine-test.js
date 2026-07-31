'use strict';
const assert = require('node:assert/strict');
const { calculateRating } = require('../src/performance-rating-formula');

const match = { home_score: 2, away_score: 0, home_club_id: 1, away_club_id: 2, winner_club_id: 1 };
const base = { appeared: true, minutes_played: 90, club_id: 1, goals: 0, assists: 0, shots_on_target: 0, key_passes: 0, tackles_won: 0, interceptions: 0, saves: 0, penalties_saved: 0, clean_sheet: false, goals_conceded: 0, yellow_cards: 0, red_cards: 0, own_goals: 0 };
const striker = calculateRating({ ...base, position: 'FW', goals: 2, shots_on_target: 3 }, match).rating;
const defender = calculateRating({ ...base, position: 'DF', clean_sheet: true, tackles_won: 5, interceptions: 4 }, match).rating;
const keeper = calculateRating({ ...base, position: 'GK', clean_sheet: true, saves: 5, penalties_saved: 1 }, match).rating;
const sentOff = calculateRating({ ...base, position: 'MF', red_cards: 1, yellow_cards: 1 }, match).rating;
const absent = calculateRating({ ...base, appeared: false, position: 'FW' }, match).rating;
assert(striker > 7.5 && striker <= 10);
assert(defender > 7 && defender <= 10);
assert(keeper > 7 && keeper <= 10);
assert(sentOff < 6);
assert.equal(absent, 0);
console.log('PERFORMANCE_ENGINE_TEST_OK', { striker, defender, keeper, sentOff, absent });
