/* ============================================================================
 FOOTBALL RANK MANAGER 2.0.10
 STADIUM COMPLIANCE & VENUE INTELLIGENCE

 - Giữ nguyên hệ thống sân, vé, tài trợ và ví của v2.0.9.
 - Tách rõ "cấp sân" và "đạt chuẩn tổ chức trận".
 - Tiêu chuẩn theo giải, giai đoạn và vòng đấu.
 - Tự kiểm tra ELIGIBLE / CONDITIONAL / NOT_ELIGIBLE.
 - Gợi ý sân thay thế, hạng mục thiếu và gói nâng cấp phù hợp.
 - Admin FIFA có thể cho phép ngoại lệ nhưng bắt buộc ghi lý do.

 An toàn dữ liệu:
 - Không DROP database.
 - Không xóa CLB, cầu thủ, mùa, giải, trận, ví, sân hoặc lịch sử tài chính.
 - Có thể chạy lại an toàn.
============================================================================ */

SET NAMES utf8mb4;
SET TIME_ZONE = '+07:00';
USE football_rank_manager;

SET @OLD_SQL_SAFE_UPDATES_V210 = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

DROP PROCEDURE IF EXISTS frm_v210_add_column_if_missing;
DROP PROCEDURE IF EXISTS frm_v210_add_index_if_missing;
DELIMITER $$
CREATE PROCEDURE frm_v210_add_column_if_missing(
  IN p_table_name VARCHAR(64),
  IN p_column_name VARCHAR(64),
  IN p_ddl VARCHAR(2000)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name=p_table_name AND column_name=p_column_name
  ) THEN
    SET @frm_v210_sql=p_ddl;
    PREPARE frm_v210_stmt FROM @frm_v210_sql;
    EXECUTE frm_v210_stmt;
    DEALLOCATE PREPARE frm_v210_stmt;
  END IF;
END$$

CREATE PROCEDURE frm_v210_add_index_if_missing(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_ddl VARCHAR(2000)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema=DATABASE() AND table_name=p_table_name AND index_name=p_index_name
  ) THEN
    SET @frm_v210_sql=p_ddl;
    PREPARE frm_v210_stmt FROM @frm_v210_sql;
    EXECUTE frm_v210_stmt;
    DEALLOCATE PREPARE frm_v210_stmt;
  END IF;
END$$
DELIMITER ;

/* -------------------------------------------------------------------------- */
/* 1. NĂNG LỰC KỸ THUẬT BẮT BUỘC CỦA SÂN                                     */
/* -------------------------------------------------------------------------- */

CALL frm_v210_add_column_if_missing('stadiums','has_var',
  'ALTER TABLE stadiums ADD COLUMN has_var BOOLEAN NOT NULL DEFAULT FALSE AFTER atmosphere_quality');
CALL frm_v210_add_column_if_missing('stadiums','has_goal_line_technology',
  'ALTER TABLE stadiums ADD COLUMN has_goal_line_technology BOOLEAN NOT NULL DEFAULT FALSE AFTER has_var');
CALL frm_v210_add_column_if_missing('stadiums','has_led_perimeter',
  'ALTER TABLE stadiums ADD COLUMN has_led_perimeter BOOLEAN NOT NULL DEFAULT FALSE AFTER has_goal_line_technology');
CALL frm_v210_add_column_if_missing('stadiums','has_backup_power',
  'ALTER TABLE stadiums ADD COLUMN has_backup_power BOOLEAN NOT NULL DEFAULT FALSE AFTER has_led_perimeter');
CALL frm_v210_add_column_if_missing('stadiums','has_media_center',
  'ALTER TABLE stadiums ADD COLUMN has_media_center BOOLEAN NOT NULL DEFAULT FALSE AFTER has_backup_power');
CALL frm_v210_add_column_if_missing('stadiums','has_medical_center',
  'ALTER TABLE stadiums ADD COLUMN has_medical_center BOOLEAN NOT NULL DEFAULT FALSE AFTER has_media_center');

CALL frm_v210_add_column_if_missing('stadium_upgrade_catalog','feature_unlocks',
  'ALTER TABLE stadium_upgrade_catalog ADD COLUMN feature_unlocks JSON NULL AFTER atmosphere_bonus');

-- Suy luận năng lực ban đầu một lần từ điểm công nghệ/an ninh của các sân đã tồn tại.
SET @FRM_V210_FIRST_INSTALL = NOT EXISTS (
  SELECT 1 FROM system_settings WHERE setting_key='stadium_compliance_capabilities_inferred'
);
UPDATE stadiums
SET has_var = IF(@FRM_V210_FIRST_INSTALL, technology_quality >= 68, has_var),
    has_goal_line_technology = IF(@FRM_V210_FIRST_INSTALL, technology_quality >= 84, has_goal_line_technology),
    has_led_perimeter = IF(@FRM_V210_FIRST_INSTALL, commercial_quality >= 65 OR technology_quality >= 72, has_led_perimeter),
    has_backup_power = IF(@FRM_V210_FIRST_INSTALL, lighting_quality >= 70 AND technology_quality >= 60, has_backup_power),
    has_media_center = IF(@FRM_V210_FIRST_INSTALL, technology_quality >= 78 AND hospitality_quality >= 60, has_media_center),
    has_medical_center = IF(@FRM_V210_FIRST_INSTALL, security_quality >= 60, has_medical_center);
INSERT INTO system_settings(setting_key,setting_value)
VALUES('stadium_compliance_capabilities_inferred','TRUE')
ON DUPLICATE KEY UPDATE setting_value=setting_value;

/* -------------------------------------------------------------------------- */
/* 2. DANH MỤC TIÊU CHUẨN SÂN                                                 */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS stadium_standard_profiles (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(600) NOT NULL,
  min_level_no TINYINT UNSIGNED NOT NULL DEFAULT 1,
  min_rating_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  min_capacity INT UNSIGNED NOT NULL DEFAULT 0,
  min_vip_seats INT UNSIGNED NOT NULL DEFAULT 0,
  min_pitch_quality TINYINT UNSIGNED NOT NULL DEFAULT 1,
  min_lighting_quality TINYINT UNSIGNED NOT NULL DEFAULT 1,
  min_technology_quality TINYINT UNSIGNED NOT NULL DEFAULT 1,
  min_security_quality TINYINT UNSIGNED NOT NULL DEFAULT 1,
  min_hospitality_quality TINYINT UNSIGNED NOT NULL DEFAULT 1,
  min_parking_quality TINYINT UNSIGNED NOT NULL DEFAULT 1,
  require_var BOOLEAN NOT NULL DEFAULT FALSE,
  require_goal_line_technology BOOLEAN NOT NULL DEFAULT FALSE,
  require_led_perimeter BOOLEAN NOT NULL DEFAULT FALSE,
  require_backup_power BOOLEAN NOT NULL DEFAULT FALSE,
  require_media_center BOOLEAN NOT NULL DEFAULT FALSE,
  require_medical_center BOOLEAN NOT NULL DEFAULT FALSE,
  capacity_tolerance_pct DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  soft_quality_tolerance TINYINT UNSIGNED NOT NULL DEFAULT 5,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_stadium_standard_profiles_code UNIQUE(code)
) ENGINE=InnoDB;

INSERT INTO stadium_standard_profiles(
  code,name,description,min_level_no,min_rating_score,min_capacity,min_vip_seats,
  min_pitch_quality,min_lighting_quality,min_technology_quality,min_security_quality,
  min_hospitality_quality,min_parking_quality,require_var,require_goal_line_technology,
  require_led_perimeter,require_backup_power,require_media_center,require_medical_center,
  capacity_tolerance_pct,soft_quality_tolerance,is_active
) VALUES
('COMMUNITY_C','Chuẩn cơ sở – Hạng C','Giao hữu, vòng loại hoặc giải phong trào; ưu tiên an toàn và mặt cỏ cơ bản.',1,35,3000,50,35,30,20,35,20,20,FALSE,FALSE,FALSE,FALSE,FALSE,TRUE,10,8,TRUE),
('PROFESSIONAL_B','Chuẩn chuyên nghiệp – Hạng B','Vòng bảng giải chuyên nghiệp quy mô vừa, có y tế và an ninh vận hành đầy đủ.',2,45,8000,250,50,50,35,55,35,35,FALSE,FALSE,FALSE,TRUE,FALSE,TRUE,8,7,TRUE),
('CONTINENTAL_A','Chuẩn châu lục – Hạng A','Giải cấp cao và vòng knock-out; yêu cầu VAR, LED, điện dự phòng và trung tâm truyền thông.',3,60,15000,600,65,70,60,70,55,50,TRUE,FALSE,TRUE,TRUE,TRUE,TRUE,6,6,TRUE),
('ELITE_KNOCKOUT','Chuẩn Elite – Bán kết','Bán kết và trận cầu lớn; yêu cầu công nghệ, an ninh, VIP và khả năng truyền hình cao.',4,75,30000,1500,78,82,75,80,70,65,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,4,5,TRUE),
('WORLD_FINAL','Chuẩn World Class – Chung kết','Chung kết hàng đầu thế giới; toàn bộ tiêu chí bắt buộc ở mức cao nhất.',5,88,40000,3000,88,90,88,90,85,80,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,2,3,TRUE),
('WORLD_CUP_ELITE','Chuẩn World Cup Elite','Chuẩn đề xuất cho World Cup: sức chứa lớn, công nghệ truyền hình và vận hành quốc tế.',4,82,40000,2500,85,88,85,88,80,75,TRUE,TRUE,TRUE,TRUE,TRUE,TRUE,3,4,TRUE)
ON DUPLICATE KEY UPDATE
  name=VALUES(name),description=VALUES(description),min_level_no=VALUES(min_level_no),
  min_rating_score=VALUES(min_rating_score),min_capacity=VALUES(min_capacity),min_vip_seats=VALUES(min_vip_seats),
  min_pitch_quality=VALUES(min_pitch_quality),min_lighting_quality=VALUES(min_lighting_quality),
  min_technology_quality=VALUES(min_technology_quality),min_security_quality=VALUES(min_security_quality),
  min_hospitality_quality=VALUES(min_hospitality_quality),min_parking_quality=VALUES(min_parking_quality),
  require_var=VALUES(require_var),require_goal_line_technology=VALUES(require_goal_line_technology),
  require_led_perimeter=VALUES(require_led_perimeter),require_backup_power=VALUES(require_backup_power),
  require_media_center=VALUES(require_media_center),require_medical_center=VALUES(require_medical_center),
  capacity_tolerance_pct=VALUES(capacity_tolerance_pct),soft_quality_tolerance=VALUES(soft_quality_tolerance),is_active=TRUE;

/* -------------------------------------------------------------------------- */
/* 3. QUY ĐỊNH THEO GIẢI / GIAI ĐOẠN / VÒNG                                  */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS competition_stadium_requirements (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  competition_id BIGINT UNSIGNED NOT NULL,
  stage_type ENUM('ANY','GROUP','KNOCKOUT') NOT NULL DEFAULT 'ANY',
  round_id BIGINT UNSIGNED NULL,
  profile_id BIGINT UNSIGNED NOT NULL,
  enforcement_mode ENUM('WARN','BLOCK') NOT NULL DEFAULT 'BLOCK',
  allow_conditional BOOLEAN NOT NULL DEFAULT TRUE,
  note VARCHAR(600) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_comp_stadium_req_comp FOREIGN KEY(competition_id) REFERENCES competitions(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_comp_stadium_req_round FOREIGN KEY(round_id) REFERENCES competition_rounds(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_comp_stadium_req_profile FOREIGN KEY(profile_id) REFERENCES stadium_standard_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_comp_stadium_req_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CALL frm_v210_add_index_if_missing('competition_stadium_requirements','idx_comp_stadium_req_lookup',
  'CREATE INDEX idx_comp_stadium_req_lookup ON competition_stadium_requirements(competition_id,is_active,round_id,stage_type)');

/* -------------------------------------------------------------------------- */
/* 4. GÁN SÂN VÀ LƯU KẾT QUẢ KIỂM ĐỊNH TỪNG TRẬN                              */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS match_stadium_assignments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id BIGINT UNSIGNED NOT NULL,
  stadium_id BIGINT UNSIGNED NOT NULL,
  requirement_id BIGINT UNSIGNED NULL,
  profile_id BIGINT UNSIGNED NOT NULL,
  eligibility_status ENUM('ELIGIBLE','CONDITIONAL','NOT_ELIGIBLE','OVERRIDDEN') NOT NULL,
  compliance_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  hard_fail_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  soft_fail_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  evaluation_json JSON NOT NULL,
  assigned_by_user_id BIGINT UNSIGNED NULL,
  assigned_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  override_reason VARCHAR(800) NULL,
  overridden_by_user_id BIGINT UNSIGNED NULL,
  overridden_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_match_stadium_assignment UNIQUE(match_id),
  CONSTRAINT fk_match_stadium_assignment_match FOREIGN KEY(match_id) REFERENCES matches(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_match_stadium_assignment_stadium FOREIGN KEY(stadium_id) REFERENCES stadiums(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_match_stadium_assignment_requirement FOREIGN KEY(requirement_id) REFERENCES competition_stadium_requirements(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_match_stadium_assignment_profile FOREIGN KEY(profile_id) REFERENCES stadium_standard_profiles(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_match_stadium_assignment_assigner FOREIGN KEY(assigned_by_user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_match_stadium_assignment_overrider FOREIGN KEY(overridden_by_user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CALL frm_v210_add_index_if_missing('match_stadium_assignments','idx_match_stadium_assignment_stadium',
  'CREATE INDEX idx_match_stadium_assignment_stadium ON match_stadium_assignments(stadium_id,eligibility_status)');

/* -------------------------------------------------------------------------- */
/* 5. GÓI NÂNG CẤP MỞ KHÓA TIÊU CHUẨN                                        */
/* -------------------------------------------------------------------------- */

INSERT INTO stadium_upgrade_catalog(
  code,name,category,description,base_cost,duration_days,min_level,
  capacity_add,standard_seats_add,vip_seats_add,hospitality_boxes_add,
  pitch_bonus,seating_bonus,stands_bonus,lighting_bonus,technology_bonus,
  hospitality_bonus,parking_bonus,security_bonus,commercial_bonus,atmosphere_bonus,
  feature_unlocks,is_active
) VALUES
('VAR_GOAL_LINE','VAR & Goal-line Technology','TECHNOLOGY','Lắp phòng VAR, camera chuyên dụng và công nghệ xác định bàn thắng để đạt chuẩn knock-out cao cấp.',3500000000,12,2,0,0,0,0,0,0,0,0,16,0,0,3,2,0,JSON_OBJECT('has_var',TRUE,'has_goal_line_technology',TRUE),TRUE),
('LED_360_COMPLIANCE','LED 360° chuẩn truyền hình','COMMERCIAL','Biển LED quanh sân đồng bộ truyền hình, quảng cáo và nhận diện giải đấu.',2200000000,8,2,0,0,0,0,0,0,0,0,5,0,0,0,14,4,JSON_OBJECT('has_led_perimeter',TRUE),TRUE),
('MEDIA_BACKUP_POWER','Media Center & điện dự phòng','TECHNOLOGY','Trung tâm báo chí, phòng điều hành truyền hình và nguồn điện dự phòng độc lập.',4200000000,15,2,0,0,0,0,0,0,2,7,12,4,0,3,3,0,JSON_OBJECT('has_media_center',TRUE,'has_backup_power',TRUE),TRUE),
('MEDICAL_COMMAND_CENTER','Trung tâm y tế và chỉ huy an ninh','SAFETY','Nâng cấp phòng y tế, lối xe cứu thương và trung tâm chỉ huy an ninh trận đấu.',2800000000,10,1,0,0,0,0,0,0,0,0,2,0,0,16,0,0,JSON_OBJECT('has_medical_center',TRUE),TRUE)
ON DUPLICATE KEY UPDATE
  name=VALUES(name),category=VALUES(category),description=VALUES(description),base_cost=VALUES(base_cost),
  duration_days=VALUES(duration_days),min_level=VALUES(min_level),technology_bonus=VALUES(technology_bonus),
  security_bonus=VALUES(security_bonus),commercial_bonus=VALUES(commercial_bonus),feature_unlocks=VALUES(feature_unlocks),is_active=TRUE;

/* -------------------------------------------------------------------------- */
/* 6. VIEW GIÁM SÁT                                                          */
/* -------------------------------------------------------------------------- */

DROP VIEW IF EXISTS v_match_stadium_compliance;
CREATE VIEW v_match_stadium_compliance AS
SELECT
  msa.id,
  msa.match_id,
  msa.stadium_id,
  s.name AS stadium_name,
  s.capacity_total,
  msa.requirement_id,
  msa.profile_id,
  sp.code AS profile_code,
  sp.name AS profile_name,
  msa.eligibility_status,
  msa.compliance_score,
  msa.hard_fail_count,
  msa.soft_fail_count,
  msa.evaluation_json,
  msa.override_reason,
  msa.assigned_at,
  msa.overridden_at,
  m.competition_id,
  comp.name AS competition_name,
  m.stage_type,
  m.round_id,
  cr.round_name,
  m.home_club_id,
  hc.name AS home_club_name,
  m.away_club_id,
  ac.name AS away_club_name,
  m.scheduled_at,
  m.status AS match_status
FROM match_stadium_assignments msa
JOIN matches m ON m.id=msa.match_id
JOIN competitions comp ON comp.id=m.competition_id
JOIN stadiums s ON s.id=msa.stadium_id
JOIN stadium_standard_profiles sp ON sp.id=msa.profile_id
LEFT JOIN competition_rounds cr ON cr.id=m.round_id
LEFT JOIN clubs hc ON hc.id=m.home_club_id
LEFT JOIN clubs ac ON ac.id=m.away_club_id;

INSERT INTO system_settings(setting_key,setting_value) VALUES
('stadium_compliance_version','2.0.10'),
('stadium_compliance_default_enforcement','BLOCK'),
('stadium_compliance_override_policy','Chỉ FIFA Admin được vượt chuẩn bắt buộc và phải ghi lý do để lưu audit.')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value);

DROP PROCEDURE IF EXISTS frm_v210_add_column_if_missing;
DROP PROCEDURE IF EXISTS frm_v210_add_index_if_missing;

SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES_V210;

SELECT
  'STADIUM_COMPLIANCE_AND_VENUE_INTELLIGENCE_READY' AS result,
  (SELECT COUNT(*) FROM stadium_standard_profiles WHERE is_active=TRUE) AS standard_profiles,
  (SELECT COUNT(*) FROM stadium_upgrade_catalog WHERE is_active=TRUE) AS upgrade_options,
  (SELECT COUNT(*) FROM stadiums) AS existing_stadiums_preserved;
