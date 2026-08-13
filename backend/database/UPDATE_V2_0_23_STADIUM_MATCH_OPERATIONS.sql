/* ============================================================================
   FOOTBALL RANK MANAGER 2.0.23
   STADIUM MATCH OPERATIONS, OWNER STATEMENTS & PLAYER FAN MOBILITY

   - Không xóa hoặc ghi đè dữ liệu sân/trận/ví hiện có.
   - Dùng chung cho trận CLB, World Cup 48 đội và giải quốc gia 32 đội.
   - Gán sân công bằng, có thời gian hồi phục/bảo trì giữa hai trận.
   - Sao kê từng khoản và thanh toán một lần cho CLB sở hữu sân.
   - Fan riêng cầu thủ và lịch sử fan dịch chuyển khi chuyển nhượng.
============================================================================ */
USE football_rank_manager;
SET NAMES utf8mb4;
SET @OLD_SQL_SAFE_UPDATES_V223 = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

DROP PROCEDURE IF EXISTS frm_v223_add_column;
DROP PROCEDURE IF EXISTS frm_v223_add_index;
DELIMITER $$
CREATE PROCEDURE frm_v223_add_column(IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND COLUMN_NAME=p_column
  ) THEN
    SET @sql=CONCAT('ALTER TABLE `',p_table,'` ADD COLUMN `',p_column,'` ',p_definition);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
CREATE PROCEDURE frm_v223_add_index(IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_sql TEXT)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND INDEX_NAME=p_index
  ) THEN
    SET @sql=p_sql; PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

/* 1. Trạng thái vận hành thực tế của sân. */
CALL frm_v223_add_column('stadiums','condition_pct','DECIMAL(5,2) NOT NULL DEFAULT 100.00 AFTER status');
CALL frm_v223_add_column('stadiums','available_after','DATETIME(6) NULL AFTER condition_pct');
CALL frm_v223_add_column('stadiums','last_match_at','DATETIME(6) NULL AFTER available_after');
CALL frm_v223_add_column('stadiums','matches_hosted','INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_match_at');
CALL frm_v223_add_column('stadiums','maintenance_reserve','DECIMAL(20,0) NOT NULL DEFAULT 0 AFTER matches_hosted');
CALL frm_v223_add_index('stadiums','idx_stadium_operational_availability',
  'CREATE INDEX idx_stadium_operational_availability ON stadiums(status,available_after,condition_pct)');

/* 2. Yêu cầu dùng/thuê sân theo đúng một trận. */
CREATE TABLE IF NOT EXISTS stadium_match_requests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_kind ENUM('REGULAR','WORLD_CUP','NATIONAL_CUP') NOT NULL,
  source_match_id BIGINT UNSIGNED NOT NULL,
  competition_id BIGINT UNSIGNED NOT NULL,
  requesting_club_id BIGINT UNSIGNED NOT NULL,
  stadium_id BIGINT UNSIGNED NOT NULL,
  proposed_fee DECIMAL(20,0) NOT NULL DEFAULT 0,
  proposed_owner_share_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  note VARCHAR(600) NULL,
  status ENUM('PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED') NOT NULL DEFAULT 'PENDING',
  requested_by_user_id BIGINT UNSIGNED NULL,
  reviewed_by_user_id BIGINT UNSIGNED NULL,
  review_note VARCHAR(600) NULL,
  requested_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  reviewed_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_stadium_match_request UNIQUE(match_kind,source_match_id,requesting_club_id,stadium_id),
  CONSTRAINT fk_smr_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_smr_club FOREIGN KEY(requesting_club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_smr_stadium FOREIGN KEY(stadium_id) REFERENCES stadiums(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_smr_requester FOREIGN KEY(requested_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_smr_reviewer FOREIGN KEY(reviewed_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;
CALL frm_v223_add_index('stadium_match_requests','idx_smr_review',
  'CREATE INDEX idx_smr_review ON stadium_match_requests(status,requested_at,competition_id)');

/* 3. Một bảng gán sân chung cho mọi loại trận. */
CREATE TABLE IF NOT EXISTS stadium_match_operations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_kind ENUM('REGULAR','WORLD_CUP','NATIONAL_CUP') NOT NULL,
  source_match_id BIGINT UNSIGNED NOT NULL,
  competition_id BIGINT UNSIGNED NOT NULL,
  competition_name VARCHAR(180) NOT NULL,
  stage_type ENUM('GROUP','KNOCKOUT') NOT NULL,
  round_label VARCHAR(100) NULL,
  home_name VARCHAR(180) NULL,
  away_name VARCHAR(180) NULL,
  home_club_id BIGINT UNSIGNED NULL,
  away_club_id BIGINT UNSIGNED NULL,
  stadium_id BIGINT UNSIGNED NOT NULL,
  owner_club_id BIGINT UNSIGNED NULL,
  request_id BIGINT UNSIGNED NULL,
  assignment_method ENUM('FIFA','CLUB_REQUEST','AUTOMATIC') NOT NULL DEFAULT 'AUTOMATIC',
  profile_code VARCHAR(60) NOT NULL,
  eligibility_status ENUM('ELIGIBLE','CONDITIONAL','OVERRIDDEN') NOT NULL,
  compliance_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  fairness_score DECIMAL(8,3) NOT NULL DEFAULT 0,
  scheduled_at DATETIME(6) NULL,
  evaluation_json JSON NULL,
  assigned_by_user_id BIGINT UNSIGNED NULL,
  assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_stadium_match_operation UNIQUE(match_kind,source_match_id),
  CONSTRAINT fk_smo_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_smo_stadium FOREIGN KEY(stadium_id) REFERENCES stadiums(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_smo_owner FOREIGN KEY(owner_club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_smo_request FOREIGN KEY(request_id) REFERENCES stadium_match_requests(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_smo_assigner FOREIGN KEY(assigned_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;
CALL frm_v223_add_index('stadium_match_operations','idx_smo_stadium_schedule',
  'CREATE INDEX idx_smo_stadium_schedule ON stadium_match_operations(stadium_id,scheduled_at,assignment_method)');
CALL frm_v223_add_index('stadium_match_operations','idx_smo_owner',
  'CREATE INDEX idx_smo_owner ON stadium_match_operations(owner_club_id,assigned_at)');

/* 4. Quyết toán và sao kê chi tiết sau trận. */
CREATE TABLE IF NOT EXISTS stadium_match_finances_v2 (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  operation_id BIGINT UNSIGNED NOT NULL,
  random_seed BIGINT UNSIGNED NOT NULL,
  attractiveness_score DECIMAL(6,2) NOT NULL,
  occupancy_pct DECIMAL(5,2) NOT NULL,
  attendance_standard INT UNSIGNED NOT NULL DEFAULT 0,
  attendance_vip INT UNSIGNED NOT NULL DEFAULT 0,
  attendance_total INT UNSIGNED NOT NULL DEFAULT 0,
  standard_ticket_price DECIMAL(20,0) NOT NULL DEFAULT 0,
  vip_ticket_price DECIMAL(20,0) NOT NULL DEFAULT 0,
  standard_ticket_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  vip_ticket_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  concessions_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  parking_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  gross_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  operating_cost DECIMAL(20,0) NOT NULL DEFAULT 0,
  damage_cost DECIMAL(20,0) NOT NULL DEFAULT 0,
  owner_payout DECIMAL(20,0) NOT NULL DEFAULT 0,
  condition_before DECIMAL(5,2) NOT NULL DEFAULT 100,
  condition_after DECIMAL(5,2) NOT NULL DEFAULT 100,
  recovery_hours SMALLINT UNSIGNED NOT NULL DEFAULT 12,
  calculation_snapshot JSON NULL,
  owner_wallet_transaction_id BIGINT UNSIGNED NULL,
  status ENUM('DRAFT','SETTLED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  settled_by_user_id BIGINT UNSIGNED NULL,
  settled_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_stadium_match_finance_v2 UNIQUE(operation_id),
  CONSTRAINT fk_smf2_operation FOREIGN KEY(operation_id) REFERENCES stadium_match_operations(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_smf2_wallet_tx FOREIGN KEY(owner_wallet_transaction_id) REFERENCES wallet_transactions(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_smf2_settler FOREIGN KEY(settled_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stadium_finance_statement_lines (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  finance_id BIGINT UNSIGNED NOT NULL,
  line_order SMALLINT UNSIGNED NOT NULL,
  line_type ENUM('REVENUE','COST','DAMAGE','PAYOUT') NOT NULL,
  line_code VARCHAR(60) NOT NULL,
  label VARCHAR(180) NOT NULL,
  quantity DECIMAL(20,3) NULL,
  unit_amount DECIMAL(20,0) NULL,
  amount DECIMAL(20,0) NOT NULL,
  explanation VARCHAR(600) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_stadium_statement_line UNIQUE(finance_id,line_code),
  CONSTRAINT fk_sfsl_finance FOREIGN KEY(finance_id) REFERENCES stadium_match_finances_v2(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

/* 5. Fan riêng cầu thủ và sao kê fan chuyển nhượng. */
CREATE TABLE IF NOT EXISTS player_fan_profiles (
  player_id BIGINT UNSIGNED PRIMARY KEY,
  fan_count BIGINT UNSIGNED NOT NULL DEFAULT 1000,
  loyalty_score DECIMAL(5,2) NOT NULL DEFAULT 55,
  mobility_score DECIMAL(5,2) NOT NULL DEFAULT 35,
  last_calculation JSON NULL,
  recalculated_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_pfp_player FOREIGN KEY(player_id) REFERENCES players(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS player_fan_transfer_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  player_transfer_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  from_club_id BIGINT UNSIGNED NULL,
  to_club_id BIGINT UNSIGNED NOT NULL,
  player_fans_before BIGINT UNSIGNED NOT NULL,
  follow_rate_pct DECIMAL(5,2) NOT NULL,
  fans_followed BIGINT UNSIGNED NOT NULL,
  fans_stayed BIGINT UNSIGNED NOT NULL,
  old_club_fan_delta BIGINT NOT NULL,
  new_club_fan_delta BIGINT NOT NULL,
  formula_snapshot JSON NULL,
  processed_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_player_fan_transfer UNIQUE(player_transfer_id),
  CONSTRAINT fk_pfte_transfer FOREIGN KEY(player_transfer_id) REFERENCES player_transfers(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_pfte_player FOREIGN KEY(player_id) REFERENCES players(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_pfte_from_club FOREIGN KEY(from_club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_pfte_to_club FOREIGN KEY(to_club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO player_fan_profiles(player_id,fan_count,loyalty_score,mobility_score,last_calculation,recalculated_at)
SELECT p.id,
       GREATEST(1000,ROUND(COALESCE(pip.social_followers,5000)*0.72)),
       LEAST(90,GREATEST(35,60-COALESCE(pip.popularity_score,20)*0.12)),
       LEAST(80,GREATEST(20,25+COALESCE(pip.popularity_score,20)*0.35)),
       JSON_OBJECT('source','v2.0.23 backfill','social_followers',COALESCE(pip.social_followers,5000)),NOW(6)
FROM players p LEFT JOIN player_influence_profiles pip ON pip.player_id=p.id
WHERE p.status<>'RETIRED'
ON DUPLICATE KEY UPDATE player_id=VALUES(player_id);

/* 6. Hạ nhẹ tiêu chí: vẫn giữ an toàn, tăng số sân có thể được chọn. */
UPDATE stadium_standard_profiles SET
  min_rating_score=CASE code WHEN 'COMMUNITY_C' THEN 30 WHEN 'PROFESSIONAL_B' THEN 40 WHEN 'CONTINENTAL_A' THEN 54 WHEN 'ELITE_KNOCKOUT' THEN 68 WHEN 'WORLD_FINAL' THEN 80 WHEN 'WORLD_CUP_ELITE' THEN 74 ELSE min_rating_score END,
  min_capacity=CASE code WHEN 'COMMUNITY_C' THEN 2500 WHEN 'PROFESSIONAL_B' THEN 6500 WHEN 'CONTINENTAL_A' THEN 12000 WHEN 'ELITE_KNOCKOUT' THEN 24000 WHEN 'WORLD_FINAL' THEN 34000 WHEN 'WORLD_CUP_ELITE' THEN 30000 ELSE min_capacity END,
  min_vip_seats=CASE code WHEN 'COMMUNITY_C' THEN 30 WHEN 'PROFESSIONAL_B' THEN 160 WHEN 'CONTINENTAL_A' THEN 400 WHEN 'ELITE_KNOCKOUT' THEN 1000 WHEN 'WORLD_FINAL' THEN 2100 WHEN 'WORLD_CUP_ELITE' THEN 1600 ELSE min_vip_seats END,
  min_pitch_quality=GREATEST(30,min_pitch_quality-8),
  min_lighting_quality=GREATEST(25,min_lighting_quality-8),
  min_technology_quality=GREATEST(18,min_technology_quality-10),
  min_security_quality=GREATEST(32,min_security_quality-7),
  min_hospitality_quality=GREATEST(18,min_hospitality_quality-10),
  min_parking_quality=GREATEST(18,min_parking_quality-10),
  capacity_tolerance_pct=LEAST(18,capacity_tolerance_pct+5),
  soft_quality_tolerance=LEAST(15,soft_quality_tolerance+4)
WHERE code IN ('COMMUNITY_C','PROFESSIONAL_B','CONTINENTAL_A','ELITE_KNOCKOUT','WORLD_FINAL','WORLD_CUP_ELITE');

INSERT INTO system_settings(setting_key,setting_value) VALUES
('stadium_match_operations_version','2.0.23'),
('stadium_assignment_policy','FIFA > yêu cầu CLB đã duyệt > tự động công bằng; có cooldown và kiểm định.'),
('stadium_owner_settlement_policy','Doanh thu vé và dịch vụ trừ vận hành/thiệt hại được trả một lần cho ví CLB sở hữu sân.'),
('player_fan_mobility_version','2.0.23')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value);

DROP PROCEDURE IF EXISTS frm_v223_add_column;
DROP PROCEDURE IF EXISTS frm_v223_add_index;
SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES_V223;

SELECT 'STADIUM_MATCH_OPERATIONS_V2_0_23_READY' AS result,
       (SELECT COUNT(*) FROM stadiums) AS stadiums_preserved,
       (SELECT COUNT(*) FROM player_fan_profiles) AS player_fan_profiles_ready;
