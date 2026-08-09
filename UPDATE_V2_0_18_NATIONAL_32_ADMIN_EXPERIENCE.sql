/* ============================================================================
   FOOTBALL RANK MANAGER 2.0.18
   GIAI 32 QUOC GIA: HAN NGACH CONG BANG + GIAO DIEN ADMIN DONG BO

   - Chay tren dung database da hoan tat v2.0.16.
   - Khong ghi cung ten database; dung duoc cho database online defaultdb.
   - Cong don va co the chay lai; khong xoa giai, cau thu, quoc gia, tran dau.
   - Khong tu danh dau cac giai cu da tinh theo cong thuc moi. FIFA Admin can
     bam "Tinh lai han ngach" de tao anh chup phan bo v2.0.18 cho tung giai.
============================================================================ */
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @OLD_SQL_SAFE_UPDATES_V218 = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

DELIMITER $$
DROP PROCEDURE IF EXISTS frm_v218_require_base$$
CREATE PROCEDURE frm_v218_require_base()
BEGIN
  IF DATABASE() IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='Hay chon database truoc khi chay migration 2.0.18.';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema=DATABASE() AND table_name='national_cup_profiles'
  ) OR NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema=DATABASE() AND table_name='national_cup_confederation_quotas'
  ) OR NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema=DATABASE() AND table_name='country_catalog'
  ) OR NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema=DATABASE() AND table_name='player_national_profiles'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='Database chua co day du nen tang giai 32 quoc gia v2.0.15.';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM system_settings
    WHERE setting_key='player_valuation_version' AND setting_value='2.0.16'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='Database chua hoan tat v2.0.16. Hay cap nhat dung thu tu truoc.';
  END IF;
END$$

DROP PROCEDURE IF EXISTS frm_v218_add_column$$
CREATE PROCEDURE frm_v218_add_column(IN p_table VARCHAR(64),IN p_column VARCHAR(64),IN p_definition TEXT)
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name=p_table AND column_name=p_column
  ) THEN
    SET @frm_v218_sql=CONCAT(
      'ALTER TABLE `',REPLACE(p_table,'`','``'),'` ADD COLUMN `',
      REPLACE(p_column,'`','``'),'` ',p_definition
    );
    PREPARE frm_v218_stmt FROM @frm_v218_sql;
    EXECUTE frm_v218_stmt;
    DEALLOCATE PREPARE frm_v218_stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS frm_v218_add_index$$
CREATE PROCEDURE frm_v218_add_index(IN p_table VARCHAR(64),IN p_index VARCHAR(64),IN p_columns TEXT)
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema=DATABASE() AND table_name=p_table AND index_name=p_index
  ) THEN
    SET @frm_v218_sql=CONCAT(
      'ALTER TABLE `',REPLACE(p_table,'`','``'),'` ADD INDEX `',
      REPLACE(p_index,'`','``'),'` (',p_columns,')'
    );
    PREPARE frm_v218_stmt FROM @frm_v218_sql;
    EXECUTE frm_v218_stmt;
    DEALLOCATE PREPARE frm_v218_stmt;
  END IF;
END$$
DELIMITER ;

CALL frm_v218_require_base();

ALTER TABLE national_cup_profiles
  MODIFY quota_method ENUM(
    'PROPORTIONAL_HAMILTON',
    'CAPACITY_WEIGHTED_HAMILTON',
    'CAPACITY_STRENGTH_HAMILTON'
  ) NOT NULL DEFAULT 'CAPACITY_STRENGTH_HAMILTON';

/* Cot v2.0.17 duoc lap lai co dieu kien de co the nang thang tu v2.0.16. */
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','historical_strength_points',
  'DECIMAL(20,3) NOT NULL DEFAULT 0 AFTER `slot_count`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','world_cup_strength_points',
  'DECIMAL(20,3) NOT NULL DEFAULT 0 AFTER `slot_count`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','national_cup_strength_points',
  'DECIMAL(20,3) NOT NULL DEFAULT 0 AFTER `world_cup_strength_points`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','championship_count',
  'SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER `historical_strength_points`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','medal_count',
  'SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER `championship_count`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','availability_share',
  'DECIMAL(10,6) NOT NULL DEFAULT 0 AFTER `medal_count`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','strength_share',
  'DECIMAL(10,6) NOT NULL DEFAULT 0 AFTER `availability_share`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','allocation_weight',
  'DECIMAL(10,6) NOT NULL DEFAULT 0 AFTER `strength_share`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','proportional_slot_target',
  'DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER `allocation_weight`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','weighted_slot_target',
  'DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER `proportional_slot_target`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','minimum_slot_count',
  'TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER `weighted_slot_target`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','maximum_slot_count',
  'TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER `minimum_slot_count`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','strength_adjustment_slots',
  'DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER `maximum_slot_count`'
);
CALL frm_v218_add_column(
  'national_cup_confederation_quotas','is_capacity_limited',
  'BOOLEAN NOT NULL DEFAULT FALSE AFTER `strength_adjustment_slots`'
);

CALL frm_v218_add_index(
  'national_cup_entries','idx_national_entry_quota_scan',
  '`competition_id`,`confederation`,`status`'
);
CALL frm_v218_add_index(
  'player_national_profiles','idx_national_profile_eligibility',
  '`is_active`,`country_catalog_id`'
);

INSERT INTO system_settings(setting_key,setting_value,description) VALUES
('national_quota_version','2.0.18','32 suat: 80% quy mo + 20% thanh tich loi suat giam dan; gioi han quanh ty le va khong vuot suc chua'),
('national_quota_availability_weight','0.80','Trong so so quoc gia co dai dien hop le'),
('national_quota_strength_weight','0.20','Trong so lich su World Cup va giai quoc gia'),
('national_quota_strength_transform','SQRT','Loi suat giam dan de thanh tich khong lan at quy mo'),
('national_quota_slot_bound','PROPORTIONAL_PLUS_MINUS_1','Bien dieu chinh thong thuong quanh ty le quoc gia')
ON DUPLICATE KEY UPDATE
  setting_value=VALUES(setting_value),description=VALUES(description);

DROP PROCEDURE IF EXISTS frm_v218_add_index;
DROP PROCEDURE IF EXISTS frm_v218_add_column;
DROP PROCEDURE IF EXISTS frm_v218_require_base;
SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES_V218;

SELECT
  CASE
    WHEN EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=DATABASE()
        AND table_name='national_cup_confederation_quotas'
        AND column_name='world_cup_strength_points'
    ) AND EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=DATABASE()
        AND table_name='national_cup_confederation_quotas'
        AND column_name='maximum_slot_count'
    ) AND EXISTS(
      SELECT 1 FROM system_settings
      WHERE setting_key='national_quota_version' AND setting_value='2.0.18'
    )
    THEN 'NATIONAL_32_ADMIN_V2_0_18_READY'
    ELSE 'NATIONAL_32_ADMIN_V2_0_18_INCOMPLETE'
  END AS result,
  (SELECT COUNT(DISTINCT cc.id)
   FROM country_catalog cc
   JOIN player_national_profiles np
     ON np.country_catalog_id=cc.id AND np.is_active=TRUE
   JOIN players p
     ON p.id=np.player_id AND p.status IN('ACTIVE','FREE_AGENT','TRANSFER_LISTED')
   WHERE cc.is_active=TRUE) AS eligible_countries_preserved,
  (SELECT COUNT(*) FROM national_cup_entries) AS national_entries_preserved;
