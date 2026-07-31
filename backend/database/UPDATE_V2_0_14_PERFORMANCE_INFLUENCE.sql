/* ============================================================================
   FOOTBALL RANK MANAGER 2.0.14
   PERFORMANCE RATING, CLUB INFLUENCE & COMMERCIAL ECONOMY
   - Tự chấm điểm cầu thủ theo vị trí và thống kê đã xác nhận
   - Tự xác định cầu thủ hay nhất mỗi đội, hay nhất trận và BXH giải
   - Danh tiếng, người hâm mộ, sự kiện thương mại, bán vật phẩm có chữ ký
   - Thưởng sức ảnh hưởng từ quỹ FIFA theo BXH mùa
   - Không xóa dữ liệu hiện có
============================================================================ */
USE football_rank_manager;
SET NAMES utf8mb4;
SET @OLD_SQL_SAFE_UPDATES_V214 = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

DROP PROCEDURE IF EXISTS frm_v214_add_column;
DROP PROCEDURE IF EXISTS frm_v214_add_index;
DELIMITER $$
CREATE PROCEDURE frm_v214_add_column(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND COLUMN_NAME=p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `',p_table,'` ADD COLUMN `',p_column,'` ',p_definition);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
CREATE PROCEDURE frm_v214_add_index(
  IN p_table VARCHAR(64), IN p_index VARCHAR(64), IN p_sql TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND INDEX_NAME=p_index
  ) THEN
    SET @sql = p_sql; PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

/* 1. Mở rộng thống kê trận đấu và loại giao dịch/điểm. */
CALL frm_v214_add_column('player_match_stats','minutes_played','SMALLINT UNSIGNED NOT NULL DEFAULT 90 AFTER appeared');
CALL frm_v214_add_column('player_match_stats','shots_on_target','SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER assists');
CALL frm_v214_add_column('player_match_stats','key_passes','SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER shots_on_target');
CALL frm_v214_add_column('player_match_stats','tackles_won','SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER key_passes');
CALL frm_v214_add_column('player_match_stats','interceptions','SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER tackles_won');
CALL frm_v214_add_column('player_match_stats','saves','SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER interceptions');
CALL frm_v214_add_column('player_match_stats','penalties_saved','SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER saves');
CALL frm_v214_add_column('player_match_stats','own_goals','SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER penalties_saved');

ALTER TABLE wallet_transactions
MODIFY COLUMN transaction_type ENUM(
  'DEPOSIT','WITHDRAWAL','SALARY','STAFF_SALARY','PRIZE','TRANSFER_FEE',
  'UPSET_REWARD','ENTRY_FEE','PENALTY','BONUS','ADJUSTMENT','REVERSAL','REFUND',
  'TICKET_REVENUE','MATCHDAY_REVENUE','MATCHDAY_COST','SPONSORSHIP',
  'STADIUM_UPGRADE','STADIUM_RENT','INFLUENCE_GRANT','MERCHANDISE',
  'COMMERCIAL_EVENT','PLAYER_ENDORSEMENT'
) NOT NULL;

ALTER TABLE player_ranking_points
MODIFY COLUMN source_type ENUM(
  'AWARD','BONUS','PENALTY','ADMIN_ADJUSTMENT','MATCH_RATING',
  'PERFORMANCE_BONUS','INFLUENCE_GRANT'
) NOT NULL;

ALTER TABLE club_ranking_points
MODIFY COLUMN source_type ENUM(
  'COMPETITION_RESULT','BONUS','PENALTY','ADMIN_ADJUSTMENT','INFLUENCE_BONUS'
) NOT NULL;

/* 2. Bảng điểm hiệu suất. */
CREATE TABLE IF NOT EXISTS match_player_ratings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id BIGINT UNSIGNED NOT NULL,
  competition_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  club_id BIGINT UNSIGNED NOT NULL,
  position ENUM('GK','DF','MF','FW') NOT NULL,
  rating_score DECIMAL(4,2) NOT NULL,
  team_rank SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  is_team_mvp BOOLEAN NOT NULL DEFAULT FALSE,
  is_match_mvp BOOLEAN NOT NULL DEFAULT FALSE,
  ranking_points_awarded DECIMAL(20,3) NOT NULL DEFAULT 0,
  calculation_breakdown JSON NULL,
  finalized_by_user_id BIGINT UNSIGNED NULL,
  finalized_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_match_player_rating UNIQUE(match_id,player_id),
  CONSTRAINT fk_mpr_match FOREIGN KEY(match_id) REFERENCES matches(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_mpr_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_mpr_season FOREIGN KEY(season_id) REFERENCES seasons(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_mpr_player FOREIGN KEY(player_id) REFERENCES players(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_mpr_club FOREIGN KEY(club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_mpr_user FOREIGN KEY(finalized_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CALL frm_v214_add_index('match_player_ratings','idx_mpr_competition','CREATE INDEX idx_mpr_competition ON match_player_ratings(competition_id,rating_score,player_id)');
CALL frm_v214_add_index('match_player_ratings','idx_mpr_club','CREATE INDEX idx_mpr_club ON match_player_ratings(club_id,match_id,team_rank)');

CREATE TABLE IF NOT EXISTS performance_bonus_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rank_from SMALLINT UNSIGNED NOT NULL,
  rank_to SMALLINT UNSIGNED NOT NULL,
  base_points DECIMAL(20,3) NOT NULL,
  label VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_performance_bonus_range UNIQUE(rank_from,rank_to)
) ENGINE=InnoDB;

INSERT INTO performance_bonus_rules(rank_from,rank_to,base_points,label,is_active) VALUES
(1,1,30,'Cầu thủ hiệu suất số 1 giải',TRUE),
(2,2,24,'Cầu thủ hiệu suất hạng 2',TRUE),
(3,3,20,'Cầu thủ hiệu suất hạng 3',TRUE),
(4,5,15,'Top 5 hiệu suất',TRUE),
(6,10,10,'Top 10 hiệu suất',TRUE)
ON DUPLICATE KEY UPDATE base_points=VALUES(base_points),label=VALUES(label),is_active=TRUE;

CREATE TABLE IF NOT EXISTS competition_performance_bonuses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  competition_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  club_id BIGINT UNSIGNED NOT NULL,
  rank_position SMALLINT UNSIGNED NOT NULL,
  average_rating DECIMAL(5,3) NOT NULL,
  appearances SMALLINT UNSIGNED NOT NULL,
  base_points DECIMAL(20,3) NOT NULL,
  coefficient DECIMAL(10,4) NOT NULL,
  awarded_points DECIMAL(20,3) NOT NULL,
  ranking_point_id BIGINT UNSIGNED NULL,
  awarded_by_user_id BIGINT UNSIGNED NULL,
  awarded_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_comp_performance_bonus UNIQUE(competition_id,player_id),
  CONSTRAINT fk_cpb_comp FOREIGN KEY(competition_id) REFERENCES competitions(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cpb_season FOREIGN KEY(season_id) REFERENCES seasons(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_cpb_player FOREIGN KEY(player_id) REFERENCES players(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_cpb_club FOREIGN KEY(club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_cpb_point FOREIGN KEY(ranking_point_id) REFERENCES player_ranking_points(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_cpb_user FOREIGN KEY(awarded_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

/* 3. Danh tiếng, người hâm mộ và sức hút thương mại. */
CREATE TABLE IF NOT EXISTS club_influence_profiles (
  club_id BIGINT UNSIGNED PRIMARY KEY,
  reputation_score DECIMAL(5,2) NOT NULL DEFAULT 35,
  fan_count BIGINT UNSIGNED NOT NULL DEFAULT 50000,
  social_followers BIGINT UNSIGNED NOT NULL DEFAULT 20000,
  media_score DECIMAL(5,2) NOT NULL DEFAULT 30,
  commercial_score DECIMAL(5,2) NOT NULL DEFAULT 30,
  loyalty_score DECIMAL(5,2) NOT NULL DEFAULT 55,
  momentum_score DECIMAL(5,2) NOT NULL DEFAULT 50,
  last_calculation JSON NULL,
  recalculated_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_cip_club FOREIGN KEY(club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS player_influence_profiles (
  player_id BIGINT UNSIGNED PRIMARY KEY,
  popularity_score DECIMAL(5,2) NOT NULL DEFAULT 20,
  endorsement_score DECIMAL(5,2) NOT NULL DEFAULT 15,
  signed_merch_multiplier DECIMAL(6,3) NOT NULL DEFAULT 1.000,
  social_followers BIGINT UNSIGNED NOT NULL DEFAULT 5000,
  last_calculation JSON NULL,
  recalculated_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_pip_player FOREIGN KEY(player_id) REFERENCES players(id) ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS club_influence_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  club_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NULL,
  reputation_score DECIMAL(5,2) NOT NULL,
  fan_count BIGINT UNSIGNED NOT NULL,
  social_followers BIGINT UNSIGNED NOT NULL,
  media_score DECIMAL(5,2) NOT NULL,
  commercial_score DECIMAL(5,2) NOT NULL,
  reason VARCHAR(200) NOT NULL,
  captured_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_cih_club FOREIGN KEY(club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cih_season FOREIGN KEY(season_id) REFERENCES seasons(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;
CALL frm_v214_add_index('club_influence_history','idx_cih_club_time','CREATE INDEX idx_cih_club_time ON club_influence_history(club_id,captured_at)');

INSERT IGNORE INTO club_influence_profiles(club_id)
SELECT id FROM clubs WHERE is_active=TRUE;
INSERT IGNORE INTO player_influence_profiles(player_id)
SELECT id FROM players WHERE status<>'RETIRED';

/* 4. Sự kiện thương mại ngẫu nhiên. */
CREATE TABLE IF NOT EXISTS commercial_event_templates (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL,
  title VARCHAR(180) NOT NULL,
  description VARCHAR(500) NOT NULL,
  category ENUM('REVENUE','COST','FAN_GROWTH','REPUTATION','MIXED') NOT NULL,
  decision_mode ENUM('OPTIONAL','AUTOMATIC') NOT NULL DEFAULT 'OPTIONAL',
  min_reputation DECIMAL(5,2) NOT NULL DEFAULT 0,
  base_probability DECIMAL(5,2) NOT NULL DEFAULT 20,
  min_amount DECIMAL(20,0) NOT NULL DEFAULT 0,
  max_amount DECIMAL(20,0) NOT NULL DEFAULT 0,
  fan_change_min_pct DECIMAL(7,3) NOT NULL DEFAULT 0,
  fan_change_max_pct DECIMAL(7,3) NOT NULL DEFAULT 0,
  reputation_delta DECIMAL(6,2) NOT NULL DEFAULT 0,
  media_delta DECIMAL(6,2) NOT NULL DEFAULT 0,
  commercial_delta DECIMAL(6,2) NOT NULL DEFAULT 0,
  weight_no SMALLINT UNSIGNED NOT NULL DEFAULT 10,
  icon_code VARCHAR(40) NOT NULL DEFAULT 'SPARKLES',
  tone ENUM('POSITIVE','NEUTRAL','NEGATIVE','PREMIUM') NOT NULL DEFAULT 'NEUTRAL',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_commercial_event_code UNIQUE(code)
) ENGINE=InnoDB;

INSERT INTO commercial_event_templates(
 code,title,description,category,decision_mode,min_reputation,base_probability,min_amount,max_amount,
 fan_change_min_pct,fan_change_max_pct,reputation_delta,media_delta,commercial_delta,weight_no,icon_code,tone,is_active
) VALUES
('VIRAL_GOAL','Khoảnh khắc lan truyền','Một bàn thắng đẹp của đội được chia sẻ mạnh trên mạng xã hội.','MIXED','AUTOMATIC',0,28,30000000,250000000,0.5,2.2,0.4,2.5,0.6,20,'TRENDING','POSITIVE',TRUE),
('SIGNED_JERSEY_DROP','Bộ sưu tập áo có chữ ký','CLB có cơ hội mở bán giới hạn áo đấu có chữ ký ngôi sao.','REVENUE','OPTIONAL',25,24,120000000,1800000000,0.2,1.1,0.2,0.6,1.8,18,'SHIRT','PREMIUM',TRUE),
('FAN_DAY','Ngày hội người hâm mộ','Sự kiện giao lưu tại sân giúp tăng lượng fan và bán vật phẩm.','MIXED','OPTIONAL',15,30,80000000,700000000,0.8,2.8,0.7,1.4,1.0,22,'FANS','POSITIVE',TRUE),
('GLOBAL_BRAND_ACTIVATION','Kích hoạt thương hiệu toàn cầu','Một thương hiệu lớn đề nghị đồng hành trong chiến dịch truyền thông.','REVENUE','OPTIONAL',65,12,800000000,6500000000,0.2,1.2,0.5,2.0,3.5,8,'BRAND','PREMIUM',TRUE),
('LOCAL_PARTNER','Đối tác địa phương','Doanh nghiệp địa phương đặt gói quảng cáo ngắn hạn.','REVENUE','OPTIONAL',0,36,30000000,350000000,0.0,0.4,0.1,0.3,0.8,25,'HANDSHAKE','NEUTRAL',TRUE),
('CHARITY_MATCH','Chiến dịch cộng đồng','CLB tài trợ hoạt động cộng đồng, chi phí ngắn hạn nhưng tăng uy tín.','REPUTATION','OPTIONAL',20,18,50000000,300000000,0.4,1.8,1.8,1.4,0.4,12,'HEART','POSITIVE',TRUE),
('STAR_INTERVIEW','Phỏng vấn độc quyền ngôi sao','Kênh truyền thông mua quyền nội dung độc quyền với cầu thủ nổi tiếng.','MIXED','OPTIONAL',40,20,100000000,1200000000,0.1,0.8,0.2,2.2,1.0,14,'MIC','PREMIUM',TRUE),
('SUPPORTER_PROTEST','Phản ứng của cổ động viên','Phong độ hoặc quyết định quản trị gây phản ứng, CLB tốn chi phí xử lý.','COST','AUTOMATIC',0,10,50000000,500000000,-2.8,-0.6,-1.6,-1.8,-0.8,8,'ALERT','NEGATIVE',TRUE),
('PLAYER_SCANDAL','Khủng hoảng hình ảnh cầu thủ','Một sự cố truyền thông làm giảm sức hút và phát sinh chi phí.','COST','AUTOMATIC',35,7,100000000,900000000,-3.5,-1.0,-2.2,-3.0,-1.5,5,'SHIELD_ALERT','NEGATIVE',TRUE),
('LEGEND_RETURN','Huyền thoại trở lại sân','Cựu danh thủ xuất hiện trong sự kiện đặc biệt, tạo hiệu ứng vé và vật phẩm.','MIXED','OPTIONAL',50,14,250000000,2200000000,0.7,2.4,1.1,2.2,2.0,9,'CROWN','PREMIUM',TRUE),
('STREAMING_DEAL','Gói nội dung trực tuyến','Nền tảng số mua gói nội dung hậu trường của CLB.','REVENUE','OPTIONAL',45,17,300000000,3000000000,0.3,1.5,0.4,2.6,2.1,11,'VIDEO','PREMIUM',TRUE),
('ACADEMY_SHOWCASE','Ngày hội tài năng trẻ','Sự kiện học viện thu hút gia đình và cộng đồng địa phương.','MIXED','OPTIONAL',10,22,50000000,500000000,0.5,1.7,0.6,0.8,0.8,16,'ACADEMY','POSITIVE',TRUE)
ON DUPLICATE KEY UPDATE title=VALUES(title),description=VALUES(description),category=VALUES(category),decision_mode=VALUES(decision_mode),
min_reputation=VALUES(min_reputation),base_probability=VALUES(base_probability),min_amount=VALUES(min_amount),max_amount=VALUES(max_amount),
fan_change_min_pct=VALUES(fan_change_min_pct),fan_change_max_pct=VALUES(fan_change_max_pct),reputation_delta=VALUES(reputation_delta),
media_delta=VALUES(media_delta),commercial_delta=VALUES(commercial_delta),weight_no=VALUES(weight_no),tone=VALUES(tone),is_active=TRUE;

CREATE TABLE IF NOT EXISTS club_commercial_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  club_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NULL,
  template_id BIGINT UNSIGNED NOT NULL,
  status ENUM('OFFERED','ACCEPTED','REJECTED','APPLIED','EXPIRED') NOT NULL DEFAULT 'OFFERED',
  amount DECIMAL(20,0) NOT NULL DEFAULT 0,
  fan_change BIGINT NOT NULL DEFAULT 0,
  reputation_delta DECIMAL(6,2) NOT NULL DEFAULT 0,
  media_delta DECIMAL(6,2) NOT NULL DEFAULT 0,
  commercial_delta DECIMAL(6,2) NOT NULL DEFAULT 0,
  cycle_key VARCHAR(80) NOT NULL,
  factors JSON NULL,
  wallet_transaction_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  generated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  applied_at DATETIME(6) NULL,
  CONSTRAINT uq_club_event_cycle UNIQUE(club_id,template_id,cycle_key),
  CONSTRAINT fk_cce_club FOREIGN KEY(club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cce_season FOREIGN KEY(season_id) REFERENCES seasons(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_cce_template FOREIGN KEY(template_id) REFERENCES commercial_event_templates(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_cce_wallet_tx FOREIGN KEY(wallet_transaction_id) REFERENCES wallet_transactions(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_cce_user FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;
CALL frm_v214_add_index('club_commercial_events','idx_cce_club_status','CREATE INDEX idx_cce_club_status ON club_commercial_events(club_id,status,generated_at)');

/* 5. Kinh doanh vật phẩm và áo có chữ ký. */
CREATE TABLE IF NOT EXISTS club_merchandise_campaigns (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  club_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NULL,
  product_type ENUM('HOME_SHIRT','AWAY_SHIRT','SIGNED_SHIRT','SIGNED_BALL','SCARF','LIMITED_BOX') NOT NULL,
  campaign_name VARCHAR(180) NOT NULL,
  units_planned INT UNSIGNED NOT NULL,
  unit_price DECIMAL(20,0) NOT NULL,
  unit_cost DECIMAL(20,0) NOT NULL,
  popularity_snapshot DECIMAL(5,2) NOT NULL DEFAULT 0,
  demand_score DECIMAL(6,2) NOT NULL DEFAULT 0,
  units_sold INT UNSIGNED NOT NULL DEFAULT 0,
  gross_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  total_cost DECIMAL(20,0) NOT NULL DEFAULT 0,
  net_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  simulation_seed BIGINT UNSIGNED NULL,
  calculation_snapshot JSON NULL,
  status ENUM('DRAFT','SIMULATED','SETTLED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  wallet_transaction_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  settled_at DATETIME(6) NULL,
  CONSTRAINT fk_cmc_club FOREIGN KEY(club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_cmc_player FOREIGN KEY(player_id) REFERENCES players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_cmc_wallet_tx FOREIGN KEY(wallet_transaction_id) REFERENCES wallet_transactions(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_cmc_user FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;
CALL frm_v214_add_index('club_merchandise_campaigns','idx_cmc_club_status','CREATE INDEX idx_cmc_club_status ON club_merchandise_campaigns(club_id,status,created_at)');

/* 6. Thưởng sức ảnh hưởng từ FIFA. */
CREATE TABLE IF NOT EXISTS influence_grant_rules (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('CLUB','PLAYER') NOT NULL,
  rank_from SMALLINT UNSIGNED NOT NULL,
  rank_to SMALLINT UNSIGNED NOT NULL,
  grant_amount DECIMAL(20,0) NOT NULL,
  label VARCHAR(160) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_influence_grant_rule UNIQUE(entity_type,rank_from,rank_to)
) ENGINE=InnoDB;

INSERT INTO influence_grant_rules(entity_type,rank_from,rank_to,grant_amount,label,is_active) VALUES
('CLUB',1,1,5000000000,'CLB có sức ảnh hưởng số 1 mùa',TRUE),
('CLUB',2,2,3500000000,'CLB sức ảnh hưởng hạng 2',TRUE),
('CLUB',3,3,2500000000,'CLB sức ảnh hưởng hạng 3',TRUE),
('CLUB',4,5,1500000000,'Top 5 CLB sức ảnh hưởng',TRUE),
('CLUB',6,10,750000000,'Top 10 CLB sức ảnh hưởng',TRUE),
('CLUB',11,20,300000000,'Top 20 CLB sức ảnh hưởng',TRUE),
('PLAYER',1,1,1000000000,'Cầu thủ có sức ảnh hưởng số 1 mùa',TRUE),
('PLAYER',2,2,700000000,'Cầu thủ sức ảnh hưởng hạng 2',TRUE),
('PLAYER',3,3,500000000,'Cầu thủ sức ảnh hưởng hạng 3',TRUE),
('PLAYER',4,5,300000000,'Top 5 cầu thủ sức ảnh hưởng',TRUE),
('PLAYER',6,10,150000000,'Top 10 cầu thủ sức ảnh hưởng',TRUE),
('PLAYER',11,20,75000000,'Top 20 cầu thủ sức ảnh hưởng',TRUE)
ON DUPLICATE KEY UPDATE grant_amount=VALUES(grant_amount),label=VALUES(label),is_active=TRUE;

CREATE TABLE IF NOT EXISTS influence_grant_runs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  season_id BIGINT UNSIGNED NOT NULL,
  status ENUM('PREVIEW','COMPLETED','PARTIAL','FAILED') NOT NULL DEFAULT 'PREVIEW',
  total_amount DECIMAL(20,0) NOT NULL DEFAULT 0,
  snapshot JSON NULL,
  executed_by_user_id BIGINT UNSIGNED NULL,
  executed_at DATETIME(6) NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_influence_grant_run_season UNIQUE(season_id),
  CONSTRAINT fk_igr_season FOREIGN KEY(season_id) REFERENCES seasons(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_igr_user FOREIGN KEY(executed_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS influence_grant_payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id BIGINT UNSIGNED NOT NULL,
  season_id BIGINT UNSIGNED NOT NULL,
  entity_type ENUM('CLUB','PLAYER') NOT NULL,
  entity_key VARCHAR(80) NOT NULL,
  club_id BIGINT UNSIGNED NULL,
  player_id BIGINT UNSIGNED NULL,
  rank_position SMALLINT UNSIGNED NOT NULL,
  grant_amount DECIMAL(20,0) NOT NULL,
  wallet_transaction_id BIGINT UNSIGNED NULL,
  paid_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_influence_grant_entity UNIQUE(season_id,entity_type,entity_key),
  CONSTRAINT fk_igp_run FOREIGN KEY(run_id) REFERENCES influence_grant_runs(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_igp_season FOREIGN KEY(season_id) REFERENCES seasons(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_igp_club FOREIGN KEY(club_id) REFERENCES clubs(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_igp_player FOREIGN KEY(player_id) REFERENCES players(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_igp_tx FOREIGN KEY(wallet_transaction_id) REFERENCES wallet_transactions(id) ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

/* 7. View tổng hợp hiệu suất và sức ảnh hưởng. */
DROP VIEW IF EXISTS v_competition_performance_leaderboard;
CREATE VIEW v_competition_performance_leaderboard AS
SELECT ranked.*,
       DENSE_RANK() OVER(
         PARTITION BY ranked.competition_id
         ORDER BY ranked.performance_index DESC, ranked.average_rating DESC,
                  ranked.match_mvp_count DESC, ranked.team_mvp_count DESC, ranked.player_id
       ) AS rank_position
FROM (
  SELECT mpr.competition_id,mpr.season_id,mpr.player_id,mpr.club_id,
         p.full_name,p.photo_url,p.position,p.shirt_number,c.name AS club_name,c.logo_url,
         COUNT(*) AS appearances,
         ROUND(AVG(mpr.rating_score),3) AS average_rating,
         ROUND(MAX(mpr.rating_score),2) AS best_rating,
         SUM(mpr.is_team_mvp) AS team_mvp_count,
         SUM(mpr.is_match_mvp) AS match_mvp_count,
         COALESCE(SUM(pms.goals),0) AS goals,
         COALESCE(SUM(pms.assists),0) AS assists,
         ROUND(AVG(mpr.rating_score)*10 + SUM(mpr.is_team_mvp)*1.2 + SUM(mpr.is_match_mvp)*2.2,3) AS performance_index,
         ROUND(SUM(mpr.ranking_points_awarded),3) AS match_rating_points
  FROM match_player_ratings mpr
  JOIN players p ON p.id=mpr.player_id
  JOIN clubs c ON c.id=mpr.club_id
  LEFT JOIN player_match_stats pms ON pms.match_id=mpr.match_id AND pms.player_id=mpr.player_id
  GROUP BY mpr.competition_id,mpr.season_id,mpr.player_id,mpr.club_id,p.full_name,p.photo_url,p.position,p.shirt_number,c.name,c.logo_url
) ranked;

/* Smart Awards dùng điểm trận đã chốt thay cho công thức bàn thắng đơn giản. */
DROP VIEW IF EXISTS v_competition_player_stat_totals;
CREATE VIEW v_competition_player_stat_totals AS
SELECT
  v.competition_id,
  v.player_id,
  v.club_id AS club_id_at_award,
  'CLUB' AS award_context_type,
  NULL AS country_name_at_award,
  NULL AS country_code_at_award,
  v.full_name,
  v.photo_url,
  v.position,
  v.appearances,
  v.goals,
  v.assists,
  COALESCE(SUM(CASE WHEN pms.clean_sheet THEN 1 ELSE 0 END),0) AS clean_sheets,
  COALESCE(SUM(pms.goals_conceded),0) AS goals_conceded,
  COALESCE(SUM(pms.yellow_cards),0) AS yellow_cards,
  COALESCE(SUM(pms.red_cards),0) AS red_cards,
  v.performance_index AS performance_score,
  ROUND(v.average_rating*10 + COALESCE(SUM(CASE WHEN pms.clean_sheet THEN 1 ELSE 0 END),0)*1.5
    - COALESCE(SUM(pms.goals_conceded),0)*0.35 + v.match_mvp_count*2,3) AS goalkeeper_score
FROM v_competition_performance_leaderboard v
JOIN match_player_ratings mpr ON mpr.competition_id=v.competition_id AND mpr.player_id=v.player_id
LEFT JOIN player_match_stats pms ON pms.match_id=mpr.match_id AND pms.player_id=mpr.player_id
GROUP BY v.competition_id,v.player_id,v.club_id,v.full_name,v.photo_url,v.position,v.appearances,v.goals,v.assists,
         v.performance_index,v.average_rating,v.match_mvp_count
UNION ALL
SELECT
  x.competition_id,
  e.player_id,
  NULL AS club_id_at_award,
  'NATIONAL_TEAM' AS award_context_type,
  e.country_name,
  e.country_code,
  p.full_name,
  p.photo_url,
  p.position,
  COUNT(*) AS appearances,
  SUM(x.goals_for) AS goals,
  0 AS assists,
  SUM(x.goals_against=0) AS clean_sheets,
  SUM(x.goals_against) AS goals_conceded,
  0 AS yellow_cards,
  0 AS red_cards,
  ROUND(COUNT(*)*60 + SUM(x.goals_for)*9 + SUM(x.goals_against=0)*5 - SUM(x.goals_against)*1.2,3) AS performance_score,
  ROUND(COUNT(*)*60 + SUM(x.goals_against=0)*8 - SUM(x.goals_against)*1.5,3) AS goalkeeper_score
FROM (
  SELECT competition_id,home_entry_id AS entry_id,home_score AS goals_for,away_score AS goals_against
  FROM world_cup_matches WHERE status='FINISHED' AND home_entry_id IS NOT NULL
  UNION ALL
  SELECT competition_id,away_entry_id AS entry_id,away_score AS goals_for,home_score AS goals_against
  FROM world_cup_matches WHERE status='FINISHED' AND away_entry_id IS NOT NULL
) x
JOIN world_cup_entries e ON e.id=x.entry_id
JOIN players p ON p.id=e.player_id
GROUP BY x.competition_id,e.player_id,e.country_name,e.country_code,p.full_name,p.photo_url,p.position;

DROP VIEW IF EXISTS v_club_influence_ranking;
CREATE VIEW v_club_influence_ranking AS
SELECT cip.*,c.code,c.name AS club_name,c.short_name,c.logo_url,
       DENSE_RANK() OVER(ORDER BY cip.reputation_score DESC,cip.fan_count DESC,cip.commercial_score DESC,c.id) AS influence_rank
FROM club_influence_profiles cip JOIN clubs c ON c.id=cip.club_id
WHERE c.is_active=TRUE AND c.registration_status='APPROVED';

DROP VIEW IF EXISTS v_player_influence_ranking;
CREATE VIEW v_player_influence_ranking AS
SELECT pip.*,p.full_name,p.photo_url,p.position,p.market_value,p.club_id,c.name AS club_name,c.logo_url,
       DENSE_RANK() OVER(ORDER BY pip.popularity_score DESC,pip.endorsement_score DESC,p.market_value DESC,p.id) AS influence_rank
FROM player_influence_profiles pip JOIN players p ON p.id=pip.player_id
LEFT JOIN clubs c ON c.id=p.club_id
WHERE p.status<>'RETIRED';

DROP VIEW IF EXISTS v_club_commercial_summary;
CREATE VIEW v_club_commercial_summary AS
SELECT c.id AS club_id,c.name AS club_name,c.logo_url,
       cip.reputation_score,cip.fan_count,cip.social_followers,cip.media_score,cip.commercial_score,cip.loyalty_score,cip.momentum_score,
       COALESCE(ev.event_revenue,0) AS event_revenue,
       COALESCE(ev.event_cost,0) AS event_cost,
       COALESCE(mc.merchandise_revenue,0) AS merchandise_revenue,
       COALESCE(mc.merchandise_campaigns,0) AS merchandise_campaigns
FROM clubs c
JOIN club_influence_profiles cip ON cip.club_id=c.id
LEFT JOIN (
  SELECT club_id,
    SUM(CASE WHEN amount>0 AND status='APPLIED' THEN amount ELSE 0 END) AS event_revenue,
    SUM(CASE WHEN amount<0 AND status='APPLIED' THEN ABS(amount) ELSE 0 END) AS event_cost
  FROM club_commercial_events GROUP BY club_id
) ev ON ev.club_id=c.id
LEFT JOIN (
  SELECT club_id,SUM(CASE WHEN status='SETTLED' THEN net_revenue ELSE 0 END) AS merchandise_revenue,
         SUM(status='SETTLED') AS merchandise_campaigns
  FROM club_merchandise_campaigns GROUP BY club_id
) mc ON mc.club_id=c.id;

INSERT INTO system_settings(setting_key,setting_value,description) VALUES
('performance_rating_version','2.0.14','Công thức chấm điểm theo vị trí và thống kê trận đấu'),
('club_influence_version','2.0.14','Mô hình danh tiếng, người hâm mộ và thương mại'),
('TEAM_MVP_BASE_POINTS','1.5','Điểm BXH cơ bản khi là cầu thủ hay nhất đội trong trận'),
('MATCH_MVP_BASE_POINTS','2.5','Điểm BXH cơ bản khi là cầu thủ hay nhất trận'),
('PLAYER_RATING_POINT_MULTIPLIER','0.6','Điểm từ phần rating vượt 6.0 trước khi nhân hệ số giải')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),description=VALUES(description);

DROP PROCEDURE IF EXISTS frm_v214_add_column;
DROP PROCEDURE IF EXISTS frm_v214_add_index;
SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES_V214;

SELECT
  'PERFORMANCE_INFLUENCE_ECONOMY_READY' AS result,
  (SELECT COUNT(*) FROM commercial_event_templates WHERE is_active=TRUE) AS event_templates,
  (SELECT COUNT(*) FROM influence_grant_rules WHERE is_active=TRUE) AS grant_rules,
  (SELECT COUNT(*) FROM performance_bonus_rules WHERE is_active=TRUE) AS performance_bonus_rules,
  (SELECT COUNT(*) FROM club_influence_profiles) AS club_profiles,
  (SELECT COUNT(*) FROM player_influence_profiles) AS player_profiles;
