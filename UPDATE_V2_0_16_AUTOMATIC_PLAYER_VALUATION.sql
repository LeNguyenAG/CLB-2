/* ============================================================================
   FOOTBALL RANK MANAGER 2.0.16
   DINH GIA CAU THU TU DONG + GIA SAN LUONG/CHUYEN NHUONG
   - Chay tren dung database da hoan tat migration 2.0.15.
   - Khong USE ten database co dinh de tuong thich database online defaultdb.
   - Migration cong don, khong xoa cau thu, hop dong, giao dich hay lich su cu.
============================================================================ */
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @OLD_SQL_SAFE_UPDATES_V216 = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

DELIMITER $$
DROP PROCEDURE IF EXISTS frm_v216_require_previous$$
CREATE PROCEDURE frm_v216_require_previous()
BEGIN
  IF DATABASE() IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Hay chon database truoc khi chay migration 2.0.16.';
  END IF;
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name='player_ranking_points' AND column_name='ranking_scope'
  ) OR NOT EXISTS(
    SELECT 1 FROM information_schema.tables
    WHERE table_schema=DATABASE() AND table_name='national_cup_matches'
  ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Database chua hoan tat v2.0.15. Hay chay file FIX v2.0.15 truoc.';
  END IF;
END$$

DROP PROCEDURE IF EXISTS frm_v216_add_column$$
CREATE PROCEDURE frm_v216_add_column(IN p_table VARCHAR(64),IN p_column VARCHAR(64),IN p_definition TEXT)
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name=p_table AND column_name=p_column
  ) THEN
    SET @frm_sql=CONCAT('ALTER TABLE `',REPLACE(p_table,'`','``'),'` ADD COLUMN `',REPLACE(p_column,'`','``'),'` ',p_definition);
    PREPARE frm_stmt FROM @frm_sql; EXECUTE frm_stmt; DEALLOCATE PREPARE frm_stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS frm_v216_add_index$$
CREATE PROCEDURE frm_v216_add_index(IN p_table VARCHAR(64),IN p_index VARCHAR(64),IN p_sql TEXT)
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema=DATABASE() AND table_name=p_table AND index_name=p_index
  ) THEN
    SET @frm_sql=p_sql; PREPARE frm_stmt FROM @frm_sql; EXECUTE frm_stmt; DEALLOCATE PREPARE frm_stmt;
  END IF;
END$$

DROP PROCEDURE IF EXISTS frm_v216_add_constraint$$
CREATE PROCEDURE frm_v216_add_constraint(IN p_table VARCHAR(64),IN p_constraint VARCHAR(64),IN p_sql TEXT)
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema=DATABASE() AND table_name=p_table AND constraint_name=p_constraint
  ) THEN
    SET @frm_sql=p_sql; PREPARE frm_stmt FROM @frm_sql; EXECUTE frm_stmt; DEALLOCATE PREPARE frm_stmt;
  END IF;
END$$
DELIMITER ;

CALL frm_v216_require_previous();

/* 1. Trang thai dinh gia hien tai tren ho so cau thu. */
CALL frm_v216_add_column('players','valuation_score','DECIMAL(9,3) NOT NULL DEFAULT 0 AFTER `market_value`');
CALL frm_v216_add_column('players','valuation_method_version','VARCHAR(20) NULL AFTER `valuation_score`');
CALL frm_v216_add_column('players','valuation_updated_at','DATETIME(6) NULL AFTER `valuation_method_version`');
CALL frm_v216_add_column('players','valuation_breakdown','JSON NULL AFTER `valuation_updated_at`');

/* 2. Moi lan bam Lam moi tao mot ky dinh gia rieng. */
CREATE TABLE IF NOT EXISTS player_valuation_batches(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  scope ENUM('ALL_ACTIVE','SINGLE') NOT NULL DEFAULT 'ALL_ACTIVE',
  season_id BIGINT UNSIGNED NULL,
  formula_version VARCHAR(20) NOT NULL,
  random_seed INT UNSIGNED NOT NULL,
  status ENUM('RUNNING','COMPLETED','FAILED') NOT NULL DEFAULT 'RUNNING',
  total_players INT UNSIGNED NOT NULL DEFAULT 0,
  increased_count INT UNSIGNED NOT NULL DEFAULT 0,
  decreased_count INT UNSIGNED NOT NULL DEFAULT 0,
  unchanged_count INT UNSIGNED NOT NULL DEFAULT 0,
  salaries_adjusted_count INT UNSIGNED NOT NULL DEFAULT 0,
  total_old_value DECIMAL(20,0) NOT NULL DEFAULT 0,
  total_new_value DECIMAL(20,0) NOT NULL DEFAULT 0,
  note VARCHAR(500) NULL,
  config_snapshot JSON NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  completed_at DATETIME(6) NULL,
  CONSTRAINT fk_pvb_season FOREIGN KEY(season_id) REFERENCES seasons(id) ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_pvb_user FOREIGN KEY(created_by_user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS player_valuation_results(
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  batch_id BIGINT UNSIGNED NOT NULL,
  player_id BIGINT UNSIGNED NOT NULL,
  old_value DECIMAL(20,0) NOT NULL DEFAULT 0,
  new_value DECIMAL(20,0) NOT NULL DEFAULT 0,
  value_change DECIMAL(20,0) NOT NULL DEFAULT 0,
  score DECIMAL(9,3) NOT NULL DEFAULT 0,
  fair_value DECIMAL(20,0) NOT NULL DEFAULT 0,
  market_pulse_pct DECIMAL(7,3) NOT NULL DEFAULT 0,
  evidence_count DECIMAL(12,3) NOT NULL DEFAULT 0,
  active_salary_before DECIMAL(20,0) NOT NULL DEFAULT 0,
  active_salary_after DECIMAL(20,0) NOT NULL DEFAULT 0,
  breakdown JSON NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_pvr_batch_player UNIQUE(batch_id,player_id),
  CONSTRAINT fk_pvr_batch FOREIGN KEY(batch_id) REFERENCES player_valuation_batches(id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_pvr_player FOREIGN KEY(player_id) REFERENCES players(id) ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CALL frm_v216_add_index('player_valuation_batches','idx_pvb_status_time','CREATE INDEX idx_pvb_status_time ON player_valuation_batches(status,scope,id)');
CALL frm_v216_add_index('player_valuation_results','idx_pvr_player_time','CREATE INDEX idx_pvr_player_time ON player_valuation_results(player_id,id)');
CALL frm_v216_add_index('player_valuation_results','idx_pvr_change','CREATE INDEX idx_pvr_change ON player_valuation_results(batch_id,value_change)');

/* 3. Mo rong lich su gia cu de xem cong thuc, diem va nguon thay doi. */
CALL frm_v216_add_column('player_market_value_history','valuation_batch_id','BIGINT UNSIGNED NULL AFTER `changed_by_user_id`');
CALL frm_v216_add_column('player_market_value_history','calculation_score','DECIMAL(9,3) NULL AFTER `valuation_batch_id`');
CALL frm_v216_add_column('player_market_value_history','fair_value','DECIMAL(20,0) NULL AFTER `calculation_score`');
CALL frm_v216_add_column('player_market_value_history','market_pulse_pct','DECIMAL(7,3) NULL AFTER `fair_value`');
CALL frm_v216_add_column('player_market_value_history','calculation_breakdown','JSON NULL AFTER `market_pulse_pct`');
CALL frm_v216_add_column('player_market_value_history','change_source','VARCHAR(30) NOT NULL DEFAULT ''MANUAL'' AFTER `calculation_breakdown`');
CALL frm_v216_add_index('player_market_value_history','idx_pmvh_batch','CREATE INDEX idx_pmvh_batch ON player_market_value_history(valuation_batch_id,player_id)');
CALL frm_v216_add_constraint(
  'player_market_value_history','fk_pmvh_valuation_batch',
  'ALTER TABLE player_market_value_history ADD CONSTRAINT fk_pmvh_valuation_batch FOREIGN KEY(valuation_batch_id) REFERENCES player_valuation_batches(id) ON UPDATE CASCADE ON DELETE SET NULL'
);

/* 4. Trigger ghi lich su gia day du. */
DROP TRIGGER IF EXISTS trg_players_market_value_history;
DELIMITER $$
CREATE TRIGGER trg_players_market_value_history
AFTER UPDATE ON players
FOR EACH ROW
BEGIN
  IF OLD.market_value<>NEW.market_value THEN
    INSERT INTO player_market_value_history(
      player_id,old_value,new_value,changed_by_user_id,valuation_batch_id,
      calculation_score,fair_value,market_pulse_pct,calculation_breakdown,change_source,reason
    ) VALUES(
      NEW.id,OLD.market_value,NEW.market_value,@app_user_id,@app_valuation_batch_id,
      @app_valuation_score,@app_fair_value,@app_market_pulse_pct,@app_valuation_breakdown,
      COALESCE(@app_valuation_source,'MANUAL'),COALESCE(@app_change_reason,'Cap nhat gia tri cau thu')
    );
  END IF;
END$$
DELIMITER ;

/* 5. Gia san: luong moi khong duoc thap hon gia cau thu. */
DROP TRIGGER IF EXISTS trg_player_contract_salary_floor_insert;
DROP TRIGGER IF EXISTS trg_player_contract_salary_floor_update;
DELIMITER $$
CREATE TRIGGER trg_player_contract_salary_floor_insert
BEFORE INSERT ON player_contracts
FOR EACH ROW
BEGIN
  DECLARE v_floor DECIMAL(20,0) DEFAULT 0;
  SELECT market_value INTO v_floor FROM players WHERE id=NEW.player_id;
  IF NEW.salary_per_season<v_floor THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Luong moi khong duoc thap hon gia san cau thu.';
  END IF;
END$$

CREATE TRIGGER trg_player_contract_salary_floor_update
BEFORE UPDATE ON player_contracts
FOR EACH ROW
BEGIN
  DECLARE v_floor DECIMAL(20,0) DEFAULT 0;
  IF NEW.salary_per_season<>OLD.salary_per_season OR (NEW.status='ACTIVE' AND OLD.status<>'ACTIVE') THEN
    SELECT market_value INTO v_floor FROM players WHERE id=NEW.player_id;
    IF NEW.salary_per_season<v_floor THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Luong moi khong duoc thap hon gia san cau thu.';
    END IF;
  END IF;
END$$
DELIMITER ;

/* 6. Gia san: phi chuyen nhuong co phi va luong moi phai dat gia dinh gia hien tai. */
DROP TRIGGER IF EXISTS trg_transfer_offer_value_floor_insert;
DROP TRIGGER IF EXISTS trg_transfer_offer_value_floor_update;
DROP TRIGGER IF EXISTS trg_player_transfer_value_floor_insert;
DELIMITER $$
CREATE TRIGGER trg_transfer_offer_value_floor_insert
BEFORE INSERT ON transfer_offers
FOR EACH ROW
BEGIN
  DECLARE v_floor DECIMAL(20,0) DEFAULT 0;
  SELECT market_value INTO v_floor FROM players WHERE id=NEW.player_id;
  IF NEW.new_salary_per_season<v_floor THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Luong de nghi thap hon gia san cau thu.';
  END IF;
  IF NEW.transfer_type='PAID' AND NEW.transfer_fee<v_floor THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Phi chuyen nhuong thap hon gia san cau thu.';
  END IF;
END$$

CREATE TRIGGER trg_transfer_offer_value_floor_update
BEFORE UPDATE ON transfer_offers
FOR EACH ROW
BEGIN
  DECLARE v_floor DECIMAL(20,0) DEFAULT 0;
  IF NEW.transfer_fee<>OLD.transfer_fee OR NEW.new_salary_per_season<>OLD.new_salary_per_season OR NEW.status<>OLD.status THEN
    SELECT market_value INTO v_floor FROM players WHERE id=NEW.player_id;
    IF NEW.new_salary_per_season<v_floor THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Luong de nghi thap hon gia san cau thu.';
    END IF;
    IF NEW.transfer_type='PAID' AND NEW.transfer_fee<v_floor THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Phi chuyen nhuong thap hon gia san cau thu.';
    END IF;
  END IF;
END$$

CREATE TRIGGER trg_player_transfer_value_floor_insert
BEFORE INSERT ON player_transfers
FOR EACH ROW
BEGIN
  DECLARE v_floor DECIMAL(20,0) DEFAULT 0;
  SELECT market_value INTO v_floor FROM players WHERE id=NEW.player_id;
  IF NEW.transfer_type='PAID' AND NEW.transfer_fee<v_floor THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Khong the hoan tat: phi thap hon gia san hien tai.';
  END IF;
END$$
DELIMITER ;

/* 7. View danh sach va ho so co bien dong gia moi nhat. */
CREATE OR REPLACE VIEW v_player_list AS
SELECT
  p.id,p.full_name,p.position,p.shirt_number,p.club_id,c.name AS club_name,
  p.market_value,p.valuation_score,p.valuation_method_version,p.valuation_updated_at,
  COALESCE(pc.salary_per_season,0) AS salary_per_season,
  COALESCE(w.balance,0) AS wallet_balance,p.status,p.photo_url,
  h.old_value AS previous_market_value,
  CASE WHEN h.id IS NULL THEN 0 ELSE h.new_value-h.old_value END AS latest_value_change,
  CASE WHEN h.old_value IS NULL OR h.old_value=0 THEN NULL
       ELSE ROUND(((h.new_value-h.old_value)/h.old_value)*100,2) END AS latest_change_percent,
  h.changed_at AS latest_value_changed_at,h.change_source AS latest_value_change_source,
  h.valuation_batch_id AS latest_valuation_batch_id
FROM players p
LEFT JOIN clubs c ON c.id=p.club_id
LEFT JOIN player_contracts pc ON pc.id=(
  SELECT MAX(pc2.id) FROM player_contracts pc2
  WHERE pc2.player_id=p.id AND pc2.status='ACTIVE'
)
LEFT JOIN wallets w ON w.player_id=p.id AND w.wallet_type='PLAYER'
LEFT JOIN player_market_value_history h ON h.id=(
  SELECT h2.id FROM player_market_value_history h2
  WHERE h2.player_id=p.id ORDER BY h2.changed_at DESC,h2.id DESC LIMIT 1
);

CREATE OR REPLACE VIEW v_player_dossier_summary AS
SELECT
  vpl.id AS player_id,vpl.full_name,vpl.position,vpl.shirt_number,vpl.club_id,vpl.club_name,
  vpl.market_value,vpl.valuation_score,vpl.valuation_method_version,vpl.valuation_updated_at,
  vpl.previous_market_value,vpl.latest_value_change,vpl.latest_change_percent,vpl.latest_value_changed_at,
  vpl.salary_per_season,vpl.wallet_balance,vpl.status,vpl.photo_url,
  COALESCE(ms.appearances,0) AS appearances,COALESCE(ms.appearances,0) AS total_appearances,
  COALESCE(ms.goals,0) AS goals,COALESCE(ms.goals,0) AS total_goals,
  COALESCE(ms.assists,0) AS assists,COALESCE(ms.assists,0) AS total_assists,
  COALESCE(ms.clean_sheets,0) AS clean_sheets,COALESCE(ms.clean_sheets,0) AS total_clean_sheets,
  COALESCE(ms.goals_conceded,0) AS goals_conceded,
  COALESCE(aw.award_count,0) AS award_count,COALESCE(ch.club_count,0) AS clubs_in_history
FROM v_player_list vpl
LEFT JOIN(
  SELECT player_id,SUM(appeared=TRUE) AS appearances,SUM(goals) AS goals,SUM(assists) AS assists,
         SUM(clean_sheet=TRUE) AS clean_sheets,SUM(goals_conceded) AS goals_conceded
  FROM player_match_stats WHERE verification_status IN('VERIFIED','LOCKED') GROUP BY player_id
) ms ON ms.player_id=vpl.id
LEFT JOIN(SELECT player_id,COUNT(*) AS award_count FROM player_awards GROUP BY player_id) aw ON aw.player_id=vpl.id
LEFT JOIN(SELECT player_id,COUNT(DISTINCT club_id) AS club_count FROM player_club_history GROUP BY player_id) ch ON ch.player_id=vpl.id;

CREATE OR REPLACE VIEW v_player_market_value_changes AS
SELECT
  p.id AS player_id,p.full_name,p.club_id,p.market_value AS current_value,
  h.old_value,h.new_value,h.new_value-h.old_value AS value_change,
  CASE WHEN h.old_value=0 THEN NULL ELSE ROUND(((h.new_value-h.old_value)/h.old_value)*100,2) END AS change_percent,
  h.calculation_score,h.fair_value,h.market_pulse_pct,h.change_source,h.valuation_batch_id,h.changed_at
FROM players p
LEFT JOIN player_market_value_history h ON h.id=(
  SELECT h2.id FROM player_market_value_history h2
  WHERE h2.player_id=p.id ORDER BY h2.changed_at DESC,h2.id DESC LIMIT 1
);

INSERT INTO system_settings(setting_key,setting_value,description) VALUES
('player_valuation_version','2.0.16','Dinh gia tu dong theo phong do, dong gop, MVP, diem, danh hieu va thanh tich quoc gia'),
('player_valuation_minimum','10000000','Gia toi thieu khi cau thu da co bang chung thanh tich'),
('player_valuation_market_pulse_limit_pct','1.75','Bien dong thi truong toi da moi ky dinh gia')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value),description=VALUES(description);

DROP PROCEDURE IF EXISTS frm_v216_require_previous;
DROP PROCEDURE IF EXISTS frm_v216_add_column;
DROP PROCEDURE IF EXISTS frm_v216_add_index;
DROP PROCEDURE IF EXISTS frm_v216_add_constraint;
SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES_V216;

SELECT
  CASE
    WHEN EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='player_valuation_batches')
     AND EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='players' AND column_name='valuation_score')
     AND EXISTS(SELECT 1 FROM system_settings WHERE setting_key='player_valuation_version' AND setting_value='2.0.16')
    THEN 'AUTOMATIC_PLAYER_VALUATION_V2_0_16_READY'
    ELSE 'AUTOMATIC_PLAYER_VALUATION_V2_0_16_INCOMPLETE'
  END AS result,
  (SELECT COUNT(*) FROM players) AS players_preserved,
  (SELECT COUNT(*) FROM player_market_value_history) AS value_history_preserved;
