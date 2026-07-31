/* ========================================================================== */
/* FOOTBALL RANK MANAGER 2.0.6 - WORLD CUP 48 UPDATE                          */
/* Chạy một lần trên database football_rank_manager bằng MySQL Workbench.      */
/* Giữ nguyên toàn bộ dữ liệu và chức năng CLB hiện có.                        */
/* ========================================================================== */

USE football_rank_manager;

SET @OLD_SQL_SAFE_UPDATES = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

/* -------------------------------------------------------------------------- */
/* 1. Cho phép danh hiệu cầu thủ có bối cảnh đội tuyển quốc gia               */
/* -------------------------------------------------------------------------- */

ALTER TABLE player_awards
    MODIFY club_id_at_award BIGINT UNSIGNED NULL;

DELIMITER $$
DROP PROCEDURE IF EXISTS _frm_wc_add_column_if_missing$$
CREATE PROCEDURE _frm_wc_add_column_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_column_name VARCHAR(64),
    IN p_definition TEXT
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND COLUMN_NAME = p_column_name
    ) THEN
        SET @wc_ddl = CONCAT(
            'ALTER TABLE `', p_table_name, '` ADD COLUMN `', p_column_name, '` ', p_definition
        );
        PREPARE wc_stmt FROM @wc_ddl;
        EXECUTE wc_stmt;
        DEALLOCATE PREPARE wc_stmt;
    END IF;
END$$

CALL _frm_wc_add_column_if_missing(
    'player_awards',
    'award_context_type',
    'ENUM(''CLUB'',''NATIONAL_TEAM'') NOT NULL DEFAULT ''CLUB'' AFTER `club_id_at_award`'
)$$
CALL _frm_wc_add_column_if_missing(
    'player_awards',
    'country_name_at_award',
    'VARCHAR(120) NULL AFTER `award_context_type`'
)$$
CALL _frm_wc_add_column_if_missing(
    'player_awards',
    'country_code_at_award',
    'VARCHAR(8) NULL AFTER `country_name_at_award`'
)$$
DROP PROCEDURE IF EXISTS _frm_wc_add_column_if_missing$$
DELIMITER ;

/* -------------------------------------------------------------------------- */
/* 2. Hồ sơ quốc gia cố định của từng cầu thủ                                 */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS player_national_profiles (
    player_id          BIGINT UNSIGNED PRIMARY KEY,
    country_name       VARCHAR(120) NOT NULL,
    country_code       VARCHAR(8) NOT NULL,
    flag_url           VARCHAR(500) NULL,
    confederation      ENUM('AFC','CAF','CONCACAF','CONMEBOL','OFC','UEFA','OTHER')
                       NOT NULL DEFAULT 'OTHER',
    world_seed_rank    SMALLINT UNSIGNED NULL,
    is_active          BOOLEAN NOT NULL DEFAULT TRUE,
    created_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                      ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_national_profile_country_name UNIQUE (country_name),
    CONSTRAINT uq_national_profile_country_code UNIQUE (country_code),
    CONSTRAINT fk_national_profile_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_national_profile_seed CHECK (
        world_seed_rank IS NULL OR world_seed_rank BETWEEN 1 AND 999
    )
) ENGINE=InnoDB;

/* -------------------------------------------------------------------------- */
/* 3. Hồ sơ giải World Cup 48                                                 */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS world_cup_profiles (
    competition_id          BIGINT UNSIGNED PRIMARY KEY,
    participant_count       SMALLINT UNSIGNED NOT NULL DEFAULT 48,
    group_count             SMALLINT UNSIGNED NOT NULL DEFAULT 12,
    teams_per_group         SMALLINT UNSIGNED NOT NULL DEFAULT 4,
    direct_advance_per_group SMALLINT UNSIGNED NOT NULL DEFAULT 2,
    best_third_count        SMALLINT UNSIGNED NOT NULL DEFAULT 8,
    knockout_size           SMALLINT UNSIGNED NOT NULL DEFAULT 32,
    draw_mode               ENUM('POTS','FULL_RANDOM') NOT NULL DEFAULT 'POTS',
    pairing_mode            ENUM('SEEDED_CONSTRAINED','FULL_RANDOM')
                            NOT NULL DEFAULT 'SEEDED_CONSTRAINED',
    visual_theme            ENUM('COSMIC_GOLD','AURORA_BLUE','ROYAL_PURPLE')
                            NOT NULL DEFAULT 'COSMIC_GOLD',
    gold_prize_amount       DECIMAL(20,0) NOT NULL DEFAULT 0,
    silver_prize_amount     DECIMAL(20,0) NOT NULL DEFAULT 0,
    bronze_prize_amount     DECIMAL(20,0) NOT NULL DEFAULT 0,
    champion_upset_points   DECIMAL(20,3) NOT NULL DEFAULT 25,
    runnerup_upset_points   DECIMAL(20,3) NOT NULL DEFAULT 15,
    max_champion_upsets     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    max_runnerup_upsets     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    entries_locked_at       DATETIME(6) NULL,
    groups_drawn_at         DATETIME(6) NULL,
    groups_finalized_at     DATETIME(6) NULL,
    tournament_finalized_at DATETIME(6) NULL,
    created_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                           ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_world_cup_profile_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_world_cup_fixed_format CHECK (
        participant_count = 48
        AND group_count = 12
        AND teams_per_group = 4
        AND direct_advance_per_group = 2
        AND best_third_count = 8
        AND knockout_size = 32
    ),
    CONSTRAINT chk_world_cup_upset_points CHECK (
        champion_upset_points >= 0 AND runnerup_upset_points >= 0
    ),
    CONSTRAINT chk_world_cup_prizes CHECK (
        gold_prize_amount >= 0 AND silver_prize_amount >= 0 AND bronze_prize_amount >= 0
    )
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS world_cup_entries (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    player_id           BIGINT UNSIGNED NOT NULL,
    country_name        VARCHAR(120) NOT NULL,
    country_code        VARCHAR(8) NOT NULL,
    flag_url            VARCHAR(500) NULL,
    confederation       ENUM('AFC','CAF','CONCACAF','CONMEBOL','OFC','UEFA','OTHER')
                        NOT NULL DEFAULT 'OTHER',
    seed_rank           SMALLINT UNSIGNED NULL,
    pot_no              TINYINT UNSIGNED NULL,
    status              ENUM('REGISTERED','APPROVED','WITHDRAWN','DISQUALIFIED')
                        NOT NULL DEFAULT 'APPROVED',
    registered_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_world_cup_entry_player UNIQUE (competition_id, player_id),
    CONSTRAINT uq_world_cup_entry_country_name UNIQUE (competition_id, country_name),
    CONSTRAINT uq_world_cup_entry_country_code UNIQUE (competition_id, country_code),
    CONSTRAINT fk_world_cup_entry_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_entry_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_world_cup_entry_seed CHECK (seed_rank IS NULL OR seed_rank BETWEEN 1 AND 999),
    CONSTRAINT chk_world_cup_entry_pot CHECK (pot_no IS NULL OR pot_no BETWEEN 1 AND 4)
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS world_cup_groups (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    group_code          CHAR(1) NOT NULL,
    display_name        VARCHAR(50) NOT NULL,
    display_order       TINYINT UNSIGNED NOT NULL,
    CONSTRAINT uq_world_cup_group_code UNIQUE (competition_id, group_code),
    CONSTRAINT uq_world_cup_group_order UNIQUE (competition_id, display_order),
    CONSTRAINT fk_world_cup_group_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS world_cup_group_members (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    group_id            BIGINT UNSIGNED NOT NULL,
    entry_id            BIGINT UNSIGNED NOT NULL,
    slot_no             TINYINT UNSIGNED NOT NULL,
    CONSTRAINT uq_world_cup_group_entry UNIQUE (group_id, entry_id),
    CONSTRAINT uq_world_cup_group_slot UNIQUE (group_id, slot_no),
    CONSTRAINT uq_world_cup_entry_one_group UNIQUE (entry_id),
    CONSTRAINT fk_world_cup_group_member_group FOREIGN KEY (group_id) REFERENCES world_cup_groups(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_group_member_entry FOREIGN KEY (entry_id) REFERENCES world_cup_entries(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_world_cup_group_slot CHECK (slot_no BETWEEN 1 AND 4)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS world_cup_rounds (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    round_code          ENUM('R32','R16','QF','SF','THIRD','FINAL') NOT NULL,
    round_name          VARCHAR(60) NOT NULL,
    round_order         TINYINT UNSIGNED NOT NULL,
    team_count          SMALLINT UNSIGNED NOT NULL,
    match_count         SMALLINT UNSIGNED NOT NULL,
    status              ENUM('PENDING','IN_PROGRESS','FINISHED') NOT NULL DEFAULT 'PENDING',
    CONSTRAINT uq_world_cup_round_code UNIQUE (competition_id, round_code),
    CONSTRAINT uq_world_cup_round_order UNIQUE (competition_id, round_order),
    CONSTRAINT fk_world_cup_round_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS world_cup_matches (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    stage_type          ENUM('GROUP','KNOCKOUT') NOT NULL,
    group_id            BIGINT UNSIGNED NULL,
    round_id            BIGINT UNSIGNED NULL,
    match_no            SMALLINT UNSIGNED NOT NULL,
    home_entry_id       BIGINT UNSIGNED NULL,
    away_entry_id       BIGINT UNSIGNED NULL,
    home_score          SMALLINT UNSIGNED NULL,
    away_score          SMALLINT UNSIGNED NULL,
    home_penalty_score  SMALLINT UNSIGNED NULL,
    away_penalty_score  SMALLINT UNSIGNED NULL,
    winner_entry_id     BIGINT UNSIGNED NULL,
    loser_entry_id      BIGINT UNSIGNED NULL,
    status              ENUM('SCHEDULED','LIVE','FINISHED','CANCELLED')
                        NOT NULL DEFAULT 'SCHEDULED',
    highlighted_upset   BOOLEAN NOT NULL DEFAULT FALSE,
    note                VARCHAR(500) NULL,
    scheduled_at        DATETIME(6) NULL,
    finished_at         DATETIME(6) NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                         ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_world_cup_group_match UNIQUE (competition_id, stage_type, group_id, match_no),
    CONSTRAINT uq_world_cup_round_match UNIQUE (competition_id, stage_type, round_id, match_no),
    CONSTRAINT fk_world_cup_match_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_match_group FOREIGN KEY (group_id) REFERENCES world_cup_groups(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_match_round FOREIGN KEY (round_id) REFERENCES world_cup_rounds(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_match_home FOREIGN KEY (home_entry_id) REFERENCES world_cup_entries(id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_world_cup_match_away FOREIGN KEY (away_entry_id) REFERENCES world_cup_entries(id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_world_cup_match_winner FOREIGN KEY (winner_entry_id) REFERENCES world_cup_entries(id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT fk_world_cup_match_loser FOREIGN KEY (loser_entry_id) REFERENCES world_cup_entries(id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT chk_world_cup_match_teams CHECK (
        home_entry_id IS NULL OR away_entry_id IS NULL OR home_entry_id <> away_entry_id
    ),
    CONSTRAINT chk_world_cup_match_scores CHECK (
        home_score IS NULL OR away_score IS NULL OR (home_score >= 0 AND away_score >= 0)
    )
) ENGINE=InnoDB;


CREATE TABLE IF NOT EXISTS world_cup_match_links (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_match_id     BIGINT UNSIGNED NOT NULL,
    source_result       ENUM('WINNER','LOSER') NOT NULL DEFAULT 'WINNER',
    target_match_id     BIGINT UNSIGNED NOT NULL,
    target_slot         ENUM('HOME','AWAY') NOT NULL,
    CONSTRAINT uq_world_cup_match_link UNIQUE (source_match_id, source_result),
    CONSTRAINT uq_world_cup_target_slot UNIQUE (target_match_id, target_slot),
    CONSTRAINT fk_world_cup_link_source FOREIGN KEY (source_match_id) REFERENCES world_cup_matches(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_link_target FOREIGN KEY (target_match_id) REFERENCES world_cup_matches(id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS world_cup_qualified_entries (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    entry_id            BIGINT UNSIGNED NOT NULL,
    group_id            BIGINT UNSIGNED NOT NULL,
    group_rank          TINYINT UNSIGNED NOT NULL,
    qualification_type  ENUM('GROUP_WINNER','RUNNER_UP','BEST_THIRD') NOT NULL,
    overall_seed        TINYINT UNSIGNED NOT NULL,
    points              SMALLINT NOT NULL DEFAULT 0,
    goal_difference     SMALLINT NOT NULL DEFAULT 0,
    goals_for           SMALLINT NOT NULL DEFAULT 0,
    CONSTRAINT uq_world_cup_qualified_entry UNIQUE (competition_id, entry_id),
    CONSTRAINT uq_world_cup_qualified_seed UNIQUE (competition_id, overall_seed),
    CONSTRAINT fk_world_cup_qualified_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_qualified_entry FOREIGN KEY (entry_id) REFERENCES world_cup_entries(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_qualified_group FOREIGN KEY (group_id) REFERENCES world_cup_groups(id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS world_cup_results (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    entry_id            BIGINT UNSIGNED NOT NULL,
    placement           TINYINT UNSIGNED NOT NULL,
    medal_type          ENUM('GOLD','SILVER','BRONZE','NONE') NOT NULL DEFAULT 'NONE',
    ranking_points      DECIMAL(20,3) NOT NULL DEFAULT 0,
    confirmed_by_user_id BIGINT UNSIGNED NOT NULL,
    confirmed_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_world_cup_result_entry UNIQUE (competition_id, entry_id),
    CONSTRAINT fk_world_cup_result_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_result_entry FOREIGN KEY (entry_id) REFERENCES world_cup_entries(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_result_user FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_world_cup_result_placement CHECK (placement BETWEEN 1 AND 32),
    CONSTRAINT chk_world_cup_result_points CHECK (ranking_points >= 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS world_cup_upset_rewards (
    id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id        BIGINT UNSIGNED NOT NULL,
    match_id              BIGINT UNSIGNED NOT NULL,
    winning_entry_id      BIGINT UNSIGNED NOT NULL,
    defeated_entry_id     BIGINT UNSIGNED NOT NULL,
    defeated_previous_placement ENUM('CHAMPION','RUNNER_UP') NOT NULL,
    awarded_points        DECIMAL(20,3) NOT NULL,
    created_at            DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_world_cup_upset_match UNIQUE (match_id),
    CONSTRAINT fk_world_cup_upset_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_upset_match FOREIGN KEY (match_id) REFERENCES world_cup_matches(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_upset_winner FOREIGN KEY (winning_entry_id) REFERENCES world_cup_entries(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_world_cup_upset_defeated FOREIGN KEY (defeated_entry_id) REFERENCES world_cup_entries(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_world_cup_upset_points CHECK (awarded_points >= 0)
) ENGINE=InnoDB;

/* Chỉ mục hỗ trợ truy vấn; có thể chạy lại migration an toàn. */
DELIMITER $$
DROP PROCEDURE IF EXISTS _frm_wc_add_index_if_missing$$
CREATE PROCEDURE _frm_wc_add_index_if_missing(
    IN p_table_name VARCHAR(64),
    IN p_index_name VARCHAR(64),
    IN p_index_columns VARCHAR(500)
)
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = p_table_name
          AND INDEX_NAME = p_index_name
    ) THEN
        SET @wc_index_ddl = CONCAT(
            'CREATE INDEX `', p_index_name, '` ON `', p_table_name, '` (', p_index_columns, ')'
        );
        PREPARE wc_index_stmt FROM @wc_index_ddl;
        EXECUTE wc_index_stmt;
        DEALLOCATE PREPARE wc_index_stmt;
    END IF;
END$$
CALL _frm_wc_add_index_if_missing(
    'world_cup_entries', 'idx_world_cup_entries_comp_status', '`competition_id`,`status`,`seed_rank`'
)$$
CALL _frm_wc_add_index_if_missing(
    'world_cup_matches', 'idx_world_cup_matches_comp_stage', '`competition_id`,`stage_type`,`status`'
)$$
DROP PROCEDURE IF EXISTS _frm_wc_add_index_if_missing$$
DELIMITER ;

/* -------------------------------------------------------------------------- */
/* 4. View BXH vòng bảng World Cup                                            */
/* -------------------------------------------------------------------------- */

CREATE OR REPLACE VIEW v_world_cup_group_standings AS
SELECT ranked.*,
       ROW_NUMBER() OVER (
           PARTITION BY ranked.group_id
           ORDER BY ranked.points DESC,
                    ranked.goal_difference DESC,
                    ranked.goals_for DESC,
                    ranked.wins DESC,
                    ranked.seed_rank ASC,
                    ranked.entry_id ASC
       ) AS group_rank
FROM (
    SELECT
        g.competition_id,
        g.id AS group_id,
        g.group_code,
        g.display_name,
        g.display_order,
        e.id AS entry_id,
        e.player_id,
        e.country_name,
        e.country_code,
        e.flag_url,
        e.confederation,
        e.seed_rank,
        gm.slot_no,
        COUNT(m.id) AS played,
        SUM(CASE
            WHEN m.id IS NULL THEN 0
            WHEN m.home_score = m.away_score THEN 0
            WHEN (m.home_entry_id = e.id AND m.home_score > m.away_score)
              OR (m.away_entry_id = e.id AND m.away_score > m.home_score) THEN 1
            ELSE 0 END) AS wins,
        SUM(CASE WHEN m.id IS NOT NULL AND m.home_score = m.away_score THEN 1 ELSE 0 END) AS draws,
        SUM(CASE
            WHEN m.id IS NULL THEN 0
            WHEN m.home_score = m.away_score THEN 0
            WHEN (m.home_entry_id = e.id AND m.home_score < m.away_score)
              OR (m.away_entry_id = e.id AND m.away_score < m.home_score) THEN 1
            ELSE 0 END) AS losses,
        COALESCE(SUM(CASE
            WHEN m.home_entry_id = e.id THEN m.home_score
            WHEN m.away_entry_id = e.id THEN m.away_score
            ELSE 0 END), 0) AS goals_for,
        COALESCE(SUM(CASE
            WHEN m.home_entry_id = e.id THEN m.away_score
            WHEN m.away_entry_id = e.id THEN m.home_score
            ELSE 0 END), 0) AS goals_against,
        COALESCE(SUM(CASE
            WHEN m.home_entry_id = e.id THEN m.home_score - m.away_score
            WHEN m.away_entry_id = e.id THEN m.away_score - m.home_score
            ELSE 0 END), 0) AS goal_difference,
        COALESCE(SUM(CASE
            WHEN m.id IS NULL THEN 0
            WHEN m.home_score = m.away_score THEN 1
            WHEN (m.home_entry_id = e.id AND m.home_score > m.away_score)
              OR (m.away_entry_id = e.id AND m.away_score > m.home_score) THEN 3
            ELSE 0 END), 0) AS points
    FROM world_cup_group_members gm
    JOIN world_cup_groups g ON g.id = gm.group_id
    JOIN world_cup_entries e ON e.id = gm.entry_id
    LEFT JOIN world_cup_matches m
      ON m.group_id = g.id
     AND m.stage_type = 'GROUP'
     AND m.status = 'FINISHED'
     AND (m.home_entry_id = e.id OR m.away_entry_id = e.id)
    GROUP BY
        g.competition_id, g.id, g.group_code, g.display_name, g.display_order,
        e.id, e.player_id, e.country_name, e.country_code, e.flag_url,
        e.confederation, e.seed_rank, gm.slot_no
) ranked;

/* -------------------------------------------------------------------------- */
/* 5. Danh hiệu World Cup                                                     */
/* -------------------------------------------------------------------------- */

INSERT INTO award_types(code, name, category, required_medal_type, base_ranking_points, is_active)
VALUES
    ('WORLD_CUP_GOLD',   'Huy chương vàng World Cup', 'TEAM_MEDAL', 'GOLD',   120, TRUE),
    ('WORLD_CUP_SILVER', 'Huy chương bạc World Cup',  'TEAM_MEDAL', 'SILVER', 80, TRUE),
    ('WORLD_CUP_BRONZE', 'Huy chương đồng World Cup', 'TEAM_MEDAL', 'BRONZE', 55, TRUE)
ON DUPLICATE KEY UPDATE
    name = VALUES(name),
    category = VALUES(category),
    required_medal_type = VALUES(required_medal_type),
    base_ranking_points = VALUES(base_ranking_points),
    is_active = TRUE;

/* -------------------------------------------------------------------------- */
/* 6. Cập nhật trigger trao danh hiệu                                          */
/* -------------------------------------------------------------------------- */

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

    SELECT account_type, club_id
      INTO v_user_type, v_user_club
    FROM users
    WHERE id = NEW.assigned_by_user_id AND is_active = TRUE;

    IF v_user_type IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Tài khoản trao danh hiệu không hợp lệ.';
    END IF;

    SELECT category, required_medal_type
      INTO v_award_category, v_required_medal_type
    FROM award_types
    WHERE id = NEW.award_type_id AND is_active = TRUE;

    IF v_award_category IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Loại danh hiệu không tồn tại hoặc đã bị khóa.';
    END IF;

    IF NEW.award_context_type = 'NATIONAL_TEAM' THEN
        IF v_user_type <> 'FIFA_ADMIN' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Danh hiệu đội tuyển quốc gia chỉ do Admin FIFA trao.';
        END IF;

        IF NEW.club_id_at_award IS NOT NULL
           OR NEW.country_name_at_award IS NULL
           OR NEW.country_code_at_award IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Danh hiệu đội tuyển phải có tên/mã quốc gia và không gắn CLB.';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM world_cup_entries wce
            WHERE wce.competition_id = NEW.competition_id
              AND wce.player_id = NEW.player_id
              AND wce.country_code = NEW.country_code_at_award
        ) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cầu thủ không thuộc danh sách quốc gia của World Cup này.';
        END IF;
    ELSE
        IF NEW.club_id_at_award IS NULL THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Danh hiệu CLB phải có CLB tại thời điểm nhận.';
        END IF;

        IF v_user_type = 'CLUB' AND v_user_club <> NEW.club_id_at_award THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Tài khoản CLB không được trao danh hiệu cho CLB khác.';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM competition_rosters cr
            WHERE cr.competition_id = NEW.competition_id
              AND cr.club_id = NEW.club_id_at_award
              AND cr.player_id = NEW.player_id
              AND cr.status = 'ACTIVE'
        ) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Cầu thủ không thuộc danh sách đăng ký của CLB tại giải này.';
        END IF;

        IF v_award_category <> 'TEAM_MEDAL' AND v_user_type <> 'FIFA_ADMIN' THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Danh hiệu cá nhân chỉ do Admin FIFA trao.';
        END IF;

        IF v_award_category = 'TEAM_MEDAL' AND NOT EXISTS (
            SELECT 1 FROM club_achievements ca
            WHERE ca.club_id = NEW.club_id_at_award
              AND ca.competition_id = NEW.competition_id
              AND ca.medal_type = v_required_medal_type
        ) THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Loại huy chương cầu thủ không khớp huy chương chính thức của CLB.';
        END IF;
    END IF;
END$$
DELIMITER ;

/* -------------------------------------------------------------------------- */
/* 7. View lịch sử danh hiệu hỗ trợ cả CLB và quốc gia                        */
/* -------------------------------------------------------------------------- */

CREATE OR REPLACE VIEW v_player_award_history AS
SELECT
    pa.id AS player_award_id,
    pa.player_id,
    p.full_name,
    pa.club_id_at_award,
    c.name AS club_name_at_award,
    pa.award_context_type,
    pa.country_name_at_award,
    pa.country_code_at_award,
    CASE
        WHEN pa.award_context_type = 'NATIONAL_TEAM' THEN pa.country_name_at_award
        ELSE c.name
    END AS representing_name_at_award,
    pa.competition_id,
    comp.name AS competition_name,
    pa.season_id,
    s.name AS season_name,
    pa.award_type_id,
    atp.code AS award_code,
    atp.name AS award_name,
    atp.category,
    atp.required_medal_type,
    pa.display_name,
    pa.awarded_points,
    pa.awarded_at
FROM player_awards pa
JOIN players p ON p.id = pa.player_id
LEFT JOIN clubs c ON c.id = pa.club_id_at_award
JOIN competitions comp ON comp.id = pa.competition_id
JOIN seasons s ON s.id = pa.season_id
JOIN award_types atp ON atp.id = pa.award_type_id;

SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES;

SELECT
    'WORLD_CUP_48_READY' AS status,
    (SELECT COUNT(*) FROM world_cup_profiles) AS world_cup_count,
    (SELECT COUNT(*) FROM award_types WHERE code LIKE 'WORLD_CUP_%') AS world_cup_award_types;
