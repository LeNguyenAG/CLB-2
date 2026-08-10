'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sql = [
  fs.readFileSync(path.join(root, 'database', 'football_rank_manager_full_v3.sql'), 'utf8'),
  fs.readFileSync(path.join(root, 'database', 'UPDATE_V2_0_15_NATIONAL_TOURNAMENTS.sql'), 'utf8'),
  fs.readFileSync(path.join(root, 'database', 'UPDATE_V2_0_16_AUTOMATIC_PLAYER_VALUATION.sql'), 'utf8'),
  fs.readFileSync(path.join(root, 'database', 'UPDATE_V2_0_18_NATIONAL_32_ADMIN_EXPERIENCE.sql'), 'utf8')
].join('\n');
const source = ['routes-core.js', 'routes-football.js', 'routes-competitions.js', 'routes-world-cup.js', 'routes-national-tournaments.js', 'routes-stadiums.js', 'routes-stadium-compliance.js', 'routes-performance.js', 'routes-influence.js', 'routes-player-valuations.js']
  .map((file) => fs.readFileSync(path.join(root, 'src', file), 'utf8'))
  .join('\n');

const procedures = new Set([...sql.matchAll(/CREATE PROCEDURE\s+(\w+)/gi)].map((match) => match[1]));
const calledProcedures = new Set([...source.matchAll(/callProcedure\('([^']+)'/g)].map((match) => match[1]));
const missingProcedures = [...calledProcedures].filter((name) => !procedures.has(name));

const requiredObjects = [
  'users', 'clubs', 'players', 'coaching_staff', 'player_contracts', 'staff_contracts',
  'wallets', 'wallet_transactions', 'seasons', 'competitions', 'competition_groups',
  'competition_group_members', 'competition_rounds', 'matches', 'player_match_stats',
  'competition_results', 'competition_prize_rules', 'competition_special_reward_rules',
  'transfer_offers', 'player_transfers', 'award_types', 'player_awards',
  'v_player_list', 'v_player_dossier_summary', 'v_group_standings',
  'v_player_rankings_current', 'v_latest_club_world_ranking', 'v_latest_player_rankings',
  'world_cup_profiles', 'player_national_profiles', 'world_cup_entries', 'world_cup_groups',
  'world_cup_group_members', 'world_cup_rounds', 'world_cup_matches', 'world_cup_match_links',
  'world_cup_qualified_entries', 'world_cup_results', 'world_cup_upset_rewards',
  'v_world_cup_group_standings', 'stadiums', 'stadium_club_links', 'stadium_upgrade_catalog',
  'matchday_finances', 'sponsor_brands', 'stadium_standard_profiles',
  'competition_stadium_requirements', 'match_stadium_assignments', 'v_match_stadium_compliance',
  'match_player_ratings', 'performance_bonus_rules', 'competition_performance_bonuses',
  'club_influence_profiles', 'player_influence_profiles', 'club_influence_history',
  'commercial_event_templates', 'club_commercial_events', 'club_merchandise_campaigns',
  'influence_grant_rules', 'influence_grant_runs', 'influence_grant_payments',
  'v_competition_performance_leaderboard', 'v_club_influence_ranking',
  'v_player_influence_ranking', 'v_club_commercial_summary',
  'national_competition_reward_rules', 'national_cup_profiles',
  'national_cup_confederation_quotas', 'national_cup_entries', 'national_cup_rounds',
  'national_cup_matches', 'national_cup_match_links', 'national_cup_results',
  'player_valuation_batches', 'player_valuation_results'
];
const missingObjects = requiredObjects.filter((name) => {
  const expression = new RegExp(`CREATE (?:(?:OR REPLACE )?VIEW|TABLE(?: IF NOT EXISTS)?)\\s+${name}\\b`, 'i');
  return !expression.test(sql);
});

const requiredValuationFeatures = [
  ['players.valuation_score', /frm_v216_add_column\('players','valuation_score'/i],
  ['players.valuation_breakdown', /frm_v216_add_column\('players','valuation_breakdown'/i],
  ['history.valuation_batch_id', /frm_v216_add_column\('player_market_value_history','valuation_batch_id'/i],
  ['salary floor insert trigger', /CREATE TRIGGER\s+trg_player_contract_salary_floor_insert/i],
  ['salary floor update trigger', /CREATE TRIGGER\s+trg_player_contract_salary_floor_update/i],
  ['transfer offer floor insert trigger', /CREATE TRIGGER\s+trg_transfer_offer_value_floor_insert/i],
  ['transfer offer floor update trigger', /CREATE TRIGGER\s+trg_transfer_offer_value_floor_update/i],
  ['completed transfer floor trigger', /CREATE TRIGGER\s+trg_player_transfer_value_floor_insert/i],
  ['automatic history trigger', /CREATE TRIGGER\s+trg_players_market_value_history/i],
  ['valuation API refresh route', /player-valuations\/recalculate/i],
  ['single-player valuation API route', /players\/:id\/valuation\/recalculate/i]
];
const missingValuationFeatures = requiredValuationFeatures
  .filter(([, expression]) => !expression.test(sql + '\n' + source))
  .map(([name]) => name);

const requiredNationalQuotaFeatures = [
  ['quota world strength', /frm_v218_add_column\(\s*'national_cup_confederation_quotas','world_cup_strength_points'/i],
  ['quota national strength', /frm_v218_add_column\(\s*'national_cup_confederation_quotas','national_cup_strength_points'/i],
  ['quota lower bound', /frm_v218_add_column\(\s*'national_cup_confederation_quotas','minimum_slot_count'/i],
  ['quota upper bound', /frm_v218_add_column\(\s*'national_cup_confederation_quotas','maximum_slot_count'/i],
  ['quota algorithm enum', /CAPACITY_STRENGTH_HAMILTON/i],
  ['eligible profile API', /national-tournament\/eligible-profiles/i],
  ['quota refresh API', /national-tournament\/recalculate-quotas/i]
];
const missingNationalQuotaFeatures = requiredNationalQuotaFeatures
  .filter(([, expression]) => !expression.test(sql + '\n' + source))
  .map(([name]) => name);

if (missingProcedures.length || missingObjects.length || missingValuationFeatures.length || missingNationalQuotaFeatures.length) {
  console.error('SCHEMA_SYNC_FAILED');
  if (missingProcedures.length) console.error('Thủ tục thiếu:', missingProcedures.join(', '));
  if (missingObjects.length) console.error('Bảng/view thiếu:', missingObjects.join(', '));
  if (missingValuationFeatures.length) console.error('Thành phần định giá thiếu:', missingValuationFeatures.join(', '));
  if (missingNationalQuotaFeatures.length) console.error('Thành phần hạn ngạch thiếu:', missingNationalQuotaFeatures.join(', '));
  process.exit(1);
}

console.log('SCHEMA_SYNC_OK');
console.log(`Procedures used by API: ${calledProcedures.size}`);
console.log(`Required tables/views checked: ${requiredObjects.length}`);
console.log(`Valuation schema/API features checked: ${requiredValuationFeatures.length}`);
console.log(`National quota schema/API features checked: ${requiredNationalQuotaFeatures.length}`);
