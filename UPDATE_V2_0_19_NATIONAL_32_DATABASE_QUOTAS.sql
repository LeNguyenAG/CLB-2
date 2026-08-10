/* ============================================================================
   FOOTBALL RANK MANAGER 2.0.19
   GIAI DAC BIET 32 QUOC GIA - CHIA SUAT THEO DU LIEU NOI BO

   - Chi ap dung cho giai knockout 32 quoc gia.
   - 60% theo so quoc gia hop le thuc co trong DB.
   - 40% theo so quoc gia trong nhom xep hang manh hien tai.
   - Chi dung AFC, CAF, CONCACAF, CONMEBOL, OFC, UEFA; khong dung OTHER.
   - Khong ghi cung ten database, khong xoa quoc gia/cau thu/giai/ket qua.
   - Co the chay lai an toan.
============================================================================ */
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @OLD_SQL_SAFE_UPDATES_V219 = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

DELIMITER $$
DROP PROCEDURE IF EXISTS frm_v219_require_base$$
CREATE PROCEDURE frm_v219_require_base()
BEGIN
  IF DATABASE() IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT='Hay chon database local cua du an truoc khi chay migration 2.0.19.';
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
      SET MESSAGE_TEXT='Database chua co nen tang giai 32 quoc gia. Hay chay UPDATE_V2_0_15_NATIONAL_TOURNAMENTS.sql truoc.';
  END IF;
END$$

DROP PROCEDURE IF EXISTS frm_v219_add_column$$
CREATE PROCEDURE frm_v219_add_column(IN p_table VARCHAR(64),IN p_column VARCHAR(64),IN p_definition TEXT)
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name=p_table AND column_name=p_column
  ) THEN
    SET @frm_v219_sql=CONCAT(
      'ALTER TABLE `',REPLACE(p_table,'`','``'),'` ADD COLUMN `',
      REPLACE(p_column,'`','``'),'` ',p_definition
    );
    PREPARE frm_v219_stmt FROM @frm_v219_sql;
    EXECUTE frm_v219_stmt;
    DEALLOCATE PREPARE frm_v219_stmt;
  END IF;
END$$
DELIMITER ;

CALL frm_v219_require_base();

ALTER TABLE national_cup_profiles
  MODIFY quota_method ENUM(
    'PROPORTIONAL_HAMILTON',
    'CAPACITY_WEIGHTED_HAMILTON',
    'CAPACITY_STRENGTH_HAMILTON',
    'DATABASE_RANKING_HAMILTON'
  ) NOT NULL DEFAULT 'DATABASE_RANKING_HAMILTON';

CALL frm_v219_add_column(
  'national_cup_confederation_quotas','strong_country_count',
  'SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER `available_country_count`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','world_cup_strength_points',
  'DECIMAL(20,3) NOT NULL DEFAULT 0 AFTER `slot_count`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','national_cup_strength_points',
  'DECIMAL(20,3) NOT NULL DEFAULT 0 AFTER `world_cup_strength_points`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','historical_strength_points',
  'DECIMAL(20,3) NOT NULL DEFAULT 0 AFTER `national_cup_strength_points`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','championship_count',
  'SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER `historical_strength_points`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','medal_count',
  'SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER `championship_count`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','availability_share',
  'DECIMAL(10,6) NOT NULL DEFAULT 0 AFTER `medal_count`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','strength_share',
  'DECIMAL(10,6) NOT NULL DEFAULT 0 AFTER `availability_share`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','allocation_weight',
  'DECIMAL(10,6) NOT NULL DEFAULT 0 AFTER `strength_share`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','proportional_slot_target',
  'DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER `allocation_weight`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','weighted_slot_target',
  'DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER `proportional_slot_target`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','minimum_slot_count',
  'TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER `weighted_slot_target`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','maximum_slot_count',
  'TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER `minimum_slot_count`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','strength_adjustment_slots',
  'DECIMAL(10,3) NOT NULL DEFAULT 0 AFTER `maximum_slot_count`'
);
CALL frm_v219_add_column(
  'national_cup_confederation_quotas','is_capacity_limited',
  'BOOLEAN NOT NULL DEFAULT FALSE AFTER `strength_adjustment_slots`'
);

INSERT INTO system_settings(setting_key,setting_value,description) VALUES
('national_quota_version','2.0.19','32 suat theo du lieu noi bo: 60% so quoc gia hop le + 40% so quoc gia top 32 xep hang; bo OTHER'),
('national_quota_availability_weight','0.60','Trong so so quoc gia hop le thuc co trong database'),
('national_quota_strength_weight','0.40','Trong so quoc gia nam trong top 32 xep hang noi bo hien tai'),
('national_quota_strength_source','CURRENT_DATABASE_TOP_32','Nguon suc manh la world_seed_rank hien tai trong database'),
('national_quota_confederations','AFC,CAF,CONCACAF,CONMEBOL,OFC,UEFA','Sau chau luc hop le cua giai knockout 32 quoc gia'),
('national_quota_allocation','CAPACITY_LIMITED_LARGEST_REMAINDER','Phan du lon nhat, toi thieu 1 suat va khong vuot so quoc gia hop le')
ON DUPLICATE KEY UPDATE
  setting_value=VALUES(setting_value),description=VALUES(description);

DROP PROCEDURE IF EXISTS frm_v219_add_column;
DROP PROCEDURE IF EXISTS frm_v219_require_base;
SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES_V219;

SELECT
  CASE
    WHEN EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=DATABASE()
        AND table_name='national_cup_confederation_quotas'
        AND column_name='strong_country_count'
    ) AND EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema=DATABASE()
        AND table_name='national_cup_profiles'
        AND column_name='quota_method'
        AND column_type LIKE '%DATABASE_RANKING_HAMILTON%'
    ) AND EXISTS(
      SELECT 1 FROM system_settings
      WHERE setting_key='national_quota_version' AND setting_value='2.0.19'
    )
    THEN 'NATIONAL_32_DATABASE_QUOTAS_V2_0_19_READY'
    ELSE 'NATIONAL_32_DATABASE_QUOTAS_V2_0_19_INCOMPLETE'
  END AS result,
  (SELECT COUNT(DISTINCT cc.id)
   FROM country_catalog cc
   JOIN player_national_profiles np
     ON np.country_catalog_id=cc.id AND np.is_active=TRUE
   JOIN players p
     ON p.id=np.player_id AND p.status IN('ACTIVE','FREE_AGENT','TRANSFER_LISTED')
   WHERE cc.is_active=TRUE
     AND cc.confederation IN('AFC','CAF','CONCACAF','CONMEBOL','OFC','UEFA')
  ) AS eligible_countries_in_six_confederations,
  (SELECT COUNT(*) FROM national_cup_entries) AS national_entries_preserved;

