/*
===============================================================================
 FOOTBALL RANK MANAGER - FULL DATABASE INSTALLER V3
 Target: MySQL Server 8.0.16+ / MySQL Workbench (Safe Updates compatible)
 Character set: utf8mb4

 IMPORTANT:
 - This development installer DROPS the database when rerun.
 - Database name: football_rank_manager
 - Money uses DECIMAL(20,0), suitable for integer VND-like amounts.
 - Player/staff do not need login accounts.
 - Each club has one shared login account.
 - All balances are managed through wallets and immutable transactions.
===============================================================================
*/

SET NAMES utf8mb4;
SET TIME_ZONE = '+07:00';

/* Preserve the Workbench session setting, then disable Safe Updates only for this installer. */
SET @OLD_SQL_SAFE_UPDATES = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

/* Drop the development database only when it exists, avoiding warning 1008 on first install. */
SET @DB_EXISTS = (
    SELECT COUNT(*)
    FROM information_schema.schemata
    WHERE schema_name = 'football_rank_manager'
);
SET @DROP_DATABASE_SQL = IF(
    @DB_EXISTS > 0,
    'DROP DATABASE football_rank_manager',
    'DO 0'
);
PREPARE stmt_drop_database FROM @DROP_DATABASE_SQL;
EXECUTE stmt_drop_database;
DEALLOCATE PREPARE stmt_drop_database;

CREATE DATABASE football_rank_manager
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
USE football_rank_manager;

/* ========================================================================== */
/* 1. CORE CONFIGURATION                                                       */
/* ========================================================================== */

CREATE TABLE system_settings (
    setting_key        VARCHAR(100) PRIMARY KEY,
    setting_value      VARCHAR(500) NOT NULL,
    description        VARCHAR(500) NULL,
    updated_at         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                      ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE seasons (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name                VARCHAR(100) NOT NULL,
    sequence_no         INT UNSIGNED NOT NULL,
    starts_on           DATE NOT NULL,
    ends_on             DATE NOT NULL,
    status              ENUM('DRAFT','ACTIVE','FINISHED') NOT NULL DEFAULT 'DRAFT',
    salary_processed_at DATETIME(6) NULL,
    closed_at           DATETIME(6) NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                         ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_seasons_name UNIQUE (name),
    CONSTRAINT uq_seasons_sequence UNIQUE (sequence_no),
    CONSTRAINT chk_seasons_dates CHECK (ends_on >= starts_on)
) ENGINE=InnoDB;

CREATE TABLE clubs (
    id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code                 VARCHAR(30) NOT NULL,
    name                 VARCHAR(150) NOT NULL,
    short_name           VARCHAR(50) NOT NULL,
    logo_url             VARCHAR(500) NULL,
    registration_status  ENUM('PENDING','APPROVED','REJECTED','SUSPENDED')
                         NOT NULL DEFAULT 'PENDING',
    is_active            BOOLEAN NOT NULL DEFAULT TRUE,
    approved_at          DATETIME(6) NULL,
    created_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                          ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_clubs_code UNIQUE (code),
    CONSTRAINT uq_clubs_name UNIQUE (name)
) ENGINE=InnoDB;

CREATE TABLE users (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username            VARCHAR(80) NOT NULL,
    password_hash       VARCHAR(255) NOT NULL,
    password_scheme     ENUM('BCRYPT','ARGON2','SHA256_DEMO') NOT NULL DEFAULT 'BCRYPT',
    account_type        ENUM('FIFA_ADMIN','CLUB') NOT NULL,
    club_id             BIGINT UNSIGNED NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at       DATETIME(6) NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                         ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_users_username UNIQUE (username),
    CONSTRAINT uq_users_one_account_per_club UNIQUE (club_id),
    CONSTRAINT fk_users_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

/* ========================================================================== */
/* 2. PLAYERS, STAFF AND CONTRACTS                                             */
/* ========================================================================== */

CREATE TABLE players (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name           VARCHAR(150) NOT NULL,
    position            ENUM('GK','DF','MF','FW') NOT NULL,
    shirt_number        TINYINT UNSIGNED NULL,
    club_id             BIGINT UNSIGNED NULL,
    market_value        DECIMAL(20,0) NOT NULL DEFAULT 0,
    status              ENUM('ACTIVE','FREE_AGENT','TRANSFER_LISTED','RETIRED','SUSPENDED')
                        NOT NULL DEFAULT 'FREE_AGENT',
    photo_url           VARCHAR(500) NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                         ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_players_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    CONSTRAINT uq_players_club_shirt UNIQUE (club_id, shirt_number),
    CONSTRAINT chk_players_market_value CHECK (market_value >= 0),
    CONSTRAINT chk_players_shirt_number CHECK (shirt_number IS NULL OR shirt_number BETWEEN 1 AND 99)
) ENGINE=InnoDB;

CREATE TABLE coaching_staff (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name           VARCHAR(150) NOT NULL,
    staff_role          VARCHAR(100) NOT NULL,
    club_id             BIGINT UNSIGNED NULL,
    status              ENUM('ACTIVE','FREE_AGENT','RETIRED','SUSPENDED')
                        NOT NULL DEFAULT 'FREE_AGENT',
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                         ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_staff_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE player_contracts (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id           BIGINT UNSIGNED NOT NULL,
    club_id             BIGINT UNSIGNED NOT NULL,
    start_season_id     BIGINT UNSIGNED NOT NULL,
    end_season_id       BIGINT UNSIGNED NULL,
    salary_per_season   DECIMAL(20,0) NOT NULL,
    status              ENUM('ACTIVE','EXPIRED','TERMINATED') NOT NULL DEFAULT 'ACTIVE',
    signed_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    ended_at            DATETIME(6) NULL,
    note                VARCHAR(500) NULL,
    CONSTRAINT fk_player_contract_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_contract_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_contract_start_season FOREIGN KEY (start_season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_contract_end_season FOREIGN KEY (end_season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_player_contract_salary CHECK (salary_per_season >= 0)
) ENGINE=InnoDB;

CREATE INDEX idx_player_contract_active ON player_contracts(player_id, status);
CREATE INDEX idx_player_contract_club ON player_contracts(club_id, status);

CREATE TABLE staff_contracts (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    staff_id            BIGINT UNSIGNED NOT NULL,
    club_id             BIGINT UNSIGNED NOT NULL,
    start_season_id     BIGINT UNSIGNED NOT NULL,
    end_season_id       BIGINT UNSIGNED NULL,
    salary_per_season   DECIMAL(20,0) NOT NULL,
    status              ENUM('ACTIVE','EXPIRED','TERMINATED') NOT NULL DEFAULT 'ACTIVE',
    signed_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    ended_at            DATETIME(6) NULL,
    note                VARCHAR(500) NULL,
    CONSTRAINT fk_staff_contract_staff FOREIGN KEY (staff_id) REFERENCES coaching_staff(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_staff_contract_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_staff_contract_start_season FOREIGN KEY (start_season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_staff_contract_end_season FOREIGN KEY (end_season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_staff_contract_salary CHECK (salary_per_season >= 0)
) ENGINE=InnoDB;

CREATE INDEX idx_staff_contract_active ON staff_contracts(staff_id, status);
CREATE INDEX idx_staff_contract_club ON staff_contracts(club_id, status);

CREATE TABLE player_club_history (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id           BIGINT UNSIGNED NOT NULL,
    club_id             BIGINT UNSIGNED NOT NULL,
    joined_at           DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    left_at             DATETIME(6) NULL,
    movement_type       ENUM('INITIAL','TRANSFER','FREE_TRANSFER','RELEASE','CONTRACT_EXPIRY')
                        NOT NULL DEFAULT 'INITIAL',
    note                VARCHAR(500) NULL,
    CONSTRAINT fk_player_history_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_history_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_player_history_lookup ON player_club_history(player_id, joined_at, left_at);

/* ========================================================================== */
/* 3. WALLET AND IMMUTABLE FINANCIAL LEDGER                                    */
/* ========================================================================== */

CREATE TABLE wallets (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    wallet_code         VARCHAR(80) NOT NULL,
    wallet_type         ENUM('FIFA','CLUB','PLAYER','STAFF') NOT NULL,
    club_id             BIGINT UNSIGNED NULL,
    player_id           BIGINT UNSIGNED NULL,
    staff_id            BIGINT UNSIGNED NULL,
    balance             DECIMAL(20,0) NOT NULL DEFAULT 0,
    status              ENUM('ACTIVE','LOCKED','CLOSED') NOT NULL DEFAULT 'ACTIVE',
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                         ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_wallets_code UNIQUE (wallet_code),
    CONSTRAINT uq_wallets_club UNIQUE (club_id),
    CONSTRAINT uq_wallets_player UNIQUE (player_id),
    CONSTRAINT uq_wallets_staff UNIQUE (staff_id),
    CONSTRAINT fk_wallets_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wallets_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wallets_staff FOREIGN KEY (staff_id) REFERENCES coaching_staff(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_wallets_balance CHECK (balance >= 0)
) ENGINE=InnoDB;

CREATE TABLE wallet_transactions (
    id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    transaction_code         VARCHAR(80) NOT NULL,
    transfer_group_code      VARCHAR(80) NULL,
    wallet_id                BIGINT UNSIGNED NOT NULL,
    counterparty_wallet_id   BIGINT UNSIGNED NULL,
    direction                ENUM('CREDIT','DEBIT') NOT NULL,
    transaction_type         ENUM(
                                'DEPOSIT','WITHDRAWAL','SALARY','STAFF_SALARY',
                                'PRIZE','TRANSFER_FEE','UPSET_REWARD','ENTRY_FEE',
                                'PENALTY','BONUS','ADJUSTMENT','REVERSAL','REFUND'
                             ) NOT NULL,
    amount                   DECIMAL(20,0) NOT NULL,
    balance_before           DECIMAL(20,0) NOT NULL,
    balance_after            DECIMAL(20,0) NOT NULL,
    reference_table          VARCHAR(80) NULL,
    reference_id             BIGINT UNSIGNED NULL,
    reversal_of_transaction_id BIGINT UNSIGNED NULL,
    note                     VARCHAR(500) NULL,
    created_by_user_id       BIGINT UNSIGNED NULL,
    created_at               DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_wallet_transactions_code UNIQUE (transaction_code),
    CONSTRAINT fk_wallet_tx_wallet FOREIGN KEY (wallet_id) REFERENCES wallets(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wallet_tx_counterparty FOREIGN KEY (counterparty_wallet_id) REFERENCES wallets(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wallet_tx_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_wallet_tx_reversal FOREIGN KEY (reversal_of_transaction_id) REFERENCES wallet_transactions(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_wallet_tx_amount CHECK (amount > 0),
    CONSTRAINT chk_wallet_tx_balances CHECK (balance_before >= 0 AND balance_after >= 0)
) ENGINE=InnoDB;

CREATE INDEX idx_wallet_tx_wallet_time ON wallet_transactions(wallet_id, created_at);
CREATE INDEX idx_wallet_tx_group ON wallet_transactions(transfer_group_code);
CREATE INDEX idx_wallet_tx_reference ON wallet_transactions(reference_table, reference_id);

CREATE TABLE player_market_value_history (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id           BIGINT UNSIGNED NOT NULL,
    old_value           DECIMAL(20,0) NOT NULL,
    new_value           DECIMAL(20,0) NOT NULL,
    changed_by_user_id  BIGINT UNSIGNED NULL,
    reason              VARCHAR(500) NULL,
    changed_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_value_history_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_value_history_user FOREIGN KEY (changed_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_value_history_values CHECK (old_value >= 0 AND new_value >= 0)
) ENGINE=InnoDB;

CREATE TABLE salary_payments (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    season_id           BIGINT UNSIGNED NOT NULL,
    recipient_type      ENUM('PLAYER','STAFF') NOT NULL,
    player_contract_id  BIGINT UNSIGNED NULL,
    staff_contract_id   BIGINT UNSIGNED NULL,
    amount              DECIMAL(20,0) NOT NULL,
    transfer_group_code VARCHAR(80) NOT NULL,
    paid_at             DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_salary_player UNIQUE (season_id, player_contract_id),
    CONSTRAINT uq_salary_staff UNIQUE (season_id, staff_contract_id),
    CONSTRAINT fk_salary_season FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_salary_player_contract FOREIGN KEY (player_contract_id) REFERENCES player_contracts(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_salary_staff_contract FOREIGN KEY (staff_contract_id) REFERENCES staff_contracts(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_salary_amount CHECK (amount >= 0)
) ENGINE=InnoDB;

/* ========================================================================== */
/* 4. COMPETITIONS, GROUPS, BRACKETS AND MATCHES                               */
/* ========================================================================== */

CREATE TABLE competition_series (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code                VARCHAR(30) NOT NULL,
    name                VARCHAR(150) NOT NULL,
    description         VARCHAR(500) NULL,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_competition_series_code UNIQUE (code),
    CONSTRAINT uq_competition_series_name UNIQUE (name)
) ENGINE=InnoDB;

CREATE TABLE competitions (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    series_id           BIGINT UNSIGNED NOT NULL,
    season_id           BIGINT UNSIGNED NOT NULL,
    name                VARCHAR(180) NOT NULL,
    logo_url            VARCHAR(500) NULL,
    format_type         ENUM('GROUP_ONLY','KNOCKOUT_ONLY','GROUP_AND_KNOCKOUT') NOT NULL,
    coefficient         DECIMAL(8,3) NOT NULL DEFAULT 1.000,
    entry_fee           DECIMAL(20,0) NOT NULL DEFAULT 0,
    status              ENUM(
                            'DRAFT','REGISTRATION','GROUP_STAGE','KNOCKOUT_READY',
                            'KNOCKOUT_STAGE','COMPLETED_PENDING_CLOSE','FINISHED','CANCELLED'
                        ) NOT NULL DEFAULT 'DRAFT',
    group_count         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    teams_per_group     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    advance_per_group   SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    best_third_count    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    group_leg_mode      ENUM('ONE_LEG','TWO_LEG') NOT NULL DEFAULT 'ONE_LEG',
    knockout_size       SMALLINT UNSIGNED NULL,
    third_place_mode    ENUM('SHARED_BRONZE','PLAYOFF','NONE') NOT NULL DEFAULT 'SHARED_BRONZE',
    starts_on           DATE NULL,
    ends_on             DATE NULL,
    rewards_processed_at DATETIME(6) NULL,
    created_by_user_id  BIGINT UNSIGNED NOT NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                         ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_competitions_series_season UNIQUE (series_id, season_id),
    CONSTRAINT fk_competitions_series FOREIGN KEY (series_id) REFERENCES competition_series(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_competitions_season FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_competitions_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_competition_coefficient CHECK (coefficient > 0),
    CONSTRAINT chk_competition_money CHECK (entry_fee >= 0),
    CONSTRAINT chk_competition_dates CHECK (ends_on IS NULL OR starts_on IS NULL OR ends_on >= starts_on),
    CONSTRAINT chk_competition_knockout_size CHECK (
        knockout_size IS NULL OR knockout_size IN (2,4,8,16,32,64,128)
    )
) ENGINE=InnoDB;

CREATE TABLE competition_participants (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    club_id             BIGINT UNSIGNED NOT NULL,
    seed_no             SMALLINT UNSIGNED NULL,
    registration_status ENUM('REGISTERED','APPROVED','WITHDRAWN','DISQUALIFIED')
                        NOT NULL DEFAULT 'REGISTERED',
    registered_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_competition_participant UNIQUE (competition_id, club_id),
    CONSTRAINT uq_competition_seed UNIQUE (competition_id, seed_no),
    CONSTRAINT fk_competition_participant_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_competition_participant_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE competition_rosters (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    club_id             BIGINT UNSIGNED NOT NULL,
    player_id           BIGINT UNSIGNED NOT NULL,
    registered_at       DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    status              ENUM('ACTIVE','REMOVED') NOT NULL DEFAULT 'ACTIVE',
    CONSTRAINT uq_competition_roster_player UNIQUE (competition_id, player_id),
    CONSTRAINT fk_roster_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_roster_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_roster_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE competition_groups (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    group_code          VARCHAR(10) NOT NULL,
    display_name        VARCHAR(50) NOT NULL,
    display_order       SMALLINT UNSIGNED NOT NULL,
    CONSTRAINT uq_competition_group_code UNIQUE (competition_id, group_code),
    CONSTRAINT uq_competition_group_order UNIQUE (competition_id, display_order),
    CONSTRAINT fk_groups_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE competition_group_members (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    group_id            BIGINT UNSIGNED NOT NULL,
    club_id             BIGINT UNSIGNED NOT NULL,
    slot_no             SMALLINT UNSIGNED NOT NULL,
    CONSTRAINT uq_group_member UNIQUE (group_id, club_id),
    CONSTRAINT uq_group_slot UNIQUE (group_id, slot_no),
    CONSTRAINT fk_group_members_group FOREIGN KEY (group_id) REFERENCES competition_groups(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_group_members_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE competition_rounds (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    round_name          VARCHAR(80) NOT NULL,
    round_order         SMALLINT UNSIGNED NOT NULL,
    team_count          SMALLINT UNSIGNED NOT NULL,
    match_count         SMALLINT UNSIGNED NOT NULL,
    status              ENUM('NOT_STARTED','IN_PROGRESS','FINISHED') NOT NULL DEFAULT 'NOT_STARTED',
    CONSTRAINT uq_competition_round_order UNIQUE (competition_id, round_order),
    CONSTRAINT fk_rounds_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_round_counts CHECK (team_count >= 2 AND match_count >= 1)
) ENGINE=InnoDB;

CREATE TABLE matches (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    stage_type          ENUM('GROUP','KNOCKOUT') NOT NULL,
    group_id            BIGINT UNSIGNED NULL,
    round_id            BIGINT UNSIGNED NULL,
    match_no            SMALLINT UNSIGNED NOT NULL,
    leg_no              TINYINT UNSIGNED NOT NULL DEFAULT 1,
    home_club_id        BIGINT UNSIGNED NULL,
    away_club_id        BIGINT UNSIGNED NULL,
    home_score          SMALLINT UNSIGNED NULL,
    away_score          SMALLINT UNSIGNED NULL,
    home_penalty_score  SMALLINT UNSIGNED NULL,
    away_penalty_score  SMALLINT UNSIGNED NULL,
    winner_club_id      BIGINT UNSIGNED NULL,
    loser_club_id       BIGINT UNSIGNED NULL,
    scheduled_at        DATETIME(6) NULL,
    status              ENUM('SCHEDULED','LIVE','FINISHED','CANCELLED') NOT NULL DEFAULT 'SCHEDULED',
    highlighted_upset   BOOLEAN NOT NULL DEFAULT FALSE,
    note                VARCHAR(500) NULL,
    created_by_user_id  BIGINT UNSIGNED NULL,
    confirmed_by_user_id BIGINT UNSIGNED NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                         ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_group_match UNIQUE (group_id, match_no, leg_no),
    CONSTRAINT uq_knockout_match UNIQUE (round_id, match_no, leg_no),
    CONSTRAINT fk_matches_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_matches_group FOREIGN KEY (group_id) REFERENCES competition_groups(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_matches_round FOREIGN KEY (round_id) REFERENCES competition_rounds(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_matches_home_club FOREIGN KEY (home_club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_matches_away_club FOREIGN KEY (away_club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_matches_winner_club FOREIGN KEY (winner_club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_matches_loser_club FOREIGN KEY (loser_club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_matches_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_matches_confirmer FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_matches_comp_status ON matches(competition_id, status);
CREATE INDEX idx_matches_group ON matches(group_id, status);
CREATE INDEX idx_matches_round ON matches(round_id, status);

CREATE TABLE match_advancement_links (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    source_match_id     BIGINT UNSIGNED NOT NULL,
    target_match_id     BIGINT UNSIGNED NOT NULL,
    target_slot         ENUM('HOME','AWAY') NOT NULL,
    CONSTRAINT uq_advancement_source UNIQUE (source_match_id),
    CONSTRAINT uq_advancement_target_slot UNIQUE (target_match_id, target_slot),
    CONSTRAINT fk_advancement_source FOREIGN KEY (source_match_id) REFERENCES matches(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_advancement_target FOREIGN KEY (target_match_id) REFERENCES matches(id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE player_match_stats (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    match_id            BIGINT UNSIGNED NOT NULL,
    player_id           BIGINT UNSIGNED NOT NULL,
    club_id             BIGINT UNSIGNED NOT NULL,
    appeared            BOOLEAN NOT NULL DEFAULT TRUE,
    goals               SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    assists             SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    clean_sheet         BOOLEAN NOT NULL DEFAULT FALSE,
    goals_conceded      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    yellow_cards        TINYINT UNSIGNED NOT NULL DEFAULT 0,
    red_cards           TINYINT UNSIGNED NOT NULL DEFAULT 0,
    entered_by_user_id  BIGINT UNSIGNED NULL,
    verified_by_user_id BIGINT UNSIGNED NULL,
    verification_status ENUM('PENDING','VERIFIED','LOCKED') NOT NULL DEFAULT 'PENDING',
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                         ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_player_match_stats UNIQUE (match_id, player_id),
    CONSTRAINT fk_player_match_stats_match FOREIGN KEY (match_id) REFERENCES matches(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_player_match_stats_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_match_stats_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_match_stats_entered_by FOREIGN KEY (entered_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_match_stats_verified_by FOREIGN KEY (verified_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE competition_qualified_teams (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    group_id            BIGINT UNSIGNED NOT NULL,
    club_id             BIGINT UNSIGNED NOT NULL,
    group_rank          SMALLINT UNSIGNED NOT NULL,
    qualification_type  ENUM('DIRECT','BEST_THIRD','ADMIN') NOT NULL,
    qualified_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_qualified_team UNIQUE (competition_id, club_id),
    CONSTRAINT fk_qualified_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_qualified_group FOREIGN KEY (group_id) REFERENCES competition_groups(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_qualified_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE knockout_pairing_rules (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    round_id            BIGINT UNSIGNED NOT NULL,
    match_no            SMALLINT UNSIGNED NOT NULL,
    home_group_id       BIGINT UNSIGNED NOT NULL,
    home_group_rank     SMALLINT UNSIGNED NOT NULL,
    away_group_id       BIGINT UNSIGNED NOT NULL,
    away_group_rank     SMALLINT UNSIGNED NOT NULL,
    CONSTRAINT uq_pairing_rule_match UNIQUE (round_id, match_no),
    CONSTRAINT fk_pairing_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_pairing_round FOREIGN KEY (round_id) REFERENCES competition_rounds(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_pairing_home_group FOREIGN KEY (home_group_id) REFERENCES competition_groups(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_pairing_away_group FOREIGN KEY (away_group_id) REFERENCES competition_groups(id)
        ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB;

/* ========================================================================== */
/* 5. PRIZES, ACHIEVEMENTS, AWARDS AND RANKING                                 */
/* ========================================================================== */

CREATE TABLE competition_prize_rules (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    placement_from      SMALLINT UNSIGNED NOT NULL,
    placement_to        SMALLINT UNSIGNED NOT NULL,
    placement_label     VARCHAR(100) NOT NULL,
    prize_amount        DECIMAL(20,0) NOT NULL DEFAULT 0,
    base_ranking_points DECIMAL(20,3) NOT NULL DEFAULT 0,
    medal_type          ENUM('GOLD','SILVER','BRONZE','NONE') NOT NULL DEFAULT 'NONE',
    CONSTRAINT uq_prize_rule_range UNIQUE (competition_id, placement_from, placement_to),
    CONSTRAINT fk_prize_rules_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_prize_rule_range CHECK (placement_from >= 1 AND placement_to >= placement_from),
    CONSTRAINT chk_prize_values CHECK (prize_amount >= 0 AND base_ranking_points >= 0)
) ENGINE=InnoDB;

CREATE TABLE competition_special_reward_rules (
    id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id           BIGINT UNSIGNED NOT NULL,
    enabled                  BOOLEAN NOT NULL DEFAULT FALSE,
    champion_reward_fraction DECIMAL(8,4) NOT NULL DEFAULT 0.2500,
    runnerup_reward_fraction DECIMAL(8,4) NOT NULL DEFAULT 0.2500,
    fifa_share_fraction      DECIMAL(8,4) NOT NULL DEFAULT 0.5000,
    defeated_share_fraction  DECIMAL(8,4) NOT NULL DEFAULT 0.5000,
    max_champion_rewards     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    max_runnerup_rewards     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    CONSTRAINT uq_special_reward_competition UNIQUE (competition_id),
    CONSTRAINT fk_special_reward_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT chk_special_reward_fractions CHECK (
        champion_reward_fraction >= 0 AND champion_reward_fraction <= 1
        AND runnerup_reward_fraction >= 0 AND runnerup_reward_fraction <= 1
        AND fifa_share_fraction >= 0 AND fifa_share_fraction <= 1
        AND defeated_share_fraction >= 0 AND defeated_share_fraction <= 1
        AND ABS((fifa_share_fraction + defeated_share_fraction) - 1.0000) < 0.0001
    )
) ENGINE=InnoDB;

CREATE TABLE competition_results (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id      BIGINT UNSIGNED NOT NULL,
    club_id             BIGINT UNSIGNED NOT NULL,
    placement           SMALLINT UNSIGNED NOT NULL,
    is_joint_placement  BOOLEAN NOT NULL DEFAULT FALSE,
    confirmed_by_user_id BIGINT UNSIGNED NOT NULL,
    confirmed_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    note                VARCHAR(500) NULL,
    CONSTRAINT uq_competition_result_club UNIQUE (competition_id, club_id),
    CONSTRAINT fk_results_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_results_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_results_user FOREIGN KEY (confirmed_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_result_placement CHECK (placement >= 1)
) ENGINE=InnoDB;

CREATE TABLE competition_upset_rewards (
    id                         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    competition_id             BIGINT UNSIGNED NOT NULL,
    match_id                   BIGINT UNSIGNED NOT NULL,
    winning_club_id            BIGINT UNSIGNED NOT NULL,
    defeated_club_id           BIGINT UNSIGNED NOT NULL,
    defeated_previous_placement ENUM('CHAMPION','RUNNER_UP') NOT NULL,
    previous_prize_amount      DECIMAL(20,0) NOT NULL,
    reward_amount              DECIMAL(20,0) NOT NULL,
    fifa_contribution          DECIMAL(20,0) NOT NULL,
    defeated_club_contribution DECIMAL(20,0) NOT NULL,
    status                     ENUM('PENDING','PAID','CANCELLED') NOT NULL DEFAULT 'PENDING',
    paid_at                    DATETIME(6) NULL,
    created_at                 DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_upset_reward_match UNIQUE (match_id),
    CONSTRAINT fk_upset_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_upset_match FOREIGN KEY (match_id) REFERENCES matches(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_upset_winner FOREIGN KEY (winning_club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_upset_defeated FOREIGN KEY (defeated_club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_upset_amounts CHECK (
        previous_prize_amount >= 0 AND reward_amount >= 0
        AND fifa_contribution >= 0 AND defeated_club_contribution >= 0
        AND fifa_contribution + defeated_club_contribution = reward_amount
    )
) ENGINE=InnoDB;

CREATE TABLE club_achievements (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    club_id             BIGINT UNSIGNED NOT NULL,
    competition_id      BIGINT UNSIGNED NOT NULL,
    season_id           BIGINT UNSIGNED NOT NULL,
    placement           SMALLINT UNSIGNED NOT NULL,
    achievement_name    VARCHAR(180) NOT NULL,
    medal_type          ENUM('GOLD','SILVER','BRONZE','NONE') NOT NULL DEFAULT 'NONE',
    awarded_points      DECIMAL(20,3) NOT NULL DEFAULT 0,
    prize_amount        DECIMAL(20,0) NOT NULL DEFAULT 0,
    awarded_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_club_achievement UNIQUE (club_id, competition_id, placement),
    CONSTRAINT fk_club_achievement_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_club_achievement_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_club_achievement_season FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE award_types (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    code                VARCHAR(50) NOT NULL,
    name                VARCHAR(150) NOT NULL,
    category            ENUM(
                            'TEAM_MEDAL','BEST_PLAYER','TOP_SCORER','BEST_GOALKEEPER',
                            'BEST_YOUNG_PLAYER','BEST_ASSIST','OTHER'
                        ) NOT NULL,
    required_medal_type ENUM('GOLD','SILVER','BRONZE','NONE') NOT NULL DEFAULT 'NONE',
    base_ranking_points DECIMAL(20,3) NOT NULL DEFAULT 0,
    is_active           BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT uq_award_types_code UNIQUE (code),
    CONSTRAINT uq_award_types_name UNIQUE (name),
    CONSTRAINT chk_award_points CHECK (base_ranking_points >= 0)
) ENGINE=InnoDB;

CREATE TABLE player_awards (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id           BIGINT UNSIGNED NOT NULL,
    club_id_at_award    BIGINT UNSIGNED NOT NULL,
    competition_id      BIGINT UNSIGNED NOT NULL,
    season_id           BIGINT UNSIGNED NOT NULL,
    award_type_id       BIGINT UNSIGNED NOT NULL,
    display_name        VARCHAR(220) NOT NULL,
    awarded_points      DECIMAL(20,3) NOT NULL DEFAULT 0,
    assigned_by_user_id BIGINT UNSIGNED NOT NULL,
    is_locked           BOOLEAN NOT NULL DEFAULT FALSE,
    awarded_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_player_award UNIQUE (player_id, competition_id, award_type_id),
    CONSTRAINT fk_player_award_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_award_club FOREIGN KEY (club_id_at_award) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_award_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_player_award_season FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_award_type FOREIGN KEY (award_type_id) REFERENCES award_types(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_award_user FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE club_ranking_points (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    club_id             BIGINT UNSIGNED NOT NULL,
    season_id           BIGINT UNSIGNED NOT NULL,
    competition_id      BIGINT UNSIGNED NULL,
    source_type         ENUM('COMPETITION_RESULT','BONUS','PENALTY','ADMIN_ADJUSTMENT') NOT NULL,
    source_id           BIGINT UNSIGNED NULL,
    points              DECIMAL(20,3) NOT NULL,
    description         VARCHAR(500) NOT NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_club_points_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_club_points_season FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_club_points_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_club_points_ranking ON club_ranking_points(club_id, season_id);

CREATE TABLE player_ranking_points (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id           BIGINT UNSIGNED NOT NULL,
    season_id           BIGINT UNSIGNED NOT NULL,
    competition_id      BIGINT UNSIGNED NULL,
    source_type         ENUM('AWARD','BONUS','PENALTY','ADMIN_ADJUSTMENT') NOT NULL,
    source_id           BIGINT UNSIGNED NULL,
    points              DECIMAL(20,3) NOT NULL,
    description         VARCHAR(500) NOT NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_player_points_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_points_season FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_points_comp FOREIGN KEY (competition_id) REFERENCES competitions(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_player_points_ranking ON player_ranking_points(player_id, season_id);

CREATE TABLE ranking_snapshot_batches (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    entity_type         ENUM('CLUB','PLAYER') NOT NULL,
    category            ENUM('WORLD','OVERALL','GOALS','GOALKEEPER','WEALTH','MARKET_VALUE') NOT NULL,
    season_id           BIGINT UNSIGNED NULL,
    club_context_id     BIGINT UNSIGNED NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_ranking_batch_season FOREIGN KEY (season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_ranking_batch_club_context FOREIGN KEY (club_context_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE club_ranking_snapshots (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_id            BIGINT UNSIGNED NOT NULL,
    club_id             BIGINT UNSIGNED NOT NULL,
    rank_position       INT UNSIGNED NOT NULL,
    previous_rank       INT UNSIGNED NULL,
    score               DECIMAL(30,3) NOT NULL,
    CONSTRAINT uq_club_snapshot UNIQUE (batch_id, club_id),
    CONSTRAINT fk_club_snapshot_batch FOREIGN KEY (batch_id) REFERENCES ranking_snapshot_batches(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_club_snapshot_club FOREIGN KEY (club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE player_ranking_snapshots (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    batch_id            BIGINT UNSIGNED NOT NULL,
    player_id           BIGINT UNSIGNED NOT NULL,
    rank_position       INT UNSIGNED NOT NULL,
    previous_rank       INT UNSIGNED NULL,
    score               DECIMAL(30,3) NOT NULL,
    CONSTRAINT uq_player_snapshot UNIQUE (batch_id, player_id),
    CONSTRAINT fk_player_snapshot_batch FOREIGN KEY (batch_id) REFERENCES ranking_snapshot_batches(id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_player_snapshot_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

/* ========================================================================== */
/* 6. TRANSFERS                                                                */
/* ========================================================================== */

CREATE TABLE transfer_offers (
    id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    player_id                BIGINT UNSIGNED NOT NULL,
    seller_club_id           BIGINT UNSIGNED NULL,
    buyer_club_id            BIGINT UNSIGNED NOT NULL,
    transfer_type            ENUM('PAID','FREE') NOT NULL,
    transfer_fee             DECIMAL(20,0) NOT NULL DEFAULT 0,
    new_salary_per_season    DECIMAL(20,0) NOT NULL,
    contract_start_season_id BIGINT UNSIGNED NOT NULL,
    contract_end_season_id   BIGINT UNSIGNED NULL,
    status                   ENUM('DRAFT','SENT','ACCEPTED','REJECTED','CANCELLED','COMPLETED')
                             NOT NULL DEFAULT 'DRAFT',
    created_by_user_id       BIGINT UNSIGNED NOT NULL,
    accepted_at              DATETIME(6) NULL,
    completed_at             DATETIME(6) NULL,
    note                     VARCHAR(500) NULL,
    created_at               DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at               DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
                                              ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_transfer_offer_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_offer_seller FOREIGN KEY (seller_club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_offer_buyer FOREIGN KEY (buyer_club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_offer_start_season FOREIGN KEY (contract_start_season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_offer_end_season FOREIGN KEY (contract_end_season_id) REFERENCES seasons(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_transfer_offer_user FOREIGN KEY (created_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_transfer_offer_money CHECK (transfer_fee >= 0 AND new_salary_per_season >= 0),
    CONSTRAINT chk_transfer_offer_type CHECK (
        (transfer_type = 'FREE' AND transfer_fee = 0)
        OR transfer_type = 'PAID'
    )
) ENGINE=InnoDB;

CREATE TABLE player_transfers (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    transfer_offer_id   BIGINT UNSIGNED NOT NULL,
    player_id           BIGINT UNSIGNED NOT NULL,
    from_club_id        BIGINT UNSIGNED NULL,
    to_club_id          BIGINT UNSIGNED NOT NULL,
    transfer_type       ENUM('PAID','FREE') NOT NULL,
    transfer_fee        DECIMAL(20,0) NOT NULL,
    transfer_group_code VARCHAR(80) NULL,
    completed_by_user_id BIGINT UNSIGNED NOT NULL,
    completed_at        DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_player_transfer_offer UNIQUE (transfer_offer_id),
    CONSTRAINT fk_player_transfer_offer FOREIGN KEY (transfer_offer_id) REFERENCES transfer_offers(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_transfer_player FOREIGN KEY (player_id) REFERENCES players(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_transfer_from_club FOREIGN KEY (from_club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_transfer_to_club FOREIGN KEY (to_club_id) REFERENCES clubs(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_player_transfer_user FOREIGN KEY (completed_by_user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_player_transfer_fee CHECK (transfer_fee >= 0)
) ENGINE=InnoDB;

/* ========================================================================== */
/* 7. AUDIT LOG                                                                */
/* ========================================================================== */

CREATE TABLE audit_logs (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id             BIGINT UNSIGNED NULL,
    action_code         VARCHAR(80) NOT NULL,
    entity_table        VARCHAR(80) NULL,
    entity_id           BIGINT UNSIGNED NULL,
    details             JSON NULL,
    created_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_audit_user FOREIGN KEY (user_id) REFERENCES users(id)
        ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE INDEX idx_audit_lookup ON audit_logs(entity_table, entity_id, created_at);


/* ========================================================================== */
/* 8. TRIGGERS                                                                 */
/* ========================================================================== */

DELIMITER $$

CREATE TRIGGER trg_clubs_create_wallet
AFTER INSERT ON clubs
FOR EACH ROW
BEGIN
    INSERT INTO wallets(wallet_code, wallet_type, club_id)
    VALUES (CONCAT('CLUB-', NEW.id), 'CLUB', NEW.id);
END$$

CREATE TRIGGER trg_players_create_wallet
AFTER INSERT ON players
FOR EACH ROW
BEGIN
    INSERT INTO wallets(wallet_code, wallet_type, player_id)
    VALUES (CONCAT('PLAYER-', NEW.id), 'PLAYER', NEW.id);
END$$

CREATE TRIGGER trg_staff_create_wallet
AFTER INSERT ON coaching_staff
FOR EACH ROW
BEGIN
    INSERT INTO wallets(wallet_code, wallet_type, staff_id)
    VALUES (CONCAT('STAFF-', NEW.id), 'STAFF', NEW.id);
END$$

CREATE TRIGGER trg_wallet_transactions_validate_insert
BEFORE INSERT ON wallet_transactions
FOR EACH ROW
BEGIN
    DECLARE v_current_balance DECIMAL(20,0);

    SELECT balance INTO v_current_balance
    FROM wallets
    WHERE id = NEW.wallet_id;

    IF NEW.direction = 'CREDIT'
       AND NEW.balance_after <> NEW.balance_before + NEW.amount THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Số dư giao dịch CREDIT không khớp số tiền.';
    END IF;

    IF NEW.direction = 'DEBIT'
       AND NEW.balance_after <> NEW.balance_before - NEW.amount THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Số dư giao dịch DEBIT không khớp số tiền.';
    END IF;

    IF v_current_balance <> NEW.balance_after THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Sổ giao dịch không khớp số dư hiện tại của ví.';
    END IF;
END$$

CREATE TRIGGER trg_wallet_transactions_no_update
BEFORE UPDATE ON wallet_transactions
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Giao dịch ví là dữ liệu bất biến; hãy tạo giao dịch đảo thay vì sửa.';
END$$

CREATE TRIGGER trg_wallet_transactions_no_delete
BEFORE DELETE ON wallet_transactions
FOR EACH ROW
BEGIN
    SIGNAL SQLSTATE '45000'
        SET MESSAGE_TEXT = 'Không được xóa giao dịch ví; hãy tạo giao dịch đảo.';
END$$

CREATE TRIGGER trg_player_contract_one_active_insert
BEFORE INSERT ON player_contracts
FOR EACH ROW
BEGIN
    DECLARE v_start_sequence INT UNSIGNED;
    DECLARE v_end_sequence INT UNSIGNED;
    DECLARE v_player_club_id BIGINT UNSIGNED;

    SELECT sequence_no INTO v_start_sequence FROM seasons WHERE id = NEW.start_season_id;
    IF NEW.end_season_id IS NOT NULL THEN
        SELECT sequence_no INTO v_end_sequence FROM seasons WHERE id = NEW.end_season_id;
        IF v_end_sequence < v_start_sequence THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Mùa kết thúc hợp đồng không được trước mùa bắt đầu.';
        END IF;
    END IF;

    SELECT club_id INTO v_player_club_id FROM players WHERE id = NEW.player_id;
    IF NEW.status = 'ACTIVE' AND NOT (v_player_club_id <=> NEW.club_id) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB trong hợp đồng không khớp CLB hiện tại của cầu thủ.';
    END IF;

    IF NEW.status = 'ACTIVE' AND EXISTS (
        SELECT 1 FROM player_contracts
        WHERE player_id = NEW.player_id AND status = 'ACTIVE'
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cầu thủ đã có hợp đồng đang hoạt động.';
    END IF;
END$$

CREATE TRIGGER trg_player_contract_one_active_update
BEFORE UPDATE ON player_contracts
FOR EACH ROW
BEGIN
    DECLARE v_start_sequence INT UNSIGNED;
    DECLARE v_end_sequence INT UNSIGNED;
    DECLARE v_player_club_id BIGINT UNSIGNED;

    SELECT sequence_no INTO v_start_sequence FROM seasons WHERE id = NEW.start_season_id;
    IF NEW.end_season_id IS NOT NULL THEN
        SELECT sequence_no INTO v_end_sequence FROM seasons WHERE id = NEW.end_season_id;
        IF v_end_sequence < v_start_sequence THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Mùa kết thúc hợp đồng không được trước mùa bắt đầu.';
        END IF;
    END IF;

    SELECT club_id INTO v_player_club_id FROM players WHERE id = NEW.player_id;
    IF NEW.status = 'ACTIVE' AND NOT (v_player_club_id <=> NEW.club_id) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB trong hợp đồng không khớp CLB hiện tại của cầu thủ.';
    END IF;

    IF NEW.status = 'ACTIVE' AND EXISTS (
        SELECT 1 FROM player_contracts
        WHERE player_id = NEW.player_id
          AND status = 'ACTIVE'
          AND id <> OLD.id
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cầu thủ đã có hợp đồng đang hoạt động khác.';
    END IF;
END$$

CREATE TRIGGER trg_staff_contract_one_active_insert
BEFORE INSERT ON staff_contracts
FOR EACH ROW
BEGIN
    DECLARE v_start_sequence INT UNSIGNED;
    DECLARE v_end_sequence INT UNSIGNED;
    DECLARE v_staff_club_id BIGINT UNSIGNED;

    SELECT sequence_no INTO v_start_sequence FROM seasons WHERE id = NEW.start_season_id;
    IF NEW.end_season_id IS NOT NULL THEN
        SELECT sequence_no INTO v_end_sequence FROM seasons WHERE id = NEW.end_season_id;
        IF v_end_sequence < v_start_sequence THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Mùa kết thúc hợp đồng không được trước mùa bắt đầu.';
        END IF;
    END IF;

    SELECT club_id INTO v_staff_club_id FROM coaching_staff WHERE id = NEW.staff_id;
    IF NEW.status = 'ACTIVE' AND NOT (v_staff_club_id <=> NEW.club_id) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB trong hợp đồng không khớp CLB hiện tại của ban huấn luyện.';
    END IF;

    IF NEW.status = 'ACTIVE' AND EXISTS (
        SELECT 1 FROM staff_contracts
        WHERE staff_id = NEW.staff_id AND status = 'ACTIVE'
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Thành viên ban huấn luyện đã có hợp đồng đang hoạt động.';
    END IF;
END$$

CREATE TRIGGER trg_staff_contract_one_active_update
BEFORE UPDATE ON staff_contracts
FOR EACH ROW
BEGIN
    DECLARE v_start_sequence INT UNSIGNED;
    DECLARE v_end_sequence INT UNSIGNED;
    DECLARE v_staff_club_id BIGINT UNSIGNED;

    SELECT sequence_no INTO v_start_sequence FROM seasons WHERE id = NEW.start_season_id;
    IF NEW.end_season_id IS NOT NULL THEN
        SELECT sequence_no INTO v_end_sequence FROM seasons WHERE id = NEW.end_season_id;
        IF v_end_sequence < v_start_sequence THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Mùa kết thúc hợp đồng không được trước mùa bắt đầu.';
        END IF;
    END IF;

    SELECT club_id INTO v_staff_club_id FROM coaching_staff WHERE id = NEW.staff_id;
    IF NEW.status = 'ACTIVE' AND NOT (v_staff_club_id <=> NEW.club_id) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB trong hợp đồng không khớp CLB hiện tại của ban huấn luyện.';
    END IF;

    IF NEW.status = 'ACTIVE' AND EXISTS (
        SELECT 1 FROM staff_contracts
        WHERE staff_id = NEW.staff_id
          AND status = 'ACTIVE'
          AND id <> OLD.id
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Thành viên ban huấn luyện đã có hợp đồng đang hoạt động khác.';
    END IF;
END$$

CREATE TRIGGER trg_players_market_value_history
AFTER UPDATE ON players
FOR EACH ROW
BEGIN
    IF OLD.market_value <> NEW.market_value THEN
        INSERT INTO player_market_value_history(
            player_id, old_value, new_value, changed_by_user_id, reason
        ) VALUES (
            NEW.id,
            OLD.market_value,
            NEW.market_value,
            @app_user_id,
            COALESCE(@app_change_reason, 'Cập nhật giá trị cầu thủ')
        );
    END IF;
END$$

CREATE TRIGGER trg_roster_validate_insert
BEFORE INSERT ON competition_rosters
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM competition_participants cp
        WHERE cp.competition_id = NEW.competition_id
          AND cp.club_id = NEW.club_id
          AND cp.registration_status = 'APPROVED'
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB chưa được duyệt tham dự giải.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM players p
        WHERE p.id = NEW.player_id AND p.club_id = NEW.club_id
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cầu thủ không thuộc CLB đăng ký tại thời điểm thêm danh sách.';
    END IF;
END$$

CREATE TRIGGER trg_group_member_validate_insert
BEFORE INSERT ON competition_group_members
FOR EACH ROW
BEGIN
    DECLARE v_competition_id BIGINT UNSIGNED;

    SELECT competition_id INTO v_competition_id
    FROM competition_groups
    WHERE id = NEW.group_id;

    IF NOT EXISTS (
        SELECT 1 FROM competition_participants cp
        WHERE cp.competition_id = v_competition_id
          AND cp.club_id = NEW.club_id
          AND cp.registration_status = 'APPROVED'
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB phải được duyệt tham dự trước khi xếp vào bảng.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM competition_group_members gm
        JOIN competition_groups g ON g.id = gm.group_id
        WHERE g.competition_id = v_competition_id
          AND gm.club_id = NEW.club_id
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB đã thuộc một bảng khác trong giải này.';
    END IF;
END$$

CREATE TRIGGER trg_match_stats_validate_insert
BEFORE INSERT ON player_match_stats
FOR EACH ROW
BEGIN
    DECLARE v_home BIGINT UNSIGNED;
    DECLARE v_away BIGINT UNSIGNED;
    DECLARE v_competition BIGINT UNSIGNED;

    SELECT home_club_id, away_club_id, competition_id
      INTO v_home, v_away, v_competition
    FROM matches
    WHERE id = NEW.match_id;

    IF v_home IS NULL OR v_away IS NULL
       OR (NEW.club_id <> v_home AND NEW.club_id <> v_away) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB thống kê không tham gia trận đấu này hoặc trận chưa đủ đội.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM competition_rosters cr
        WHERE cr.competition_id = v_competition
          AND cr.club_id = NEW.club_id
          AND cr.player_id = NEW.player_id
          AND cr.status = 'ACTIVE'
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Cầu thủ không nằm trong danh sách đăng ký của giải.';
    END IF;
END$$

CREATE TRIGGER trg_competition_result_validate_insert
BEFORE INSERT ON competition_results
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM competition_participants cp
        WHERE cp.competition_id = NEW.competition_id
          AND cp.club_id = NEW.club_id
          AND cp.registration_status = 'APPROVED'
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Không thể xếp hạng CLB không tham dự giải.';
    END IF;
END$$

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

    SELECT category, required_medal_type
      INTO v_award_category, v_required_medal_type
    FROM award_types
    WHERE id = NEW.award_type_id AND is_active = TRUE;

    IF v_award_category IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Loại danh hiệu không tồn tại hoặc đã bị khóa.';
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
END$$

CREATE TRIGGER trg_wallets_single_fifa_insert
BEFORE INSERT ON wallets
FOR EACH ROW
BEGIN
    IF NEW.wallet_type = 'FIFA' AND EXISTS (
        SELECT 1 FROM wallets WHERE wallet_type = 'FIFA'
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Hệ thống chỉ được có một ví Quỹ FIFA.';
    END IF;
END$$

CREATE TRIGGER trg_wallets_single_fifa_update
BEFORE UPDATE ON wallets
FOR EACH ROW
BEGIN
    IF NEW.wallet_type = 'FIFA' AND OLD.wallet_type <> 'FIFA' AND EXISTS (
        SELECT 1 FROM wallets WHERE wallet_type = 'FIFA' AND id <> OLD.id
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Hệ thống chỉ được có một ví Quỹ FIFA.';
    END IF;
END$$

CREATE TRIGGER trg_prize_rules_no_overlap_insert
BEFORE INSERT ON competition_prize_rules
FOR EACH ROW
BEGIN
    IF EXISTS (
        SELECT 1 FROM competition_prize_rules pr
        WHERE pr.competition_id = NEW.competition_id
          AND NOT (
              NEW.placement_to < pr.placement_from
              OR NEW.placement_from > pr.placement_to
          )
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Khoảng thứ hạng tiền thưởng bị chồng lấn.';
    END IF;
END$$

CREATE TRIGGER trg_prize_rules_no_overlap_update
BEFORE UPDATE ON competition_prize_rules
FOR EACH ROW
BEGIN
    IF EXISTS (
        SELECT 1 FROM competition_prize_rules pr
        WHERE pr.competition_id = NEW.competition_id
          AND pr.id <> OLD.id
          AND NOT (
              NEW.placement_to < pr.placement_from
              OR NEW.placement_from > pr.placement_to
          )
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Khoảng thứ hạng tiền thưởng bị chồng lấn.';
    END IF;
END$$

CREATE TRIGGER trg_pairing_rule_consistency_insert
BEFORE INSERT ON knockout_pairing_rules
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM competition_rounds r
        WHERE r.id = NEW.round_id AND r.competition_id = NEW.competition_id
    ) OR NOT EXISTS (
        SELECT 1 FROM competition_groups g
        WHERE g.id = NEW.home_group_id AND g.competition_id = NEW.competition_id
    ) OR NOT EXISTS (
        SELECT 1 FROM competition_groups g
        WHERE g.id = NEW.away_group_id AND g.competition_id = NEW.competition_id
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Vòng đấu và bảng đấu phải thuộc cùng một giải.';
    END IF;

    IF NEW.home_group_id = NEW.away_group_id
       AND NEW.home_group_rank = NEW.away_group_rank THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Hai nguồn đội trong một trận không được trùng nhau.';
    END IF;
END$$

CREATE TRIGGER trg_pairing_rule_consistency_update
BEFORE UPDATE ON knockout_pairing_rules
FOR EACH ROW
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM competition_rounds r
        WHERE r.id = NEW.round_id AND r.competition_id = NEW.competition_id
    ) OR NOT EXISTS (
        SELECT 1 FROM competition_groups g
        WHERE g.id = NEW.home_group_id AND g.competition_id = NEW.competition_id
    ) OR NOT EXISTS (
        SELECT 1 FROM competition_groups g
        WHERE g.id = NEW.away_group_id AND g.competition_id = NEW.competition_id
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Vòng đấu và bảng đấu phải thuộc cùng một giải.';
    END IF;

    IF NEW.home_group_id = NEW.away_group_id
       AND NEW.home_group_rank = NEW.away_group_rank THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Hai nguồn đội trong một trận không được trùng nhau.';
    END IF;
END$$

CREATE TRIGGER trg_users_owner_insert
BEFORE INSERT ON users
FOR EACH ROW
BEGIN
    IF (NEW.account_type = 'FIFA_ADMIN' AND NEW.club_id IS NOT NULL)
       OR (NEW.account_type = 'CLUB' AND NEW.club_id IS NULL) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Tài khoản FIFA không gắn CLB; tài khoản CLB bắt buộc gắn đúng một CLB.';
    END IF;
END$$

CREATE TRIGGER trg_users_owner_update
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
    IF (NEW.account_type = 'FIFA_ADMIN' AND NEW.club_id IS NOT NULL)
       OR (NEW.account_type = 'CLUB' AND NEW.club_id IS NULL) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Tài khoản FIFA không gắn CLB; tài khoản CLB bắt buộc gắn đúng một CLB.';
    END IF;
END$$

CREATE TRIGGER trg_wallets_owner_insert
BEFORE INSERT ON wallets
FOR EACH ROW
BEGIN
    IF NOT (
        (NEW.wallet_type = 'FIFA' AND NEW.club_id IS NULL AND NEW.player_id IS NULL AND NEW.staff_id IS NULL)
        OR (NEW.wallet_type = 'CLUB' AND NEW.club_id IS NOT NULL AND NEW.player_id IS NULL AND NEW.staff_id IS NULL)
        OR (NEW.wallet_type = 'PLAYER' AND NEW.club_id IS NULL AND NEW.player_id IS NOT NULL AND NEW.staff_id IS NULL)
        OR (NEW.wallet_type = 'STAFF' AND NEW.club_id IS NULL AND NEW.player_id IS NULL AND NEW.staff_id IS NOT NULL)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Chủ sở hữu ví không khớp loại ví.';
    END IF;
END$$

CREATE TRIGGER trg_wallets_owner_update
BEFORE UPDATE ON wallets
FOR EACH ROW
BEGIN
    IF NOT (
        (NEW.wallet_type = 'FIFA' AND NEW.club_id IS NULL AND NEW.player_id IS NULL AND NEW.staff_id IS NULL)
        OR (NEW.wallet_type = 'CLUB' AND NEW.club_id IS NOT NULL AND NEW.player_id IS NULL AND NEW.staff_id IS NULL)
        OR (NEW.wallet_type = 'PLAYER' AND NEW.club_id IS NULL AND NEW.player_id IS NOT NULL AND NEW.staff_id IS NULL)
        OR (NEW.wallet_type = 'STAFF' AND NEW.club_id IS NULL AND NEW.player_id IS NULL AND NEW.staff_id IS NOT NULL)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Chủ sở hữu ví không khớp loại ví.';
    END IF;
END$$

CREATE TRIGGER trg_wallets_balance_guard_update
BEFORE UPDATE ON wallets
FOR EACH ROW
BEGIN
    IF NEW.balance <> OLD.balance
       AND COALESCE(@allow_wallet_balance_write, 0) <> 1 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Không được sửa số dư trực tiếp; hãy dùng thủ tục giao dịch ví.';
    END IF;
END$$

CREATE TRIGGER trg_salary_payment_recipient_insert
BEFORE INSERT ON salary_payments
FOR EACH ROW
BEGIN
    IF NOT (
        (NEW.recipient_type = 'PLAYER' AND NEW.player_contract_id IS NOT NULL AND NEW.staff_contract_id IS NULL)
        OR (NEW.recipient_type = 'STAFF' AND NEW.player_contract_id IS NULL AND NEW.staff_contract_id IS NOT NULL)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Loại người nhận lương không khớp hợp đồng.';
    END IF;
END$$

CREATE TRIGGER trg_salary_payment_recipient_update
BEFORE UPDATE ON salary_payments
FOR EACH ROW
BEGIN
    IF NOT (
        (NEW.recipient_type = 'PLAYER' AND NEW.player_contract_id IS NOT NULL AND NEW.staff_contract_id IS NULL)
        OR (NEW.recipient_type = 'STAFF' AND NEW.player_contract_id IS NULL AND NEW.staff_contract_id IS NOT NULL)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Loại người nhận lương không khớp hợp đồng.';
    END IF;
END$$

CREATE TRIGGER trg_matches_structure_insert
BEFORE INSERT ON matches
FOR EACH ROW
BEGIN
    IF NOT (
        (NEW.stage_type = 'GROUP' AND NEW.group_id IS NOT NULL AND NEW.round_id IS NULL)
        OR (NEW.stage_type = 'KNOCKOUT' AND NEW.group_id IS NULL AND NEW.round_id IS NOT NULL)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Trận vòng bảng phải có group_id; trận loại trực tiếp phải có round_id.';
    END IF;

    IF NEW.home_club_id IS NOT NULL AND NEW.away_club_id IS NOT NULL
       AND NEW.home_club_id = NEW.away_club_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Một CLB không thể thi đấu với chính mình.';
    END IF;
END$$

CREATE TRIGGER trg_matches_structure_update
BEFORE UPDATE ON matches
FOR EACH ROW
BEGIN
    IF NOT (
        (NEW.stage_type = 'GROUP' AND NEW.group_id IS NOT NULL AND NEW.round_id IS NULL)
        OR (NEW.stage_type = 'KNOCKOUT' AND NEW.group_id IS NULL AND NEW.round_id IS NOT NULL)
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Trận vòng bảng phải có group_id; trận loại trực tiếp phải có round_id.';
    END IF;

    IF NEW.home_club_id IS NOT NULL AND NEW.away_club_id IS NOT NULL
       AND NEW.home_club_id = NEW.away_club_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Một CLB không thể thi đấu với chính mình.';
    END IF;
END$$

CREATE TRIGGER trg_advancement_link_insert
BEFORE INSERT ON match_advancement_links
FOR EACH ROW
BEGIN
    IF NEW.source_match_id = NEW.target_match_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Trận nguồn và trận đích không được trùng nhau.';
    END IF;
END$$

CREATE TRIGGER trg_advancement_link_update
BEFORE UPDATE ON match_advancement_links
FOR EACH ROW
BEGIN
    IF NEW.source_match_id = NEW.target_match_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Trận nguồn và trận đích không được trùng nhau.';
    END IF;
END$$

CREATE TRIGGER trg_transfer_offer_clubs_insert
BEFORE INSERT ON transfer_offers
FOR EACH ROW
BEGIN
    IF NEW.seller_club_id IS NOT NULL AND NEW.seller_club_id = NEW.buyer_club_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB bán và CLB mua không được trùng nhau.';
    END IF;
END$$

CREATE TRIGGER trg_transfer_offer_clubs_update
BEFORE UPDATE ON transfer_offers
FOR EACH ROW
BEGIN
    IF NEW.seller_club_id IS NOT NULL AND NEW.seller_club_id = NEW.buyer_club_id THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB bán và CLB mua không được trùng nhau.';
    END IF;
END$$

DELIMITER ;

/* ========================================================================== */
/* 9. VIEWS                                                                    */
/* ========================================================================== */

CREATE OR REPLACE VIEW v_club_wallets AS
SELECT
    c.id AS club_id,
    c.code AS club_code,
    c.name AS club_name,
    w.id AS wallet_id,
    w.wallet_code,
    w.balance,
    w.status AS wallet_status
FROM clubs c
JOIN wallets w ON w.club_id = c.id AND w.wallet_type = 'CLUB';

CREATE OR REPLACE VIEW v_player_wallets AS
SELECT
    p.id AS player_id,
    p.full_name,
    p.club_id,
    w.id AS wallet_id,
    w.wallet_code,
    w.balance,
    w.status AS wallet_status
FROM players p
JOIN wallets w ON w.player_id = p.id AND w.wallet_type = 'PLAYER';

CREATE OR REPLACE VIEW v_staff_wallets AS
SELECT
    s.id AS staff_id,
    s.full_name,
    s.club_id,
    w.id AS wallet_id,
    w.wallet_code,
    w.balance,
    w.status AS wallet_status
FROM coaching_staff s
JOIN wallets w ON w.staff_id = s.id AND w.wallet_type = 'STAFF';

CREATE OR REPLACE VIEW v_player_list AS
SELECT
    p.id,
    p.full_name,
    p.position,
    p.shirt_number,
    p.club_id,
    c.name AS club_name,
    p.market_value,
    COALESCE(pc.salary_per_season, 0) AS salary_per_season,
    COALESCE(w.balance, 0) AS wallet_balance,
    p.status,
    p.photo_url
FROM players p
LEFT JOIN clubs c ON c.id = p.club_id
LEFT JOIN player_contracts pc
       ON pc.player_id = p.id
      AND pc.status = 'ACTIVE'
LEFT JOIN wallets w
       ON w.player_id = p.id
      AND w.wallet_type = 'PLAYER';

CREATE OR REPLACE VIEW v_player_dossier_summary AS
SELECT
    vpl.id AS player_id,
    vpl.full_name,
    vpl.position,
    vpl.shirt_number,
    vpl.club_id,
    vpl.club_name,
    vpl.market_value,
    vpl.salary_per_season,
    vpl.wallet_balance,
    vpl.status,
    COALESCE(ms.appearances, 0) AS appearances,
    COALESCE(ms.goals, 0) AS goals,
    COALESCE(ms.assists, 0) AS assists,
    COALESCE(ms.clean_sheets, 0) AS clean_sheets,
    COALESCE(ms.goals_conceded, 0) AS goals_conceded,
    COALESCE(aw.award_count, 0) AS award_count,
    COALESCE(ch.club_count, 0) AS clubs_in_history
FROM v_player_list vpl
LEFT JOIN (
    SELECT
        player_id,
        SUM(CASE WHEN appeared THEN 1 ELSE 0 END) AS appearances,
        SUM(goals) AS goals,
        SUM(assists) AS assists,
        SUM(CASE WHEN clean_sheet THEN 1 ELSE 0 END) AS clean_sheets,
        SUM(goals_conceded) AS goals_conceded
    FROM player_match_stats
    WHERE verification_status IN ('VERIFIED','LOCKED')
    GROUP BY player_id
) ms ON ms.player_id = vpl.id
LEFT JOIN (
    SELECT player_id, COUNT(*) AS award_count
    FROM player_awards
    GROUP BY player_id
) aw ON aw.player_id = vpl.id
LEFT JOIN (
    SELECT player_id, COUNT(DISTINCT club_id) AS club_count
    FROM player_club_history
    GROUP BY player_id
) ch ON ch.player_id = vpl.id;

CREATE OR REPLACE VIEW v_group_standings AS
SELECT
    ranked.competition_id,
    ranked.group_id,
    ranked.group_code,
    ranked.group_name,
    ranked.club_id,
    ranked.club_name,
    ranked.played,
    ranked.won,
    ranked.drawn,
    ranked.lost,
    ranked.goals_for,
    ranked.goals_against,
    ranked.goal_difference,
    ranked.points,
    ROW_NUMBER() OVER (
        PARTITION BY ranked.group_id
        ORDER BY
            ranked.points DESC,
            ranked.goal_difference DESC,
            ranked.goals_for DESC,
            ranked.club_name ASC,
            ranked.club_id ASC
    ) AS group_rank
FROM (
    SELECT
        g.competition_id,
        g.id AS group_id,
        g.group_code,
        g.display_name AS group_name,
        gm.club_id,
        c.name AS club_name,
        COALESCE(SUM(r.played), 0) AS played,
        COALESCE(SUM(r.won), 0) AS won,
        COALESCE(SUM(r.drawn), 0) AS drawn,
        COALESCE(SUM(r.lost), 0) AS lost,
        COALESCE(SUM(r.goals_for), 0) AS goals_for,
        COALESCE(SUM(r.goals_against), 0) AS goals_against,
        COALESCE(SUM(r.goals_for), 0) - COALESCE(SUM(r.goals_against), 0) AS goal_difference,
        COALESCE(SUM(r.points), 0) AS points
    FROM competition_group_members gm
    JOIN competition_groups g ON g.id = gm.group_id
    JOIN clubs c ON c.id = gm.club_id
    LEFT JOIN (
        SELECT
            m.group_id,
            m.home_club_id AS club_id,
            1 AS played,
            CASE WHEN m.home_score > m.away_score THEN 1 ELSE 0 END AS won,
            CASE WHEN m.home_score = m.away_score THEN 1 ELSE 0 END AS drawn,
            CASE WHEN m.home_score < m.away_score THEN 1 ELSE 0 END AS lost,
            m.home_score AS goals_for,
            m.away_score AS goals_against,
            CASE
                WHEN m.home_score > m.away_score THEN 3
                WHEN m.home_score = m.away_score THEN 1
                ELSE 0
            END AS points
        FROM matches m
        WHERE m.stage_type = 'GROUP' AND m.status = 'FINISHED'

        UNION ALL

        SELECT
            m.group_id,
            m.away_club_id AS club_id,
            1 AS played,
            CASE WHEN m.away_score > m.home_score THEN 1 ELSE 0 END AS won,
            CASE WHEN m.away_score = m.home_score THEN 1 ELSE 0 END AS drawn,
            CASE WHEN m.away_score < m.home_score THEN 1 ELSE 0 END AS lost,
            m.away_score AS goals_for,
            m.home_score AS goals_against,
            CASE
                WHEN m.away_score > m.home_score THEN 3
                WHEN m.away_score = m.home_score THEN 1
                ELSE 0
            END AS points
        FROM matches m
        WHERE m.stage_type = 'GROUP' AND m.status = 'FINISHED'
    ) r ON r.group_id = gm.group_id AND r.club_id = gm.club_id
    GROUP BY
        g.competition_id, g.id, g.group_code, g.display_name,
        gm.club_id, c.name
) ranked;

CREATE OR REPLACE VIEW v_player_metrics AS
SELECT
    p.id AS player_id,
    p.full_name,
    p.position,
    p.club_id,
    c.name AS club_name,
    p.market_value,
    COALESCE(w.balance, 0) AS wallet_balance,
    COALESCE(ms.appearances, 0) AS appearances,
    COALESCE(ms.goals, 0) AS goals,
    COALESCE(ms.assists, 0) AS assists,
    COALESCE(ms.clean_sheets, 0) AS clean_sheets,
    COALESCE(ms.goals_conceded, 0) AS goals_conceded,
    COALESCE(ap.award_points, 0) AS award_points,
    (
        COALESCE(ap.award_points, 0)
        + COALESCE(ms.goals, 0) * CAST((SELECT setting_value FROM system_settings WHERE setting_key = 'PLAYER_GOAL_WEIGHT') AS DECIMAL(10,3))
        + COALESCE(ms.assists, 0) * CAST((SELECT setting_value FROM system_settings WHERE setting_key = 'PLAYER_ASSIST_WEIGHT') AS DECIMAL(10,3))
        + COALESCE(ms.clean_sheets, 0) * CAST((SELECT setting_value FROM system_settings WHERE setting_key = 'PLAYER_CLEAN_SHEET_WEIGHT') AS DECIMAL(10,3))
    ) AS overall_score,
    GREATEST(
        0,
        COALESCE(ms.clean_sheets, 0) * CAST((SELECT setting_value FROM system_settings WHERE setting_key = 'GOALKEEPER_CLEAN_SHEET_WEIGHT') AS DECIMAL(10,3))
        - COALESCE(ms.goals_conceded, 0) * CAST((SELECT setting_value FROM system_settings WHERE setting_key = 'GOALKEEPER_CONCEDED_PENALTY') AS DECIMAL(10,3))
    ) AS goalkeeper_score
FROM players p
LEFT JOIN clubs c ON c.id = p.club_id
LEFT JOIN wallets w ON w.player_id = p.id AND w.wallet_type = 'PLAYER'
LEFT JOIN (
    SELECT
        player_id,
        SUM(CASE WHEN appeared THEN 1 ELSE 0 END) AS appearances,
        SUM(goals) AS goals,
        SUM(assists) AS assists,
        SUM(CASE WHEN clean_sheet THEN 1 ELSE 0 END) AS clean_sheets,
        SUM(goals_conceded) AS goals_conceded
    FROM player_match_stats
    WHERE verification_status IN ('VERIFIED','LOCKED')
    GROUP BY player_id
) ms ON ms.player_id = p.id
LEFT JOIN (
    SELECT player_id, SUM(points) AS award_points
    FROM player_ranking_points
    GROUP BY player_id
) ap ON ap.player_id = p.id;

CREATE OR REPLACE VIEW v_player_rankings_current AS
SELECT
    vm.*,
    DENSE_RANK() OVER (ORDER BY vm.overall_score DESC, vm.player_id ASC) AS overall_world_rank,
    DENSE_RANK() OVER (PARTITION BY vm.club_id ORDER BY vm.overall_score DESC, vm.player_id ASC) AS overall_club_rank,
    DENSE_RANK() OVER (ORDER BY vm.goals DESC, vm.player_id ASC) AS goals_world_rank,
    DENSE_RANK() OVER (PARTITION BY vm.club_id ORDER BY vm.goals DESC, vm.player_id ASC) AS goals_club_rank,
    CASE
        WHEN vm.position = 'GK'
        THEN DENSE_RANK() OVER (
            ORDER BY CASE WHEN vm.position = 'GK' THEN vm.goalkeeper_score END DESC, vm.player_id ASC
        )
        ELSE NULL
    END AS goalkeeper_world_rank,
    CASE
        WHEN vm.position = 'GK'
        THEN DENSE_RANK() OVER (
            PARTITION BY vm.club_id
            ORDER BY CASE WHEN vm.position = 'GK' THEN vm.goalkeeper_score END DESC, vm.player_id ASC
        )
        ELSE NULL
    END AS goalkeeper_club_rank,
    DENSE_RANK() OVER (ORDER BY vm.wallet_balance DESC, vm.player_id ASC) AS wealth_world_rank,
    DENSE_RANK() OVER (PARTITION BY vm.club_id ORDER BY vm.wallet_balance DESC, vm.player_id ASC) AS wealth_club_rank,
    DENSE_RANK() OVER (ORDER BY vm.market_value DESC, vm.player_id ASC) AS market_value_world_rank,
    DENSE_RANK() OVER (PARTITION BY vm.club_id ORDER BY vm.market_value DESC, vm.player_id ASC) AS market_value_club_rank
FROM v_player_metrics vm;

CREATE OR REPLACE VIEW v_player_award_history AS
SELECT
    pa.player_id,
    p.full_name,
    pa.club_id_at_award,
    c.name AS club_name_at_award,
    pa.competition_id,
    comp.name AS competition_name,
    pa.season_id,
    s.name AS season_name,
    atp.code AS award_code,
    atp.name AS award_name,
    atp.category,
    pa.display_name,
    pa.awarded_points,
    pa.awarded_at
FROM player_awards pa
JOIN players p ON p.id = pa.player_id
JOIN clubs c ON c.id = pa.club_id_at_award
JOIN competitions comp ON comp.id = pa.competition_id
JOIN seasons s ON s.id = pa.season_id
JOIN award_types atp ON atp.id = pa.award_type_id;

CREATE OR REPLACE VIEW v_latest_club_world_ranking AS
SELECT
    crs.club_id,
    c.code AS club_code,
    c.name AS club_name,
    crs.rank_position,
    crs.previous_rank,
    CASE
        WHEN crs.previous_rank IS NULL THEN NULL
        ELSE CAST(crs.previous_rank AS SIGNED) - CAST(crs.rank_position AS SIGNED)
    END AS rank_change,
    crs.score,
    rb.season_id,
    rb.created_at AS snapshot_at
FROM club_ranking_snapshots crs
JOIN ranking_snapshot_batches rb ON rb.id = crs.batch_id
JOIN clubs c ON c.id = crs.club_id
WHERE rb.id = (
    SELECT MAX(id)
    FROM ranking_snapshot_batches
    WHERE entity_type = 'CLUB' AND category = 'WORLD'
);

CREATE OR REPLACE VIEW v_latest_player_rankings AS
SELECT
    prs.player_id,
    p.full_name,
    p.club_id,
    c.name AS club_name,
    rb.category,
    prs.rank_position,
    prs.previous_rank,
    CASE
        WHEN prs.previous_rank IS NULL THEN NULL
        ELSE CAST(prs.previous_rank AS SIGNED) - CAST(prs.rank_position AS SIGNED)
    END AS rank_change,
    prs.score,
    rb.season_id,
    rb.created_at AS snapshot_at
FROM player_ranking_snapshots prs
JOIN ranking_snapshot_batches rb ON rb.id = prs.batch_id
JOIN players p ON p.id = prs.player_id
LEFT JOIN clubs c ON c.id = p.club_id
WHERE rb.id = (
    SELECT MAX(rb2.id)
    FROM ranking_snapshot_batches rb2
    WHERE rb2.entity_type = 'PLAYER'
      AND rb2.category = rb.category
      AND rb2.club_context_id IS NULL
);

CREATE OR REPLACE VIEW v_player_market_value_changes AS
SELECT
    p.id AS player_id,
    p.full_name,
    p.club_id,
    p.market_value AS current_value,
    h.old_value,
    h.new_value,
    h.new_value - h.old_value AS value_change,
    CASE
        WHEN h.old_value = 0 THEN NULL
        ELSE ROUND(((h.new_value - h.old_value) / h.old_value) * 100, 2)
    END AS change_percent,
    h.changed_at
FROM players p
LEFT JOIN player_market_value_history h
       ON h.id = (
            SELECT h2.id
            FROM player_market_value_history h2
            WHERE h2.player_id = p.id
            ORDER BY h2.changed_at DESC, h2.id DESC
            LIMIT 1
       );


/* ========================================================================== */
/* 10. STORED PROCEDURES - WALLET, VALUES, GROUPS AND BRACKETS                 */
/* ========================================================================== */

DELIMITER $$

CREATE PROCEDURE sp_post_wallet_entry_core(
    IN p_wallet_id BIGINT UNSIGNED,
    IN p_direction VARCHAR(10),
    IN p_transaction_type VARCHAR(30),
    IN p_amount DECIMAL(20,0),
    IN p_transfer_group_code VARCHAR(80),
    IN p_counterparty_wallet_id BIGINT UNSIGNED,
    IN p_reference_table VARCHAR(80),
    IN p_reference_id BIGINT UNSIGNED,
    IN p_note VARCHAR(500),
    IN p_created_by_user_id BIGINT UNSIGNED,
    IN p_reversal_of_transaction_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_before DECIMAL(20,0) DEFAULT NULL;
    DECLARE v_after DECIMAL(20,0) DEFAULT NULL;
    DECLARE v_wallet_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_transaction_code VARCHAR(80);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @allow_wallet_balance_write = 0;
        RESIGNAL;
    END;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Số tiền giao dịch phải lớn hơn 0.';
    END IF;

    IF p_direction NOT IN ('CREDIT','DEBIT') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chiều giao dịch không hợp lệ.';
    END IF;

    SELECT balance, status
      INTO v_before, v_wallet_status
    FROM wallets
    WHERE id = p_wallet_id
    FOR UPDATE;

    IF v_before IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy ví.';
    END IF;

    IF v_wallet_status <> 'ACTIVE' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ví không ở trạng thái hoạt động.';
    END IF;

    IF p_direction = 'DEBIT' THEN
        IF v_before < p_amount THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Số dư ví không đủ để thực hiện giao dịch.';
        END IF;
        SET v_after = v_before - p_amount;
    ELSE
        SET v_after = v_before + p_amount;
    END IF;

    SET @allow_wallet_balance_write = 1;
    UPDATE wallets
    SET balance = v_after
    WHERE id = p_wallet_id;
    SET @allow_wallet_balance_write = 0;

    SET v_transaction_code = CONCAT('TX-', REPLACE(UUID(), '-', ''));

    INSERT INTO wallet_transactions(
        transaction_code,
        transfer_group_code,
        wallet_id,
        counterparty_wallet_id,
        direction,
        transaction_type,
        amount,
        balance_before,
        balance_after,
        reference_table,
        reference_id,
        reversal_of_transaction_id,
        note,
        created_by_user_id
    ) VALUES (
        v_transaction_code,
        p_transfer_group_code,
        p_wallet_id,
        p_counterparty_wallet_id,
        p_direction,
        p_transaction_type,
        p_amount,
        v_before,
        v_after,
        p_reference_table,
        p_reference_id,
        p_reversal_of_transaction_id,
        p_note,
        p_created_by_user_id
    );
END$$

CREATE PROCEDURE sp_wallet_transfer_core(
    IN p_from_wallet_id BIGINT UNSIGNED,
    IN p_to_wallet_id BIGINT UNSIGNED,
    IN p_transaction_type VARCHAR(30),
    IN p_amount DECIMAL(20,0),
    IN p_transfer_group_code VARCHAR(80),
    IN p_reference_table VARCHAR(80),
    IN p_reference_id BIGINT UNSIGNED,
    IN p_note VARCHAR(500),
    IN p_created_by_user_id BIGINT UNSIGNED
)
BEGIN
    IF p_from_wallet_id = p_to_wallet_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ví nguồn và ví nhận không được trùng nhau.';
    END IF;

    CALL sp_post_wallet_entry_core(
        p_from_wallet_id, 'DEBIT', p_transaction_type, p_amount,
        p_transfer_group_code, p_to_wallet_id,
        p_reference_table, p_reference_id, p_note,
        p_created_by_user_id, NULL
    );

    CALL sp_post_wallet_entry_core(
        p_to_wallet_id, 'CREDIT', p_transaction_type, p_amount,
        p_transfer_group_code, p_from_wallet_id,
        p_reference_table, p_reference_id, p_note,
        p_created_by_user_id, NULL
    );
END$$

CREATE PROCEDURE sp_admin_wallet_action(
    IN p_admin_user_id BIGINT UNSIGNED,
    IN p_wallet_id BIGINT UNSIGNED,
    IN p_direction VARCHAR(10),
    IN p_transaction_type VARCHAR(30),
    IN p_amount DECIMAL(20,0),
    IN p_note VARCHAR(500)
)
BEGIN
    DECLARE v_group_code VARCHAR(80);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được thao tác ví thủ công.';
    END IF;

    IF p_transaction_type NOT IN ('DEPOSIT','WITHDRAWAL','PENALTY','BONUS','ADJUSTMENT','REFUND') THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Loại giao dịch thủ công không được phép.';
    END IF;

    IF p_transaction_type IN ('DEPOSIT','BONUS','REFUND') AND p_direction <> 'CREDIT' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Loại giao dịch này phải cộng tiền vào ví.';
    END IF;

    IF p_transaction_type IN ('WITHDRAWAL','PENALTY') AND p_direction <> 'DEBIT' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Loại giao dịch này phải trừ tiền khỏi ví.';
    END IF;

    SET v_group_code = CONCAT('MANUAL-', REPLACE(UUID(), '-', ''));

    START TRANSACTION;

    CALL sp_post_wallet_entry_core(
        p_wallet_id,
        p_direction,
        p_transaction_type,
        p_amount,
        v_group_code,
        NULL,
        'manual_wallet_action',
        NULL,
        p_note,
        p_admin_user_id,
        NULL
    );

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'ADMIN_WALLET_ACTION',
        'wallets',
        p_wallet_id,
        JSON_OBJECT(
            'direction', p_direction,
            'transaction_type', p_transaction_type,
            'amount', p_amount,
            'transfer_group_code', v_group_code,
            'note', p_note
        )
    );

    COMMIT;
END$$

CREATE PROCEDURE sp_reverse_wallet_transaction(
    IN p_admin_user_id BIGINT UNSIGNED,
    IN p_transaction_id BIGINT UNSIGNED,
    IN p_reason VARCHAR(500)
)
BEGIN
    DECLARE v_wallet_id BIGINT UNSIGNED;
    DECLARE v_direction VARCHAR(10);
    DECLARE v_amount DECIMAL(20,0);
    DECLARE v_reverse_direction VARCHAR(10);
    DECLARE v_group_code VARCHAR(80);

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được đảo giao dịch.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM wallet_transactions
        WHERE reversal_of_transaction_id = p_transaction_id
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Giao dịch này đã được đảo trước đó.';
    END IF;

    SELECT wallet_id, direction, amount
      INTO v_wallet_id, v_direction, v_amount
    FROM wallet_transactions
    WHERE id = p_transaction_id;

    IF v_wallet_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy giao dịch cần đảo.';
    END IF;

    SET v_reverse_direction = IF(v_direction = 'CREDIT', 'DEBIT', 'CREDIT');
    SET v_group_code = CONCAT('REV-', REPLACE(UUID(), '-', ''));

    START TRANSACTION;

    CALL sp_post_wallet_entry_core(
        v_wallet_id,
        v_reverse_direction,
        'REVERSAL',
        v_amount,
        v_group_code,
        NULL,
        'wallet_transactions',
        p_transaction_id,
        p_reason,
        p_admin_user_id,
        p_transaction_id
    );

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'REVERSE_WALLET_TRANSACTION',
        'wallet_transactions',
        p_transaction_id,
        JSON_OBJECT('reason', p_reason, 'transfer_group_code', v_group_code)
    );

    COMMIT;
END$$

CREATE PROCEDURE sp_update_player_market_value(
    IN p_player_id BIGINT UNSIGNED,
    IN p_new_value DECIMAL(20,0),
    IN p_user_id BIGINT UNSIGNED,
    IN p_reason VARCHAR(500)
)
BEGIN
    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        SET @app_user_id = NULL;
        SET @app_change_reason = NULL;
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_new_value < 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Giá cầu thủ không được âm.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM users WHERE id = p_user_id AND is_active = TRUE) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Tài khoản cập nhật không hợp lệ.';
    END IF;

    START TRANSACTION;

    SET @app_user_id = p_user_id;
    SET @app_change_reason = p_reason;

    UPDATE players
    SET market_value = p_new_value
    WHERE id = p_player_id;

    IF ROW_COUNT() = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy cầu thủ.';
    END IF;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_user_id,
        'UPDATE_PLAYER_MARKET_VALUE',
        'players',
        p_player_id,
        JSON_OBJECT('new_value', p_new_value, 'reason', p_reason)
    );

    SET @app_user_id = NULL;
    SET @app_change_reason = NULL;

    COMMIT;
END$$

CREATE PROCEDURE sp_generate_group_matches(
    IN p_competition_id BIGINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_leg_mode VARCHAR(20);
    DECLARE v_existing_matches INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được tạo lịch vòng bảng.';
    END IF;

    SELECT group_leg_mode INTO v_leg_mode
    FROM competitions
    WHERE id = p_competition_id;

    IF v_leg_mode IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy giải đấu.';
    END IF;

    SELECT COUNT(*) INTO v_existing_matches
    FROM matches
    WHERE competition_id = p_competition_id AND stage_type = 'GROUP';

    IF v_existing_matches > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Giải đã có trận vòng bảng; không thể tạo trùng.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM competition_groups g
        LEFT JOIN competition_group_members gm ON gm.group_id = g.id
        WHERE g.competition_id = p_competition_id
        GROUP BY g.id
        HAVING COUNT(gm.id) < 2
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Mỗi bảng phải có ít nhất 2 CLB.';
    END IF;

    START TRANSACTION;

    INSERT INTO matches(
        competition_id, stage_type, group_id, round_id,
        match_no, leg_no, home_club_id, away_club_id,
        status, created_by_user_id
    )
    SELECT
        g.competition_id,
        'GROUP',
        g.id,
        NULL,
        ROW_NUMBER() OVER (
            PARTITION BY g.id
            ORDER BY gm1.slot_no, gm2.slot_no
        ) AS match_no,
        1,
        gm1.club_id,
        gm2.club_id,
        'SCHEDULED',
        p_admin_user_id
    FROM competition_groups g
    JOIN competition_group_members gm1 ON gm1.group_id = g.id
    JOIN competition_group_members gm2
      ON gm2.group_id = g.id
     AND gm1.slot_no < gm2.slot_no
    WHERE g.competition_id = p_competition_id;

    IF v_leg_mode = 'TWO_LEG' THEN
        INSERT INTO matches(
            competition_id, stage_type, group_id, round_id,
            match_no, leg_no, home_club_id, away_club_id,
            status, created_by_user_id
        )
        SELECT
            competition_id,
            'GROUP',
            group_id,
            NULL,
            match_no,
            2,
            away_club_id,
            home_club_id,
            'SCHEDULED',
            p_admin_user_id
        FROM matches
        WHERE competition_id = p_competition_id
          AND stage_type = 'GROUP'
          AND leg_no = 1;
    END IF;

    UPDATE competitions
    SET status = 'GROUP_STAGE'
    WHERE id = p_competition_id;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'GENERATE_GROUP_MATCHES',
        'competitions',
        p_competition_id,
        JSON_OBJECT('leg_mode', v_leg_mode)
    );

    COMMIT;
END$$

CREATE PROCEDURE sp_create_knockout_bracket(
    IN p_competition_id BIGINT UNSIGNED,
    IN p_bracket_size SMALLINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_team_count INT;
    DECLARE v_match_count INT;
    DECLARE v_round_order INT DEFAULT 1;
    DECLARE v_round_name VARCHAR(80);
    DECLARE v_round_id BIGINT UNSIGNED;
    DECLARE v_previous_round_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_i INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được tạo nhánh đấu.';
    END IF;

    IF p_bracket_size < 2 OR p_bracket_size > 128
       OR (p_bracket_size & (p_bracket_size - 1)) <> 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Kích thước nhánh phải là 2, 4, 8, 16, 32, 64 hoặc 128.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM competitions WHERE id = p_competition_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy giải đấu.';
    END IF;

    IF EXISTS (SELECT 1 FROM competition_rounds WHERE competition_id = p_competition_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Giải đã có nhánh đấu.';
    END IF;

    START TRANSACTION;

    SET v_team_count = p_bracket_size;

    WHILE v_team_count >= 2 DO
        SET v_match_count = v_team_count / 2;
        SET v_round_name = CASE v_team_count
            WHEN 128 THEN 'Vòng 128 đội'
            WHEN 64 THEN 'Vòng 64 đội'
            WHEN 32 THEN 'Vòng 32 đội'
            WHEN 16 THEN 'Vòng 16 đội'
            WHEN 8 THEN 'Tứ kết'
            WHEN 4 THEN 'Bán kết'
            WHEN 2 THEN 'Chung kết'
            ELSE CONCAT('Vòng ', v_team_count, ' đội')
        END;

        INSERT INTO competition_rounds(
            competition_id, round_name, round_order,
            team_count, match_count, status
        ) VALUES (
            p_competition_id, v_round_name, v_round_order,
            v_team_count, v_match_count, 'NOT_STARTED'
        );

        SET v_round_id = LAST_INSERT_ID();
        SET v_i = 1;

        WHILE v_i <= v_match_count DO
            INSERT INTO matches(
                competition_id, stage_type, group_id, round_id,
                match_no, leg_no, status, created_by_user_id
            ) VALUES (
                p_competition_id, 'KNOCKOUT', NULL, v_round_id,
                v_i, 1, 'SCHEDULED', p_admin_user_id
            );
            SET v_i = v_i + 1;
        END WHILE;

        IF v_previous_round_id IS NOT NULL THEN
            INSERT INTO match_advancement_links(source_match_id, target_match_id, target_slot)
            SELECT
                source_match.id,
                target_match.id,
                CASE WHEN MOD(source_match.match_no, 2) = 1 THEN 'HOME' ELSE 'AWAY' END
            FROM matches source_match
            JOIN matches target_match
              ON target_match.round_id = v_round_id
             AND target_match.match_no = CEIL(source_match.match_no / 2)
            WHERE source_match.round_id = v_previous_round_id;
        END IF;

        SET v_previous_round_id = v_round_id;
        SET v_team_count = v_team_count / 2;
        SET v_round_order = v_round_order + 1;
    END WHILE;

    UPDATE competitions
    SET knockout_size = p_bracket_size,
        status = CASE
            WHEN format_type = 'KNOCKOUT_ONLY' THEN 'KNOCKOUT_READY'
            ELSE status
        END
    WHERE id = p_competition_id;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'CREATE_KNOCKOUT_BRACKET',
        'competitions',
        p_competition_id,
        JSON_OBJECT('bracket_size', p_bracket_size)
    );

    COMMIT;

    SELECT id, round_name, round_order, team_count, match_count
    FROM competition_rounds
    WHERE competition_id = p_competition_id
    ORDER BY round_order;
END$$

CREATE PROCEDURE sp_finalize_group_stage(
    IN p_competition_id BIGINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_advance_per_group INT;
    DECLARE v_best_third_count INT;
    DECLARE v_group_match_count INT;
    DECLARE v_unfinished_count INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được chốt vòng bảng.';
    END IF;

    SELECT advance_per_group, best_third_count
      INTO v_advance_per_group, v_best_third_count
    FROM competitions
    WHERE id = p_competition_id;

    IF v_advance_per_group IS NULL OR v_advance_per_group = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Giải chưa cấu hình số đội đi tiếp mỗi bảng.';
    END IF;

    SELECT COUNT(*), SUM(CASE WHEN status <> 'FINISHED' THEN 1 ELSE 0 END)
      INTO v_group_match_count, v_unfinished_count
    FROM matches
    WHERE competition_id = p_competition_id
      AND stage_type = 'GROUP';

    IF v_group_match_count = 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Giải chưa có trận vòng bảng.';
    END IF;

    IF COALESCE(v_unfinished_count, 0) > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Còn trận vòng bảng chưa kết thúc.';
    END IF;

    START TRANSACTION;

    DELETE FROM competition_qualified_teams
    WHERE competition_id = p_competition_id;

    INSERT INTO competition_qualified_teams(
        competition_id, group_id, club_id, group_rank, qualification_type
    )
    SELECT
        competition_id, group_id, club_id, group_rank, 'DIRECT'
    FROM v_group_standings
    WHERE competition_id = p_competition_id
      AND group_rank <= v_advance_per_group;

    IF v_best_third_count > 0 THEN
        INSERT INTO competition_qualified_teams(
            competition_id, group_id, club_id, group_rank, qualification_type
        )
        SELECT
            x.competition_id,
            x.group_id,
            x.club_id,
            x.group_rank,
            'BEST_THIRD'
        FROM (
            SELECT
                vgs.*,
                ROW_NUMBER() OVER (
                    ORDER BY
                        vgs.points DESC,
                        vgs.goal_difference DESC,
                        vgs.goals_for DESC,
                        vgs.club_name ASC
                ) AS best_rank_order
            FROM v_group_standings vgs
            WHERE vgs.competition_id = p_competition_id
              AND vgs.group_rank = v_advance_per_group + 1
        ) x
        WHERE x.best_rank_order <= v_best_third_count;
    END IF;

    UPDATE competitions
    SET status = 'KNOCKOUT_READY'
    WHERE id = p_competition_id;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'FINALIZE_GROUP_STAGE',
        'competitions',
        p_competition_id,
        JSON_OBJECT(
            'advance_per_group', v_advance_per_group,
            'best_third_count', v_best_third_count
        )
    );

    COMMIT;

    SELECT *
    FROM competition_qualified_teams
    WHERE competition_id = p_competition_id
    ORDER BY qualification_type, group_id, group_rank;
END$$

CREATE PROCEDURE sp_seed_first_knockout_round(
    IN p_competition_id BIGINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_first_round_id BIGINT UNSIGNED;
    DECLARE v_match_count INT;
    DECLARE v_rule_count INT;
    DECLARE v_unassigned INT;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được xếp đội vào nhánh.';
    END IF;

    SELECT id, match_count
      INTO v_first_round_id, v_match_count
    FROM competition_rounds
    WHERE competition_id = p_competition_id
    ORDER BY round_order
    LIMIT 1;

    IF v_first_round_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Giải chưa có nhánh đấu.';
    END IF;

    SELECT COUNT(*) INTO v_rule_count
    FROM knockout_pairing_rules
    WHERE round_id = v_first_round_id;

    IF v_rule_count <> v_match_count THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Số quy tắc ghép cặp không khớp số trận của vòng đầu.';
    END IF;

    START TRANSACTION;

    UPDATE matches m
    JOIN knockout_pairing_rules r
      ON r.round_id = m.round_id
     AND r.match_no = m.match_no
    JOIN competition_qualified_teams h
      ON h.competition_id = p_competition_id
     AND h.group_id = r.home_group_id
     AND h.group_rank = r.home_group_rank
    JOIN competition_qualified_teams a
      ON a.competition_id = p_competition_id
     AND a.group_id = r.away_group_id
     AND a.group_rank = r.away_group_rank
    SET m.home_club_id = h.club_id,
        m.away_club_id = a.club_id,
        m.status = 'SCHEDULED'
    WHERE m.round_id = v_first_round_id;

    SELECT COUNT(*) INTO v_unassigned
    FROM matches
    WHERE round_id = v_first_round_id
      AND (home_club_id IS NULL OR away_club_id IS NULL);

    IF v_unassigned > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Không thể xác định đủ đội từ quy tắc ghép cặp.';
    END IF;

    UPDATE competition_rounds
    SET status = 'IN_PROGRESS'
    WHERE id = v_first_round_id;

    UPDATE competitions
    SET status = 'KNOCKOUT_STAGE'
    WHERE id = p_competition_id;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'SEED_FIRST_KNOCKOUT_ROUND',
        'competitions',
        p_competition_id,
        JSON_OBJECT('round_id', v_first_round_id)
    );

    COMMIT;
END$$

DELIMITER ;

/* ========================================================================== */
/* 11. STORED PROCEDURES - MATCH RESULTS, AWARDS AND TRANSFERS                 */
/* ========================================================================== */

DELIMITER $$

CREATE PROCEDURE sp_set_match_result(
    IN p_match_id BIGINT UNSIGNED,
    IN p_home_score SMALLINT UNSIGNED,
    IN p_away_score SMALLINT UNSIGNED,
    IN p_home_penalty_score SMALLINT UNSIGNED,
    IN p_away_penalty_score SMALLINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED,
    IN p_note VARCHAR(500)
)
BEGIN
    DECLARE v_competition_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_series_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_season_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_season_sequence INT DEFAULT NULL;
    DECLARE v_stage_type VARCHAR(20) DEFAULT NULL;
    DECLARE v_round_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_home_club_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_away_club_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_winner_club_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_loser_club_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_match_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_target_match_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_target_slot VARCHAR(10) DEFAULT NULL;
    DECLARE v_target_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_target_current_club BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_previous_competition_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_previous_placement INT DEFAULT NULL;
    DECLARE v_previous_prize DECIMAL(20,0) DEFAULT 0;
    DECLARE v_enabled BOOLEAN DEFAULT FALSE;
    DECLARE v_champion_fraction DECIMAL(8,4) DEFAULT 0;
    DECLARE v_runnerup_fraction DECIMAL(8,4) DEFAULT 0;
    DECLARE v_fifa_share DECIMAL(8,4) DEFAULT 0.5;
    DECLARE v_defeated_share DECIMAL(8,4) DEFAULT 0.5;
    DECLARE v_max_champion INT DEFAULT 0;
    DECLARE v_max_runnerup INT DEFAULT 0;
    DECLARE v_existing_reward_count INT DEFAULT 0;
    DECLARE v_reward_fraction DECIMAL(8,4) DEFAULT 0;
    DECLARE v_reward_amount DECIMAL(20,0) DEFAULT 0;
    DECLARE v_fifa_contribution DECIMAL(20,0) DEFAULT 0;
    DECLARE v_defeated_contribution DECIMAL(20,0) DEFAULT 0;
    DECLARE v_previous_label VARCHAR(20) DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được xác nhận kết quả.';
    END IF;

    IF p_home_score IS NULL OR p_away_score IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Phải nhập đủ tỷ số hai đội.';
    END IF;

    START TRANSACTION;

    SELECT
        m.competition_id,
        c.series_id,
        c.season_id,
        s.sequence_no,
        m.stage_type,
        m.round_id,
        m.home_club_id,
        m.away_club_id,
        m.status
    INTO
        v_competition_id,
        v_series_id,
        v_season_id,
        v_season_sequence,
        v_stage_type,
        v_round_id,
        v_home_club_id,
        v_away_club_id,
        v_match_status
    FROM matches m
    JOIN competitions c ON c.id = m.competition_id
    JOIN seasons s ON s.id = c.season_id
    WHERE m.id = p_match_id
    FOR UPDATE;

    IF v_competition_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy trận đấu.';
    END IF;

    IF v_home_club_id IS NULL OR v_away_club_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Trận đấu chưa có đủ hai đội.';
    END IF;

    IF v_match_status = 'FINISHED' THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Trận đã được xác nhận. Hãy dùng quy trình hiệu chỉnh riêng nếu nhập sai.';
    END IF;

    IF v_match_status = 'CANCELLED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không thể nhập kết quả cho trận đã hủy.';
    END IF;

    IF v_stage_type = 'GROUP'
       AND (p_home_penalty_score IS NOT NULL OR p_away_penalty_score IS NOT NULL) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Trận vòng bảng không sử dụng tỷ số luân lưu.';
    END IF;

    IF p_home_score <> p_away_score
       AND (p_home_penalty_score IS NOT NULL OR p_away_penalty_score IS NOT NULL) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Chỉ nhập tỷ số luân lưu khi tỷ số chính thức hòa.';
    END IF;

    IF p_home_score > p_away_score THEN
        SET v_winner_club_id = v_home_club_id;
        SET v_loser_club_id = v_away_club_id;
    ELSEIF p_away_score > p_home_score THEN
        SET v_winner_club_id = v_away_club_id;
        SET v_loser_club_id = v_home_club_id;
    ELSEIF v_stage_type = 'KNOCKOUT' THEN
        IF p_home_penalty_score IS NULL OR p_away_penalty_score IS NULL
           OR p_home_penalty_score = p_away_penalty_score THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Trận loại trực tiếp hòa phải có tỷ số luân lưu phân thắng bại.';
        END IF;

        IF p_home_penalty_score > p_away_penalty_score THEN
            SET v_winner_club_id = v_home_club_id;
            SET v_loser_club_id = v_away_club_id;
        ELSE
            SET v_winner_club_id = v_away_club_id;
            SET v_loser_club_id = v_home_club_id;
        END IF;
    END IF;

    UPDATE matches
    SET home_score = p_home_score,
        away_score = p_away_score,
        home_penalty_score = p_home_penalty_score,
        away_penalty_score = p_away_penalty_score,
        winner_club_id = v_winner_club_id,
        loser_club_id = v_loser_club_id,
        status = 'FINISHED',
        confirmed_by_user_id = p_admin_user_id,
        note = p_note
    WHERE id = p_match_id;

    IF v_stage_type = 'KNOCKOUT' AND v_winner_club_id IS NOT NULL THEN
        SET v_target_match_id = NULL;
        SET v_target_slot = NULL;
        SELECT target_match_id, target_slot
          INTO v_target_match_id, v_target_slot
        FROM match_advancement_links
        WHERE source_match_id = p_match_id
        LIMIT 1;

        IF v_target_match_id IS NOT NULL THEN
            IF v_target_slot = 'HOME' THEN
                SELECT status, home_club_id
                  INTO v_target_status, v_target_current_club
                FROM matches
                WHERE id = v_target_match_id
                FOR UPDATE;

                IF v_target_status <> 'SCHEDULED'
                   OR (v_target_current_club IS NOT NULL AND v_target_current_club <> v_winner_club_id) THEN
                    SIGNAL SQLSTATE '45000'
                        SET MESSAGE_TEXT = 'Không thể đẩy đội thắng: ô trận kế tiếp đã được sử dụng.';
                END IF;

                UPDATE matches
                SET home_club_id = v_winner_club_id
                WHERE id = v_target_match_id;
            ELSE
                SELECT status, away_club_id
                  INTO v_target_status, v_target_current_club
                FROM matches
                WHERE id = v_target_match_id
                FOR UPDATE;

                IF v_target_status <> 'SCHEDULED'
                   OR (v_target_current_club IS NOT NULL AND v_target_current_club <> v_winner_club_id) THEN
                    SIGNAL SQLSTATE '45000'
                        SET MESSAGE_TEXT = 'Không thể đẩy đội thắng: ô trận kế tiếp đã được sử dụng.';
                END IF;

                UPDATE matches
                SET away_club_id = v_winner_club_id
                WHERE id = v_target_match_id;
            END IF;
        END IF;

        UPDATE competition_rounds
        SET status = CASE
            WHEN EXISTS (
                SELECT 1 FROM matches
                WHERE round_id = v_round_id AND status <> 'FINISHED'
            ) THEN 'IN_PROGRESS'
            ELSE 'FINISHED'
        END
        WHERE id = v_round_id;
    END IF;

    /* Detect first configured win over the previous champion or runner-up. */
    IF v_winner_club_id IS NOT NULL THEN
        SELECT pc.id
          INTO v_previous_competition_id
        FROM competitions pc
        JOIN seasons ps ON ps.id = pc.season_id
        WHERE pc.series_id = v_series_id
          AND ps.sequence_no < v_season_sequence
          AND pc.status = 'FINISHED'
        ORDER BY ps.sequence_no DESC
        LIMIT 1;

        IF v_previous_competition_id IS NOT NULL THEN
            SELECT cr.placement
              INTO v_previous_placement
            FROM competition_results cr
            WHERE cr.competition_id = v_previous_competition_id
              AND cr.club_id = v_loser_club_id
              AND cr.placement IN (1,2)
            LIMIT 1;

            IF v_previous_placement IN (1,2) THEN
                SELECT
                    enabled,
                    champion_reward_fraction,
                    runnerup_reward_fraction,
                    fifa_share_fraction,
                    defeated_share_fraction,
                    max_champion_rewards,
                    max_runnerup_rewards
                INTO
                    v_enabled,
                    v_champion_fraction,
                    v_runnerup_fraction,
                    v_fifa_share,
                    v_defeated_share,
                    v_max_champion,
                    v_max_runnerup
                FROM competition_special_reward_rules
                WHERE competition_id = v_competition_id;

                IF COALESCE(v_enabled, FALSE) = TRUE THEN
                    SET v_previous_label = IF(v_previous_placement = 1, 'CHAMPION', 'RUNNER_UP');
                    SET v_reward_fraction = IF(v_previous_placement = 1, v_champion_fraction, v_runnerup_fraction);

                    SELECT COUNT(*) INTO v_existing_reward_count
                    FROM competition_upset_rewards
                    WHERE competition_id = v_competition_id
                      AND defeated_previous_placement = v_previous_label
                      AND status IN ('PENDING','PAID');

                    IF (
                        (v_previous_placement = 1 AND v_existing_reward_count < v_max_champion)
                        OR (v_previous_placement = 2 AND v_existing_reward_count < v_max_runnerup)
                    ) THEN
                        SELECT COALESCE(MAX(prize_amount), 0)
                          INTO v_previous_prize
                        FROM competition_prize_rules
                        WHERE competition_id = v_previous_competition_id
                          AND v_previous_placement BETWEEN placement_from AND placement_to;

                        SET v_reward_amount = FLOOR(v_previous_prize * v_reward_fraction);
                        SET v_fifa_contribution = FLOOR(v_reward_amount * v_fifa_share);
                        SET v_defeated_contribution = v_reward_amount - v_fifa_contribution;

                        IF v_reward_amount > 0 THEN
                            INSERT INTO competition_upset_rewards(
                                competition_id,
                                match_id,
                                winning_club_id,
                                defeated_club_id,
                                defeated_previous_placement,
                                previous_prize_amount,
                                reward_amount,
                                fifa_contribution,
                                defeated_club_contribution,
                                status
                            ) VALUES (
                                v_competition_id,
                                p_match_id,
                                v_winner_club_id,
                                v_loser_club_id,
                                v_previous_label,
                                v_previous_prize,
                                v_reward_amount,
                                v_fifa_contribution,
                                v_defeated_contribution,
                                'PENDING'
                            );

                            UPDATE matches
                            SET highlighted_upset = TRUE
                            WHERE id = p_match_id;
                        END IF;
                    END IF;
                END IF;
            END IF;
        END IF;
    END IF;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'SET_MATCH_RESULT',
        'matches',
        p_match_id,
        JSON_OBJECT(
            'home_score', p_home_score,
            'away_score', p_away_score,
            'home_penalty_score', p_home_penalty_score,
            'away_penalty_score', p_away_penalty_score,
            'winner_club_id', v_winner_club_id,
            'note', p_note
        )
    );

    COMMIT;
END$$

CREATE PROCEDURE sp_assign_player_award(
    IN p_player_id BIGINT UNSIGNED,
    IN p_club_id_at_award BIGINT UNSIGNED,
    IN p_competition_id BIGINT UNSIGNED,
    IN p_award_type_id BIGINT UNSIGNED,
    IN p_assigned_by_user_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_season_id BIGINT UNSIGNED;
    DECLARE v_season_name VARCHAR(100);
    DECLARE v_competition_name VARCHAR(180);
    DECLARE v_club_name VARCHAR(150);
    DECLARE v_award_name VARCHAR(150);
    DECLARE v_base_points DECIMAL(20,3);
    DECLARE v_coefficient DECIMAL(8,3);
    DECLARE v_awarded_points DECIMAL(20,3);
    DECLARE v_display_name VARCHAR(220);
    DECLARE v_player_award_id BIGINT UNSIGNED;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    SELECT
        c.season_id,
        s.name,
        c.name,
        c.coefficient,
        cl.name,
        atp.name,
        atp.base_ranking_points
    INTO
        v_season_id,
        v_season_name,
        v_competition_name,
        v_coefficient,
        v_club_name,
        v_award_name,
        v_base_points
    FROM competitions c
    JOIN seasons s ON s.id = c.season_id
    JOIN clubs cl ON cl.id = p_club_id_at_award
    JOIN award_types atp ON atp.id = p_award_type_id AND atp.is_active = TRUE
    WHERE c.id = p_competition_id;

    IF v_season_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Thông tin giải, CLB hoặc loại danh hiệu không hợp lệ.';
    END IF;

    SET v_awarded_points = v_base_points * v_coefficient;
    SET v_display_name = CONCAT(v_award_name, ' - ', v_competition_name, ' (', v_club_name, ')');

    START TRANSACTION;

    INSERT INTO player_awards(
        player_id,
        club_id_at_award,
        competition_id,
        season_id,
        award_type_id,
        display_name,
        awarded_points,
        assigned_by_user_id
    ) VALUES (
        p_player_id,
        p_club_id_at_award,
        p_competition_id,
        v_season_id,
        p_award_type_id,
        v_display_name,
        v_awarded_points,
        p_assigned_by_user_id
    );

    SET v_player_award_id = LAST_INSERT_ID();

    INSERT INTO player_ranking_points(
        player_id,
        season_id,
        competition_id,
        source_type,
        source_id,
        points,
        description
    ) VALUES (
        p_player_id,
        v_season_id,
        p_competition_id,
        'AWARD',
        v_player_award_id,
        v_awarded_points,
        v_display_name
    );

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_assigned_by_user_id,
        'ASSIGN_PLAYER_AWARD',
        'player_awards',
        v_player_award_id,
        JSON_OBJECT(
            'player_id', p_player_id,
            'club_id_at_award', p_club_id_at_award,
            'competition_id', p_competition_id,
            'award_type_id', p_award_type_id,
            'awarded_points', v_awarded_points
        )
    );

    COMMIT;
END$$

CREATE PROCEDURE sp_lock_competition_player_awards(
    IN p_competition_id BIGINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED
)
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được khóa danh hiệu.';
    END IF;

    UPDATE player_awards
    SET is_locked = TRUE
    WHERE competition_id = p_competition_id;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'LOCK_COMPETITION_PLAYER_AWARDS',
        'competitions',
        p_competition_id,
        JSON_OBJECT('locked_awards', ROW_COUNT())
    );
END$$

CREATE PROCEDURE sp_complete_transfer(
    IN p_transfer_offer_id BIGINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_player_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_current_club_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_seller_club_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_buyer_club_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_transfer_type VARCHAR(10);
    DECLARE v_transfer_fee DECIMAL(20,0);
    DECLARE v_new_salary DECIMAL(20,0);
    DECLARE v_start_season_id BIGINT UNSIGNED;
    DECLARE v_end_season_id BIGINT UNSIGNED;
    DECLARE v_offer_status VARCHAR(20);
    DECLARE v_seller_wallet_id BIGINT UNSIGNED;
    DECLARE v_buyer_wallet_id BIGINT UNSIGNED;
    DECLARE v_transfer_group_code VARCHAR(80);
    DECLARE v_transfer_id BIGINT UNSIGNED;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được hoàn tất chuyển nhượng.';
    END IF;

    START TRANSACTION;

    SELECT
        player_id,
        seller_club_id,
        buyer_club_id,
        transfer_type,
        transfer_fee,
        new_salary_per_season,
        contract_start_season_id,
        contract_end_season_id,
        status
    INTO
        v_player_id,
        v_seller_club_id,
        v_buyer_club_id,
        v_transfer_type,
        v_transfer_fee,
        v_new_salary,
        v_start_season_id,
        v_end_season_id,
        v_offer_status
    FROM transfer_offers
    WHERE id = p_transfer_offer_id
    FOR UPDATE;

    IF v_player_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy đề nghị chuyển nhượng.';
    END IF;

    IF v_offer_status <> 'ACCEPTED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Đề nghị phải ở trạng thái ACCEPTED.';
    END IF;

    SELECT club_id INTO v_current_club_id
    FROM players
    WHERE id = v_player_id
    FOR UPDATE;

    IF NOT (v_current_club_id <=> v_seller_club_id) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'CLB hiện tại của cầu thủ không khớp bên bán trong đề nghị.';
    END IF;

    IF v_transfer_type = 'PAID' AND (v_seller_club_id IS NULL OR v_transfer_fee <= 0) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Chuyển nhượng có phí phải có CLB bán và phí lớn hơn 0.';
    END IF;

    SET v_transfer_group_code = CONCAT('TRANSFER-', REPLACE(UUID(), '-', ''));

    IF v_transfer_fee > 0 THEN
        SELECT id INTO v_buyer_wallet_id
        FROM wallets
        WHERE wallet_type = 'CLUB' AND club_id = v_buyer_club_id;

        SELECT id INTO v_seller_wallet_id
        FROM wallets
        WHERE wallet_type = 'CLUB' AND club_id = v_seller_club_id;

        CALL sp_wallet_transfer_core(
            v_buyer_wallet_id,
            v_seller_wallet_id,
            'TRANSFER_FEE',
            v_transfer_fee,
            v_transfer_group_code,
            'transfer_offers',
            p_transfer_offer_id,
            CONCAT('Phí chuyển nhượng cầu thủ ID ', v_player_id),
            p_admin_user_id
        );
    END IF;

    UPDATE player_contracts
    SET status = 'TERMINATED', ended_at = CURRENT_TIMESTAMP(6)
    WHERE player_id = v_player_id AND status = 'ACTIVE';

    UPDATE player_club_history
    SET left_at = CURRENT_TIMESTAMP(6),
        movement_type = IF(v_transfer_type = 'FREE', 'FREE_TRANSFER', 'TRANSFER')
    WHERE player_id = v_player_id AND left_at IS NULL;

    UPDATE players
    SET club_id = v_buyer_club_id,
        shirt_number = NULL,
        status = 'ACTIVE'
    WHERE id = v_player_id;

    INSERT INTO player_contracts(
        player_id,
        club_id,
        start_season_id,
        end_season_id,
        salary_per_season,
        status,
        note
    ) VALUES (
        v_player_id,
        v_buyer_club_id,
        v_start_season_id,
        v_end_season_id,
        v_new_salary,
        'ACTIVE',
        CONCAT('Tạo từ đề nghị chuyển nhượng #', p_transfer_offer_id)
    );

    INSERT INTO player_transfers(
        transfer_offer_id,
        player_id,
        from_club_id,
        to_club_id,
        transfer_type,
        transfer_fee,
        transfer_group_code,
        completed_by_user_id
    ) VALUES (
        p_transfer_offer_id,
        v_player_id,
        v_seller_club_id,
        v_buyer_club_id,
        v_transfer_type,
        v_transfer_fee,
        IF(v_transfer_fee > 0, v_transfer_group_code, NULL),
        p_admin_user_id
    );

    SET v_transfer_id = LAST_INSERT_ID();

    INSERT INTO player_club_history(
        player_id, club_id, movement_type, note
    ) VALUES (
        v_player_id,
        v_buyer_club_id,
        IF(v_transfer_type = 'FREE', 'FREE_TRANSFER', 'TRANSFER'),
        CONCAT('Chuyển nhượng #', v_transfer_id)
    );

    UPDATE transfer_offers
    SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP(6)
    WHERE id = p_transfer_offer_id;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'COMPLETE_PLAYER_TRANSFER',
        'player_transfers',
        v_transfer_id,
        JSON_OBJECT(
            'player_id', v_player_id,
            'from_club_id', v_seller_club_id,
            'to_club_id', v_buyer_club_id,
            'transfer_type', v_transfer_type,
            'transfer_fee', v_transfer_fee
        )
    );

    COMMIT;
END$$

DELIMITER ;

/* ========================================================================== */
/* 12. STORED PROCEDURES - RANKING SNAPSHOTS                                   */
/* ========================================================================== */

DELIMITER $$

CREATE PROCEDURE sp_snapshot_club_rankings(
    IN p_season_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_batch_id BIGINT UNSIGNED;
    DECLARE v_previous_batch_id BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_season_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM seasons WHERE id = p_season_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Mùa giải xếp hạng không hợp lệ.';
    END IF;

    START TRANSACTION;

    SELECT MAX(id) INTO v_previous_batch_id
    FROM ranking_snapshot_batches
    WHERE entity_type = 'CLUB'
      AND category = 'WORLD'
      AND club_context_id IS NULL;

    INSERT INTO ranking_snapshot_batches(
        entity_type, category, season_id, club_context_id
    ) VALUES ('CLUB', 'WORLD', p_season_id, NULL);

    SET v_batch_id = LAST_INSERT_ID();

    INSERT INTO club_ranking_snapshots(
        batch_id, club_id, rank_position, previous_rank, score
    )
    SELECT
        v_batch_id,
        ranked.club_id,
        ranked.rank_position,
        previous_snapshot.rank_position,
        ranked.score
    FROM (
        SELECT
            scores.club_id,
            scores.score,
            DENSE_RANK() OVER (
                ORDER BY scores.score DESC, scores.club_id ASC
            ) AS rank_position
        FROM (
            SELECT
                c.id AS club_id,
                COALESCE(SUM(crp.points), 0) AS score
            FROM clubs c
            LEFT JOIN club_ranking_points crp ON crp.club_id = c.id
            WHERE c.registration_status = 'APPROVED'
              AND c.is_active = TRUE
            GROUP BY c.id
        ) scores
    ) ranked
    LEFT JOIN club_ranking_snapshots previous_snapshot
      ON previous_snapshot.batch_id = v_previous_batch_id
     AND previous_snapshot.club_id = ranked.club_id;

    COMMIT;
END$$

CREATE PROCEDURE sp_snapshot_player_category(
    IN p_season_id BIGINT UNSIGNED,
    IN p_category VARCHAR(30),
    IN p_club_context_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_batch_id BIGINT UNSIGNED;
    DECLARE v_previous_batch_id BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF p_category NOT IN ('OVERALL','GOALS','GOALKEEPER','WEALTH','MARKET_VALUE') THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Loại xếp hạng cầu thủ không hợp lệ.';
    END IF;

    START TRANSACTION;

    SELECT MAX(id) INTO v_previous_batch_id
    FROM ranking_snapshot_batches
    WHERE entity_type = 'PLAYER'
      AND category = p_category
      AND club_context_id <=> p_club_context_id;

    INSERT INTO ranking_snapshot_batches(
        entity_type, category, season_id, club_context_id
    ) VALUES ('PLAYER', p_category, p_season_id, p_club_context_id);

    SET v_batch_id = LAST_INSERT_ID();

    INSERT INTO player_ranking_snapshots(
        batch_id, player_id, rank_position, previous_rank, score
    )
    SELECT
        v_batch_id,
        ranked.player_id,
        ranked.rank_position,
        previous_snapshot.rank_position,
        ranked.score
    FROM (
        SELECT
            values_to_rank.player_id,
            values_to_rank.score,
            DENSE_RANK() OVER (
                ORDER BY values_to_rank.score DESC, values_to_rank.player_id ASC
            ) AS rank_position
        FROM (
            SELECT
                vm.player_id,
                CASE p_category
                    WHEN 'OVERALL' THEN vm.overall_score
                    WHEN 'GOALS' THEN vm.goals
                    WHEN 'GOALKEEPER' THEN vm.goalkeeper_score
                    WHEN 'WEALTH' THEN vm.wallet_balance
                    WHEN 'MARKET_VALUE' THEN vm.market_value
                END AS score
            FROM v_player_metrics vm
            JOIN players p ON p.id = vm.player_id
            WHERE p.status NOT IN ('RETIRED','SUSPENDED')
              AND (p_club_context_id IS NULL OR vm.club_id = p_club_context_id)
              AND (p_category <> 'GOALKEEPER' OR vm.position = 'GK')
        ) values_to_rank
    ) ranked
    LEFT JOIN player_ranking_snapshots previous_snapshot
      ON previous_snapshot.batch_id = v_previous_batch_id
     AND previous_snapshot.player_id = ranked.player_id;

    COMMIT;
END$$

CREATE PROCEDURE sp_snapshot_all_player_rankings(
    IN p_season_id BIGINT UNSIGNED
)
BEGIN
    CALL sp_snapshot_player_category(p_season_id, 'OVERALL', NULL);
    CALL sp_snapshot_player_category(p_season_id, 'GOALS', NULL);
    CALL sp_snapshot_player_category(p_season_id, 'GOALKEEPER', NULL);
    CALL sp_snapshot_player_category(p_season_id, 'WEALTH', NULL);
    CALL sp_snapshot_player_category(p_season_id, 'MARKET_VALUE', NULL);
END$$

DELIMITER ;

/* ========================================================================== */
/* 13. STORED PROCEDURES - CLOSE COMPETITION AND CLOSE SEASON                  */
/* ========================================================================== */

DELIMITER $$

CREATE PROCEDURE sp_finalize_competition(
    IN p_competition_id BIGINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_season_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_coefficient DECIMAL(8,3) DEFAULT 1;
    DECLARE v_competition_name VARCHAR(180);
    DECLARE v_status VARCHAR(40);
    DECLARE v_third_place_mode VARCHAR(30);
    DECLARE v_knockout_size INT DEFAULT NULL;
    DECLARE v_unfinished_matches INT DEFAULT 0;
    DECLARE v_unmatched_results INT DEFAULT 0;
    DECLARE v_champion_count INT DEFAULT 0;
    DECLARE v_runnerup_count INT DEFAULT 0;
    DECLARE v_third_count INT DEFAULT 0;
    DECLARE v_fifa_wallet_id BIGINT UNSIGNED;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được kết thúc giải.';
    END IF;

    SELECT
        season_id, coefficient, name, status, third_place_mode, knockout_size
    INTO
        v_season_id, v_coefficient, v_competition_name, v_status,
        v_third_place_mode, v_knockout_size
    FROM competitions
    WHERE id = p_competition_id;

    IF v_season_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy giải đấu.';
    END IF;

    IF v_status = 'FINISHED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Giải đấu đã được kết thúc trước đó.';
    END IF;

    SELECT COUNT(*) INTO v_unfinished_matches
    FROM matches
    WHERE competition_id = p_competition_id
      AND status NOT IN ('FINISHED','CANCELLED');

    IF v_unfinished_matches > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Còn trận đấu chưa hoàn tất.';
    END IF;

    SELECT
        SUM(CASE WHEN placement = 1 THEN 1 ELSE 0 END),
        SUM(CASE WHEN placement = 2 THEN 1 ELSE 0 END),
        SUM(CASE WHEN placement = 3 THEN 1 ELSE 0 END)
    INTO v_champion_count, v_runnerup_count, v_third_count
    FROM competition_results
    WHERE competition_id = p_competition_id;

    IF COALESCE(v_champion_count, 0) <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Giải phải có đúng 1 CLB vô địch.';
    END IF;

    IF COALESCE(v_runnerup_count, 0) <> 1 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Giải phải có đúng 1 CLB á quân.';
    END IF;

    IF v_third_place_mode = 'SHARED_BRONZE'
       AND COALESCE(v_knockout_size, 0) >= 4
       AND COALESCE(v_third_count, 0) <> 2 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Giải đồng hạng ba phải có đúng 2 CLB ở vị trí thứ 3.';
    END IF;

    SELECT COUNT(*) INTO v_unmatched_results
    FROM competition_results cr
    LEFT JOIN competition_prize_rules pr
      ON pr.competition_id = cr.competition_id
     AND cr.placement BETWEEN pr.placement_from AND pr.placement_to
    WHERE cr.competition_id = p_competition_id
      AND pr.id IS NULL;

    IF v_unmatched_results > 0 THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Có kết quả chưa được cấu hình tiền thưởng/điểm hệ số.';
    END IF;

    SELECT id INTO v_fifa_wallet_id
    FROM wallets
    WHERE wallet_type = 'FIFA'
    LIMIT 1;

    IF v_fifa_wallet_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chưa có ví Quỹ FIFA.';
    END IF;

    START TRANSACTION;

    BEGIN
        DECLARE v_done INT DEFAULT 0;
        DECLARE v_result_id BIGINT UNSIGNED;
        DECLARE v_club_id BIGINT UNSIGNED;
        DECLARE v_placement INT;
        DECLARE v_prize_amount DECIMAL(20,0);
        DECLARE v_base_points DECIMAL(20,3);
        DECLARE v_medal_type VARCHAR(20);
        DECLARE v_placement_label VARCHAR(100);
        DECLARE v_awarded_points DECIMAL(20,3);
        DECLARE v_club_wallet_id BIGINT UNSIGNED;
        DECLARE v_group_code VARCHAR(80);
        DECLARE v_achievement_id BIGINT UNSIGNED;

        DECLARE cur_results CURSOR FOR
            SELECT
                cr.id,
                cr.club_id,
                cr.placement,
                pr.prize_amount,
                pr.base_ranking_points,
                pr.medal_type,
                pr.placement_label
            FROM competition_results cr
            JOIN competition_prize_rules pr
              ON pr.competition_id = cr.competition_id
             AND cr.placement BETWEEN pr.placement_from AND pr.placement_to
            WHERE cr.competition_id = p_competition_id
            ORDER BY cr.placement, cr.club_id;

        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

        OPEN cur_results;

        result_loop: LOOP
            FETCH cur_results INTO
                v_result_id,
                v_club_id,
                v_placement,
                v_prize_amount,
                v_base_points,
                v_medal_type,
                v_placement_label;

            IF v_done = 1 THEN
                LEAVE result_loop;
            END IF;

            SET v_awarded_points = v_base_points * v_coefficient;
            SET v_group_code = CONCAT('PRIZE-', p_competition_id, '-', v_club_id, '-', REPLACE(UUID(), '-', ''));

            SELECT id INTO v_club_wallet_id
            FROM wallets
            WHERE wallet_type = 'CLUB' AND club_id = v_club_id;

            IF v_prize_amount > 0 THEN
                CALL sp_wallet_transfer_core(
                    v_fifa_wallet_id,
                    v_club_wallet_id,
                    'PRIZE',
                    v_prize_amount,
                    v_group_code,
                    'competition_results',
                    v_result_id,
                    CONCAT(v_placement_label, ' - ', v_competition_name),
                    p_admin_user_id
                );
            END IF;

            INSERT INTO club_achievements(
                club_id,
                competition_id,
                season_id,
                placement,
                achievement_name,
                medal_type,
                awarded_points,
                prize_amount
            ) VALUES (
                v_club_id,
                p_competition_id,
                v_season_id,
                v_placement,
                CONCAT(v_placement_label, ' - ', v_competition_name),
                v_medal_type,
                v_awarded_points,
                v_prize_amount
            );

            SET v_achievement_id = LAST_INSERT_ID();

            INSERT INTO club_ranking_points(
                club_id,
                season_id,
                competition_id,
                source_type,
                source_id,
                points,
                description
            ) VALUES (
                v_club_id,
                v_season_id,
                p_competition_id,
                'COMPETITION_RESULT',
                v_achievement_id,
                v_awarded_points,
                CONCAT(v_placement_label, ' - ', v_competition_name)
            );
        END LOOP;

        CLOSE cur_results;
    END;

    BEGIN
        DECLARE v_done_upset INT DEFAULT 0;
        DECLARE v_upset_id BIGINT UNSIGNED;
        DECLARE v_winning_club_id BIGINT UNSIGNED;
        DECLARE v_defeated_club_id BIGINT UNSIGNED;
        DECLARE v_fifa_contribution DECIMAL(20,0);
        DECLARE v_defeated_contribution DECIMAL(20,0);
        DECLARE v_winner_wallet_id BIGINT UNSIGNED;
        DECLARE v_defeated_wallet_id BIGINT UNSIGNED;
        DECLARE v_upset_group_code VARCHAR(80);

        DECLARE cur_upsets CURSOR FOR
            SELECT
                id,
                winning_club_id,
                defeated_club_id,
                fifa_contribution,
                defeated_club_contribution
            FROM competition_upset_rewards
            WHERE competition_id = p_competition_id
              AND status = 'PENDING'
            ORDER BY id;

        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done_upset = 1;

        OPEN cur_upsets;

        upset_loop: LOOP
            FETCH cur_upsets INTO
                v_upset_id,
                v_winning_club_id,
                v_defeated_club_id,
                v_fifa_contribution,
                v_defeated_contribution;

            IF v_done_upset = 1 THEN
                LEAVE upset_loop;
            END IF;

            SELECT id INTO v_winner_wallet_id
            FROM wallets
            WHERE wallet_type = 'CLUB' AND club_id = v_winning_club_id;

            SELECT id INTO v_defeated_wallet_id
            FROM wallets
            WHERE wallet_type = 'CLUB' AND club_id = v_defeated_club_id;

            SET v_upset_group_code = CONCAT('UPSET-', v_upset_id, '-', REPLACE(UUID(), '-', ''));

            IF v_fifa_contribution > 0 THEN
                CALL sp_wallet_transfer_core(
                    v_fifa_wallet_id,
                    v_winner_wallet_id,
                    'UPSET_REWARD',
                    v_fifa_contribution,
                    v_upset_group_code,
                    'competition_upset_rewards',
                    v_upset_id,
                    'FIFA đồng tài trợ thưởng đánh bại đội thành tích mùa trước',
                    p_admin_user_id
                );
            END IF;

            IF v_defeated_contribution > 0 THEN
                CALL sp_wallet_transfer_core(
                    v_defeated_wallet_id,
                    v_winner_wallet_id,
                    'UPSET_REWARD',
                    v_defeated_contribution,
                    v_upset_group_code,
                    'competition_upset_rewards',
                    v_upset_id,
                    'CLB bị đánh bại đóng góp phần thưởng đặc biệt',
                    p_admin_user_id
                );
            END IF;

            UPDATE competition_upset_rewards
            SET status = 'PAID', paid_at = CURRENT_TIMESTAMP(6)
            WHERE id = v_upset_id;
        END LOOP;

        CLOSE cur_upsets;
    END;

    UPDATE competitions
    SET status = 'FINISHED',
        rewards_processed_at = CURRENT_TIMESTAMP(6),
        ends_on = COALESCE(ends_on, CURRENT_DATE())
    WHERE id = p_competition_id;

    UPDATE player_match_stats pms
    JOIN matches m ON m.id = pms.match_id
    SET pms.verification_status = 'LOCKED'
    WHERE m.competition_id = p_competition_id
      AND pms.verification_status = 'VERIFIED';

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'FINALIZE_COMPETITION',
        'competitions',
        p_competition_id,
        JSON_OBJECT('season_id', v_season_id, 'competition_name', v_competition_name)
    );

    COMMIT;

    BEGIN
        DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
        CALL sp_snapshot_club_rankings(v_season_id);
    END;
END$$

CREATE PROCEDURE sp_close_season(
    IN p_season_id BIGINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_season_sequence INT DEFAULT NULL;
    DECLARE v_salary_processed_at DATETIME(6) DEFAULT NULL;
    DECLARE v_unfinished_competitions INT DEFAULT 0;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        DROP TEMPORARY TABLE IF EXISTS tmp_expired_players;
        DROP TEMPORARY TABLE IF EXISTS tmp_expired_staff;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được kết thúc mùa giải.';
    END IF;

    SELECT sequence_no, salary_processed_at
      INTO v_season_sequence, v_salary_processed_at
    FROM seasons
    WHERE id = p_season_id;

    IF v_season_sequence IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy mùa giải.';
    END IF;

    IF v_salary_processed_at IS NOT NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Lương mùa này đã được xử lý trước đó.';
    END IF;

    SELECT COUNT(*) INTO v_unfinished_competitions
    FROM competitions
    WHERE season_id = p_season_id
      AND status NOT IN ('FINISHED','CANCELLED');

    IF v_unfinished_competitions > 0 THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Còn giải đấu trong mùa chưa kết thúc.';
    END IF;

    DROP TEMPORARY TABLE IF EXISTS tmp_expired_players;
    DROP TEMPORARY TABLE IF EXISTS tmp_expired_staff;

    CREATE TEMPORARY TABLE tmp_expired_players (
        player_id BIGINT UNSIGNED PRIMARY KEY,
        club_id BIGINT UNSIGNED NOT NULL
    ) ENGINE=Memory;

    CREATE TEMPORARY TABLE tmp_expired_staff (
        staff_id BIGINT UNSIGNED PRIMARY KEY,
        club_id BIGINT UNSIGNED NOT NULL
    ) ENGINE=Memory;

    START TRANSACTION;

    BEGIN
        DECLARE v_done_player INT DEFAULT 0;
        DECLARE v_contract_id BIGINT UNSIGNED;
        DECLARE v_club_id BIGINT UNSIGNED;
        DECLARE v_player_id BIGINT UNSIGNED;
        DECLARE v_salary DECIMAL(20,0);
        DECLARE v_club_wallet_id BIGINT UNSIGNED;
        DECLARE v_player_wallet_id BIGINT UNSIGNED;
        DECLARE v_group_code VARCHAR(80);

        DECLARE cur_player_salary CURSOR FOR
            SELECT
                pc.id,
                pc.club_id,
                pc.player_id,
                pc.salary_per_season,
                cw.id,
                pw.id
            FROM player_contracts pc
            JOIN seasons start_s ON start_s.id = pc.start_season_id
            LEFT JOIN seasons end_s ON end_s.id = pc.end_season_id
            JOIN wallets cw ON cw.wallet_type = 'CLUB' AND cw.club_id = pc.club_id
            JOIN wallets pw ON pw.wallet_type = 'PLAYER' AND pw.player_id = pc.player_id
            WHERE pc.status = 'ACTIVE'
              AND start_s.sequence_no <= v_season_sequence
              AND (end_s.sequence_no IS NULL OR end_s.sequence_no >= v_season_sequence)
              AND NOT EXISTS (
                    SELECT 1 FROM salary_payments sp
                    WHERE sp.season_id = p_season_id
                      AND sp.player_contract_id = pc.id
              )
            ORDER BY pc.club_id, pc.player_id;

        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done_player = 1;

        OPEN cur_player_salary;

        player_salary_loop: LOOP
            FETCH cur_player_salary INTO
                v_contract_id,
                v_club_id,
                v_player_id,
                v_salary,
                v_club_wallet_id,
                v_player_wallet_id;

            IF v_done_player = 1 THEN
                LEAVE player_salary_loop;
            END IF;

            SET v_group_code = CONCAT('SALARY-P-', p_season_id, '-', v_contract_id, '-', REPLACE(UUID(), '-', ''));

            IF v_salary > 0 THEN
                CALL sp_wallet_transfer_core(
                    v_club_wallet_id,
                    v_player_wallet_id,
                    'SALARY',
                    v_salary,
                    v_group_code,
                    'player_contracts',
                    v_contract_id,
                    CONCAT('Lương cầu thủ mùa #', p_season_id),
                    p_admin_user_id
                );
            END IF;

            INSERT INTO salary_payments(
                season_id,
                recipient_type,
                player_contract_id,
                staff_contract_id,
                amount,
                transfer_group_code
            ) VALUES (
                p_season_id,
                'PLAYER',
                v_contract_id,
                NULL,
                v_salary,
                v_group_code
            );
        END LOOP;

        CLOSE cur_player_salary;
    END;

    BEGIN
        DECLARE v_done_staff INT DEFAULT 0;
        DECLARE v_contract_id BIGINT UNSIGNED;
        DECLARE v_club_id BIGINT UNSIGNED;
        DECLARE v_staff_id BIGINT UNSIGNED;
        DECLARE v_salary DECIMAL(20,0);
        DECLARE v_club_wallet_id BIGINT UNSIGNED;
        DECLARE v_staff_wallet_id BIGINT UNSIGNED;
        DECLARE v_group_code VARCHAR(80);

        DECLARE cur_staff_salary CURSOR FOR
            SELECT
                sc.id,
                sc.club_id,
                sc.staff_id,
                sc.salary_per_season,
                cw.id,
                sw.id
            FROM staff_contracts sc
            JOIN seasons start_s ON start_s.id = sc.start_season_id
            LEFT JOIN seasons end_s ON end_s.id = sc.end_season_id
            JOIN wallets cw ON cw.wallet_type = 'CLUB' AND cw.club_id = sc.club_id
            JOIN wallets sw ON sw.wallet_type = 'STAFF' AND sw.staff_id = sc.staff_id
            WHERE sc.status = 'ACTIVE'
              AND start_s.sequence_no <= v_season_sequence
              AND (end_s.sequence_no IS NULL OR end_s.sequence_no >= v_season_sequence)
              AND NOT EXISTS (
                    SELECT 1 FROM salary_payments sp
                    WHERE sp.season_id = p_season_id
                      AND sp.staff_contract_id = sc.id
              )
            ORDER BY sc.club_id, sc.staff_id;

        DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done_staff = 1;

        OPEN cur_staff_salary;

        staff_salary_loop: LOOP
            FETCH cur_staff_salary INTO
                v_contract_id,
                v_club_id,
                v_staff_id,
                v_salary,
                v_club_wallet_id,
                v_staff_wallet_id;

            IF v_done_staff = 1 THEN
                LEAVE staff_salary_loop;
            END IF;

            SET v_group_code = CONCAT('SALARY-S-', p_season_id, '-', v_contract_id, '-', REPLACE(UUID(), '-', ''));

            IF v_salary > 0 THEN
                CALL sp_wallet_transfer_core(
                    v_club_wallet_id,
                    v_staff_wallet_id,
                    'STAFF_SALARY',
                    v_salary,
                    v_group_code,
                    'staff_contracts',
                    v_contract_id,
                    CONCAT('Lương ban huấn luyện mùa #', p_season_id),
                    p_admin_user_id
                );
            END IF;

            INSERT INTO salary_payments(
                season_id,
                recipient_type,
                player_contract_id,
                staff_contract_id,
                amount,
                transfer_group_code
            ) VALUES (
                p_season_id,
                'STAFF',
                NULL,
                v_contract_id,
                v_salary,
                v_group_code
            );
        END LOOP;

        CLOSE cur_staff_salary;
    END;

    INSERT INTO tmp_expired_players(player_id, club_id)
    SELECT pc.player_id, pc.club_id
    FROM player_contracts pc
    JOIN seasons es ON es.id = pc.end_season_id
    WHERE pc.status = 'ACTIVE'
      AND es.sequence_no <= v_season_sequence;

    INSERT INTO tmp_expired_staff(staff_id, club_id)
    SELECT sc.staff_id, sc.club_id
    FROM staff_contracts sc
    JOIN seasons es ON es.id = sc.end_season_id
    WHERE sc.status = 'ACTIVE'
      AND es.sequence_no <= v_season_sequence;

    UPDATE player_contracts pc
    JOIN seasons es ON es.id = pc.end_season_id
    SET pc.status = 'EXPIRED', pc.ended_at = CURRENT_TIMESTAMP(6)
    WHERE pc.status = 'ACTIVE'
      AND es.sequence_no <= v_season_sequence;

    UPDATE staff_contracts sc
    JOIN seasons es ON es.id = sc.end_season_id
    SET sc.status = 'EXPIRED', sc.ended_at = CURRENT_TIMESTAMP(6)
    WHERE sc.status = 'ACTIVE'
      AND es.sequence_no <= v_season_sequence;

    UPDATE player_club_history pch
    JOIN tmp_expired_players tep
      ON tep.player_id = pch.player_id
     AND tep.club_id = pch.club_id
    SET pch.left_at = CURRENT_TIMESTAMP(6),
        pch.movement_type = 'CONTRACT_EXPIRY'
    WHERE pch.left_at IS NULL;

    UPDATE players p
    JOIN tmp_expired_players tep ON tep.player_id = p.id
    SET p.club_id = NULL,
        p.shirt_number = NULL,
        p.status = 'FREE_AGENT'
    WHERE NOT EXISTS (
        SELECT 1 FROM player_contracts active_pc
        WHERE active_pc.player_id = p.id
          AND active_pc.status = 'ACTIVE'
    );

    UPDATE coaching_staff cs
    JOIN tmp_expired_staff tes ON tes.staff_id = cs.id
    SET cs.club_id = NULL,
        cs.status = 'FREE_AGENT'
    WHERE NOT EXISTS (
        SELECT 1 FROM staff_contracts active_sc
        WHERE active_sc.staff_id = cs.id
          AND active_sc.status = 'ACTIVE'
    );

    UPDATE seasons
    SET status = 'FINISHED',
        salary_processed_at = CURRENT_TIMESTAMP(6),
        closed_at = CURRENT_TIMESTAMP(6)
    WHERE id = p_season_id;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'CLOSE_SEASON',
        'seasons',
        p_season_id,
        JSON_OBJECT('season_sequence', v_season_sequence)
    );

    COMMIT;

    DROP TEMPORARY TABLE IF EXISTS tmp_expired_players;
    DROP TEMPORARY TABLE IF EXISTS tmp_expired_staff;

    BEGIN
        DECLARE CONTINUE HANDLER FOR SQLEXCEPTION BEGIN END;
        CALL sp_snapshot_club_rankings(p_season_id);
        CALL sp_snapshot_all_player_rankings(p_season_id);
    END;
END$$

CREATE PROCEDURE sp_database_health_check()
BEGIN
    SELECT
        'INSTALLATION_COUNTS' AS check_name,
        (SELECT COUNT(*) FROM clubs) AS clubs,
        (SELECT COUNT(*) FROM players) AS players,
        (SELECT COUNT(*) FROM coaching_staff) AS coaching_staff,
        (SELECT COUNT(*) FROM wallets) AS wallets,
        (SELECT COUNT(*) FROM competitions) AS competitions,
        (SELECT COUNT(*) FROM matches) AS matches;

    SELECT
        'WALLET_LEDGER_MISMATCHES' AS check_name,
        COUNT(*) AS error_count
    FROM (
        SELECT
            w.id,
            w.balance,
            COALESCE(SUM(
                CASE wt.direction
                    WHEN 'CREDIT' THEN wt.amount
                    WHEN 'DEBIT' THEN -wt.amount
                END
            ), 0) AS ledger_balance
        FROM wallets w
        LEFT JOIN wallet_transactions wt ON wt.wallet_id = w.id
        GROUP BY w.id, w.balance
        HAVING w.balance <> ledger_balance
    ) x;

    SELECT
        'DUPLICATE_ACTIVE_PLAYER_CONTRACTS' AS check_name,
        COUNT(*) AS error_count
    FROM (
        SELECT player_id
        FROM player_contracts
        WHERE status = 'ACTIVE'
        GROUP BY player_id
        HAVING COUNT(*) > 1
    ) x;

    SELECT
        'DUPLICATE_ACTIVE_STAFF_CONTRACTS' AS check_name,
        COUNT(*) AS error_count
    FROM (
        SELECT staff_id
        FROM staff_contracts
        WHERE status = 'ACTIVE'
        GROUP BY staff_id
        HAVING COUNT(*) > 1
    ) x;

    SELECT
        'PLAYER_CLUB_CONTRACT_MISMATCHES' AS check_name,
        COUNT(*) AS error_count
    FROM players p
    JOIN player_contracts pc ON pc.player_id = p.id AND pc.status = 'ACTIVE'
    WHERE NOT (p.club_id <=> pc.club_id);

    SELECT
        'INVALID_GROUP_MEMBERS' AS check_name,
        COUNT(*) AS error_count
    FROM competition_group_members gm
    JOIN competition_groups g ON g.id = gm.group_id
    LEFT JOIN competition_participants cp
      ON cp.competition_id = g.competition_id
     AND cp.club_id = gm.club_id
     AND cp.registration_status = 'APPROVED'
    WHERE cp.id IS NULL;

    SELECT 'DATABASE_READY' AS status, CURRENT_TIMESTAMP(6) AS checked_at;
END$$

DELIMITER ;

/* ========================================================================== */
/* 13B. STORED PROCEDURES - SAFE MATCH CORRECTION AND MANUAL BRACKET           */
/* ========================================================================== */

DELIMITER $$

CREATE PROCEDURE sp_reset_match_result(
    IN p_match_id BIGINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED,
    IN p_reason VARCHAR(500)
)
BEGIN
    DECLARE v_competition_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_competition_status VARCHAR(40) DEFAULT NULL;
    DECLARE v_stage_type VARCHAR(20) DEFAULT NULL;
    DECLARE v_round_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_match_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_old_winner BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_target_match_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_target_slot VARCHAR(10) DEFAULT NULL;
    DECLARE v_target_status VARCHAR(20) DEFAULT NULL;
    DECLARE v_target_club BIGINT UNSIGNED DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được hiệu chỉnh kết quả.';
    END IF;

    START TRANSACTION;

    SELECT
        m.competition_id,
        c.status,
        m.stage_type,
        m.round_id,
        m.status,
        m.winner_club_id
    INTO
        v_competition_id,
        v_competition_status,
        v_stage_type,
        v_round_id,
        v_match_status,
        v_old_winner
    FROM matches m
    JOIN competitions c ON c.id = m.competition_id
    WHERE m.id = p_match_id
    FOR UPDATE;

    IF v_competition_id IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không tìm thấy trận đấu.';
    END IF;

    IF v_competition_status = 'FINISHED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Không thể sửa trận của giải đã kết thúc.';
    END IF;

    IF v_match_status <> 'FINISHED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ có thể đặt lại trận đã xác nhận.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM competition_upset_rewards
        WHERE match_id = p_match_id AND status = 'PAID'
    ) THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Phần thưởng trận này đã chi trả; phải đảo giao dịch trước.';
    END IF;

    IF v_stage_type = 'KNOCKOUT' AND v_old_winner IS NOT NULL THEN
        SET v_target_match_id = NULL;
        SET v_target_slot = NULL;
        SELECT target_match_id, target_slot
          INTO v_target_match_id, v_target_slot
        FROM match_advancement_links
        WHERE source_match_id = p_match_id
        LIMIT 1;

        IF v_target_match_id IS NOT NULL THEN
            IF v_target_slot = 'HOME' THEN
                SELECT status, home_club_id
                  INTO v_target_status, v_target_club
                FROM matches
                WHERE id = v_target_match_id
                FOR UPDATE;
            ELSE
                SELECT status, away_club_id
                  INTO v_target_status, v_target_club
                FROM matches
                WHERE id = v_target_match_id
                FOR UPDATE;
            END IF;

            IF v_target_status <> 'SCHEDULED' THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Trận kế tiếp đã bắt đầu hoặc hoàn tất; không thể đặt lại kết quả.';
            END IF;

            IF v_target_club IS NOT NULL AND v_target_club <> v_old_winner THEN
                SIGNAL SQLSTATE '45000'
                    SET MESSAGE_TEXT = 'Ô đội ở trận kế tiếp không còn khớp đội thắng cũ.';
            END IF;

            IF v_target_slot = 'HOME' THEN
                UPDATE matches SET home_club_id = NULL WHERE id = v_target_match_id;
            ELSE
                UPDATE matches SET away_club_id = NULL WHERE id = v_target_match_id;
            END IF;
        END IF;
    END IF;

    DELETE FROM competition_upset_rewards
    WHERE match_id = p_match_id AND status = 'PENDING';

    UPDATE player_match_stats
    SET verification_status = 'PENDING',
        verified_by_user_id = NULL
    WHERE match_id = p_match_id
      AND verification_status <> 'LOCKED';

    UPDATE matches
    SET home_score = NULL,
        away_score = NULL,
        home_penalty_score = NULL,
        away_penalty_score = NULL,
        winner_club_id = NULL,
        loser_club_id = NULL,
        status = 'SCHEDULED',
        highlighted_upset = FALSE,
        confirmed_by_user_id = NULL,
        note = p_reason
    WHERE id = p_match_id;

    IF v_round_id IS NOT NULL THEN
        UPDATE competition_rounds
        SET status = 'IN_PROGRESS'
        WHERE id = v_round_id;
    END IF;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'RESET_MATCH_RESULT',
        'matches',
        p_match_id,
        JSON_OBJECT('old_winner_club_id', v_old_winner, 'reason', p_reason)
    );

    COMMIT;
END$$

CREATE PROCEDURE sp_set_knockout_match_teams(
    IN p_match_id BIGINT UNSIGNED,
    IN p_home_club_id BIGINT UNSIGNED,
    IN p_away_club_id BIGINT UNSIGNED,
    IN p_admin_user_id BIGINT UNSIGNED
)
BEGIN
    DECLARE v_competition_id BIGINT UNSIGNED DEFAULT NULL;
    DECLARE v_stage_type VARCHAR(20) DEFAULT NULL;
    DECLARE v_match_status VARCHAR(20) DEFAULT NULL;

    DECLARE EXIT HANDLER FOR SQLEXCEPTION
    BEGIN
        ROLLBACK;
        RESIGNAL;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM users
        WHERE id = p_admin_user_id
          AND account_type = 'FIFA_ADMIN'
          AND is_active = TRUE
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ Admin FIFA được xếp cặp thủ công.';
    END IF;

    IF p_home_club_id = p_away_club_id THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Hai vị trí trong trận không được cùng một CLB.';
    END IF;

    START TRANSACTION;

    SELECT competition_id, stage_type, status
      INTO v_competition_id, v_stage_type, v_match_status
    FROM matches
    WHERE id = p_match_id
    FOR UPDATE;

    IF v_competition_id IS NULL OR v_stage_type <> 'KNOCKOUT' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Trận không tồn tại hoặc không thuộc nhánh đấu.';
    END IF;

    IF v_match_status <> 'SCHEDULED' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Chỉ được xếp đội cho trận chưa thi đấu.';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM competition_participants
        WHERE competition_id = v_competition_id
          AND club_id = p_home_club_id
          AND registration_status = 'APPROVED'
    ) OR NOT EXISTS (
        SELECT 1 FROM competition_participants
        WHERE competition_id = v_competition_id
          AND club_id = p_away_club_id
          AND registration_status = 'APPROVED'
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'CLB phải được duyệt tham dự giải.';
    END IF;

    UPDATE matches
    SET home_club_id = p_home_club_id,
        away_club_id = p_away_club_id
    WHERE id = p_match_id;

    INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
    VALUES (
        p_admin_user_id,
        'SET_KNOCKOUT_MATCH_TEAMS',
        'matches',
        p_match_id,
        JSON_OBJECT('home_club_id', p_home_club_id, 'away_club_id', p_away_club_id)
    );

    COMMIT;
END$$

DELIMITER ;

/* V3 FIX: demo player session variables are resolved from players.id before
   award/statistic procedures are called. */

/* ========================================================================== */
/* 14. DEMO DATA - EXECUTES AUTOMATICALLY FOR EASY TESTING                     */
/* ========================================================================== */

INSERT INTO system_settings(setting_key, setting_value, description) VALUES
('PLAYER_GOAL_WEIGHT', '3.000', 'Điểm tổng cầu thủ cho mỗi bàn thắng đã xác minh'),
('PLAYER_ASSIST_WEIGHT', '2.000', 'Điểm tổng cầu thủ cho mỗi kiến tạo đã xác minh'),
('PLAYER_CLEAN_SHEET_WEIGHT', '3.000', 'Điểm tổng cầu thủ cho mỗi trận sạch lưới'),
('GOALKEEPER_CLEAN_SHEET_WEIGHT', '10.000', 'Điểm thủ môn cho mỗi trận sạch lưới'),
('GOALKEEPER_CONCEDED_PENALTY', '1.000', 'Điểm trừ thủ môn cho mỗi bàn thua'),
('CURRENCY_CODE', 'VND', 'Mã tiền hiển thị mặc định'),
('SITE_NAME', 'FIFA Club Ranking Manager', 'Tên website');

INSERT INTO seasons(name, sequence_no, starts_on, ends_on, status) VALUES
('Mùa 1', 1, '2025-01-01', '2025-12-31', 'FINISHED'),
('Mùa 2', 2, '2026-01-01', '2026-12-31', 'ACTIVE');

INSERT INTO clubs(code, name, short_name, registration_status, is_active, approved_at) VALUES
('CLB-A', 'Dragon United', 'Dragon', 'APPROVED', TRUE, CURRENT_TIMESTAMP(6)),
('CLB-B', 'Thunder City', 'Thunder', 'APPROVED', TRUE, CURRENT_TIMESTAMP(6)),
('CLB-C', 'Phoenix FC', 'Phoenix', 'APPROVED', TRUE, CURRENT_TIMESTAMP(6)),
('CLB-D', 'Galaxy Stars', 'Galaxy', 'APPROVED', TRUE, CURRENT_TIMESTAMP(6)),
('CLB-E', 'Royal Lions', 'Lions', 'APPROVED', TRUE, CURRENT_TIMESTAMP(6)),
('CLB-F', 'Ocean Warriors', 'Ocean', 'APPROVED', TRUE, CURRENT_TIMESTAMP(6)),
('CLB-G', 'Mountain Kings', 'Kings', 'APPROVED', TRUE, CURRENT_TIMESTAMP(6)),
('CLB-H', 'Golden Eagles', 'Eagles', 'APPROVED', TRUE, CURRENT_TIMESTAMP(6));

/* Demo only: password is SHA-256, not production security.
   admin_fifa / Admin@123
   dragon_fc, thunder_fc, ... / Club@123
   When building Node.js, replace these with bcrypt hashes. */
INSERT INTO users(username, password_hash, password_scheme, account_type, club_id) VALUES
('admin_fifa', SHA2('Admin@123', 256), 'SHA256_DEMO', 'FIFA_ADMIN', NULL),
('dragon_fc', SHA2('Club@123', 256), 'SHA256_DEMO', 'CLUB', (SELECT id FROM clubs WHERE code='CLB-A')),
('thunder_fc', SHA2('Club@123', 256), 'SHA256_DEMO', 'CLUB', (SELECT id FROM clubs WHERE code='CLB-B')),
('phoenix_fc', SHA2('Club@123', 256), 'SHA256_DEMO', 'CLUB', (SELECT id FROM clubs WHERE code='CLB-C')),
('galaxy_fc', SHA2('Club@123', 256), 'SHA256_DEMO', 'CLUB', (SELECT id FROM clubs WHERE code='CLB-D')),
('lions_fc', SHA2('Club@123', 256), 'SHA256_DEMO', 'CLUB', (SELECT id FROM clubs WHERE code='CLB-E')),
('ocean_fc', SHA2('Club@123', 256), 'SHA256_DEMO', 'CLUB', (SELECT id FROM clubs WHERE code='CLB-F')),
('kings_fc', SHA2('Club@123', 256), 'SHA256_DEMO', 'CLUB', (SELECT id FROM clubs WHERE code='CLB-G')),
('eagles_fc', SHA2('Club@123', 256), 'SHA256_DEMO', 'CLUB', (SELECT id FROM clubs WHERE code='CLB-H'));

SET @admin_id = (SELECT id FROM users WHERE username = 'admin_fifa');
SET @season1_id = (SELECT id FROM seasons WHERE sequence_no = 1);
SET @season2_id = (SELECT id FROM seasons WHERE sequence_no = 2);

/* FIFA wallet is the system treasury. Club/player/staff wallets are auto-created by triggers. */
INSERT INTO wallets(wallet_code, wallet_type, balance, status)
VALUES ('FIFA-TREASURY', 'FIFA', 0, 'ACTIVE');

INSERT INTO players(full_name, position, shirt_number, club_id, market_value, status) VALUES
('An Dragon', 'GK', 1, (SELECT id FROM clubs WHERE code='CLB-A'), 1200000000, 'ACTIVE'),
('Bình Dragon', 'FW', 10, (SELECT id FROM clubs WHERE code='CLB-A'), 3500000000, 'ACTIVE'),
('Cường Dragon', 'MF', 8, (SELECT id FROM clubs WHERE code='CLB-A'), 2400000000, 'ACTIVE'),

('Dũng Thunder', 'GK', 1, (SELECT id FROM clubs WHERE code='CLB-B'), 1100000000, 'ACTIVE'),
('Em Thunder', 'FW', 10, (SELECT id FROM clubs WHERE code='CLB-B'), 3200000000, 'ACTIVE'),
('Giang Thunder', 'MF', 8, (SELECT id FROM clubs WHERE code='CLB-B'), 2200000000, 'ACTIVE'),

('Hải Phoenix', 'GK', 1, (SELECT id FROM clubs WHERE code='CLB-C'), 1000000000, 'ACTIVE'),
('Khang Phoenix', 'FW', 10, (SELECT id FROM clubs WHERE code='CLB-C'), 2800000000, 'ACTIVE'),
('Lâm Phoenix', 'MF', 8, (SELECT id FROM clubs WHERE code='CLB-C'), 2100000000, 'ACTIVE'),

('Minh Galaxy', 'GK', 1, (SELECT id FROM clubs WHERE code='CLB-D'), 950000000, 'ACTIVE'),
('Nam Galaxy', 'FW', 10, (SELECT id FROM clubs WHERE code='CLB-D'), 2600000000, 'ACTIVE'),
('Phúc Galaxy', 'MF', 8, (SELECT id FROM clubs WHERE code='CLB-D'), 2000000000, 'ACTIVE'),

('Quân Lions', 'GK', 1, (SELECT id FROM clubs WHERE code='CLB-E'), 1050000000, 'ACTIVE'),
('Sơn Lions', 'FW', 10, (SELECT id FROM clubs WHERE code='CLB-E'), 3000000000, 'ACTIVE'),
('Tài Lions', 'MF', 8, (SELECT id FROM clubs WHERE code='CLB-E'), 2300000000, 'ACTIVE'),

('Uy Ocean', 'GK', 1, (SELECT id FROM clubs WHERE code='CLB-F'), 900000000, 'ACTIVE'),
('Việt Ocean', 'FW', 10, (SELECT id FROM clubs WHERE code='CLB-F'), 2500000000, 'ACTIVE'),
('Xuân Ocean', 'MF', 8, (SELECT id FROM clubs WHERE code='CLB-F'), 1900000000, 'ACTIVE'),

('Yên Kings', 'GK', 1, (SELECT id FROM clubs WHERE code='CLB-G'), 980000000, 'ACTIVE'),
('Bảo Kings', 'FW', 10, (SELECT id FROM clubs WHERE code='CLB-G'), 2700000000, 'ACTIVE'),
('Châu Kings', 'MF', 8, (SELECT id FROM clubs WHERE code='CLB-G'), 2050000000, 'ACTIVE'),

('Đạt Eagles', 'GK', 1, (SELECT id FROM clubs WHERE code='CLB-H'), 1080000000, 'ACTIVE'),
('Hoàng Eagles', 'FW', 10, (SELECT id FROM clubs WHERE code='CLB-H'), 3100000000, 'ACTIVE'),
('Khôi Eagles', 'MF', 8, (SELECT id FROM clubs WHERE code='CLB-H'), 2250000000, 'ACTIVE');

INSERT INTO coaching_staff(full_name, staff_role, club_id, status) VALUES
('HLV Dragon', 'Huấn luyện viên trưởng', (SELECT id FROM clubs WHERE code='CLB-A'), 'ACTIVE'),
('HLV Thunder', 'Huấn luyện viên trưởng', (SELECT id FROM clubs WHERE code='CLB-B'), 'ACTIVE'),
('HLV Phoenix', 'Huấn luyện viên trưởng', (SELECT id FROM clubs WHERE code='CLB-C'), 'ACTIVE'),
('HLV Galaxy', 'Huấn luyện viên trưởng', (SELECT id FROM clubs WHERE code='CLB-D'), 'ACTIVE'),
('HLV Lions', 'Huấn luyện viên trưởng', (SELECT id FROM clubs WHERE code='CLB-E'), 'ACTIVE'),
('HLV Ocean', 'Huấn luyện viên trưởng', (SELECT id FROM clubs WHERE code='CLB-F'), 'ACTIVE'),
('HLV Kings', 'Huấn luyện viên trưởng', (SELECT id FROM clubs WHERE code='CLB-G'), 'ACTIVE'),
('HLV Eagles', 'Huấn luyện viên trưởng', (SELECT id FROM clubs WHERE code='CLB-H'), 'ACTIVE');

/* Initial wallet funding with matching immutable ledger entries. */
SET @allow_wallet_balance_write = 1;
UPDATE wallets SET balance = 1000000000000 WHERE wallet_type = 'FIFA';
SET @allow_wallet_balance_write = 0;
INSERT INTO wallet_transactions(
    transaction_code, transfer_group_code, wallet_id, direction, transaction_type,
    amount, balance_before, balance_after, reference_table, note, created_by_user_id
)
SELECT
    CONCAT('SEED-FIFA-', id), 'SEED-FUNDING', id, 'CREDIT', 'DEPOSIT',
    1000000000000, 0, 1000000000000, 'seed', 'Nạp quỹ FIFA dữ liệu mẫu', @admin_id
FROM wallets WHERE wallet_type = 'FIFA';

SET @allow_wallet_balance_write = 1;
UPDATE wallets SET balance = 50000000000 WHERE wallet_type = 'CLUB';
SET @allow_wallet_balance_write = 0;
INSERT INTO wallet_transactions(
    transaction_code, transfer_group_code, wallet_id, direction, transaction_type,
    amount, balance_before, balance_after, reference_table, note, created_by_user_id
)
SELECT
    CONCAT('SEED-CLUB-', id), 'SEED-FUNDING', id, 'CREDIT', 'DEPOSIT',
    50000000000, 0, 50000000000, 'seed', 'Nạp vốn CLB dữ liệu mẫu', @admin_id
FROM wallets WHERE wallet_type = 'CLUB';

SET @allow_wallet_balance_write = 1;
UPDATE wallets SET balance = 1000000000 WHERE wallet_type = 'PLAYER';
SET @allow_wallet_balance_write = 0;
INSERT INTO wallet_transactions(
    transaction_code, transfer_group_code, wallet_id, direction, transaction_type,
    amount, balance_before, balance_after, reference_table, note, created_by_user_id
)
SELECT
    CONCAT('SEED-PLAYER-', id), 'SEED-FUNDING', id, 'CREDIT', 'DEPOSIT',
    1000000000, 0, 1000000000, 'seed', 'Số dư cầu thủ dữ liệu mẫu', @admin_id
FROM wallets WHERE wallet_type = 'PLAYER';

SET @allow_wallet_balance_write = 1;
UPDATE wallets SET balance = 500000000 WHERE wallet_type = 'STAFF';
SET @allow_wallet_balance_write = 0;
INSERT INTO wallet_transactions(
    transaction_code, transfer_group_code, wallet_id, direction, transaction_type,
    amount, balance_before, balance_after, reference_table, note, created_by_user_id
)
SELECT
    CONCAT('SEED-STAFF-', id), 'SEED-FUNDING', id, 'CREDIT', 'DEPOSIT',
    500000000, 0, 500000000, 'seed', 'Số dư ban huấn luyện dữ liệu mẫu', @admin_id
FROM wallets WHERE wallet_type = 'STAFF';

/* Active contracts for current season. */
INSERT INTO player_contracts(
    player_id, club_id, start_season_id, end_season_id,
    salary_per_season, status, note
)
SELECT
    p.id,
    p.club_id,
    @season2_id,
    @season2_id,
    CASE p.position
        WHEN 'GK' THEN 180000000
        WHEN 'FW' THEN 350000000
        WHEN 'MF' THEN 250000000
        ELSE 200000000
    END,
    'ACTIVE',
    'Hợp đồng dữ liệu mẫu mùa 2'
FROM players p;

INSERT INTO staff_contracts(
    staff_id, club_id, start_season_id, end_season_id,
    salary_per_season, status, note
)
SELECT
    cs.id,
    cs.club_id,
    @season2_id,
    @season2_id,
    500000000,
    'ACTIVE',
    'Hợp đồng HLV dữ liệu mẫu mùa 2'
FROM coaching_staff cs;

INSERT INTO player_club_history(player_id, club_id, movement_type, note)
SELECT id, club_id, 'INITIAL', 'CLB ban đầu trong dữ liệu mẫu'
FROM players;

INSERT INTO competition_series(code, name, description) VALUES
('C1', 'Champions League C1', 'Giải cấp cao dùng để thử vòng bảng, nhánh đấu và hệ số');

SET @series_c1_id = (SELECT id FROM competition_series WHERE code = 'C1');

/* Previous season competition, closed through the real closing procedure. */
INSERT INTO competitions(
    series_id, season_id, name, format_type, coefficient, status,
    knockout_size, third_place_mode, starts_on, ends_on, created_by_user_id
) VALUES (
    @series_c1_id, @season1_id, 'C1 Mùa 1', 'KNOCKOUT_ONLY', 2.000,
    'COMPLETED_PENDING_CLOSE', 4, 'SHARED_BRONZE',
    '2025-03-01', '2025-06-30', @admin_id
);

SET @c1_s1_id = (SELECT id FROM competitions WHERE series_id=@series_c1_id AND season_id=@season1_id);

INSERT INTO competition_participants(competition_id, club_id, seed_no, registration_status)
SELECT @c1_s1_id, id,
       CASE code WHEN 'CLB-A' THEN 1 WHEN 'CLB-B' THEN 2 WHEN 'CLB-C' THEN 3 ELSE 4 END,
       'APPROVED'
FROM clubs WHERE code IN ('CLB-A','CLB-B','CLB-C','CLB-D');

INSERT INTO competition_rosters(competition_id, club_id, player_id)
SELECT @c1_s1_id, p.club_id, p.id
FROM players p
JOIN clubs c ON c.id = p.club_id
WHERE c.code IN ('CLB-A','CLB-B','CLB-C','CLB-D');

INSERT INTO competition_prize_rules(
    competition_id, placement_from, placement_to, placement_label,
    prize_amount, base_ranking_points, medal_type
) VALUES
(@c1_s1_id, 1, 1, 'Vô địch', 12000000000, 100.000, 'GOLD'),
(@c1_s1_id, 2, 2, 'Á quân', 6000000000, 60.000, 'SILVER'),
(@c1_s1_id, 3, 3, 'Đồng hạng ba', 2000000000, 40.000, 'BRONZE');

INSERT INTO competition_results(
    competition_id, club_id, placement, is_joint_placement,
    confirmed_by_user_id, note
) VALUES
(@c1_s1_id, (SELECT id FROM clubs WHERE code='CLB-A'), 1, FALSE, @admin_id, 'Vô địch mùa trước'),
(@c1_s1_id, (SELECT id FROM clubs WHERE code='CLB-B'), 2, FALSE, @admin_id, 'Á quân mùa trước'),
(@c1_s1_id, (SELECT id FROM clubs WHERE code='CLB-C'), 3, TRUE, @admin_id, 'Đồng hạng ba'),
(@c1_s1_id, (SELECT id FROM clubs WHERE code='CLB-D'), 3, TRUE, @admin_id, 'Đồng hạng ba');

CALL sp_finalize_competition(@c1_s1_id, @admin_id);

INSERT INTO award_types(code, name, category, required_medal_type, base_ranking_points) VALUES
('TEAM_GOLD', 'Huy chương vàng', 'TEAM_MEDAL', 'GOLD', 25.000),
('TEAM_SILVER', 'Huy chương bạc', 'TEAM_MEDAL', 'SILVER', 15.000),
('TEAM_BRONZE', 'Huy chương đồng', 'TEAM_MEDAL', 'BRONZE', 10.000),
('BEST_PLAYER', 'Cầu thủ xuất sắc nhất', 'BEST_PLAYER', 'NONE', 50.000),
('TOP_SCORER', 'Vua phá lưới', 'TOP_SCORER', 'NONE', 40.000),
('BEST_GOALKEEPER', 'Thủ môn xuất sắc nhất', 'BEST_GOALKEEPER', 'NONE', 35.000),
('BEST_ASSIST', 'Vua kiến tạo', 'BEST_ASSIST', 'NONE', 30.000);

SET @club_a_id = (SELECT id FROM clubs WHERE code='CLB-A');
SET @club_b_id = (SELECT id FROM clubs WHERE code='CLB-B');
SET @club_c_id = (SELECT id FROM clubs WHERE code='CLB-C');
SET @club_d_id = (SELECT id FROM clubs WHERE code='CLB-D');
SET @club_e_id = (SELECT id FROM clubs WHERE code='CLB-E');
SET @club_f_id = (SELECT id FROM clubs WHERE code='CLB-F');
SET @club_g_id = (SELECT id FROM clubs WHERE code='CLB-G');
SET @club_h_id = (SELECT id FROM clubs WHERE code='CLB-H');

SET @award_gold_id = (SELECT id FROM award_types WHERE code='TEAM_GOLD');
SET @award_silver_id = (SELECT id FROM award_types WHERE code='TEAM_SILVER');
SET @award_bronze_id = (SELECT id FROM award_types WHERE code='TEAM_BRONZE');
SET @award_best_id = (SELECT id FROM award_types WHERE code='BEST_PLAYER');
SET @award_scorer_id = (SELECT id FROM award_types WHERE code='TOP_SCORER');
SET @award_gk_id = (SELECT id FROM award_types WHERE code='BEST_GOALKEEPER');

/* Resolve demo player IDs explicitly before assigning awards/statistics.
   The previous self-assignments left these session variables NULL. */
SET @p_an_dragon = (
    SELECT id FROM players
    WHERE full_name='An Dragon' AND club_id=@club_a_id
    LIMIT 1
);
SET @p_binh_dragon = (
    SELECT id FROM players
    WHERE full_name='Bình Dragon' AND club_id=@club_a_id
    LIMIT 1
);
SET @p_cuong_dragon = (
    SELECT id FROM players
    WHERE full_name='Cường Dragon' AND club_id=@club_a_id
    LIMIT 1
);
SET @p_dung_thunder = (
    SELECT id FROM players
    WHERE full_name='Dũng Thunder' AND club_id=@club_b_id
    LIMIT 1
);
SET @p_em_thunder = (
    SELECT id FROM players
    WHERE full_name='Em Thunder' AND club_id=@club_b_id
    LIMIT 1
);
SET @p_giang_thunder = (
    SELECT id FROM players
    WHERE full_name='Giang Thunder' AND club_id=@club_b_id
    LIMIT 1
);
SET @p_hai_phoenix = (
    SELECT id FROM players
    WHERE full_name='Hải Phoenix' AND club_id=@club_c_id
    LIMIT 1
);
SET @p_khang_phoenix = (
    SELECT id FROM players
    WHERE full_name='Khang Phoenix' AND club_id=@club_c_id
    LIMIT 1
);
SET @p_lam_phoenix = (
    SELECT id FROM players
    WHERE full_name='Lâm Phoenix' AND club_id=@club_c_id
    LIMIT 1
);
SET @p_minh_galaxy = (
    SELECT id FROM players
    WHERE full_name='Minh Galaxy' AND club_id=@club_d_id
    LIMIT 1
);
SET @p_nam_galaxy = (
    SELECT id FROM players
    WHERE full_name='Nam Galaxy' AND club_id=@club_d_id
    LIMIT 1
);
SET @p_phuc_galaxy = (
    SELECT id FROM players
    WHERE full_name='Phúc Galaxy' AND club_id=@club_d_id
    LIMIT 1
);
SET @p_son_lions = (
    SELECT id FROM players
    WHERE full_name='Sơn Lions' AND club_id=@club_e_id
    LIMIT 1
);

/* Fail early with a clear installer error if demo player IDs were not found. */
DROP PROCEDURE IF EXISTS sp_assert_demo_player_ids;
DELIMITER $$
CREATE PROCEDURE sp_assert_demo_player_ids()
BEGIN
    IF @p_an_dragon IS NULL OR @p_binh_dragon IS NULL OR @p_cuong_dragon IS NULL
       OR @p_dung_thunder IS NULL OR @p_em_thunder IS NULL OR @p_giang_thunder IS NULL
       OR @p_hai_phoenix IS NULL OR @p_khang_phoenix IS NULL OR @p_lam_phoenix IS NULL
       OR @p_minh_galaxy IS NULL OR @p_nam_galaxy IS NULL OR @p_phuc_galaxy IS NULL
       OR @p_son_lions IS NULL THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Không thể xác định đầy đủ ID cầu thủ dữ liệu mẫu.';
    END IF;
END$$
DELIMITER ;
CALL sp_assert_demo_player_ids();
DROP PROCEDURE sp_assert_demo_player_ids;

/* Historical awards remain attached to the player and the club at award time. */
CALL sp_assign_player_award(@p_an_dragon, @club_a_id, @c1_s1_id, @award_gold_id, @admin_id);
CALL sp_assign_player_award(@p_binh_dragon, @club_a_id, @c1_s1_id, @award_gold_id, @admin_id);
CALL sp_assign_player_award(@p_cuong_dragon, @club_a_id, @c1_s1_id, @award_gold_id, @admin_id);
CALL sp_assign_player_award(@p_binh_dragon, @club_a_id, @c1_s1_id, @award_best_id, @admin_id);
CALL sp_assign_player_award(@p_binh_dragon, @club_a_id, @c1_s1_id, @award_scorer_id, @admin_id);
CALL sp_assign_player_award(@p_an_dragon, @club_a_id, @c1_s1_id, @award_gk_id, @admin_id);

CALL sp_assign_player_award(@p_dung_thunder, @club_b_id, @c1_s1_id, @award_silver_id, @admin_id);
CALL sp_assign_player_award(@p_em_thunder, @club_b_id, @c1_s1_id, @award_silver_id, @admin_id);
CALL sp_assign_player_award(@p_giang_thunder, @club_b_id, @c1_s1_id, @award_silver_id, @admin_id);

CALL sp_assign_player_award(@p_hai_phoenix, @club_c_id, @c1_s1_id, @award_bronze_id, @admin_id);
CALL sp_assign_player_award(@p_khang_phoenix, @club_c_id, @c1_s1_id, @award_bronze_id, @admin_id);
CALL sp_assign_player_award(@p_lam_phoenix, @club_c_id, @c1_s1_id, @award_bronze_id, @admin_id);

CALL sp_assign_player_award(@p_minh_galaxy, @club_d_id, @c1_s1_id, @award_bronze_id, @admin_id);
CALL sp_assign_player_award(@p_nam_galaxy, @club_d_id, @c1_s1_id, @award_bronze_id, @admin_id);
CALL sp_assign_player_award(@p_phuc_galaxy, @club_d_id, @c1_s1_id, @award_bronze_id, @admin_id);

CALL sp_snapshot_all_player_rankings(@season1_id);

/* Current season competition with 8 clubs, 2 groups and a 4-team bracket. */
INSERT INTO competitions(
    series_id, season_id, name, format_type, coefficient, entry_fee, status,
    group_count, teams_per_group, advance_per_group, best_third_count,
    group_leg_mode, knockout_size, third_place_mode,
    starts_on, ends_on, created_by_user_id
) VALUES (
    @series_c1_id, @season2_id, 'C1 Mùa 2', 'GROUP_AND_KNOCKOUT', 2.200,
    0, 'REGISTRATION', 2, 4, 2, 0, 'ONE_LEG', 4, 'SHARED_BRONZE',
    '2026-03-01', '2026-08-31', @admin_id
);

SET @c1_s2_id = (SELECT id FROM competitions WHERE series_id=@series_c1_id AND season_id=@season2_id);

INSERT INTO competition_participants(competition_id, club_id, seed_no, registration_status)
SELECT @c1_s2_id, id,
       ROW_NUMBER() OVER (ORDER BY code),
       'APPROVED'
FROM clubs
WHERE registration_status='APPROVED';

INSERT INTO competition_rosters(competition_id, club_id, player_id)
SELECT @c1_s2_id, p.club_id, p.id
FROM players p
WHERE p.club_id IS NOT NULL;

INSERT INTO competition_groups(competition_id, group_code, display_name, display_order) VALUES
(@c1_s2_id, 'A', 'Bảng A', 1),
(@c1_s2_id, 'B', 'Bảng B', 2);

SET @group_a_id = (SELECT id FROM competition_groups WHERE competition_id=@c1_s2_id AND group_code='A');
SET @group_b_id = (SELECT id FROM competition_groups WHERE competition_id=@c1_s2_id AND group_code='B');

INSERT INTO competition_group_members(group_id, club_id, slot_no) VALUES
(@group_a_id, @club_a_id, 1),
(@group_a_id, @club_e_id, 2),
(@group_a_id, @club_f_id, 3),
(@group_a_id, @club_g_id, 4),
(@group_b_id, @club_b_id, 1),
(@group_b_id, @club_c_id, 2),
(@group_b_id, @club_d_id, 3),
(@group_b_id, @club_h_id, 4);

INSERT INTO competition_prize_rules(
    competition_id, placement_from, placement_to, placement_label,
    prize_amount, base_ranking_points, medal_type
) VALUES
(@c1_s2_id, 1, 1, 'Vô địch', 20000000000, 120.000, 'GOLD'),
(@c1_s2_id, 2, 2, 'Á quân', 10000000000, 75.000, 'SILVER'),
(@c1_s2_id, 3, 3, 'Đồng hạng ba', 4000000000, 50.000, 'BRONZE');

INSERT INTO competition_special_reward_rules(
    competition_id, enabled,
    champion_reward_fraction, runnerup_reward_fraction,
    fifa_share_fraction, defeated_share_fraction,
    max_champion_rewards, max_runnerup_rewards
) VALUES (
    @c1_s2_id, TRUE,
    0.2500, 0.2500,
    0.5000, 0.5000,
    1, 1
);

CALL sp_generate_group_matches(@c1_s2_id, @admin_id);
CALL sp_create_knockout_bracket(@c1_s2_id, 4, @admin_id);

SET @first_ko_round_id = (
    SELECT id FROM competition_rounds
    WHERE competition_id=@c1_s2_id
    ORDER BY round_order LIMIT 1
);

INSERT INTO knockout_pairing_rules(
    competition_id, round_id, match_no,
    home_group_id, home_group_rank,
    away_group_id, away_group_rank
) VALUES
(@c1_s2_id, @first_ko_round_id, 1, @group_a_id, 1, @group_b_id, 2),
(@c1_s2_id, @first_ko_round_id, 2, @group_b_id, 1, @group_a_id, 2);

/* Two demo matches trigger the special champion/runner-up reward records. */
SET @match_a1_e2 = (
    SELECT id FROM matches
    WHERE competition_id=@c1_s2_id AND group_id=@group_a_id
      AND home_club_id=@club_a_id AND away_club_id=@club_e_id
    LIMIT 1
);
CALL sp_set_match_result(@match_a1_e2, 0, 3, NULL, NULL, @admin_id, 'Royal Lions đánh bại đương kim vô địch 3-0');

SET @match_b1_c2 = (
    SELECT id FROM matches
    WHERE competition_id=@c1_s2_id AND group_id=@group_b_id
      AND home_club_id=@club_b_id AND away_club_id=@club_c_id
    LIMIT 1
);
CALL sp_set_match_result(@match_b1_c2, 1, 2, NULL, NULL, @admin_id, 'Phoenix đánh bại á quân mùa trước 2-1');

/* Verified sample player statistics for rankings. */
INSERT INTO player_match_stats(
    match_id, player_id, club_id, appeared, goals, assists,
    clean_sheet, goals_conceded, entered_by_user_id,
    verified_by_user_id, verification_status
) VALUES
(@match_a1_e2, @p_son_lions, @club_e_id, TRUE, 2, 0, FALSE, 0, (SELECT id FROM users WHERE username='lions_fc'), @admin_id, 'VERIFIED'),
(@match_a1_e2, (SELECT id FROM players WHERE full_name='Tài Lions'), @club_e_id, TRUE, 1, 2, FALSE, 0, (SELECT id FROM users WHERE username='lions_fc'), @admin_id, 'VERIFIED'),
(@match_a1_e2, (SELECT id FROM players WHERE full_name='Quân Lions'), @club_e_id, TRUE, 0, 0, TRUE, 0, (SELECT id FROM users WHERE username='lions_fc'), @admin_id, 'VERIFIED'),
(@match_b1_c2, @p_khang_phoenix, @club_c_id, TRUE, 2, 0, FALSE, 0, (SELECT id FROM users WHERE username='phoenix_fc'), @admin_id, 'VERIFIED'),
(@match_b1_c2, @p_lam_phoenix, @club_c_id, TRUE, 0, 1, FALSE, 0, (SELECT id FROM users WHERE username='phoenix_fc'), @admin_id, 'VERIFIED'),
(@match_b1_c2, @p_hai_phoenix, @club_c_id, TRUE, 0, 0, FALSE, 1, (SELECT id FROM users WHERE username='phoenix_fc'), @admin_id, 'VERIFIED');

/* Ranking movement demo. */
INSERT INTO club_ranking_points(
    club_id, season_id, competition_id, source_type, source_id, points, description
) VALUES
(@club_e_id, @season2_id, @c1_s2_id, 'BONUS', @match_a1_e2, 60.000, 'Thưởng thành tích nổi bật mùa 2'),
(@club_c_id, @season2_id, @c1_s2_id, 'BONUS', @match_b1_c2, 40.000, 'Thưởng thành tích nổi bật mùa 2'),
(@club_h_id, @season2_id, @c1_s2_id, 'BONUS', NULL, 20.000, 'Điểm khởi đầu mùa 2');

CALL sp_update_player_market_value(@p_son_lions, 3800000000, @admin_id, 'Tăng giá sau trận thắng đương kim vô địch');
CALL sp_update_player_market_value(@p_khang_phoenix, 3400000000, @admin_id, 'Tăng giá sau cú đúp bàn thắng');
CALL sp_update_player_market_value(@p_binh_dragon, 3300000000, @admin_id, 'Điều chỉnh giá sau biến động mùa mới');

CALL sp_snapshot_club_rankings(@season2_id);
CALL sp_snapshot_all_player_rankings(@season2_id);

/* ========================================================================== */
/* 15. READY-TO-TEST QUERIES                                                   */
/* ========================================================================== */

CALL sp_database_health_check();

/* Restore the Workbench Safe Updates preference for subsequent manual queries. */
SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES;

SELECT * FROM v_latest_club_world_ranking ORDER BY rank_position;
SELECT * FROM v_latest_player_rankings ORDER BY category, rank_position;
SELECT * FROM v_group_standings WHERE competition_id = @c1_s2_id ORDER BY group_id, group_rank;
SELECT * FROM competition_upset_rewards WHERE competition_id = @c1_s2_id ORDER BY id;
SELECT * FROM v_player_award_history ORDER BY player_id, awarded_at;
SELECT * FROM v_player_market_value_changes ORDER BY value_change DESC;

/*
===============================================================================
 OPTIONAL MANUAL TEST FLOW AFTER INSTALLATION
===============================================================================

1) View all generated group matches:
   SELECT * FROM matches
   WHERE competition_id = @c1_s2_id AND stage_type='GROUP'
   ORDER BY group_id, match_no;

2) Finish every remaining group match by calling, for each scheduled match:
   CALL sp_set_match_result(<match_id>, 2, 1, NULL, NULL, @admin_id, 'Kết quả thử');

3) Finalize groups and seed the bracket:
   CALL sp_finalize_group_stage(@c1_s2_id, @admin_id);
   CALL sp_seed_first_knockout_round(@c1_s2_id, @admin_id);

4) Finish both semifinals and the final with sp_set_match_result().
   Winners automatically move to the next round.

5) Insert final results before closing the competition:
   INSERT INTO competition_results(... placement 1, 2, 3, 3 ...);
   CALL sp_finalize_competition(@c1_s2_id, @admin_id);

6) Club assigns medals to registered players:
   CALL sp_assign_player_award(player_id, club_id, @c1_s2_id, award_type_id, club_user_id);

7) Close the season only after every competition is FINISHED/CANCELLED:
   CALL sp_close_season(@season2_id, @admin_id);

8) Manual wallet operation examples:
   CALL sp_admin_wallet_action(@admin_id, <wallet_id>, 'CREDIT', 'DEPOSIT', 500000000, 'Nạp tiền');
   CALL sp_admin_wallet_action(@admin_id, <wallet_id>, 'DEBIT', 'WITHDRAWAL', 500000000, 'Rút tiền');

9) Transfer example:
   - Insert an ACCEPTED transfer_offers row.
   - CALL sp_complete_transfer(<offer_id>, @admin_id);
===============================================================================
*/


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



/* ===== INCLUDED UPDATE 2.0.6 WORLD CUP 48 ===== */

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
    CONSTRAINT chk_world_cup_match_scores CHECK (
        home_score IS NULL OR away_score IS NULL OR (home_score >= 0 AND away_score >= 0)
    )
) ENGINE=InnoDB;

DROP TRIGGER IF EXISTS trg_world_cup_matches_distinct_insert;
DROP TRIGGER IF EXISTS trg_world_cup_matches_distinct_update;
DELIMITER $$
CREATE TRIGGER trg_world_cup_matches_distinct_insert
BEFORE INSERT ON world_cup_matches
FOR EACH ROW
BEGIN
  IF NEW.home_entry_id IS NOT NULL AND NEW.away_entry_id IS NOT NULL AND NEW.home_entry_id = NEW.away_entry_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Một đội tuyển không thể gặp chính mình.';
  END IF;
END$$
CREATE TRIGGER trg_world_cup_matches_distinct_update
BEFORE UPDATE ON world_cup_matches
FOR EACH ROW
BEGIN
  IF NEW.home_entry_id IS NOT NULL AND NEW.away_entry_id IS NOT NULL AND NEW.home_entry_id = NEW.away_entry_id THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Một đội tuyển không thể gặp chính mình.';
  END IF;
END$$
DELIMITER ;

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
    CONSTRAINT chk_world_cup_upset_reward_points CHECK (awarded_points >= 0)
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

/* ============================================================================
   BỔ SUNG PHIÊN BẢN 2.0.8
============================================================================ */
/* ============================================================================
   FOOTBALL RANK MANAGER 2.0.8 - SMART AWARDS & GLOBAL FLAGS
   - Tự động tổng hợp thống kê và trao danh hiệu cá nhân khách quan
   - Danh mục quốc gia song ngữ, tự nhận cờ theo mã chuẩn
   - Không xóa dữ liệu CLB, cầu thủ, giải đấu hoặc lịch sử hiện có
============================================================================ */
USE football_rank_manager;

SET NAMES utf8mb4;
SET @OLD_SQL_SAFE_UPDATES = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

DROP PROCEDURE IF EXISTS _frm_v208_add_column;
DELIMITER $$
CREATE PROCEDURE _frm_v208_add_column(
  IN p_table VARCHAR(64), IN p_column VARCHAR(64), IN p_definition TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = p_table AND COLUMN_NAME = p_column
  ) THEN
    SET @sql = CONCAT('ALTER TABLE `', p_table, '` ADD COLUMN `', p_column, '` ', p_definition);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END$$
DELIMITER ;

CREATE TABLE IF NOT EXISTS country_catalog (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  iso2           VARCHAR(8) NULL,
  iso3           VARCHAR(8) NOT NULL,
  fifa_code      VARCHAR(8) NOT NULL,
  name_en        VARCHAR(120) NOT NULL,
  name_vi        VARCHAR(120) NOT NULL,
  confederation  ENUM('AFC','CAF','CONCACAF','CONMEBOL','OFC','UEFA','OTHER') NOT NULL DEFAULT 'OTHER',
  flag_url       VARCHAR(500) NOT NULL,
  flag_emoji     VARCHAR(16) NULL,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_country_catalog_iso3 UNIQUE (iso3),
  CONSTRAINT uq_country_catalog_fifa UNIQUE (fifa_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS country_aliases (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  country_id  BIGINT UNSIGNED NOT NULL,
  alias_text  VARCHAR(160) NOT NULL,
  alias_type  ENUM('VI','EN','ISO2','ISO3','FIFA','OTHER') NOT NULL DEFAULT 'OTHER',
  CONSTRAINT uq_country_alias UNIQUE (country_id, alias_text),
  CONSTRAINT fk_country_alias_country FOREIGN KEY (country_id) REFERENCES country_catalog(id)
    ON UPDATE CASCADE ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CALL _frm_v208_add_column('player_national_profiles','country_catalog_id','BIGINT UNSIGNED NULL AFTER player_id');
CALL _frm_v208_add_column('world_cup_entries','country_catalog_id','BIGINT UNSIGNED NULL AFTER player_id');
CALL _frm_v208_add_column('player_awards','assignment_mode','ENUM(''MANUAL'',''AUTOMATIC'',''TEAM_AUTO'') NOT NULL DEFAULT ''MANUAL'' AFTER assigned_by_user_id');
CALL _frm_v208_add_column('player_awards','calculation_snapshot','JSON NULL AFTER assignment_mode');
DROP PROCEDURE IF EXISTS _frm_v208_add_column;

CREATE TABLE IF NOT EXISTS award_auto_rules (
  award_type_id       BIGINT UNSIGNED PRIMARY KEY,
  metric_code         ENUM('OVERALL','GOALS','ASSISTS','CLEAN_SHEETS','GOALKEEPER') NOT NULL,
  position_filter     ENUM('ANY','GK','DF','MF','FW') NOT NULL DEFAULT 'ANY',
  min_appearances     SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  auto_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  explanation         VARCHAR(500) NOT NULL,
  updated_at          DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_auto_rule_award_type FOREIGN KEY (award_type_id) REFERENCES award_types(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT chk_auto_rule_appearances CHECK (min_appearances >= 1)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS competition_award_runs (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  competition_id        BIGINT UNSIGNED NOT NULL,
  run_status            ENUM('PREVIEW','COMPLETED','PARTIAL','FAILED') NOT NULL,
  statistics_coverage   JSON NULL,
  awards_snapshot       JSON NULL,
  executed_by_user_id   BIGINT UNSIGNED NULL,
  created_at            DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_award_run_competition FOREIGN KEY (competition_id) REFERENCES competitions(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_award_run_user FOREIGN KEY (executed_by_user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

INSERT INTO country_catalog(iso2,iso3,fifa_code,name_en,name_vi,confederation,flag_url,flag_emoji) VALUES
('AW','ABW','ARU','Aruba','Aruba','CONCACAF','https://flagcdn.com/w160/aw.png','🇦🇼'),
('AF','AFG','AFG','Afghanistan','Afghanistan','AFC','https://flagcdn.com/w160/af.png','🇦🇫'),
('AO','AGO','ANG','Angola','Angola','CAF','https://flagcdn.com/w160/ao.png','🇦🇴'),
('AI','AIA','AIA','Anguilla','Anguilla','CONCACAF','https://flagcdn.com/w160/ai.png','🇦🇮'),
('AX','ALA','ALA','Åland Islands','Quần đảo Åland','OTHER','https://flagcdn.com/w160/ax.png','🇦🇽'),
('AL','ALB','ALB','Albania','Albania','UEFA','https://flagcdn.com/w160/al.png','🇦🇱'),
('AD','AND','AND','Andorra','Andorra','UEFA','https://flagcdn.com/w160/ad.png','🇦🇩'),
('AE','ARE','UAE','United Arab Emirates','Các Tiểu Vương quốc Ả Rập Thống nhất','AFC','https://flagcdn.com/w160/ae.png','🇦🇪'),
('AR','ARG','ARG','Argentina','Argentina','CONMEBOL','https://flagcdn.com/w160/ar.png','🇦🇷'),
('AM','ARM','ARM','Armenia','Armenia','UEFA','https://flagcdn.com/w160/am.png','🇦🇲'),
('AS','ASM','ASA','American Samoa','Samoa thuộc Mỹ','OFC','https://flagcdn.com/w160/as.png','🇦🇸'),
('AQ','ATA','ATA','Antarctica','Nam Cực','OTHER','https://flagcdn.com/w160/aq.png','🇦🇶'),
('TF','ATF','ATF','French Southern Territories','Lãnh thổ phía Nam Thuộc Pháp','OTHER','https://flagcdn.com/w160/tf.png','🇹🇫'),
('AG','ATG','ATG','Antigua and Barbuda','Antigua và Barbuda','CONCACAF','https://flagcdn.com/w160/ag.png','🇦🇬'),
('AU','AUS','AUS','Australia','Australia','AFC','https://flagcdn.com/w160/au.png','🇦🇺'),
('AT','AUT','AUT','Austria','Áo','UEFA','https://flagcdn.com/w160/at.png','🇦🇹'),
('AZ','AZE','AZE','Azerbaijan','Azerbaijan','UEFA','https://flagcdn.com/w160/az.png','🇦🇿'),
('BI','BDI','BDI','Burundi','Burundi','CAF','https://flagcdn.com/w160/bi.png','🇧🇮'),
('BE','BEL','BEL','Belgium','Bỉ','UEFA','https://flagcdn.com/w160/be.png','🇧🇪'),
('BJ','BEN','BEN','Benin','Benin','CAF','https://flagcdn.com/w160/bj.png','🇧🇯'),
('BQ','BES','BES','Bonaire, Sint Eustatius and Saba','Ca-ri-bê Hà Lan','CONCACAF','https://flagcdn.com/w160/bq.png','🇧🇶'),
('BF','BFA','BFA','Burkina Faso','Burkina Faso','CAF','https://flagcdn.com/w160/bf.png','🇧🇫'),
('BD','BGD','BAN','Bangladesh','Bangladesh','AFC','https://flagcdn.com/w160/bd.png','🇧🇩'),
('BG','BGR','BUL','Bulgaria','Bulgaria','UEFA','https://flagcdn.com/w160/bg.png','🇧🇬'),
('BH','BHR','BHR','Bahrain','Bahrain','AFC','https://flagcdn.com/w160/bh.png','🇧🇭'),
('BS','BHS','BAH','Bahamas','Bahamas','CONCACAF','https://flagcdn.com/w160/bs.png','🇧🇸'),
('BA','BIH','BIH','Bosnia and Herzegovina','Bosnia và Herzegovina','UEFA','https://flagcdn.com/w160/ba.png','🇧🇦'),
('BL','BLM','BLM','Saint Barthélemy','St. Barthélemy','OTHER','https://flagcdn.com/w160/bl.png','🇧🇱'),
('BY','BLR','BLR','Belarus','Belarus','UEFA','https://flagcdn.com/w160/by.png','🇧🇾'),
('BZ','BLZ','BLZ','Belize','Belize','CONCACAF','https://flagcdn.com/w160/bz.png','🇧🇿'),
('BM','BMU','BER','Bermuda','Bermuda','CONCACAF','https://flagcdn.com/w160/bm.png','🇧🇲'),
('BO','BOL','BOL','Bolivia','Bolivia','CONMEBOL','https://flagcdn.com/w160/bo.png','🇧🇴'),
('BR','BRA','BRA','Brazil','Brazil','CONMEBOL','https://flagcdn.com/w160/br.png','🇧🇷'),
('BB','BRB','BRB','Barbados','Barbados','CONCACAF','https://flagcdn.com/w160/bb.png','🇧🇧'),
('BN','BRN','BRU','Brunei Darussalam','Brunei','AFC','https://flagcdn.com/w160/bn.png','🇧🇳'),
('BT','BTN','BHU','Bhutan','Bhutan','AFC','https://flagcdn.com/w160/bt.png','🇧🇹'),
('BV','BVT','BVT','Bouvet Island','Đảo Bouvet','OTHER','https://flagcdn.com/w160/bv.png','🇧🇻'),
('BW','BWA','BOT','Botswana','Botswana','CAF','https://flagcdn.com/w160/bw.png','🇧🇼'),
('CF','CAF','CTA','Central African Republic','Cộng hòa Trung Phi','CAF','https://flagcdn.com/w160/cf.png','🇨🇫'),
('CA','CAN','CAN','Canada','Canada','CONCACAF','https://flagcdn.com/w160/ca.png','🇨🇦'),
('CC','CCK','CCK','Cocos (Keeling) Islands','Quần đảo Cocos (Keeling)','OTHER','https://flagcdn.com/w160/cc.png','🇨🇨'),
('CH','CHE','SUI','Switzerland','Thụy Sĩ','UEFA','https://flagcdn.com/w160/ch.png','🇨🇭'),
('CL','CHL','CHI','Chile','Chile','CONMEBOL','https://flagcdn.com/w160/cl.png','🇨🇱'),
('CN','CHN','CHN','China','Trung Quốc','AFC','https://flagcdn.com/w160/cn.png','🇨🇳'),
('CI','CIV','CIV','Côte d''Ivoire','Côte d’Ivoire','CAF','https://flagcdn.com/w160/ci.png','🇨🇮'),
('CM','CMR','CMR','Cameroon','Cameroon','CAF','https://flagcdn.com/w160/cm.png','🇨🇲'),
('CD','COD','COD','Congo, The Democratic Republic of the','Congo - Kinshasa','CAF','https://flagcdn.com/w160/cd.png','🇨🇩'),
('CG','COG','CGO','Congo','Congo - Brazzaville','CAF','https://flagcdn.com/w160/cg.png','🇨🇬'),
('CK','COK','COK','Cook Islands','Quần đảo Cook','OFC','https://flagcdn.com/w160/ck.png','🇨🇰'),
('CO','COL','COL','Colombia','Colombia','CONMEBOL','https://flagcdn.com/w160/co.png','🇨🇴'),
('KM','COM','COM','Comoros','Comoros','CAF','https://flagcdn.com/w160/km.png','🇰🇲'),
('CV','CPV','CPV','Cabo Verde','Cape Verde','CAF','https://flagcdn.com/w160/cv.png','🇨🇻'),
('CR','CRI','CRC','Costa Rica','Costa Rica','CONCACAF','https://flagcdn.com/w160/cr.png','🇨🇷'),
('CU','CUB','CUB','Cuba','Cuba','CONCACAF','https://flagcdn.com/w160/cu.png','🇨🇺'),
('CW','CUW','CUW','Curaçao','Curaçao','CONCACAF','https://flagcdn.com/w160/cw.png','🇨🇼'),
('CX','CXR','CXR','Christmas Island','Đảo Giáng Sinh','OTHER','https://flagcdn.com/w160/cx.png','🇨🇽'),
('KY','CYM','CAY','Cayman Islands','Quần đảo Cayman','CONCACAF','https://flagcdn.com/w160/ky.png','🇰🇾'),
('CY','CYP','CYP','Cyprus','Síp','UEFA','https://flagcdn.com/w160/cy.png','🇨🇾'),
('CZ','CZE','CZE','Czechia','Séc','UEFA','https://flagcdn.com/w160/cz.png','🇨🇿'),
('DE','DEU','GER','Germany','Đức','UEFA','https://flagcdn.com/w160/de.png','🇩🇪'),
('DJ','DJI','DJI','Djibouti','Djibouti','CAF','https://flagcdn.com/w160/dj.png','🇩🇯'),
('DM','DMA','DMA','Dominica','Dominica','CONCACAF','https://flagcdn.com/w160/dm.png','🇩🇲'),
('DK','DNK','DEN','Denmark','Đan Mạch','UEFA','https://flagcdn.com/w160/dk.png','🇩🇰'),
('DO','DOM','DOM','Dominican Republic','Cộng hòa Dominica','CONCACAF','https://flagcdn.com/w160/do.png','🇩🇴'),
('DZ','DZA','ALG','Algeria','Algeria','CAF','https://flagcdn.com/w160/dz.png','🇩🇿'),
('EC','ECU','ECU','Ecuador','Ecuador','CONMEBOL','https://flagcdn.com/w160/ec.png','🇪🇨'),
('EG','EGY','EGY','Egypt','Ai Cập','CAF','https://flagcdn.com/w160/eg.png','🇪🇬'),
('ER','ERI','ERI','Eritrea','Eritrea','CAF','https://flagcdn.com/w160/er.png','🇪🇷'),
('EH','ESH','ESH','Western Sahara','Tây Sahara','OTHER','https://flagcdn.com/w160/eh.png','🇪🇭'),
('ES','ESP','ESP','Spain','Tây Ban Nha','UEFA','https://flagcdn.com/w160/es.png','🇪🇸'),
('EE','EST','EST','Estonia','Estonia','UEFA','https://flagcdn.com/w160/ee.png','🇪🇪'),
('ET','ETH','ETH','Ethiopia','Ethiopia','CAF','https://flagcdn.com/w160/et.png','🇪🇹'),
('FI','FIN','FIN','Finland','Phần Lan','UEFA','https://flagcdn.com/w160/fi.png','🇫🇮'),
('FJ','FJI','FIJ','Fiji','Fiji','OFC','https://flagcdn.com/w160/fj.png','🇫🇯'),
('FK','FLK','FLK','Falkland Islands (Malvinas)','Quần đảo Falkland','OTHER','https://flagcdn.com/w160/fk.png','🇫🇰'),
('FR','FRA','FRA','France','Pháp','UEFA','https://flagcdn.com/w160/fr.png','🇫🇷'),
('FO','FRO','FRO','Faroe Islands','Quần đảo Faroe','UEFA','https://flagcdn.com/w160/fo.png','🇫🇴'),
('FM','FSM','FSM','Micronesia, Federated States of','Micronesia','OTHER','https://flagcdn.com/w160/fm.png','🇫🇲'),
('GA','GAB','GAB','Gabon','Gabon','CAF','https://flagcdn.com/w160/ga.png','🇬🇦'),
('GB','GBR','GBR','United Kingdom','Vương quốc Anh','UEFA','https://flagcdn.com/w160/gb.png','🇬🇧'),
('GE','GEO','GEO','Georgia','Georgia','UEFA','https://flagcdn.com/w160/ge.png','🇬🇪'),
('GG','GGY','GGY','Guernsey','Guernsey','OTHER','https://flagcdn.com/w160/gg.png','🇬🇬'),
('GH','GHA','GHA','Ghana','Ghana','CAF','https://flagcdn.com/w160/gh.png','🇬🇭'),
('GI','GIB','GIB','Gibraltar','Gibraltar','UEFA','https://flagcdn.com/w160/gi.png','🇬🇮'),
('GN','GIN','GUI','Guinea','Guinea','CAF','https://flagcdn.com/w160/gn.png','🇬🇳'),
('GP','GLP','GLP','Guadeloupe','Guadeloupe','CONCACAF','https://flagcdn.com/w160/gp.png','🇬🇵'),
('GM','GMB','GAM','Gambia','Gambia','CAF','https://flagcdn.com/w160/gm.png','🇬🇲'),
('GW','GNB','GNB','Guinea-Bissau','Guinea-Bissau','CAF','https://flagcdn.com/w160/gw.png','🇬🇼'),
('GQ','GNQ','EQG','Equatorial Guinea','Guinea Xích Đạo','CAF','https://flagcdn.com/w160/gq.png','🇬🇶'),
('GR','GRC','GRE','Greece','Hy Lạp','UEFA','https://flagcdn.com/w160/gr.png','🇬🇷'),
('GD','GRD','GRN','Grenada','Grenada','CONCACAF','https://flagcdn.com/w160/gd.png','🇬🇩'),
('GL','GRL','GRL','Greenland','Greenland','OTHER','https://flagcdn.com/w160/gl.png','🇬🇱'),
('GT','GTM','GUA','Guatemala','Guatemala','OTHER','https://flagcdn.com/w160/gt.png','🇬🇹'),
('GF','GUF','GUF','French Guiana','Guiana thuộc Pháp','OTHER','https://flagcdn.com/w160/gf.png','🇬🇫'),
('GU','GUM','GUM','Guam','Guam','AFC','https://flagcdn.com/w160/gu.png','🇬🇺'),
('GY','GUY','GUY','Guyana','Guyana','CONCACAF','https://flagcdn.com/w160/gy.png','🇬🇾'),
('HK','HKG','HKG','Hong Kong','Đặc khu Hành chính Hồng Kông, Trung Quốc','AFC','https://flagcdn.com/w160/hk.png','🇭🇰'),
('HM','HMD','HMD','Heard Island and McDonald Islands','Quần đảo Heard và McDonald','OTHER','https://flagcdn.com/w160/hm.png','🇭🇲'),
('HN','HND','HON','Honduras','Honduras','CONCACAF','https://flagcdn.com/w160/hn.png','🇭🇳'),
('HR','HRV','CRO','Croatia','Croatia','UEFA','https://flagcdn.com/w160/hr.png','🇭🇷'),
('HT','HTI','HAI','Haiti','Haiti','CONCACAF','https://flagcdn.com/w160/ht.png','🇭🇹'),
('HU','HUN','HUN','Hungary','Hungary','UEFA','https://flagcdn.com/w160/hu.png','🇭🇺'),
('ID','IDN','IDN','Indonesia','Indonesia','AFC','https://flagcdn.com/w160/id.png','🇮🇩'),
('IM','IMN','IMN','Isle of Man','Đảo Man','OTHER','https://flagcdn.com/w160/im.png','🇮🇲'),
('IN','IND','IND','India','Ấn Độ','AFC','https://flagcdn.com/w160/in.png','🇮🇳'),
('IO','IOT','IOT','British Indian Ocean Territory','Lãnh thổ Ấn Độ Dương thuộc Anh','OTHER','https://flagcdn.com/w160/io.png','🇮🇴'),
('IE','IRL','IRL','Ireland','Ireland','UEFA','https://flagcdn.com/w160/ie.png','🇮🇪'),
('IR','IRN','IRN','Iran','Iran','AFC','https://flagcdn.com/w160/ir.png','🇮🇷'),
('IQ','IRQ','IRQ','Iraq','Iraq','AFC','https://flagcdn.com/w160/iq.png','🇮🇶'),
('IS','ISL','ISL','Iceland','Iceland','UEFA','https://flagcdn.com/w160/is.png','🇮🇸'),
('IL','ISR','ISR','Israel','Israel','UEFA','https://flagcdn.com/w160/il.png','🇮🇱'),
('IT','ITA','ITA','Italy','Italy','UEFA','https://flagcdn.com/w160/it.png','🇮🇹'),
('JM','JAM','JAM','Jamaica','Jamaica','CONCACAF','https://flagcdn.com/w160/jm.png','🇯🇲'),
('JE','JEY','JEY','Jersey','Jersey','OTHER','https://flagcdn.com/w160/je.png','🇯🇪'),
('JO','JOR','JOR','Jordan','Jordan','AFC','https://flagcdn.com/w160/jo.png','🇯🇴'),
('JP','JPN','JPN','Japan','Nhật Bản','AFC','https://flagcdn.com/w160/jp.png','🇯🇵'),
('KZ','KAZ','KAZ','Kazakhstan','Kazakhstan','UEFA','https://flagcdn.com/w160/kz.png','🇰🇿'),
('KE','KEN','KEN','Kenya','Kenya','CAF','https://flagcdn.com/w160/ke.png','🇰🇪'),
('KG','KGZ','KGZ','Kyrgyzstan','Kyrgyzstan','AFC','https://flagcdn.com/w160/kg.png','🇰🇬'),
('KH','KHM','CAM','Cambodia','Campuchia','AFC','https://flagcdn.com/w160/kh.png','🇰🇭'),
('KI','KIR','KIR','Kiribati','Kiribati','OFC','https://flagcdn.com/w160/ki.png','🇰🇮'),
('KN','KNA','SKN','Saint Kitts and Nevis','St. Kitts và Nevis','CONCACAF','https://flagcdn.com/w160/kn.png','🇰🇳'),
('KR','KOR','KOR','South Korea','Hàn Quốc','AFC','https://flagcdn.com/w160/kr.png','🇰🇷'),
('KW','KWT','KUW','Kuwait','Kuwait','AFC','https://flagcdn.com/w160/kw.png','🇰🇼'),
('LA','LAO','LAO','Laos','Lào','AFC','https://flagcdn.com/w160/la.png','🇱🇦'),
('LB','LBN','LIB','Lebanon','Li-băng','AFC','https://flagcdn.com/w160/lb.png','🇱🇧'),
('LR','LBR','LBR','Liberia','Liberia','CAF','https://flagcdn.com/w160/lr.png','🇱🇷'),
('LY','LBY','LBY','Libya','Libya','CAF','https://flagcdn.com/w160/ly.png','🇱🇾'),
('LC','LCA','LCA','Saint Lucia','St. Lucia','CONCACAF','https://flagcdn.com/w160/lc.png','🇱🇨'),
('LI','LIE','LIE','Liechtenstein','Liechtenstein','UEFA','https://flagcdn.com/w160/li.png','🇱🇮'),
('LK','LKA','SRI','Sri Lanka','Sri Lanka','AFC','https://flagcdn.com/w160/lk.png','🇱🇰'),
('LS','LSO','LES','Lesotho','Lesotho','CAF','https://flagcdn.com/w160/ls.png','🇱🇸'),
('LT','LTU','LTU','Lithuania','Litva','UEFA','https://flagcdn.com/w160/lt.png','🇱🇹'),
('LU','LUX','LUX','Luxembourg','Luxembourg','UEFA','https://flagcdn.com/w160/lu.png','🇱🇺'),
('LV','LVA','LVA','Latvia','Latvia','UEFA','https://flagcdn.com/w160/lv.png','🇱🇻'),
('MO','MAC','MAC','Macao','Đặc khu Hành chính Macao, Trung Quốc','AFC','https://flagcdn.com/w160/mo.png','🇲🇴'),
('MF','MAF','MAF','Saint Martin (French part)','St. Martin','CONCACAF','https://flagcdn.com/w160/mf.png','🇲🇫'),
('MA','MAR','MAR','Morocco','Ma-rốc','CAF','https://flagcdn.com/w160/ma.png','🇲🇦'),
('MC','MCO','MCO','Monaco','Monaco','OTHER','https://flagcdn.com/w160/mc.png','🇲🇨'),
('MD','MDA','MDA','Moldova','Moldova','UEFA','https://flagcdn.com/w160/md.png','🇲🇩'),
('MG','MDG','MAD','Madagascar','Madagascar','CAF','https://flagcdn.com/w160/mg.png','🇲🇬'),
('MV','MDV','MDV','Maldives','Maldives','AFC','https://flagcdn.com/w160/mv.png','🇲🇻'),
('MX','MEX','MEX','Mexico','Mexico','CONCACAF','https://flagcdn.com/w160/mx.png','🇲🇽'),
('MH','MHL','MHL','Marshall Islands','Quần đảo Marshall','OTHER','https://flagcdn.com/w160/mh.png','🇲🇭'),
('MK','MKD','MKD','North Macedonia','Bắc Macedonia','UEFA','https://flagcdn.com/w160/mk.png','🇲🇰'),
('ML','MLI','MLI','Mali','Mali','CAF','https://flagcdn.com/w160/ml.png','🇲🇱'),
('MT','MLT','MLT','Malta','Malta','UEFA','https://flagcdn.com/w160/mt.png','🇲🇹'),
('MM','MMR','MYA','Myanmar','Myanmar (Miến Điện)','AFC','https://flagcdn.com/w160/mm.png','🇲🇲'),
('ME','MNE','MNE','Montenegro','Montenegro','UEFA','https://flagcdn.com/w160/me.png','🇲🇪'),
('MN','MNG','MNG','Mongolia','Mông Cổ','AFC','https://flagcdn.com/w160/mn.png','🇲🇳'),
('MP','MNP','MNP','Northern Mariana Islands','Quần đảo Bắc Mariana','OTHER','https://flagcdn.com/w160/mp.png','🇲🇵'),
('MZ','MOZ','MOZ','Mozambique','Mozambique','CAF','https://flagcdn.com/w160/mz.png','🇲🇿'),
('MR','MRT','MTN','Mauritania','Mauritania','CAF','https://flagcdn.com/w160/mr.png','🇲🇷'),
('MS','MSR','MSR','Montserrat','Montserrat','CONCACAF','https://flagcdn.com/w160/ms.png','🇲🇸'),
('MQ','MTQ','MTQ','Martinique','Martinique','CONCACAF','https://flagcdn.com/w160/mq.png','🇲🇶'),
('MU','MUS','MRI','Mauritius','Mauritius','CAF','https://flagcdn.com/w160/mu.png','🇲🇺'),
('MW','MWI','MWI','Malawi','Malawi','CAF','https://flagcdn.com/w160/mw.png','🇲🇼'),
('MY','MYS','MAS','Malaysia','Malaysia','AFC','https://flagcdn.com/w160/my.png','🇲🇾'),
('YT','MYT','MYT','Mayotte','Mayotte','OTHER','https://flagcdn.com/w160/yt.png','🇾🇹'),
('NA','NAM','NAM','Namibia','Namibia','CAF','https://flagcdn.com/w160/na.png','🇳🇦'),
('NC','NCL','NCL','New Caledonia','New Caledonia','OFC','https://flagcdn.com/w160/nc.png','🇳🇨'),
('NE','NER','NIG','Niger','Niger','CAF','https://flagcdn.com/w160/ne.png','🇳🇪'),
('NF','NFK','NFK','Norfolk Island','Đảo Norfolk','OTHER','https://flagcdn.com/w160/nf.png','🇳🇫'),
('NG','NGA','NGA','Nigeria','Nigeria','CAF','https://flagcdn.com/w160/ng.png','🇳🇬'),
('NI','NIC','NCA','Nicaragua','Nicaragua','CONCACAF','https://flagcdn.com/w160/ni.png','🇳🇮'),
('NU','NIU','NIU','Niue','Niue','OFC','https://flagcdn.com/w160/nu.png','🇳🇺'),
('NL','NLD','NED','Netherlands','Hà Lan','UEFA','https://flagcdn.com/w160/nl.png','🇳🇱'),
('NO','NOR','NOR','Norway','Na Uy','UEFA','https://flagcdn.com/w160/no.png','🇳🇴'),
('NP','NPL','NEP','Nepal','Nepal','AFC','https://flagcdn.com/w160/np.png','🇳🇵'),
('NR','NRU','NRU','Nauru','Nauru','OTHER','https://flagcdn.com/w160/nr.png','🇳🇷'),
('NZ','NZL','NZL','New Zealand','New Zealand','OFC','https://flagcdn.com/w160/nz.png','🇳🇿'),
('OM','OMN','OMA','Oman','Oman','AFC','https://flagcdn.com/w160/om.png','🇴🇲'),
('PK','PAK','PAK','Pakistan','Pakistan','AFC','https://flagcdn.com/w160/pk.png','🇵🇰'),
('PA','PAN','PAN','Panama','Panama','CONCACAF','https://flagcdn.com/w160/pa.png','🇵🇦'),
('PN','PCN','PCN','Pitcairn','Quần đảo Pitcairn','OTHER','https://flagcdn.com/w160/pn.png','🇵🇳'),
('PE','PER','PER','Peru','Peru','CONMEBOL','https://flagcdn.com/w160/pe.png','🇵🇪'),
('PH','PHL','PHI','Philippines','Philippines','AFC','https://flagcdn.com/w160/ph.png','🇵🇭'),
('PW','PLW','PLW','Palau','Palau','OTHER','https://flagcdn.com/w160/pw.png','🇵🇼'),
('PG','PNG','PNG','Papua New Guinea','Papua New Guinea','OFC','https://flagcdn.com/w160/pg.png','🇵🇬'),
('PL','POL','POL','Poland','Ba Lan','UEFA','https://flagcdn.com/w160/pl.png','🇵🇱'),
('PR','PRI','PUR','Puerto Rico','Puerto Rico','CONCACAF','https://flagcdn.com/w160/pr.png','🇵🇷'),
('KP','PRK','PRK','North Korea','Triều Tiên','AFC','https://flagcdn.com/w160/kp.png','🇰🇵'),
('PT','PRT','POR','Portugal','Bồ Đào Nha','UEFA','https://flagcdn.com/w160/pt.png','🇵🇹'),
('PY','PRY','PAR','Paraguay','Paraguay','CONMEBOL','https://flagcdn.com/w160/py.png','🇵🇾'),
('PS','PSE','PLE','Palestine, State of','Lãnh thổ Palestine','AFC','https://flagcdn.com/w160/ps.png','🇵🇸'),
('PF','PYF','PYF','French Polynesia','Polynesia thuộc Pháp','OFC','https://flagcdn.com/w160/pf.png','🇵🇫'),
('QA','QAT','QAT','Qatar','Qatar','AFC','https://flagcdn.com/w160/qa.png','🇶🇦'),
('RE','REU','REU','Réunion','Réunion','OTHER','https://flagcdn.com/w160/re.png','🇷🇪'),
('RO','ROU','ROU','Romania','Romania','UEFA','https://flagcdn.com/w160/ro.png','🇷🇴'),
('RU','RUS','RUS','Russian Federation','Nga','UEFA','https://flagcdn.com/w160/ru.png','🇷🇺'),
('RW','RWA','RWA','Rwanda','Rwanda','CAF','https://flagcdn.com/w160/rw.png','🇷🇼'),
('SA','SAU','KSA','Saudi Arabia','Ả Rập Xê-út','AFC','https://flagcdn.com/w160/sa.png','🇸🇦'),
('SD','SDN','SUD','Sudan','Sudan','CAF','https://flagcdn.com/w160/sd.png','🇸🇩'),
('SN','SEN','SEN','Senegal','Senegal','CAF','https://flagcdn.com/w160/sn.png','🇸🇳'),
('SG','SGP','SIN','Singapore','Singapore','AFC','https://flagcdn.com/w160/sg.png','🇸🇬'),
('GS','SGS','SGS','South Georgia and the South Sandwich Islands','Nam Georgia & Quần đảo Nam Sandwich','OTHER','https://flagcdn.com/w160/gs.png','🇬🇸'),
('SH','SHN','SHN','Saint Helena, Ascension and Tristan da Cunha','St. Helena','OTHER','https://flagcdn.com/w160/sh.png','🇸🇭'),
('SJ','SJM','SJM','Svalbard and Jan Mayen','Svalbard và Jan Mayen','OTHER','https://flagcdn.com/w160/sj.png','🇸🇯'),
('SB','SLB','SOL','Solomon Islands','Quần đảo Solomon','OFC','https://flagcdn.com/w160/sb.png','🇸🇧'),
('SL','SLE','SLE','Sierra Leone','Sierra Leone','CAF','https://flagcdn.com/w160/sl.png','🇸🇱'),
('SV','SLV','SLV','El Salvador','El Salvador','CONCACAF','https://flagcdn.com/w160/sv.png','🇸🇻'),
('SM','SMR','SMR','San Marino','San Marino','UEFA','https://flagcdn.com/w160/sm.png','🇸🇲'),
('SO','SOM','SOM','Somalia','Somalia','CAF','https://flagcdn.com/w160/so.png','🇸🇴'),
('PM','SPM','SPM','Saint Pierre and Miquelon','Saint Pierre và Miquelon','OTHER','https://flagcdn.com/w160/pm.png','🇵🇲'),
('RS','SRB','SRB','Serbia','Serbia','UEFA','https://flagcdn.com/w160/rs.png','🇷🇸'),
('SS','SSD','SSD','South Sudan','Nam Sudan','CAF','https://flagcdn.com/w160/ss.png','🇸🇸'),
('ST','STP','STP','Sao Tome and Principe','São Tomé và Príncipe','CAF','https://flagcdn.com/w160/st.png','🇸🇹'),
('SR','SUR','SUR','Suriname','Suriname','CONCACAF','https://flagcdn.com/w160/sr.png','🇸🇷'),
('SK','SVK','SVK','Slovakia','Slovakia','UEFA','https://flagcdn.com/w160/sk.png','🇸🇰'),
('SI','SVN','SVN','Slovenia','Slovenia','UEFA','https://flagcdn.com/w160/si.png','🇸🇮'),
('SE','SWE','SWE','Sweden','Thụy Điển','UEFA','https://flagcdn.com/w160/se.png','🇸🇪'),
('SZ','SWZ','SWZ','Eswatini','Eswatini','CAF','https://flagcdn.com/w160/sz.png','🇸🇿'),
('SX','SXM','SXM','Sint Maarten (Dutch part)','Sint Maarten','CONCACAF','https://flagcdn.com/w160/sx.png','🇸🇽'),
('SC','SYC','SEY','Seychelles','Seychelles','CAF','https://flagcdn.com/w160/sc.png','🇸🇨'),
('SY','SYR','SYR','Syria','Syria','AFC','https://flagcdn.com/w160/sy.png','🇸🇾'),
('TC','TCA','TCA','Turks and Caicos Islands','Quần đảo Turks và Caicos','CONCACAF','https://flagcdn.com/w160/tc.png','🇹🇨'),
('TD','TCD','CHA','Chad','Chad','CAF','https://flagcdn.com/w160/td.png','🇹🇩'),
('TG','TGO','TOG','Togo','Togo','CAF','https://flagcdn.com/w160/tg.png','🇹🇬'),
('TH','THA','THA','Thailand','Thái Lan','AFC','https://flagcdn.com/w160/th.png','🇹🇭'),
('TJ','TJK','TJK','Tajikistan','Tajikistan','AFC','https://flagcdn.com/w160/tj.png','🇹🇯'),
('TK','TKL','TKL','Tokelau','Tokelau','OTHER','https://flagcdn.com/w160/tk.png','🇹🇰'),
('TM','TKM','TKM','Turkmenistan','Turkmenistan','AFC','https://flagcdn.com/w160/tm.png','🇹🇲'),
('TL','TLS','TLS','Timor-Leste','Timor-Leste','AFC','https://flagcdn.com/w160/tl.png','🇹🇱'),
('TO','TON','TGA','Tonga','Tonga','OFC','https://flagcdn.com/w160/to.png','🇹🇴'),
('TT','TTO','TRI','Trinidad and Tobago','Trinidad và Tobago','CONCACAF','https://flagcdn.com/w160/tt.png','🇹🇹'),
('TN','TUN','TUN','Tunisia','Tunisia','CAF','https://flagcdn.com/w160/tn.png','🇹🇳'),
('TR','TUR','TUR','Türkiye','Thổ Nhĩ Kỳ','UEFA','https://flagcdn.com/w160/tr.png','🇹🇷'),
('TV','TUV','TUV','Tuvalu','Tuvalu','OFC','https://flagcdn.com/w160/tv.png','🇹🇻'),
('TW','TWN','TPE','Taiwan','Đài Loan','AFC','https://flagcdn.com/w160/tw.png','🇹🇼'),
('TZ','TZA','TAN','Tanzania','Tanzania','CAF','https://flagcdn.com/w160/tz.png','🇹🇿'),
('UG','UGA','UGA','Uganda','Uganda','CAF','https://flagcdn.com/w160/ug.png','🇺🇬'),
('UA','UKR','UKR','Ukraine','Ukraina','UEFA','https://flagcdn.com/w160/ua.png','🇺🇦'),
('UM','UMI','UMI','United States Minor Outlying Islands','Các tiểu đảo xa của Hoa Kỳ','OTHER','https://flagcdn.com/w160/um.png','🇺🇲'),
('UY','URY','URU','Uruguay','Uruguay','CONMEBOL','https://flagcdn.com/w160/uy.png','🇺🇾'),
('US','USA','USA','United States','Hoa Kỳ','CONCACAF','https://flagcdn.com/w160/us.png','🇺🇸'),
('UZ','UZB','UZB','Uzbekistan','Uzbekistan','AFC','https://flagcdn.com/w160/uz.png','🇺🇿'),
('VA','VAT','VAT','Holy See (Vatican City State)','Thành Vatican','OTHER','https://flagcdn.com/w160/va.png','🇻🇦'),
('VC','VCT','VIN','Saint Vincent and the Grenadines','St. Vincent và Grenadines','CONCACAF','https://flagcdn.com/w160/vc.png','🇻🇨'),
('VE','VEN','VEN','Venezuela','Venezuela','CONMEBOL','https://flagcdn.com/w160/ve.png','🇻🇪'),
('VG','VGB','VGB','Virgin Islands, British','Quần đảo Virgin thuộc Anh','CONCACAF','https://flagcdn.com/w160/vg.png','🇻🇬'),
('VI','VIR','VIR','Virgin Islands, U.S.','Quần đảo Virgin thuộc Hoa Kỳ','CONCACAF','https://flagcdn.com/w160/vi.png','🇻🇮'),
('VN','VNM','VIE','Vietnam','Việt Nam','AFC','https://flagcdn.com/w160/vn.png','🇻🇳'),
('VU','VUT','VAN','Vanuatu','Vanuatu','OFC','https://flagcdn.com/w160/vu.png','🇻🇺'),
('WF','WLF','WLF','Wallis and Futuna','Wallis và Futuna','OTHER','https://flagcdn.com/w160/wf.png','🇼🇫'),
('WS','WSM','SAM','Samoa','Samoa','OFC','https://flagcdn.com/w160/ws.png','🇼🇸'),
('YE','YEM','YEM','Yemen','Yemen','AFC','https://flagcdn.com/w160/ye.png','🇾🇪'),
('ZA','ZAF','RSA','South Africa','Nam Phi','CAF','https://flagcdn.com/w160/za.png','🇿🇦'),
('ZM','ZMB','ZAM','Zambia','Zambia','CAF','https://flagcdn.com/w160/zm.png','🇿🇲'),
('ZW','ZWE','ZIM','Zimbabwe','Zimbabwe','CAF','https://flagcdn.com/w160/zw.png','🇿🇼'),
('GB-ENG','ENG','ENG','England','Anh','UEFA','https://flagcdn.com/w160/gb-eng.png','🏴'),
('GB-SCT','SCO','SCO','Scotland','Scotland','UEFA','https://flagcdn.com/w160/gb-sct.png','🏴'),
('GB-WLS','WAL','WAL','Wales','Xứ Wales','UEFA','https://flagcdn.com/w160/gb-wls.png','🏴'),
('GB-NIR','NIR','NIR','Northern Ireland','Bắc Ireland','UEFA','https://flagcdn.com/w160/gb-nir.png','🇬🇧'),
('XK','XKX','KOS','Kosovo','Kosovo','UEFA','https://flagcdn.com/w160/xk.png','🇽🇰')
ON DUPLICATE KEY UPDATE
  iso2=VALUES(iso2), name_en=VALUES(name_en), name_vi=VALUES(name_vi),
  confederation=VALUES(confederation), flag_url=VALUES(flag_url), flag_emoji=VALUES(flag_emoji), is_active=TRUE;

INSERT IGNORE INTO country_aliases(country_id, alias_text, alias_type)
SELECT id, name_vi, 'VI' FROM country_catalog
UNION ALL SELECT id, name_en, 'EN' FROM country_catalog
UNION ALL SELECT id, iso2, 'ISO2' FROM country_catalog WHERE iso2 IS NOT NULL
UNION ALL SELECT id, iso3, 'ISO3' FROM country_catalog
UNION ALL SELECT id, fifa_code, 'FIFA' FROM country_catalog;

/* Các cách gọi thông dụng bằng tiếng Việt/tiếng Anh. */
INSERT IGNORE INTO country_aliases(country_id, alias_text, alias_type)
SELECT id, 'Mỹ', 'VI' FROM country_catalog WHERE iso3='USA'
UNION ALL SELECT id, 'USA', 'OTHER' FROM country_catalog WHERE iso3='USA'
UNION ALL SELECT id, 'United States', 'EN' FROM country_catalog WHERE iso3='USA'
UNION ALL SELECT id, 'Anh', 'VI' FROM country_catalog WHERE fifa_code='ENG'
UNION ALL SELECT id, 'Korea Republic', 'EN' FROM country_catalog WHERE iso3='KOR'
UNION ALL SELECT id, 'Hàn Quốc', 'VI' FROM country_catalog WHERE iso3='KOR'
UNION ALL SELECT id, 'Triều Tiên', 'VI' FROM country_catalog WHERE iso3='PRK'
UNION ALL SELECT id, 'Nga', 'VI' FROM country_catalog WHERE iso3='RUS'
UNION ALL SELECT id, 'Czechia', 'EN' FROM country_catalog WHERE iso3='CZE'
UNION ALL SELECT id, 'Cộng hòa Séc', 'VI' FROM country_catalog WHERE iso3='CZE';

UPDATE player_national_profiles np
JOIN country_catalog cc
  ON UPPER(np.country_code) IN (UPPER(cc.iso2), UPPER(cc.iso3), UPPER(cc.fifa_code))
SET np.country_catalog_id = cc.id,
    np.country_name = COALESCE(NULLIF(np.country_name,''), cc.name_vi),
    np.country_code = cc.fifa_code,
    np.flag_url = cc.flag_url,
    np.confederation = cc.confederation
WHERE np.country_catalog_id IS NULL;

UPDATE world_cup_entries wce
JOIN country_catalog cc
  ON UPPER(wce.country_code) IN (UPPER(cc.iso2), UPPER(cc.iso3), UPPER(cc.fifa_code))
SET wce.country_catalog_id = cc.id,
    wce.flag_url = cc.flag_url,
    wce.confederation = cc.confederation
WHERE wce.country_catalog_id IS NULL;

INSERT INTO award_auto_rules(award_type_id,metric_code,position_filter,min_appearances,auto_enabled,explanation)
SELECT id,'GOALS','ANY',1,TRUE,'Tổng bàn thắng cao nhất; hòa thì xét kiến tạo, số trận ít hơn rồi ID.' FROM award_types WHERE code='TOP_SCORER'
ON DUPLICATE KEY UPDATE metric_code=VALUES(metric_code),position_filter=VALUES(position_filter),explanation=VALUES(explanation);
INSERT INTO award_auto_rules(award_type_id,metric_code,position_filter,min_appearances,auto_enabled,explanation)
SELECT id,'ASSISTS','ANY',1,TRUE,'Tổng kiến tạo cao nhất; hòa thì xét bàn thắng rồi số trận ít hơn.' FROM award_types WHERE code='BEST_ASSIST'
ON DUPLICATE KEY UPDATE metric_code=VALUES(metric_code),position_filter=VALUES(position_filter),explanation=VALUES(explanation);
INSERT INTO award_auto_rules(award_type_id,metric_code,position_filter,min_appearances,auto_enabled,explanation)
SELECT id,'GOALKEEPER','GK',1,TRUE,'Giữ sạch lưới nhiều nhất; hòa thì xét tỷ lệ thủng lưới thấp và số trận.' FROM award_types WHERE code='BEST_GOALKEEPER'
ON DUPLICATE KEY UPDATE metric_code=VALUES(metric_code),position_filter=VALUES(position_filter),explanation=VALUES(explanation);
INSERT INTO award_auto_rules(award_type_id,metric_code,position_filter,min_appearances,auto_enabled,explanation)
SELECT id,'OVERALL','ANY',1,TRUE,'Điểm hiệu suất tổng hợp từ bàn thắng, kiến tạo, sạch lưới và kỷ luật.' FROM award_types WHERE code='BEST_PLAYER'
ON DUPLICATE KEY UPDATE metric_code=VALUES(metric_code),position_filter=VALUES(position_filter),explanation=VALUES(explanation);

DROP VIEW IF EXISTS v_competition_player_stat_totals;
CREATE VIEW v_competition_player_stat_totals AS
SELECT
  m.competition_id,
  pms.player_id,
  pms.club_id AS club_id_at_award,
  'CLUB' AS award_context_type,
  NULL AS country_name_at_award,
  NULL AS country_code_at_award,
  p.full_name,
  p.photo_url,
  p.position,
  COUNT(DISTINCT CASE WHEN pms.appeared THEN pms.match_id END) AS appearances,
  COALESCE(SUM(pms.goals),0) AS goals,
  COALESCE(SUM(pms.assists),0) AS assists,
  COALESCE(SUM(CASE WHEN pms.clean_sheet THEN 1 ELSE 0 END),0) AS clean_sheets,
  COALESCE(SUM(pms.goals_conceded),0) AS goals_conceded,
  COALESCE(SUM(pms.yellow_cards),0) AS yellow_cards,
  COALESCE(SUM(pms.red_cards),0) AS red_cards,
  ROUND(COALESCE(SUM(pms.goals),0)*5 + COALESCE(SUM(pms.assists),0)*3
    + COALESCE(SUM(CASE WHEN pms.clean_sheet THEN 1 ELSE 0 END),0)*2
    - COALESCE(SUM(pms.goals_conceded),0)*0.20
    - COALESCE(SUM(pms.yellow_cards),0)*0.25 - COALESCE(SUM(pms.red_cards),0)*2, 3) AS performance_score,
  ROUND(COALESCE(SUM(CASE WHEN pms.clean_sheet THEN 1 ELSE 0 END),0)*8
    - COALESCE(SUM(pms.goals_conceded),0)*1.5 + COUNT(DISTINCT CASE WHEN pms.appeared THEN pms.match_id END)*0.5, 3) AS goalkeeper_score
FROM player_match_stats pms
JOIN matches m ON m.id=pms.match_id AND m.status='FINISHED'
JOIN players p ON p.id=pms.player_id
WHERE pms.verification_status IN ('VERIFIED','LOCKED')
GROUP BY m.competition_id,pms.player_id,pms.club_id,p.full_name,p.photo_url,p.position
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
  ROUND(SUM(x.goals_for)*5 + SUM(x.goals_against=0)*2 - SUM(x.goals_against)*0.20,3) AS performance_score,
  ROUND(SUM(x.goals_against=0)*8 - SUM(x.goals_against)*1.5 + COUNT(*)*0.5,3) AS goalkeeper_score
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

SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES;

SELECT
  'SMART_AWARDS_AND_GLOBAL_FLAGS_READY' AS result,
  (SELECT COUNT(*) FROM country_catalog WHERE is_active=TRUE) AS countries_ready,
  (SELECT COUNT(*) FROM award_auto_rules WHERE auto_enabled=TRUE) AS automatic_award_rules;

/* ============================================================================
 FOOTBALL RANK MANAGER 2.0.9
 STADIUM ECONOMY & SPONSORSHIP
 - Sửa phần đồng bộ quốc gia 2.0.8 bị lỗi collation 1271.
 - Thêm quản lý nhiều sân/CLB, thuê sân, nâng cấp sân.
 - Thêm mô phỏng vé, tỷ lệ lấp đầy, doanh thu ngày thi đấu.
 - Thêm thị trường tài trợ 0-4 lời mời, chấp nhận/từ chối có kiểm tra xung đột.
 - Mọi khoản thu/chi đi qua ví và sổ cái hiện có.

 An toàn dữ liệu:
 - Không DROP database.
 - Không xóa CLB, cầu thủ, mùa, giải, trận, ví hay lịch sử hiện có.
 - Có thể chạy lại; dữ liệu danh mục được UPSERT/IGNORE.
============================================================================ */

SET NAMES utf8mb4;
SET TIME_ZONE = '+07:00';
USE football_rank_manager;

SET @OLD_SQL_SAFE_UPDATES_V209 = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

DROP PROCEDURE IF EXISTS frm_v209_add_index_if_missing;
DELIMITER $$
CREATE PROCEDURE frm_v209_add_index_if_missing(
  IN p_table_name VARCHAR(64),
  IN p_index_name VARCHAR(64),
  IN p_ddl VARCHAR(1000)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema=DATABASE() AND table_name=p_table_name AND index_name=p_index_name
  ) THEN
    SET @frm_v209_index_sql=p_ddl;
    PREPARE frm_v209_stmt FROM @frm_v209_index_sql;
    EXECUTE frm_v209_stmt;
    DEALLOCATE PREPARE frm_v209_stmt;
  END IF;
END$$
DELIMITER ;

/* -------------------------------------------------------------------------- */
/* 0. HOÀN TẤT PHẦN 2.0.8 BỊ DỪNG DO COLLATION                               */
/* -------------------------------------------------------------------------- */

UPDATE player_national_profiles np
JOIN country_catalog cc
  ON CONVERT(UPPER(TRIM(np.country_code)) USING utf8mb4) COLLATE utf8mb4_unicode_ci IN (
       CONVERT(UPPER(cc.iso2) USING utf8mb4) COLLATE utf8mb4_unicode_ci,
       CONVERT(UPPER(cc.iso3) USING utf8mb4) COLLATE utf8mb4_unicode_ci,
       CONVERT(UPPER(cc.fifa_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci
     )
SET np.country_catalog_id = cc.id,
    np.country_name = COALESCE(NULLIF(np.country_name,''), cc.name_vi),
    np.country_code = cc.fifa_code,
    np.flag_url = cc.flag_url,
    np.confederation = cc.confederation
WHERE np.country_catalog_id IS NULL
  AND np.country_code IS NOT NULL
  AND TRIM(np.country_code) <> '';

UPDATE world_cup_entries wce
JOIN country_catalog cc
  ON CONVERT(UPPER(TRIM(wce.country_code)) USING utf8mb4) COLLATE utf8mb4_unicode_ci IN (
       CONVERT(UPPER(cc.iso2) USING utf8mb4) COLLATE utf8mb4_unicode_ci,
       CONVERT(UPPER(cc.iso3) USING utf8mb4) COLLATE utf8mb4_unicode_ci,
       CONVERT(UPPER(cc.fifa_code) USING utf8mb4) COLLATE utf8mb4_unicode_ci
     )
SET wce.country_catalog_id = cc.id,
    wce.flag_url = cc.flag_url,
    wce.confederation = cc.confederation
WHERE wce.country_catalog_id IS NULL
  AND wce.country_code IS NOT NULL
  AND TRIM(wce.country_code) <> '';

INSERT INTO award_auto_rules(award_type_id,metric_code,position_filter,min_appearances,auto_enabled,explanation)
SELECT id,'GOALS','ANY',1,TRUE,'Tổng bàn thắng cao nhất; hòa thì xét kiến tạo, số trận ít hơn rồi ID.' FROM award_types WHERE code='TOP_SCORER'
ON DUPLICATE KEY UPDATE metric_code=VALUES(metric_code),position_filter=VALUES(position_filter),explanation=VALUES(explanation),auto_enabled=TRUE;
INSERT INTO award_auto_rules(award_type_id,metric_code,position_filter,min_appearances,auto_enabled,explanation)
SELECT id,'ASSISTS','ANY',1,TRUE,'Tổng kiến tạo cao nhất; hòa thì xét bàn thắng rồi số trận ít hơn.' FROM award_types WHERE code='BEST_ASSIST'
ON DUPLICATE KEY UPDATE metric_code=VALUES(metric_code),position_filter=VALUES(position_filter),explanation=VALUES(explanation),auto_enabled=TRUE;
INSERT INTO award_auto_rules(award_type_id,metric_code,position_filter,min_appearances,auto_enabled,explanation)
SELECT id,'GOALKEEPER','GK',1,TRUE,'Giữ sạch lưới nhiều nhất; hòa thì xét tỷ lệ thủng lưới thấp và số trận.' FROM award_types WHERE code='BEST_GOALKEEPER'
ON DUPLICATE KEY UPDATE metric_code=VALUES(metric_code),position_filter=VALUES(position_filter),explanation=VALUES(explanation),auto_enabled=TRUE;
INSERT INTO award_auto_rules(award_type_id,metric_code,position_filter,min_appearances,auto_enabled,explanation)
SELECT id,'OVERALL','ANY',1,TRUE,'Điểm hiệu suất tổng hợp từ bàn thắng, kiến tạo, sạch lưới và kỷ luật.' FROM award_types WHERE code='BEST_PLAYER'
ON DUPLICATE KEY UPDATE metric_code=VALUES(metric_code),position_filter=VALUES(position_filter),explanation=VALUES(explanation),auto_enabled=TRUE;

DROP VIEW IF EXISTS v_competition_player_stat_totals;
CREATE VIEW v_competition_player_stat_totals AS
SELECT
  m.competition_id,
  pms.player_id,
  pms.club_id AS club_id_at_award,
  'CLUB' AS award_context_type,
  NULL AS country_name_at_award,
  NULL AS country_code_at_award,
  p.full_name,
  p.photo_url,
  p.position,
  COUNT(DISTINCT CASE WHEN pms.appeared THEN pms.match_id END) AS appearances,
  COALESCE(SUM(pms.goals),0) AS goals,
  COALESCE(SUM(pms.assists),0) AS assists,
  COALESCE(SUM(CASE WHEN pms.clean_sheet THEN 1 ELSE 0 END),0) AS clean_sheets,
  COALESCE(SUM(pms.goals_conceded),0) AS goals_conceded,
  COALESCE(SUM(pms.yellow_cards),0) AS yellow_cards,
  COALESCE(SUM(pms.red_cards),0) AS red_cards,
  ROUND(COALESCE(SUM(pms.goals),0)*5 + COALESCE(SUM(pms.assists),0)*3
    + COALESCE(SUM(CASE WHEN pms.clean_sheet THEN 1 ELSE 0 END),0)*2
    - COALESCE(SUM(pms.goals_conceded),0)*0.20
    - COALESCE(SUM(pms.yellow_cards),0)*0.25 - COALESCE(SUM(pms.red_cards),0)*2, 3) AS performance_score,
  ROUND(COALESCE(SUM(CASE WHEN pms.clean_sheet THEN 1 ELSE 0 END),0)*8
    - COALESCE(SUM(pms.goals_conceded),0)*1.5 + COUNT(DISTINCT CASE WHEN pms.appeared THEN pms.match_id END)*0.5, 3) AS goalkeeper_score
FROM player_match_stats pms
JOIN matches m ON m.id=pms.match_id AND m.status='FINISHED'
JOIN players p ON p.id=pms.player_id
WHERE pms.verification_status IN ('VERIFIED','LOCKED')
GROUP BY m.competition_id,pms.player_id,pms.club_id,p.full_name,p.photo_url,p.position
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
  ROUND(SUM(x.goals_for)*5 + SUM(x.goals_against=0)*2 - SUM(x.goals_against)*0.20,3) AS performance_score,
  ROUND(SUM(x.goals_against=0)*8 - SUM(x.goals_against)*1.5 + COUNT(*)*0.5,3) AS goalkeeper_score
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

/* -------------------------------------------------------------------------- */
/* 1. MỞ RỘNG LOẠI GIAO DỊCH TÀI CHÍNH                                        */
/* -------------------------------------------------------------------------- */

ALTER TABLE wallet_transactions
MODIFY COLUMN transaction_type ENUM(
  'DEPOSIT','WITHDRAWAL','SALARY','STAFF_SALARY','PRIZE','TRANSFER_FEE',
  'UPSET_REWARD','ENTRY_FEE','PENALTY','BONUS','ADJUSTMENT','REVERSAL','REFUND',
  'TICKET_REVENUE','MATCHDAY_REVENUE','MATCHDAY_COST','SPONSORSHIP',
  'STADIUM_UPGRADE','STADIUM_RENT'
) NOT NULL;

/* -------------------------------------------------------------------------- */
/* 2. SÂN VẬN ĐỘNG VÀ QUYỀN KHAI THÁC                                         */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS stadiums (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(180) NOT NULL,
  city VARCHAR(120) NULL,
  country_name VARCHAR(120) NOT NULL DEFAULT 'Việt Nam',
  image_url VARCHAR(500) NULL,
  opened_year SMALLINT UNSIGNED NULL,
  status ENUM('ACTIVE','UNDER_UPGRADE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  level_no TINYINT UNSIGNED NOT NULL DEFAULT 1,
  capacity_total INT UNSIGNED NOT NULL DEFAULT 10000,
  standard_seats INT UNSIGNED NOT NULL DEFAULT 9000,
  vip_seats INT UNSIGNED NOT NULL DEFAULT 1000,
  hospitality_boxes SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  default_standard_ticket DECIMAL(20,0) NOT NULL DEFAULT 100000,
  default_vip_ticket DECIMAL(20,0) NOT NULL DEFAULT 500000,
  concession_per_head DECIMAL(20,0) NOT NULL DEFAULT 35000,
  parking_per_head DECIMAL(20,0) NOT NULL DEFAULT 8000,
  pitch_quality TINYINT UNSIGNED NOT NULL DEFAULT 45,
  seating_quality TINYINT UNSIGNED NOT NULL DEFAULT 40,
  stands_quality TINYINT UNSIGNED NOT NULL DEFAULT 40,
  lighting_quality TINYINT UNSIGNED NOT NULL DEFAULT 45,
  technology_quality TINYINT UNSIGNED NOT NULL DEFAULT 35,
  hospitality_quality TINYINT UNSIGNED NOT NULL DEFAULT 30,
  parking_quality TINYINT UNSIGNED NOT NULL DEFAULT 35,
  security_quality TINYINT UNSIGNED NOT NULL DEFAULT 45,
  commercial_quality TINYINT UNSIGNED NOT NULL DEFAULT 30,
  atmosphere_quality TINYINT UNSIGNED NOT NULL DEFAULT 45,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_stadiums_code UNIQUE(code),
  CONSTRAINT fk_stadiums_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stadium_club_links (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  stadium_id BIGINT UNSIGNED NOT NULL,
  club_id BIGINT UNSIGNED NOT NULL,
  relationship_type ENUM('OWNED','LEASED','SHARED') NOT NULL DEFAULT 'OWNED',
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  lease_fee_per_match DECIMAL(20,0) NOT NULL DEFAULT 0,
  owner_revenue_share_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  starts_on DATE NULL,
  ends_on DATE NULL,
  status ENUM('ACTIVE','EXPIRED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_stadium_club_link UNIQUE(stadium_id, club_id),
  CONSTRAINT fk_stadium_link_stadium FOREIGN KEY(stadium_id) REFERENCES stadiums(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_stadium_link_club FOREIGN KEY(club_id) REFERENCES clubs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT
) ENGINE=InnoDB;

CALL frm_v209_add_index_if_missing('stadium_club_links','idx_stadium_links_club','CREATE INDEX idx_stadium_links_club ON stadium_club_links(club_id,status,is_primary)');
CALL frm_v209_add_index_if_missing('stadium_club_links','idx_stadium_links_stadium','CREATE INDEX idx_stadium_links_stadium ON stadium_club_links(stadium_id,status)');

/* -------------------------------------------------------------------------- */
/* 3. DANH MỤC VÀ TIẾN ĐỘ NÂNG CẤP                                            */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS stadium_upgrade_catalog (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  category ENUM('CAPACITY','COMFORT','PITCH','TECHNOLOGY','HOSPITALITY','SAFETY','COMMERCIAL') NOT NULL,
  description VARCHAR(500) NOT NULL,
  base_cost DECIMAL(20,0) NOT NULL,
  duration_days SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  min_level TINYINT UNSIGNED NOT NULL DEFAULT 1,
  capacity_add INT NOT NULL DEFAULT 0,
  standard_seats_add INT NOT NULL DEFAULT 0,
  vip_seats_add INT NOT NULL DEFAULT 0,
  hospitality_boxes_add SMALLINT NOT NULL DEFAULT 0,
  pitch_bonus SMALLINT NOT NULL DEFAULT 0,
  seating_bonus SMALLINT NOT NULL DEFAULT 0,
  stands_bonus SMALLINT NOT NULL DEFAULT 0,
  lighting_bonus SMALLINT NOT NULL DEFAULT 0,
  technology_bonus SMALLINT NOT NULL DEFAULT 0,
  hospitality_bonus SMALLINT NOT NULL DEFAULT 0,
  parking_bonus SMALLINT NOT NULL DEFAULT 0,
  security_bonus SMALLINT NOT NULL DEFAULT 0,
  commercial_bonus SMALLINT NOT NULL DEFAULT 0,
  atmosphere_bonus SMALLINT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_stadium_upgrade_catalog_code UNIQUE(code)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stadium_upgrades (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  stadium_id BIGINT UNSIGNED NOT NULL,
  club_id BIGINT UNSIGNED NOT NULL,
  catalog_id BIGINT UNSIGNED NOT NULL,
  status ENUM('PLANNED','IN_PROGRESS','COMPLETED','CANCELLED') NOT NULL DEFAULT 'IN_PROGRESS',
  final_cost DECIMAL(20,0) NOT NULL,
  starts_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  expected_at DATETIME(6) NOT NULL,
  completed_at DATETIME(6) NULL,
  before_snapshot JSON NULL,
  after_snapshot JSON NULL,
  wallet_transaction_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_stadium_upgrade_stadium FOREIGN KEY(stadium_id) REFERENCES stadiums(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_stadium_upgrade_club FOREIGN KEY(club_id) REFERENCES clubs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_stadium_upgrade_catalog FOREIGN KEY(catalog_id) REFERENCES stadium_upgrade_catalog(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_stadium_upgrade_wallet_tx FOREIGN KEY(wallet_transaction_id) REFERENCES wallet_transactions(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_stadium_upgrade_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CALL frm_v209_add_index_if_missing('stadium_upgrades','idx_stadium_upgrades_progress','CREATE INDEX idx_stadium_upgrades_progress ON stadium_upgrades(stadium_id,status,expected_at)');

/* -------------------------------------------------------------------------- */
/* 4. THỊ TRƯỜNG NHÀ TÀI TRỢ                                                  */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS sponsor_brands (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  industry VARCHAR(100) NOT NULL,
  brand_tier ENUM('LOCAL','REGIONAL','NATIONAL','GLOBAL') NOT NULL,
  min_offer DECIMAL(20,0) NOT NULL,
  max_offer DECIMAL(20,0) NOT NULL,
  conflict_group VARCHAR(80) NOT NULL,
  accent_hex VARCHAR(9) NULL,
  logo_url VARCHAR(500) NULL,
  is_real_world_reference BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT uq_sponsor_brands_code UNIQUE(code),
  CONSTRAINT uq_sponsor_brands_name UNIQUE(name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sponsorship_offers (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  club_id BIGINT UNSIGNED NOT NULL,
  stadium_id BIGINT UNSIGNED NULL,
  competition_id BIGINT UNSIGNED NULL,
  match_id BIGINT UNSIGNED NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  offer_type ENUM('MATCH_PARTNER','LED_BOARD','VIP_LOUNGE','STADIUM_PARTNER','SEASON_PARTNER') NOT NULL,
  amount DECIMAL(20,0) NOT NULL,
  status ENUM('OFFERED','ACCEPTED','REJECTED','EXPIRED','PAID') NOT NULL DEFAULT 'OFFERED',
  attractiveness_score DECIMAL(6,2) NOT NULL DEFAULT 0,
  appearance_probability DECIMAL(5,2) NOT NULL DEFAULT 0,
  factors JSON NULL,
  expires_at DATETIME(6) NULL,
  accepted_at DATETIME(6) NULL,
  paid_at DATETIME(6) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_sponsor_offer_club FOREIGN KEY(club_id) REFERENCES clubs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_sponsor_offer_stadium FOREIGN KEY(stadium_id) REFERENCES stadiums(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_sponsor_offer_competition FOREIGN KEY(competition_id) REFERENCES competitions(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_sponsor_offer_match FOREIGN KEY(match_id) REFERENCES matches(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_sponsor_offer_brand FOREIGN KEY(brand_id) REFERENCES sponsor_brands(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_sponsor_offer_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CALL frm_v209_add_index_if_missing('sponsorship_offers','idx_sponsor_offers_club_status','CREATE INDEX idx_sponsor_offers_club_status ON sponsorship_offers(club_id,status,created_at)');
CALL frm_v209_add_index_if_missing('sponsorship_offers','idx_sponsor_offers_match','CREATE INDEX idx_sponsor_offers_match ON sponsorship_offers(match_id,status)');

CREATE TABLE IF NOT EXISTS sponsorship_contracts (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  offer_id BIGINT UNSIGNED NOT NULL,
  club_id BIGINT UNSIGNED NOT NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  match_id BIGINT UNSIGNED NULL,
  stadium_id BIGINT UNSIGNED NULL,
  amount DECIMAL(20,0) NOT NULL,
  status ENUM('ACTIVE','COMPLETED','CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  starts_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  ends_at DATETIME(6) NULL,
  paid_at DATETIME(6) NULL,
  wallet_transaction_id BIGINT UNSIGNED NULL,
  CONSTRAINT uq_sponsorship_contract_offer UNIQUE(offer_id),
  CONSTRAINT fk_sponsor_contract_offer FOREIGN KEY(offer_id) REFERENCES sponsorship_offers(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_sponsor_contract_club FOREIGN KEY(club_id) REFERENCES clubs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_sponsor_contract_brand FOREIGN KEY(brand_id) REFERENCES sponsor_brands(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_sponsor_contract_match FOREIGN KEY(match_id) REFERENCES matches(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_sponsor_contract_stadium FOREIGN KEY(stadium_id) REFERENCES stadiums(id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  CONSTRAINT fk_sponsor_contract_wallet_tx FOREIGN KEY(wallet_transaction_id) REFERENCES wallet_transactions(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

/* -------------------------------------------------------------------------- */
/* 5. KINH TẾ NGÀY THI ĐẤU                                                    */
/* -------------------------------------------------------------------------- */

CREATE TABLE IF NOT EXISTS matchday_finances (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  match_id BIGINT UNSIGNED NOT NULL,
  stadium_id BIGINT UNSIGNED NOT NULL,
  stadium_club_link_id BIGINT UNSIGNED NOT NULL,
  host_club_id BIGINT UNSIGNED NOT NULL,
  simulation_mode ENUM('RANDOM','MANUAL') NOT NULL DEFAULT 'RANDOM',
  random_seed BIGINT UNSIGNED NULL,
  attractiveness_score DECIMAL(6,2) NOT NULL DEFAULT 0,
  occupancy_pct DECIMAL(5,2) NOT NULL DEFAULT 0,
  attendance_standard INT UNSIGNED NOT NULL DEFAULT 0,
  attendance_vip INT UNSIGNED NOT NULL DEFAULT 0,
  attendance_total INT UNSIGNED NOT NULL DEFAULT 0,
  standard_ticket_price DECIMAL(20,0) NOT NULL DEFAULT 0,
  vip_ticket_price DECIMAL(20,0) NOT NULL DEFAULT 0,
  standard_ticket_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  vip_ticket_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  concessions_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  parking_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  sponsorship_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  gross_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  operating_cost DECIMAL(20,0) NOT NULL DEFAULT 0,
  stadium_rent DECIMAL(20,0) NOT NULL DEFAULT 0,
  owner_revenue_share DECIMAL(20,0) NOT NULL DEFAULT 0,
  net_revenue DECIMAL(20,0) NOT NULL DEFAULT 0,
  calculation_snapshot JSON NULL,
  status ENUM('DRAFT','SETTLED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  settled_at DATETIME(6) NULL,
  created_by_user_id BIGINT UNSIGNED NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT uq_matchday_finance_match UNIQUE(match_id),
  CONSTRAINT fk_matchday_match FOREIGN KEY(match_id) REFERENCES matches(id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_matchday_stadium FOREIGN KEY(stadium_id) REFERENCES stadiums(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_matchday_link FOREIGN KEY(stadium_club_link_id) REFERENCES stadium_club_links(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_matchday_host_club FOREIGN KEY(host_club_id) REFERENCES clubs(id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_matchday_creator FOREIGN KEY(created_by_user_id) REFERENCES users(id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

CALL frm_v209_add_index_if_missing('matchday_finances','idx_matchday_finance_club','CREATE INDEX idx_matchday_finance_club ON matchday_finances(host_club_id,status,created_at)');
CALL frm_v209_add_index_if_missing('matchday_finances','idx_matchday_finance_stadium','CREATE INDEX idx_matchday_finance_stadium ON matchday_finances(stadium_id,status,created_at)');

/* -------------------------------------------------------------------------- */
/* 6. DANH MỤC NÂNG CẤP                                                       */
/* -------------------------------------------------------------------------- */

INSERT INTO stadium_upgrade_catalog(
  code,name,category,description,base_cost,duration_days,min_level,
  capacity_add,standard_seats_add,vip_seats_add,hospitality_boxes_add,
  pitch_bonus,seating_bonus,stands_bonus,lighting_bonus,technology_bonus,
  hospitality_bonus,parking_bonus,security_bonus,commercial_bonus,atmosphere_bonus
) VALUES
('EXPAND_5K','Mở rộng 5.000 chỗ','CAPACITY','Xây thêm khán đài tiêu chuẩn và lối thoát hiểm mới.',6000000000,30,1,5000,4700,300,0,0,2,5,0,0,0,2,4,3,5),
('PREMIUM_SEATS','Ghế khán đài cao cấp','COMFORT','Thay ghế bền, rộng và có số ghế điện tử.',2500000000,14,1,0,0,0,0,0,18,8,0,2,2,0,2,3,5),
('VIP_LOUNGE','Khu VIP & Sky Box','HOSPITALITY','Khu tiếp khách, phòng doanh nghiệp và ghế VIP mới.',8500000000,45,2,600,0,600,12,0,6,8,2,5,25,4,5,20,8),
('HYBRID_PITCH','Mặt cỏ hybrid chuẩn quốc tế','PITCH','Cải tạo thoát nước, cỏ hybrid và hệ thống chăm sóc tự động.',4200000000,21,1,0,0,0,0,28,0,2,0,4,0,0,3,0,7),
('LED_PERIMETER','Biển LED quảng cáo 360°','COMMERCIAL','Mở thêm inventory quảng cáo động quanh sân.',3100000000,12,1,0,0,0,0,0,0,0,4,12,2,0,2,28,6),
('SMART_STADIUM','Hệ thống Smart Stadium','TECHNOLOGY','Wifi mật độ cao, app vé, cổng soát vé và phân tích khán giả.',9000000000,40,2,0,0,0,0,0,4,3,8,32,8,4,10,16,8),
('ELITE_LIGHTS','Đèn thi đấu & trình diễn Elite','TECHNOLOGY','Đèn LED 4K, show ánh sáng và giảm điện năng.',5500000000,25,2,0,0,0,0,0,0,2,30,12,0,0,5,8,10),
('SAFE_STANDS','Gia cố khán đài & an ninh','SAFETY','Gia cố kết cấu, camera AI, cửa thoát hiểm và phòng điều hành.',7000000000,35,1,0,0,0,0,0,3,18,4,10,0,2,32,2,5),
('FAN_ZONE','Fan Zone & khu thương mại','COMMERCIAL','Khu ẩm thực, bán áo đấu, sân khấu và hoạt động trước trận.',4800000000,24,1,0,0,0,0,0,0,2,3,8,5,6,4,30,22),
('PARKING_HUB','Bãi xe thông minh','COMMERCIAL','Mở rộng bãi xe, điều phối thông minh và trạm sạc.',3600000000,18,1,0,0,0,0,0,0,0,1,8,0,28,8,8,3)
ON DUPLICATE KEY UPDATE
  name=VALUES(name),description=VALUES(description),base_cost=VALUES(base_cost),duration_days=VALUES(duration_days),is_active=TRUE;

/* -------------------------------------------------------------------------- */
/* 7. DANH MỤC NHÀ TÀI TRỢ MÔ PHỎNG                                           */
/* -------------------------------------------------------------------------- */

INSERT INTO sponsor_brands(code,name,industry,brand_tier,min_offer,max_offer,conflict_group,accent_hex,is_real_world_reference,is_active) VALUES
('TOYOTA','Toyota','Ô tô','GLOBAL',1200000000,9000000000,'AUTOMOTIVE','#EB0A1E',TRUE,TRUE),
('HONDA','Honda','Ô tô','GLOBAL',900000000,7000000000,'AUTOMOTIVE','#CC0000',TRUE,TRUE),
('HYUNDAI','Hyundai','Ô tô','GLOBAL',800000000,6500000000,'AUTOMOTIVE','#002C5F',TRUE,TRUE),
('REDBULL','Red Bull','Nước tăng lực','GLOBAL',1000000000,8500000000,'ENERGY_DRINK','#1E3A8A',TRUE,TRUE),
('MONSTER','Monster Energy','Nước tăng lực','GLOBAL',800000000,6500000000,'ENERGY_DRINK','#65A30D',TRUE,TRUE),
('COCACOLA','Coca-Cola','Đồ uống','GLOBAL',1200000000,10000000000,'SOFT_DRINK','#E41E2B',TRUE,TRUE),
('PEPSI','Pepsi','Đồ uống','GLOBAL',1000000000,9000000000,'SOFT_DRINK','#005CB4',TRUE,TRUE),
('SAMSUNG','Samsung','Công nghệ','GLOBAL',1000000000,9000000000,'TECH','#1428A0',TRUE,TRUE),
('OPPO','OPPO','Công nghệ','GLOBAL',650000000,5000000000,'TECH','#008F55',TRUE,TRUE),
('VISA','Visa','Thanh toán','GLOBAL',900000000,8000000000,'PAYMENT','#1434CB',TRUE,TRUE),
('MASTERCARD','Mastercard','Thanh toán','GLOBAL',850000000,7500000000,'PAYMENT','#EB001B',TRUE,TRUE),
('NIKE','Nike','Thể thao','GLOBAL',900000000,8000000000,'SPORTSWEAR','#111111',TRUE,TRUE),
('ADIDAS','adidas','Thể thao','GLOBAL',900000000,8000000000,'SPORTSWEAR','#111111',TRUE,TRUE),
('EMIRATES','Emirates','Hàng không','GLOBAL',1500000000,12000000000,'AIRLINE','#D71920',TRUE,TRUE),
('QATAR','Qatar Airways','Hàng không','GLOBAL',1400000000,11000000000,'AIRLINE','#5C0632',TRUE,TRUE),
('VIETTEL','Viettel','Viễn thông','NATIONAL',400000000,3500000000,'TELECOM','#E60012',TRUE,TRUE),
('VNPT','VNPT','Viễn thông','NATIONAL',300000000,2800000000,'TELECOM','#0085CA',TRUE,TRUE),
('VINAMILK','Vinamilk','Dinh dưỡng','NATIONAL',350000000,3000000000,'DAIRY','#0072BC',TRUE,TRUE),
('VNPAY','VNPAY','Thanh toán','NATIONAL',300000000,2500000000,'PAYMENT','#005BAA',TRUE,TRUE),
('MOMO','MoMo','Ví điện tử','NATIONAL',250000000,2200000000,'PAYMENT','#A50064',TRUE,TRUE),
('BIA_SAIGON','Bia Saigon','Đồ uống','NATIONAL',350000000,3200000000,'BEER','#D4AF37',TRUE,TRUE),
('HIGHLANDS','Highlands Coffee','F&B','NATIONAL',180000000,1500000000,'COFFEE','#7F1D1D',TRUE,TRUE),
('SPORT_HUB','Sport Hub','Bán lẻ thể thao','REGIONAL',80000000,700000000,'SPORTS_RETAIL','#2563EB',FALSE,TRUE),
('CITY_BANK','City Bank Partner','Tài chính','REGIONAL',120000000,900000000,'BANKING','#0F766E',FALSE,TRUE),
('LOCAL_AUTO','Đại lý ô tô địa phương','Ô tô','LOCAL',50000000,350000000,'AUTOMOTIVE','#475569',FALSE,TRUE),
('LOCAL_CAFE','Chuỗi cà phê địa phương','F&B','LOCAL',30000000,220000000,'COFFEE','#92400E',FALSE,TRUE),
('LOCAL_FOOD','Nhà hàng đồng hành','F&B','LOCAL',25000000,180000000,'FOOD','#B45309',FALSE,TRUE),
('LOCAL_MEDIA','Truyền thông địa phương','Truyền thông','LOCAL',20000000,160000000,'MEDIA','#7C3AED',FALSE,TRUE)
ON DUPLICATE KEY UPDATE
  industry=VALUES(industry),brand_tier=VALUES(brand_tier),min_offer=VALUES(min_offer),max_offer=VALUES(max_offer),
  conflict_group=VALUES(conflict_group),accent_hex=VALUES(accent_hex),is_active=TRUE;

/* -------------------------------------------------------------------------- */
/* 8. VIEW TỔNG HỢP                                                           */
/* -------------------------------------------------------------------------- */

DROP VIEW IF EXISTS v_stadium_ratings;
CREATE VIEW v_stadium_ratings AS
SELECT
  s.*,
  ROUND((s.pitch_quality+s.seating_quality+s.stands_quality+s.lighting_quality+
    s.technology_quality+s.hospitality_quality+s.parking_quality+s.security_quality+
    s.commercial_quality+s.atmosphere_quality)/10,1) AS rating_score,
  CASE
    WHEN ((s.pitch_quality+s.seating_quality+s.stands_quality+s.lighting_quality+s.technology_quality+
      s.hospitality_quality+s.parking_quality+s.security_quality+s.commercial_quality+s.atmosphere_quality)/10) >= 88 THEN 'WORLD_CLASS'
    WHEN ((s.pitch_quality+s.seating_quality+s.stands_quality+s.lighting_quality+s.technology_quality+
      s.hospitality_quality+s.parking_quality+s.security_quality+s.commercial_quality+s.atmosphere_quality)/10) >= 75 THEN 'ELITE'
    WHEN ((s.pitch_quality+s.seating_quality+s.stands_quality+s.lighting_quality+s.technology_quality+
      s.hospitality_quality+s.parking_quality+s.security_quality+s.commercial_quality+s.atmosphere_quality)/10) >= 60 THEN 'A'
    WHEN ((s.pitch_quality+s.seating_quality+s.stands_quality+s.lighting_quality+s.technology_quality+
      s.hospitality_quality+s.parking_quality+s.security_quality+s.commercial_quality+s.atmosphere_quality)/10) >= 45 THEN 'B'
    ELSE 'C'
  END AS stadium_class
FROM stadiums s;

DROP VIEW IF EXISTS v_club_stadium_overview;
CREATE VIEW v_club_stadium_overview AS
SELECT
  scl.id AS link_id,
  scl.club_id,
  c.name AS club_name,
  scl.relationship_type,
  scl.is_primary,
  scl.lease_fee_per_match,
  scl.owner_revenue_share_pct,
  scl.status AS link_status,
  sr.*
FROM stadium_club_links scl
JOIN clubs c ON c.id=scl.club_id
JOIN v_stadium_ratings sr ON sr.id=scl.stadium_id;

DROP VIEW IF EXISTS v_matchday_finance_summary;
CREATE VIEW v_matchday_finance_summary AS
SELECT
  mf.*,
  s.name AS stadium_name,
  c.name AS host_club_name,
  comp.name AS competition_name,
  hc.name AS home_club_name,
  ac.name AS away_club_name,
  m.scheduled_at,
  m.status AS match_status
FROM matchday_finances mf
JOIN stadiums s ON s.id=mf.stadium_id
JOIN clubs c ON c.id=mf.host_club_id
JOIN matches m ON m.id=mf.match_id
JOIN competitions comp ON comp.id=m.competition_id
LEFT JOIN clubs hc ON hc.id=m.home_club_id
LEFT JOIN clubs ac ON ac.id=m.away_club_id;

INSERT INTO system_settings(setting_key,setting_value) VALUES
('stadium_economy_version','2.0.9'),
('stadium_brand_disclaimer','Tên thương hiệu thật chỉ được dùng cho mô phỏng quản trị; hệ thống không đại diện hay liên kết với các nhãn hàng.')
ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value);

DROP PROCEDURE IF EXISTS frm_v209_add_index_if_missing;

SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES_V209;

SELECT
  'STADIUM_ECONOMY_AND_SPONSORSHIP_READY' AS result,
  (SELECT COUNT(*) FROM stadium_upgrade_catalog WHERE is_active=TRUE) AS upgrade_options,
  (SELECT COUNT(*) FROM sponsor_brands WHERE is_active=TRUE) AS sponsor_brands,
  (SELECT COUNT(*) FROM award_auto_rules WHERE auto_enabled=TRUE) AS smart_award_rules;


/* ===== INCLUDED UPDATE 2.0.10 ===== */
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



/* ==================== UPDATE 2.0.14 ==================== */
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
