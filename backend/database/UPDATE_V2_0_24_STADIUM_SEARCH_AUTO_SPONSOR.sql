/* FOOTBALL RANK MANAGER 2.0.24 - Stadium search & automatic competition sponsorship */
USE football_rank_manager;
SET NAMES utf8mb4;

DROP PROCEDURE IF EXISTS frm_v224_add_column;
DROP PROCEDURE IF EXISTS frm_v224_add_index;
DELIMITER $$
CREATE PROCEDURE frm_v224_add_column(IN p_table VARCHAR(64),IN p_column VARCHAR(64),IN p_definition TEXT)
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND COLUMN_NAME=p_column) THEN
    SET @sql=CONCAT('ALTER TABLE `',p_table,'` ADD COLUMN `',p_column,'` ',p_definition);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
CREATE PROCEDURE frm_v224_add_index(IN p_table VARCHAR(64),IN p_index VARCHAR(64),IN p_sql TEXT)
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=p_table AND INDEX_NAME=p_index) THEN
    SET @sql=p_sql; PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CALL frm_v224_add_column('sponsorship_offers','source_operation_id','BIGINT UNSIGNED NULL AFTER match_id');
CALL frm_v224_add_column('sponsorship_offers','generation_source',
  'ENUM(''MANUAL'',''MATCH_RANDOM_LEGACY'',''AUTO_STADIUM_COMPETITION'') NOT NULL DEFAULT ''MANUAL'' AFTER source_operation_id');
CALL frm_v224_add_column('sponsorship_offers','preference_score','DECIMAL(6,2) NOT NULL DEFAULT 0 AFTER appearance_probability');
CALL frm_v224_add_column('sponsorship_contracts','competition_id','BIGINT UNSIGNED NULL AFTER match_id');

CALL frm_v224_add_index('sponsorship_offers','idx_so_stadium_competition',
  'CREATE INDEX idx_so_stadium_competition ON sponsorship_offers(stadium_id,competition_id,status,created_at)');
CALL frm_v224_add_index('sponsorship_offers','idx_so_auto_source',
  'CREATE INDEX idx_so_auto_source ON sponsorship_offers(generation_source,source_operation_id)');
CALL frm_v224_add_index('sponsorship_contracts','idx_sc_competition_status',
  'CREATE INDEX idx_sc_competition_status ON sponsorship_contracts(competition_id,status)');

UPDATE sponsorship_offers SET generation_source='MATCH_RANDOM_LEGACY'
WHERE match_id IS NOT NULL AND generation_source='MANUAL';

INSERT INTO system_settings(setting_key,setting_value) VALUES
('stadium_search_version','2.0.24'),
('automatic_stadium_sponsorship_version','2.0.24'),
('automatic_stadium_sponsorship_policy','Tự đề xuất theo sân + giải khi phân sân; CLB duyệt/từ chối; thanh toán khi giải kết thúc; ưu tiên lịch sử hợp tác.')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value);

DROP PROCEDURE IF EXISTS frm_v224_add_column;
DROP PROCEDURE IF EXISTS frm_v224_add_index;

SELECT 'STADIUM_SEARCH_AUTO_SPONSOR_V2_0_24_READY' AS result;
