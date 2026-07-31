/*
===============================================================================
 FOOTBALL RANK MANAGER 2.0.5
 - Đội hình CLB cố định tự động đăng ký vào giải
 - Cảnh báo CLB thiếu cầu thủ
 - Trao huy chương tập thể tự động
 - Bổ sung huy chương hồi tố cho các giải đã kết thúc
===============================================================================
 Chạy toàn bộ file này một lần trong MySQL Workbench trên database hiện tại.
===============================================================================
*/

USE football_rank_manager;
SET NAMES utf8mb4;

INSERT INTO system_settings(setting_key, setting_value, description)
VALUES ('MIN_ACTIVE_CLUB_PLAYERS', '11', 'Số cầu thủ hoạt động tối thiểu để CLB được xem là đủ đội hình')
ON DUPLICATE KEY UPDATE description = VALUES(description);

DELIMITER $$

DROP PROCEDURE IF EXISTS _frm_add_column_if_missing$$
CREATE PROCEDURE _frm_add_column_if_missing(
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
        SET @ddl = CONCAT('ALTER TABLE `', p_table_name, '` ADD COLUMN `', p_column_name, '` ', p_definition);
        PREPARE stmt FROM @ddl;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$

CALL _frm_add_column_if_missing(
    'competition_rosters',
    'registration_source',
    'ENUM(''AUTO_CLUB_ROSTER'',''CLUB_SYNC'',''ADMIN_RETROACTIVE'',''MANUAL'') NOT NULL DEFAULT ''MANUAL'' AFTER `status`'
)$$

CALL _frm_add_column_if_missing(
    'competition_participants',
    'last_roster_sync_at',
    'DATETIME(6) NULL AFTER `registered_at`'
)$$

CALL _frm_add_column_if_missing(
    'competition_participants',
    'roster_locked_at',
    'DATETIME(6) NULL AFTER `last_roster_sync_at`'
)$$

DROP PROCEDURE IF EXISTS _frm_add_column_if_missing$$

DROP PROCEDURE IF EXISTS sp_sync_competition_roster$$
CREATE PROCEDURE sp_sync_competition_roster(
    IN p_competition_id BIGINT UNSIGNED,
    IN p_club_id BIGINT UNSIGNED,
    IN p_user_id BIGINT UNSIGNED,
    IN p_source VARCHAR(30)
)
BEGIN
    DECLARE v_competition_status VARCHAR(40);
    DECLARE v_user_type VARCHAR(20);
    DECLARE v_user_club_id BIGINT UNSIGNED;
    DECLARE v_minimum_size INT DEFAULT 11;
    DECLARE v_official_count INT DEFAULT 0;
    DECLARE v_roster_count INT DEFAULT 0;

    SELECT status INTO v_competition_status
    FROM competitions
    WHERE id = p_competition_id;

    IF v_competition_status IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy giải đấu.';
    END IF;

    IF v_competition_status IN ('FINISHED','CANCELLED') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không thể đồng bộ đội hình của giải đã kết thúc hoặc bị hủy.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM competition_participants
        WHERE competition_id = p_competition_id
          AND club_id = p_club_id
          AND registration_status NOT IN ('WITHDRAWN','DISQUALIFIED')
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CLB chưa được thêm vào giải đấu.';
    END IF;

    SELECT account_type, club_id
      INTO v_user_type, v_user_club_id
    FROM users
    WHERE id = p_user_id AND is_active = TRUE;

    IF v_user_type IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tài khoản thao tác không hợp lệ.';
    END IF;

    IF v_user_type = 'CLUB' AND v_user_club_id <> p_club_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CLB chỉ được đồng bộ đội hình của chính mình.';
    END IF;

    SELECT COALESCE(CAST(setting_value AS UNSIGNED), 11)
      INTO v_minimum_size
    FROM system_settings
    WHERE setting_key = 'MIN_ACTIVE_CLUB_PLAYERS'
    LIMIT 1;

    SET v_minimum_size = COALESCE(v_minimum_size, 11);

    UPDATE competition_rosters cr
    LEFT JOIN players p ON p.id = cr.player_id
    SET cr.status = 'REMOVED'
    WHERE cr.competition_id = p_competition_id
      AND cr.club_id = p_club_id
      AND (
          p.id IS NULL
          OR p.club_id <> p_club_id
          OR p.status NOT IN ('ACTIVE','TRANSFER_LISTED')
      );

    INSERT INTO competition_rosters(
        competition_id,
        club_id,
        player_id,
        status,
        registration_source
    )
    SELECT
        p_competition_id,
        p_club_id,
        p.id,
        'ACTIVE',
        CASE
            WHEN p_source IN ('AUTO_CLUB_ROSTER','CLUB_SYNC','ADMIN_RETROACTIVE','MANUAL')
                THEN p_source
            ELSE 'CLUB_SYNC'
        END
    FROM players p
    WHERE p.club_id = p_club_id
      AND p.status IN ('ACTIVE','TRANSFER_LISTED')
    ON DUPLICATE KEY UPDATE
        club_id = VALUES(club_id),
        status = 'ACTIVE',
        registration_source = VALUES(registration_source);

    UPDATE competition_participants
    SET last_roster_sync_at = CURRENT_TIMESTAMP(6)
    WHERE competition_id = p_competition_id
      AND club_id = p_club_id;

    SELECT COUNT(*) INTO v_official_count
    FROM players
    WHERE club_id = p_club_id
      AND status IN ('ACTIVE','TRANSFER_LISTED');

    SELECT COUNT(*) INTO v_roster_count
    FROM competition_rosters
    WHERE competition_id = p_competition_id
      AND club_id = p_club_id
      AND status = 'ACTIVE';

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_user_id,
        'SYNC_COMPETITION_ROSTER',
        'competitions',
        p_competition_id,
        JSON_OBJECT(
            'club_id', p_club_id,
            'source', p_source,
            'official_roster_count', v_official_count,
            'competition_roster_count', v_roster_count,
            'minimum_required', v_minimum_size
        )
    );

    SELECT
        p_competition_id AS competition_id,
        p_club_id AS club_id,
        v_official_count AS official_roster_count,
        v_roster_count AS competition_roster_count,
        v_minimum_size AS minimum_required,
        GREATEST(v_minimum_size - v_official_count, 0) AS shortage_count,
        (v_official_count < v_minimum_size) AS has_warning;
END$$

DROP PROCEDURE IF EXISTS sp_auto_award_team_medals$$
CREATE PROCEDURE sp_auto_award_team_medals(
    IN p_competition_id BIGINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED,
    IN p_retroactive BOOLEAN
)
BEGIN
    DECLARE v_season_id BIGINT UNSIGNED;
    DECLARE v_season_name VARCHAR(100);
    DECLARE v_competition_name VARCHAR(180);
    DECLARE v_coefficient DECIMAL(8,3);
    DECLARE v_competition_start DATE;
    DECLARE v_competition_end DATE;
    DECLARE v_new_awards INT DEFAULT 0;
    DECLARE v_total_medal_players INT DEFAULT 0;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được trao huy chương tự động.';
    END IF;

    SELECT
        c.season_id,
        s.name,
        c.name,
        c.coefficient,
        COALESCE(c.starts_on, s.starts_on),
        COALESCE(c.ends_on, s.ends_on)
    INTO
        v_season_id,
        v_season_name,
        v_competition_name,
        v_coefficient,
        v_competition_start,
        v_competition_end
    FROM competitions c
    JOIN seasons s ON s.id = c.season_id
    WHERE c.id = p_competition_id;

    IF v_season_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy giải đấu.';
    END IF;

    /*
      Với giải cũ chưa đăng ký cầu thủ, khôi phục danh sách theo lịch sử CLB
      trong khoảng thời gian giải diễn ra. Các CLB chưa có lịch sử sẽ dùng
      đội hình hiện tại làm phương án dự phòng có kiểm soát.
    */
    INSERT INTO competition_rosters(
        competition_id,
        club_id,
        player_id,
        status,
        registration_source
    )
    SELECT DISTINCT
        p_competition_id,
        ca.club_id,
        pch.player_id,
        'ACTIVE',
        'ADMIN_RETROACTIVE'
    FROM club_achievements ca
    JOIN player_club_history pch ON pch.club_id = ca.club_id
    JOIN players p ON p.id = pch.player_id
    WHERE ca.competition_id = p_competition_id
      AND ca.medal_type IN ('GOLD','SILVER','BRONZE')
      AND pch.joined_at <= TIMESTAMP(v_competition_end, '23:59:59')
      AND (pch.left_at IS NULL OR pch.left_at >= TIMESTAMP(v_competition_start, '00:00:00'))
      AND NOT EXISTS (
          SELECT 1 FROM competition_rosters existing_active
          WHERE existing_active.competition_id = p_competition_id
            AND existing_active.club_id = ca.club_id
            AND existing_active.status = 'ACTIVE'
      )
    ON DUPLICATE KEY UPDATE
        club_id = VALUES(club_id),
        status = 'ACTIVE',
        registration_source = CASE
            WHEN registration_source = 'MANUAL'
                THEN registration_source
            ELSE 'ADMIN_RETROACTIVE'
        END;

    INSERT INTO competition_rosters(
        competition_id,
        club_id,
        player_id,
        status,
        registration_source
    )
    SELECT
        p_competition_id,
        ca.club_id,
        p.id,
        'ACTIVE',
        'ADMIN_RETROACTIVE'
    FROM club_achievements ca
    JOIN players p ON p.club_id = ca.club_id
    WHERE ca.competition_id = p_competition_id
      AND ca.medal_type IN ('GOLD','SILVER','BRONZE')
      AND p.status IN ('ACTIVE','TRANSFER_LISTED')
      AND NOT EXISTS (
          SELECT 1 FROM competition_rosters existing
          WHERE existing.competition_id = p_competition_id
            AND existing.club_id = ca.club_id
            AND existing.status = 'ACTIVE'
      )
    ON DUPLICATE KEY UPDATE
        club_id = VALUES(club_id),
        status = 'ACTIVE',
        registration_source = 'ADMIN_RETROACTIVE';

    INSERT INTO player_awards(
        player_id,
        club_id_at_award,
        competition_id,
        season_id,
        award_type_id,
        display_name,
        awarded_points,
        assigned_by_user_id,
        is_locked
    )
    SELECT
        cr.player_id,
        ca.club_id,
        p_competition_id,
        v_season_id,
        atp.id,
        CONCAT(atp.name, ' - ', v_competition_name, ' - ', v_season_name, ' (', cl.name, ')'),
        atp.base_ranking_points * v_coefficient,
        p_admin_user_id,
        TRUE
    FROM club_achievements ca
    JOIN clubs cl ON cl.id = ca.club_id
    JOIN award_types atp
      ON atp.category = 'TEAM_MEDAL'
     AND atp.required_medal_type = ca.medal_type
     AND atp.is_active = TRUE
    JOIN competition_rosters cr
      ON cr.competition_id = ca.competition_id
     AND cr.club_id = ca.club_id
     AND cr.status = 'ACTIVE'
    WHERE ca.competition_id = p_competition_id
      AND ca.medal_type IN ('GOLD','SILVER','BRONZE')
      AND NOT EXISTS (
          SELECT 1 FROM player_awards existing_award
          WHERE existing_award.player_id = cr.player_id
            AND existing_award.competition_id = p_competition_id
            AND existing_award.award_type_id = atp.id
      );

    SET v_new_awards = ROW_COUNT();

    INSERT INTO player_ranking_points(
        player_id,
        season_id,
        competition_id,
        source_type,
        source_id,
        points,
        description
    )
    SELECT
        pa.player_id,
        pa.season_id,
        pa.competition_id,
        'AWARD',
        pa.id,
        pa.awarded_points,
        pa.display_name
    FROM player_awards pa
    JOIN award_types atp ON atp.id = pa.award_type_id
    WHERE pa.competition_id = p_competition_id
      AND atp.category = 'TEAM_MEDAL'
      AND NOT EXISTS (
          SELECT 1 FROM player_ranking_points prp
          WHERE prp.source_type = 'AWARD'
            AND prp.source_id = pa.id
      );

    SELECT COUNT(*) INTO v_total_medal_players
    FROM player_awards pa
    JOIN award_types atp ON atp.id = pa.award_type_id
    WHERE pa.competition_id = p_competition_id
      AND atp.category = 'TEAM_MEDAL';

    UPDATE competition_participants cp
    SET cp.last_roster_sync_at = CURRENT_TIMESTAMP(6),
        cp.roster_locked_at = COALESCE(cp.roster_locked_at, CURRENT_TIMESTAMP(6))
    WHERE cp.competition_id = p_competition_id
      AND EXISTS (
          SELECT 1 FROM club_achievements ca
          WHERE ca.competition_id = cp.competition_id
            AND ca.club_id = cp.club_id
            AND ca.medal_type IN ('GOLD','SILVER','BRONZE')
      );

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        CASE WHEN p_retroactive THEN 'BACKFILL_TEAM_MEDALS' ELSE 'AUTO_ASSIGN_TEAM_MEDALS' END,
        'competitions',
        p_competition_id,
        JSON_OBJECT(
            'competition_name', v_competition_name,
            'season_name', v_season_name,
            'new_awards', v_new_awards,
            'total_team_medal_awards', v_total_medal_players,
            'retroactive', p_retroactive
        )
    );

    BEGIN
        DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
        CALL sp_snapshot_all_player_rankings(v_season_id);
    END;

    SELECT
        p_competition_id AS competition_id,
        v_competition_name AS competition_name,
        v_season_name AS season_name,
        v_new_awards AS new_awards,
        v_total_medal_players AS total_team_medal_awards;
END$$

DROP PROCEDURE IF EXISTS sp_backfill_all_finished_team_medals$$
CREATE PROCEDURE sp_backfill_all_finished_team_medals(
    IN p_admin_user_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_done INT DEFAULT 0;
    DECLARE v_competition_id BIGINT UNSIGNED;
    DECLARE v_processed INT DEFAULT 0;

    DECLARE cur_competitions CURSOR FOR
        SELECT DISTINCT c.id
        FROM competitions c
        JOIN club_achievements ca ON ca.competition_id = c.id
        WHERE c.status = 'FINISHED'
          AND ca.medal_type IN ('GOLD','SILVER','BRONZE')
        ORDER BY c.id;

    DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được bổ sung huy chương giải cũ.';
    END IF;

    OPEN cur_competitions;

    competition_loop: LOOP
        FETCH cur_competitions INTO v_competition_id;
        IF v_done = 1 THEN
            LEAVE competition_loop;
        END IF;

        CALL sp_auto_award_team_medals(v_competition_id, p_admin_user_id, TRUE);
        SET v_processed = v_processed + 1;
    END LOOP;

    CLOSE cur_competitions;

    SELECT v_processed AS processed_finished_competitions;
END$$

DELIMITER ;

/* Đồng bộ ngay đội hình cố định cho mọi CLB đang nằm trong giải chưa kết thúc. */
INSERT INTO competition_rosters(
    competition_id,
    club_id,
    player_id,
    status,
    registration_source
)
SELECT
    cp.competition_id,
    cp.club_id,
    p.id,
    'ACTIVE',
    'AUTO_CLUB_ROSTER'
FROM competition_participants cp
JOIN competitions c ON c.id = cp.competition_id
JOIN players p ON p.club_id = cp.club_id
WHERE cp.registration_status NOT IN ('WITHDRAWN','DISQUALIFIED')
  AND c.status NOT IN ('FINISHED','CANCELLED')
  AND p.status IN ('ACTIVE','TRANSFER_LISTED')
ON DUPLICATE KEY UPDATE
    club_id = VALUES(club_id),
    status = 'ACTIVE',
    registration_source = 'AUTO_CLUB_ROSTER';

UPDATE competition_participants cp
JOIN competitions c ON c.id = cp.competition_id
SET cp.last_roster_sync_at = CURRENT_TIMESTAMP(6)
WHERE cp.registration_status NOT IN ('WITHDRAWN','DISQUALIFIED')
  AND c.status NOT IN ('FINISHED','CANCELLED');

/* Bổ sung huy chương ngay cho toàn bộ giải cũ đã kết thúc. */
SET @frm_admin_id = (
    SELECT id FROM users
    WHERE account_type = 'FIFA_ADMIN' AND is_active = TRUE
    ORDER BY id LIMIT 1
);

CALL sp_backfill_all_finished_team_medals(@frm_admin_id);

/* Kiểm tra nhanh sau cập nhật. */
SELECT
    (SELECT COUNT(*) FROM competition_rosters WHERE status = 'ACTIVE') AS active_competition_roster_members,
    (SELECT COUNT(*) FROM player_awards pa JOIN award_types atp ON atp.id = pa.award_type_id WHERE atp.category = 'TEAM_MEDAL') AS player_team_medals,
    (SELECT COUNT(*) FROM player_ranking_points WHERE source_type = 'AWARD') AS player_award_ranking_rows;
