/*
  FOOTBALL RANK MANAGER - XÓA TOÀN BỘ DỮ LIỆU VẬN HÀNH MẪU
  Giữ lại:
  - Tài khoản Admin FIFA
  - Cấu hình hệ thống
  - Danh mục hệ giải
  - Danh mục loại danh hiệu
  - Ví Quỹ FIFA được tạo lại với số dư 0
*/

USE football_rank_manager;

SET @OLD_FOREIGN_KEY_CHECKS = @@FOREIGN_KEY_CHECKS;
SET FOREIGN_KEY_CHECKS = 0;

DELETE FROM users WHERE account_type = 'CLUB';

TRUNCATE TABLE audit_logs;
TRUNCATE TABLE player_ranking_snapshots;
TRUNCATE TABLE club_ranking_snapshots;
TRUNCATE TABLE ranking_snapshot_batches;
TRUNCATE TABLE player_ranking_points;
TRUNCATE TABLE club_ranking_points;
TRUNCATE TABLE player_awards;
TRUNCATE TABLE club_achievements;
TRUNCATE TABLE world_cup_upset_rewards;
TRUNCATE TABLE world_cup_results;
TRUNCATE TABLE world_cup_qualified_entries;
TRUNCATE TABLE world_cup_match_links;
TRUNCATE TABLE world_cup_matches;
TRUNCATE TABLE world_cup_rounds;
TRUNCATE TABLE world_cup_group_members;
TRUNCATE TABLE world_cup_groups;
TRUNCATE TABLE world_cup_entries;
TRUNCATE TABLE world_cup_profiles;
TRUNCATE TABLE competition_upset_rewards;
TRUNCATE TABLE competition_results;
TRUNCATE TABLE competition_special_reward_rules;
TRUNCATE TABLE competition_prize_rules;
TRUNCATE TABLE knockout_pairing_rules;
TRUNCATE TABLE competition_qualified_teams;
TRUNCATE TABLE player_match_stats;
TRUNCATE TABLE match_advancement_links;
TRUNCATE TABLE matches;
TRUNCATE TABLE competition_group_members;
TRUNCATE TABLE competition_rounds;
TRUNCATE TABLE competition_groups;
TRUNCATE TABLE competition_rosters;
TRUNCATE TABLE competition_participants;
TRUNCATE TABLE competitions;
TRUNCATE TABLE salary_payments;
TRUNCATE TABLE player_transfers;
TRUNCATE TABLE transfer_offers;
TRUNCATE TABLE player_market_value_history;
TRUNCATE TABLE wallet_transactions;
TRUNCATE TABLE player_club_history;
TRUNCATE TABLE staff_contracts;
TRUNCATE TABLE player_contracts;
TRUNCATE TABLE wallets;
TRUNCATE TABLE coaching_staff;
TRUNCATE TABLE player_national_profiles;
TRUNCATE TABLE players;
TRUNCATE TABLE clubs;
TRUNCATE TABLE seasons;

INSERT INTO wallets(wallet_code, wallet_type, balance, status)
VALUES ('FIFA-TREASURY', 'FIFA', 0, 'ACTIVE');

UPDATE users
SET is_active = TRUE,
    club_id = NULL
WHERE account_type = 'FIFA_ADMIN';

SET FOREIGN_KEY_CHECKS = @OLD_FOREIGN_KEY_CHECKS;

INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
SELECT id,
       'RESET_DEMO_DATA',
       'system',
       NULL,
       JSON_OBJECT('source', 'RESET_DEMO_DATA.sql', 'result', 'operational demo data cleared')
FROM users
WHERE account_type = 'FIFA_ADMIN'
ORDER BY id
LIMIT 1;

SELECT
  (SELECT COUNT(*) FROM seasons) AS seasons,
  (SELECT COUNT(*) FROM clubs) AS clubs,
  (SELECT COUNT(*) FROM players) AS players,
  (SELECT COUNT(*) FROM competitions) AS competitions,
  (SELECT COUNT(*) FROM wallet_transactions) AS wallet_transactions,
  (SELECT COUNT(*) FROM users WHERE account_type = 'FIFA_ADMIN') AS fifa_admin_accounts,
  (SELECT COUNT(*) FROM wallets WHERE wallet_type = 'FIFA' AND balance = 0) AS clean_fifa_wallets;
