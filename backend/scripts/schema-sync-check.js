'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sql = fs.readFileSync(path.join(root, 'database', 'football_rank_manager_full_v3.sql'), 'utf8');
const source = ['routes-core.js', 'routes-football.js', 'routes-competitions.js', 'routes-world-cup.js', 'routes-stadiums.js', 'routes-stadium-compliance.js', 'routes-performance.js', 'routes-influence.js']
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
  'v_player_influence_ranking', 'v_club_commercial_summary'
];
const missingObjects = requiredObjects.filter((name) => {
  const expression = new RegExp(`CREATE (?:(?:OR REPLACE )?VIEW|TABLE(?: IF NOT EXISTS)?)\\s+${name}\\b`, 'i');
  return !expression.test(sql);
});

if (missingProcedures.length || missingObjects.length) {
  console.error('SCHEMA_SYNC_FAILED');
  if (missingProcedures.length) console.error('Thủ tục thiếu:', missingProcedures.join(', '));
  if (missingObjects.length) console.error('Bảng/view thiếu:', missingObjects.join(', '));
  process.exit(1);
}

console.log('SCHEMA_SYNC_OK');
console.log(`Procedures used by API: ${calledProcedures.size}`);
console.log(`Required tables/views checked: ${requiredObjects.length}`);
