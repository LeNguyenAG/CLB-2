/* ========================================================================== */
/* FOOTBALL RANK MANAGER 2.0.15                                               */
/* GIẢI QUỐC GIA ĐẶC BIỆT 32 ĐỘI + BXH QUỐC GIA/TỔNG THỂ                     */
/* Migration cộng dồn, không xóa CLB, cầu thủ, giải hoặc dữ liệu World Cup.  */
/* ========================================================================== */

USE football_rank_manager;
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @OLD_SQL_SAFE_UPDATES_V215 = @@SQL_SAFE_UPDATES;
SET SQL_SAFE_UPDATES = 0;

DELIMITER $$
DROP PROCEDURE IF EXISTS frm_v215_add_column$$
CREATE PROCEDURE frm_v215_add_column(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name=p_table AND column_name=p_column
  ) THEN
    SET @frm_sql=CONCAT('ALTER TABLE `',REPLACE(p_table,'`','``'),'` ADD COLUMN `',REPLACE(p_column,'`','``'),'` ',p_definition);
    PREPARE frm_stmt FROM @frm_sql; EXECUTE frm_stmt; DEALLOCATE PREPARE frm_stmt;
  END IF;
END$$
DROP PROCEDURE IF EXISTS frm_v215_add_index$$
CREATE PROCEDURE frm_v215_add_index(
  IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema=DATABASE() AND table_name=p_table AND index_name=p_index
  ) THEN
    SET @frm_sql=p_sql; PREPARE frm_stmt FROM @frm_sql; EXECUTE frm_stmt; DEALLOCATE PREPARE frm_stmt;
  END IF;
END$$
DELIMITER ;

/* 1. Tách điểm cầu thủ theo phạm vi CLB và đội tuyển quốc gia. */
CALL frm_v215_add_column(
  'player_ranking_points','ranking_scope',
  'ENUM(''CLUB'',''NATIONAL_TEAM'') NOT NULL DEFAULT ''CLUB'' AFTER `source_id`'
);
CALL frm_v215_add_index(
  'player_ranking_points','idx_player_points_scope',
  'CREATE INDEX idx_player_points_scope ON player_ranking_points(player_id,ranking_scope,season_id)'
);

UPDATE player_ranking_points prp
LEFT JOIN player_awards pa ON prp.source_type='AWARD' AND pa.id=prp.source_id
SET prp.ranking_scope='NATIONAL_TEAM'
WHERE pa.award_context_type='NATIONAL_TEAM'
   OR prp.competition_id IN (SELECT competition_id FROM world_cup_profiles);

/* 2. Quy tắc điểm/tiền thưởng dùng chung cho mọi giải cấp quốc gia. */
CREATE TABLE IF NOT EXISTS national_competition_reward_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  competition_id BIGINT UNSIGNED NOT NULL,
  placement_from TINYINT UNSIGNED NOT NULL,
  placement_to TINYINT UNSIGNED NOT NULL,
  placement_label VARCHAR(100) NOT NULL,
  prize_amount DECIMAL(20,0) NOT NULL DEFAULT 0,
  base_ranking_points DECIMAL(20,3) NOT NULL DEFAULT 0,
  medal_type ENUM('GOLD','SILVER','BRONZE','NONE') NOT NULL DEFAULT 'NONE',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_national_reward_range UNIQUE(competition_id,placement_from,placement_to),
  CONSTRAINT fk_national_reward_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_national_reward_range CHECK(placement_from>=1 AND placement_to>=placement_from AND placement_to<=32),
  CONSTRAINT chk_national_reward_values CHECK(prize_amount>=0 AND base_ranking_points>=0)
) ENGINE=InnoDB;

/* World Cup mạnh hơn giải CLB thường; hệ số mặc định 2.0 tiếp tục được giữ. */
INSERT IGNORE INTO national_competition_reward_rules(
  competition_id,placement_from,placement_to,placement_label,prize_amount,base_ranking_points,medal_type
)
SELECT competition_id,1,1,'Vô địch',gold_prize_amount,120,'GOLD' FROM world_cup_profiles
UNION ALL SELECT competition_id,2,2,'Á quân',silver_prize_amount,80,'SILVER' FROM world_cup_profiles
UNION ALL SELECT competition_id,3,3,'Hạng ba',bronze_prize_amount,55,'BRONZE' FROM world_cup_profiles
UNION ALL SELECT competition_id,4,4,'Hạng tư',0,40,'NONE' FROM world_cup_profiles
UNION ALL SELECT competition_id,5,8,'Tứ kết',0,30,'NONE' FROM world_cup_profiles
UNION ALL SELECT competition_id,9,16,'Vòng 16 đội',0,18,'NONE' FROM world_cup_profiles
UNION ALL SELECT competition_id,17,32,'Vòng 32 đội',0,8,'NONE' FROM world_cup_profiles;

/* 3. Giải quốc gia đặc biệt: 32 đội, loại trực tiếp. */
CREATE TABLE IF NOT EXISTS national_cup_profiles (
  competition_id BIGINT UNSIGNED PRIMARY KEY,
  participant_count SMALLINT UNSIGNED NOT NULL DEFAULT 32,
  draw_mode ENUM('SEEDED_CONSTRAINED','FULL_RANDOM') NOT NULL DEFAULT 'SEEDED_CONSTRAINED',
  quota_method ENUM('PROPORTIONAL_HAMILTON') NOT NULL DEFAULT 'PROPORTIONAL_HAMILTON',
  visual_theme ENUM('CONTINENTAL_GOLD','OCEAN_BLUE','EMERALD_NIGHT') NOT NULL DEFAULT 'CONTINENTAL_GOLD',
  entries_locked_at DATETIME(6) NULL,
  bracket_drawn_at DATETIME(6) NULL,
  tournament_finalized_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_national_cup_profile_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_national_cup_size CHECK(participant_count=32)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS national_cup_confederation_quotas (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  competition_id BIGINT UNSIGNED NOT NULL,
  confederation ENUM('AFC','CAF','CONCACAF','CONMEBOL','OFC','UEFA','OTHER') NOT NULL,
  available_country_count SMALLINT UNSIGNED NOT NULL,
  slot_count TINYINT UNSIGNED NOT NULL,
  calculated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_national_cup_quota UNIQUE(competition_id,confederation),
  CONSTRAINT fk_national_cup_quota_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_national_cup_quota CHECK(slot_count>=1 AND available_country_count>=slot_count)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS national_cup_entries (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  competition_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  country_catalog_id BIGINT UNSIGNED NOT NULL,
  country_name VARCHAR(120) NOT NULL,
  country_code VARCHAR(8) NOT NULL,
  flag_url VARCHAR(500) NULL,
  confederation ENUM('AFC','CAF','CONCACAF','CONMEBOL','OFC','UEFA','OTHER') NOT NULL,
  seed_rank SMALLINT UNSIGNED NULL,
  pot_no TINYINT UNSIGNED NULL,
  status ENUM('APPROVED','WITHDRAWN','DISQUALIFIED') NOT NULL DEFAULT 'APPROVED',
  registered_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_national_cup_entry_player UNIQUE(competition_id,player_id),
  CONSTRAINT uq_national_cup_entry_country UNIQUE(competition_id,country_catalog_id),
  CONSTRAINT uq_national_cup_entry_code UNIQUE(competition_id,country_code),
  CONSTRAINT fk_national_cup_entry_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_national_cup_entry_player FOREIGN KEY(player_id) REFERENCES players(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_national_cup_entry_country FOREIGN KEY(country_catalog_id) REFERENCES country_catalog(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_national_cup_entry_seed CHECK(seed_rank IS NULL OR seed_rank BETWEEN 1 AND 999),
  CONSTRAINT chk_national_cup_entry_pot CHECK(pot_no IS NULL OR pot_no IN(1,2))
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS national_cup_rounds (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  competition_id BIGINT UNSIGNED NOT NULL,
  round_code ENUM('R32','R16','QF','SF','THIRD','FINAL') NOT NULL,
  round_name VARCHAR(60) NOT NULL,
  round_order TINYINT UNSIGNED NOT NULL,
  team_count SMALLINT UNSIGNED NOT NULL,
  match_count SMALLINT UNSIGNED NOT NULL,
  status ENUM('PENDING','IN_PROGRESS','FINISHED') NOT NULL DEFAULT 'PENDING',
  CONSTRAINT uq_national_cup_round_code UNIQUE(competition_id,round_code),
  CONSTRAINT uq_national_cup_round_order UNIQUE(competition_id,round_order),
  CONSTRAINT fk_national_cup_round_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS national_cup_matches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  competition_id BIGINT UNSIGNED NOT NULL,
  round_id BIGINT UNSIGNED NOT NULL,
  match_no SMALLINT UNSIGNED NOT NULL,
  home_entry_id BIGINT UNSIGNED NULL,
  away_entry_id BIGINT UNSIGNED NULL,
  home_score SMALLINT UNSIGNED NULL,
  away_score SMALLINT UNSIGNED NULL,
  home_penalty_score SMALLINT UNSIGNED NULL,
  away_penalty_score SMALLINT UNSIGNED NULL,
  winner_entry_id BIGINT UNSIGNED NULL,
  loser_entry_id BIGINT UNSIGNED NULL,
  status ENUM('SCHEDULED','LIVE','FINISHED','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
  same_confederation_pair BOOLEAN NOT NULL DEFAULT FALSE,
  note VARCHAR(500) NULL,
  scheduled_at DATETIME(6) NULL,
  finished_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_national_cup_match UNIQUE(competition_id,round_id,match_no),
  CONSTRAINT fk_national_cup_match_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_national_cup_match_round FOREIGN KEY(round_id) REFERENCES national_cup_rounds(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_national_cup_match_home FOREIGN KEY(home_entry_id) REFERENCES national_cup_entries(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_national_cup_match_away FOREIGN KEY(away_entry_id) REFERENCES national_cup_entries(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_national_cup_match_winner FOREIGN KEY(winner_entry_id) REFERENCES national_cup_entries(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_national_cup_match_loser FOREIGN KEY(loser_entry_id) REFERENCES national_cup_entries(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT chk_national_cup_distinct CHECK(home_entry_id IS NULL OR away_entry_id IS NULL OR home_entry_id<>away_entry_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS national_cup_match_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source_match_id BIGINT UNSIGNED NOT NULL,
  source_result ENUM('WINNER','LOSER') NOT NULL DEFAULT 'WINNER',
  target_match_id BIGINT UNSIGNED NOT NULL,
  target_slot ENUM('HOME','AWAY') NOT NULL,
  CONSTRAINT uq_national_cup_source_link UNIQUE(source_match_id,source_result),
  CONSTRAINT uq_national_cup_target_slot UNIQUE(target_match_id,target_slot),
  CONSTRAINT fk_national_cup_link_source FOREIGN KEY(source_match_id) REFERENCES national_cup_matches(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_national_cup_link_target FOREIGN KEY(target_match_id) REFERENCES national_cup_matches(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS national_cup_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  competition_id BIGINT UNSIGNED NOT NULL,
  entry_id BIGINT UNSIGNED NOT NULL,
  placement TINYINT UNSIGNED NOT NULL,
  medal_type ENUM('GOLD','SILVER','BRONZE','NONE') NOT NULL DEFAULT 'NONE',
  ranking_points DECIMAL(20,3) NOT NULL DEFAULT 0,
  prize_amount DECIMAL(20,0) NOT NULL DEFAULT 0,
  confirmed_by_user_id BIGINT UNSIGNED NOT NULL,
  confirmed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_national_cup_result_entry UNIQUE(competition_id,entry_id),
  CONSTRAINT uq_national_cup_result_place UNIQUE(competition_id,placement),
  CONSTRAINT fk_national_cup_result_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_national_cup_result_entry FOREIGN KEY(entry_id) REFERENCES national_cup_entries(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_national_cup_result_user FOREIGN KEY(confirmed_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT chk_national_cup_result_place CHECK(placement BETWEEN 1 AND 32),
  CONSTRAINT chk_national_cup_result_value CHECK(ranking_points>=0 AND prize_amount>=0)
) ENGINE=InnoDB;

CALL frm_v215_add_index('national_cup_entries','idx_national_cup_entries_comp','CREATE INDEX idx_national_cup_entries_comp ON national_cup_entries(competition_id,status,confederation)');
CALL frm_v215_add_index('national_cup_matches','idx_national_cup_matches_comp','CREATE INDEX idx_national_cup_matches_comp ON national_cup_matches(competition_id,status,round_id)');

/* 4. Danh hiệu được hệ thống tự trao cho giải 32 đội. */
INSERT INTO award_types(code,name,category,required_medal_type,base_ranking_points,is_active) VALUES
('NATIONAL_SPECIAL_GOLD','Huy chương vàng giải quốc gia đặc biệt','TEAM_MEDAL','GOLD',100,TRUE),
('NATIONAL_SPECIAL_SILVER','Huy chương bạc giải quốc gia đặc biệt','TEAM_MEDAL','SILVER',70,TRUE),
('NATIONAL_SPECIAL_BRONZE','Huy chương đồng giải quốc gia đặc biệt','TEAM_MEDAL','BRONZE',50,TRUE),
('NATIONAL_SPECIAL_BEST_PLAYER','Cầu thủ xuất sắc giải quốc gia đặc biệt','BEST_PLAYER','NONE',35,TRUE),
('NATIONAL_SPECIAL_TOP_SCORER','Vua phá lưới giải quốc gia đặc biệt','TOP_SCORER','NONE',28,TRUE),
('NATIONAL_SPECIAL_BEST_GOALKEEPER','Thủ môn xuất sắc giải quốc gia đặc biệt','BEST_GOALKEEPER','NONE',24,TRUE)
ON DUPLICATE KEY UPDATE name=VALUES(name),category=VALUES(category),required_medal_type=VALUES(required_medal_type),base_ranking_points=VALUES(base_ranking_points),is_active=TRUE;

/* Cho phép danh hiệu quốc gia đến từ World Cup 48 hoặc giải đặc biệt 32. */
DROP TRIGGER IF EXISTS trg_player_award_validate_insert;
DELIMITER $$
CREATE TRIGGER trg_player_award_validate_insert
BEFORE INSERT ON player_awards
FOR EACH ROW
BEGIN
  DECLARE v_user_type VARCHAR(20);
  DECLARE v_user_club BIGINT UNSIGNED;
  DECLARE v_award_category VARCHAR(30);
  DECLARE v_required_medal_type VARCHAR(20);

  SELECT account_type,club_id INTO v_user_type,v_user_club
  FROM users WHERE id=NEW.assigned_by_user_id AND is_active=TRUE;
  IF v_user_type IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Tài khoản trao danh hiệu không hợp lệ.';
  END IF;

  SELECT category,required_medal_type INTO v_award_category,v_required_medal_type
  FROM award_types WHERE id=NEW.award_type_id AND is_active=TRUE;
  IF v_award_category IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Loại danh hiệu không tồn tại hoặc đã bị khóa.';
  END IF;

  IF NEW.award_context_type='NATIONAL_TEAM' THEN
    IF v_user_type<>'FIFA_ADMIN' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Danh hiệu đội tuyển quốc gia chỉ do Admin FIFA trao.';
    END IF;
    IF NEW.club_id_at_award IS NOT NULL OR NEW.country_name_at_award IS NULL OR NEW.country_code_at_award IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Danh hiệu đội tuyển phải có tên/mã quốc gia và không gắn CLB.';
    END IF;
    IF NOT EXISTS(
      SELECT 1 FROM world_cup_entries wce
      WHERE wce.competition_id=NEW.competition_id AND wce.player_id=NEW.player_id
        AND wce.country_code=NEW.country_code_at_award
    ) AND NOT EXISTS(
      SELECT 1 FROM national_cup_entries nce
      WHERE nce.competition_id=NEW.competition_id AND nce.player_id=NEW.player_id
        AND nce.country_code=NEW.country_code_at_award
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Cầu thủ không thuộc danh sách quốc gia của giải này.';
    END IF;
  ELSE
    IF NEW.club_id_at_award IS NULL THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Danh hiệu CLB phải có CLB tại thời điểm nhận.';
    END IF;
    IF v_user_type='CLUB' AND v_user_club<>NEW.club_id_at_award THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Tài khoản CLB không được trao danh hiệu cho CLB khác.';
    END IF;
    IF NOT EXISTS(
      SELECT 1 FROM competition_rosters cr
      WHERE cr.competition_id=NEW.competition_id AND cr.club_id=NEW.club_id_at_award
        AND cr.player_id=NEW.player_id AND cr.status='ACTIVE'
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Cầu thủ không thuộc danh sách đăng ký của CLB tại giải này.';
    END IF;
    IF v_award_category<>'TEAM_MEDAL' AND v_user_type<>'FIFA_ADMIN' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Danh hiệu cá nhân chỉ do Admin FIFA trao.';
    END IF;
    IF v_award_category='TEAM_MEDAL' AND NOT EXISTS(
      SELECT 1 FROM club_achievements ca
      WHERE ca.club_id=NEW.club_id_at_award AND ca.competition_id=NEW.competition_id
        AND ca.medal_type=v_required_medal_type
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Loại huy chương cầu thủ không khớp huy chương chính thức của CLB.';
    END IF;
  END IF;
END$$
DELIMITER ;

/* 5. Hoàn thiện thứ hạng World Cup cũ đến hết vòng 32 và cộng điểm tiến sâu. */
INSERT IGNORE INTO world_cup_results(competition_id,entry_id,placement,medal_type,ranking_points,confirmed_by_user_id)
SELECT ranked.competition_id,ranked.entry_id,ranked.base_place+ranked.position_no,'NONE',0,ranked.created_by_user_id
FROM (
  SELECT m.competition_id,m.loser_entry_id AS entry_id,c.created_by_user_id,
         CASE r.round_code WHEN 'QF' THEN 4 WHEN 'R16' THEN 8 WHEN 'R32' THEN 16 END AS base_place,
         ROW_NUMBER() OVER(PARTITION BY m.competition_id,r.round_code ORDER BY e.seed_rank IS NULL,e.seed_rank,e.id) AS position_no
  FROM world_cup_matches m
  JOIN world_cup_rounds r ON r.id=m.round_id
  JOIN world_cup_entries e ON e.id=m.loser_entry_id
  JOIN competitions c ON c.id=m.competition_id
  JOIN world_cup_profiles p ON p.competition_id=m.competition_id AND p.tournament_finalized_at IS NOT NULL
  WHERE m.status='FINISHED' AND r.round_code IN('QF','R16','R32') AND m.loser_entry_id IS NOT NULL
) ranked;

UPDATE world_cup_results wcr
JOIN competitions c ON c.id=wcr.competition_id
JOIN national_competition_reward_rules rr ON rr.competition_id=wcr.competition_id AND wcr.placement BETWEEN rr.placement_from AND rr.placement_to
SET wcr.ranking_points=ROUND(rr.base_ranking_points*c.coefficient,3);

INSERT INTO player_ranking_points(
  player_id,season_id,competition_id,source_type,source_id,ranking_scope,points,description
)
SELECT e.player_id,c.season_id,r.competition_id,'BONUS',r.id,'NATIONAL_TEAM',r.ranking_points,
       CONCAT(rr.placement_label,' – ',c.name,' (',e.country_name,')')
FROM world_cup_results r
JOIN world_cup_entries e ON e.id=r.entry_id
JOIN competitions c ON c.id=r.competition_id
JOIN national_competition_reward_rules rr ON rr.competition_id=r.competition_id AND r.placement BETWEEN rr.placement_from AND rr.placement_to
WHERE r.medal_type='NONE' AND r.ranking_points>0
  AND NOT EXISTS(
    SELECT 1 FROM player_ranking_points old
    WHERE old.competition_id=r.competition_id AND old.source_type='BONUS' AND old.source_id=r.id
      AND old.ranking_scope='NATIONAL_TEAM'
      AND old.description LIKE CONCAT(rr.placement_label,' – %')
  );

INSERT INTO system_settings(setting_key,setting_value,description) VALUES
('national_tournament_version','2.0.15','Giải quốc gia đặc biệt 32 đội và BXH phạm vi quốc gia'),
('national_tournament_default_coefficient','1.500','Hệ số mặc định cân bằng giữa giải CLB và World Cup'),
('national_tournament_quota_method','PROPORTIONAL_HAMILTON','Chia 32 suất theo tỷ lệ số quốc gia hiện có của từng liên đoàn')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),description=VALUES(description);

DROP PROCEDURE IF EXISTS frm_v215_add_column;
DROP PROCEDURE IF EXISTS frm_v215_add_index;
SET SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES_V215;

SELECT 'NATIONAL_TOURNAMENTS_V2_0_15_READY' AS result,
       (SELECT COUNT(*) FROM national_cup_profiles) AS special_tournaments,
       (SELECT COUNT(*) FROM national_competition_reward_rules) AS national_reward_rules,
       (SELECT COUNT(*) FROM player_ranking_points WHERE ranking_scope='NATIONAL_TEAM') AS national_ranking_rows;
