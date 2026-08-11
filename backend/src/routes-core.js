'use strict';

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const {
  pool,
  query,
  first,
  transaction,
  callProcedure,
  ApiError,
  parsePositiveInt,
  parseMoney,
  parseEnum,
  parseText,
  parseBoolean,
  parseDate,
  pagination,
  sqlLimit,
  buildUpdate,
  ok,
  audit
} = require('./db');
const {
  verifyPassword,
  hashPassword,
  signToken,
  authenticate,
  requireAdmin,
  requireClubOrAdmin,
  assertClubScope
} = require('./auth');

const router = express.Router();
const { recalculatePlayerValues } = require('./player-valuation-engine');
const loginLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

const CLUB_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED'];
const SEASON_STATUSES = ['DRAFT', 'ACTIVE', 'FINISHED'];
const WALLET_STATUSES = ['ACTIVE', 'LOCKED', 'CLOSED'];
const MANUAL_TX_TYPES = ['DEPOSIT', 'WITHDRAWAL', 'PENALTY', 'BONUS', 'ADJUSTMENT', 'REFUND'];
const CLUB_MASCOT_KEYS = [
  'dragon-ascendant', 'golden-buffalo', 'fire-phoenix', 'thunder-wolf',
  'royal-lion', 'ocean-shark', 'snow-leopard', 'golden-eagle',
  'void-panther', 'jade-tiger', 'mecha-falcon', 'cosmic-stag',
  'crimson-trex', 'neon-raptor', 'rampage-bull', 'iron-rhino',
  'celestial-sword', 'silverbeard-sage', 'storm-champion', 'lunar-fairy',
  'nine-tail-fox', 'jade-sentinel', 'crowned-grail', 'glacial-golem'
];

function mascotSettingKey(clubId) {
  return `CLUB_MASCOT_${clubId}`;
}

function parseMascotSetting(value) {
  const [mascotKey = '', locked = '0'] = String(value || '').split('|');
  return { mascot_key: mascotKey || null, mascot_locked: locked === '1' };
}

function normalizeUserRow(row) {
  return {
    id: Number(row.id),
    username: row.username,
    accountType: row.account_type,
    clubId: row.club_id ? Number(row.club_id) : null,
    clubName: row.club_name || null
  };
}


async function getDemoResetPreview(connection = undefined) {
  const summary = await first(
    `SELECT
      (SELECT COUNT(*) FROM seasons) AS seasons,
      (SELECT COUNT(*) FROM clubs) AS clubs,
      (SELECT COUNT(*) FROM users WHERE account_type = 'CLUB') AS club_accounts,
      (SELECT COUNT(*) FROM players) AS players,
      (SELECT COUNT(*) FROM coaching_staff) AS staff,
      (SELECT COUNT(*) FROM competitions) AS competitions,
      (SELECT COUNT(*) FROM matches) AS matches,
      (SELECT COUNT(*) FROM player_awards) AS player_awards,
      (SELECT COUNT(*) FROM club_achievements) AS club_achievements,
      (SELECT COUNT(*) FROM transfer_offers) AS transfer_offers,
      (SELECT COUNT(*) FROM player_transfers) AS player_transfers,
      (SELECT COUNT(*) FROM wallet_transactions) AS wallet_transactions,
      (SELECT COUNT(*) FROM wallets WHERE wallet_type <> 'FIFA') AS entity_wallets`,
    [],
    connection
  );
  const counts = Object.fromEntries(Object.entries(summary || {}).map(([key, value]) => [key, Number(value || 0)]));
  return {
    counts,
    hasOperationalData: Object.values(counts).some((value) => value > 0),
    keeps: [
      'Tài khoản Admin FIFA',
      'Ví Quỹ FIFA (đưa số dư về 0)',
      'Cấu hình hệ thống',
      'Danh mục hệ giải',
      'Danh mục loại danh hiệu'
    ],
    confirmationPhrase: 'XÓA DỮ LIỆU MẪU'
  };
}


async function getSeasonDeletePreview(seasonId, connection = undefined) {
  const season = await first('SELECT * FROM seasons WHERE id = ?', [seasonId], connection);
  if (!season) throw new ApiError(404, 'Không tìm thấy mùa giải.');

  // Chạy tuần tự để dùng an toàn với cả pool và connection trong transaction.
  const competitionCount = await first('SELECT COUNT(*) AS total FROM competitions WHERE season_id = ?', [seasonId], connection);
  const playerContractCount = await first('SELECT COUNT(*) AS total FROM player_contracts WHERE start_season_id = ?', [seasonId], connection);
  const staffContractCount = await first('SELECT COUNT(*) AS total FROM staff_contracts WHERE start_season_id = ?', [seasonId], connection);
  const crossPlayerContractCount = await first(
    'SELECT COUNT(*) AS total FROM player_contracts WHERE start_season_id <> ? AND end_season_id = ?',
    [seasonId, seasonId], connection
  );
  const crossStaffContractCount = await first(
    'SELECT COUNT(*) AS total FROM staff_contracts WHERE start_season_id <> ? AND end_season_id = ?',
    [seasonId, seasonId], connection
  );

  // Lương có thể thuộc mùa khác nhưng vẫn tham chiếu hợp đồng bắt đầu trong mùa đang xóa.
  // Nếu không tính nhóm này, DELETE hợp đồng sẽ vướng FK 1451.
  const salaryCount = await first(
    `SELECT COUNT(*) AS total
     FROM salary_payments sp
     WHERE sp.season_id = ?
        OR sp.player_contract_id IN (SELECT id FROM player_contracts WHERE start_season_id = ?)
        OR sp.staff_contract_id IN (SELECT id FROM staff_contracts WHERE start_season_id = ?)`,
    [seasonId, seasonId, seasonId], connection
  );
  const outsideSalaryCount = await first(
    `SELECT COUNT(*) AS total
     FROM salary_payments sp
     WHERE sp.season_id <> ?
       AND (
         sp.player_contract_id IN (SELECT id FROM player_contracts WHERE start_season_id = ?)
         OR sp.staff_contract_id IN (SELECT id FROM staff_contracts WHERE start_season_id = ?)
       )`,
    [seasonId, seasonId, seasonId], connection
  );

  const clubAwardCount = await first('SELECT COUNT(*) AS total FROM club_achievements WHERE season_id = ?', [seasonId], connection);
  const playerAwardCount = await first('SELECT COUNT(*) AS total FROM player_awards WHERE season_id = ?', [seasonId], connection);
  const clubPointCount = await first('SELECT COUNT(*) AS total FROM club_ranking_points WHERE season_id = ?', [seasonId], connection);
  const playerPointCount = await first('SELECT COUNT(*) AS total FROM player_ranking_points WHERE season_id = ?', [seasonId], connection);
  const snapshotCount = await first('SELECT COUNT(*) AS total FROM ranking_snapshot_batches WHERE season_id = ?', [seasonId], connection);
  const transferOfferCount = await first(
    'SELECT COUNT(*) AS total FROM transfer_offers WHERE contract_start_season_id = ? OR contract_end_season_id = ?',
    [seasonId, seasonId], connection
  );
  const transferHistoryCount = await first(
    `SELECT COUNT(*) AS total
     FROM player_transfers pt
     JOIN transfer_offers t ON t.id = pt.transfer_offer_id
     WHERE t.contract_start_season_id = ? OR t.contract_end_season_id = ?`,
    [seasonId, seasonId], connection
  );

  const financeCount = await first(
    `SELECT COUNT(*) AS total
     FROM wallet_transactions wt
     WHERE wt.transaction_type <> 'REVERSAL'
       AND NOT EXISTS (SELECT 1 FROM wallet_transactions rv WHERE rv.reversal_of_transaction_id = wt.id)
       AND (
         (wt.reference_table = 'competition_results' AND wt.reference_id IN (
            SELECT cr.id FROM competition_results cr JOIN competitions c ON c.id = cr.competition_id WHERE c.season_id = ?
         ))
         OR (wt.reference_table = 'competition_upset_rewards' AND wt.reference_id IN (
            SELECT ur.id FROM competition_upset_rewards ur JOIN competitions c ON c.id = ur.competition_id WHERE c.season_id = ?
         ))
         OR (wt.reference_table = 'competition_participants' AND wt.reference_id IN (
            SELECT cp.id FROM competition_participants cp JOIN competitions c ON c.id = cp.competition_id WHERE c.season_id = ?
         ))
         OR wt.transfer_group_code IN (
            SELECT sp.transfer_group_code
            FROM salary_payments sp
            WHERE sp.season_id = ?
               OR sp.player_contract_id IN (SELECT id FROM player_contracts WHERE start_season_id = ?)
               OR sp.staff_contract_id IN (SELECT id FROM staff_contracts WHERE start_season_id = ?)
         )
         OR (wt.reference_table = 'transfer_offers' AND wt.reference_id IN (
            SELECT id FROM transfer_offers WHERE contract_start_season_id = ? OR contract_end_season_id = ?
         ))
       )`,
    [seasonId, seasonId, seasonId, seasonId, seasonId, seasonId, seasonId, seasonId], connection
  );

  const number = (row) => Number(row?.total || 0);
  const blockers = [];
  const warnings = [];

  if (number(transferHistoryCount)) {
    blockers.push('Mùa có lịch sử chuyển nhượng đã hoàn tất. Không thể xóa vì sẽ làm sai lịch sử CLB của cầu thủ.');
  }
  if (number(crossPlayerContractCount) || number(crossStaffContractCount)) {
    blockers.push('Có hợp đồng bắt đầu ở mùa khác nhưng kết thúc tại mùa này. Hãy đổi mùa kết thúc hoặc để trống trước khi xóa.');
  }
  if (number(outsideSalaryCount)) {
    warnings.push(`${number(outsideSalaryCount)} khoản lương ở mùa khác đang tham chiếu hợp đồng bắt đầu trong mùa này; chúng sẽ được đảo và xóa cùng hợp đồng.`);
  }

  return {
    season,
    counts: {
      competitions: number(competitionCount),
      playerContracts: number(playerContractCount),
      staffContracts: number(staffContractCount),
      salaryPayments: number(salaryCount),
      outsideSalaryPayments: number(outsideSalaryCount),
      clubAchievements: number(clubAwardCount),
      playerAwards: number(playerAwardCount),
      clubRankingPoints: number(clubPointCount),
      playerRankingPoints: number(playerPointCount),
      rankingSnapshots: number(snapshotCount),
      transferOffers: number(transferOfferCount),
      transferHistory: number(transferHistoryCount),
      financialEntriesToReverse: number(financeCount)
    },
    requiresForce: season.status === 'FINISHED' || number(salaryCount) > 0 || number(financeCount) > 0,
    canDelete: blockers.length === 0,
    blockers,
    warnings
  };
}

/* ========================================================================== */
/* AUTH                                                                        */
/* ========================================================================== */

router.post('/auth/register-club', async (req, res) => {
  const code = parseText(req.body.code, 'code', { max: 30 });
  const name = parseText(req.body.name, 'name', { max: 150 });
  const shortName = parseText(req.body.short_name, 'short_name', { max: 50 });
  const logoUrl = parseText(req.body.logo_url, 'logo_url', { required: false, nullable: true, max: 500 });
  const username = parseText(req.body.username, 'username', { max: 80 });
  const passwordHash = await hashPassword(req.body.password);

  const result = await transaction(async (connection) => {
    const clubInsert = await query(
      `INSERT INTO clubs(code, name, short_name, logo_url, registration_status, is_active)
       VALUES (?, ?, ?, ?, 'PENDING', TRUE)`,
      [code.toUpperCase(), name, shortName, logoUrl],
      connection
    );
    const clubId = clubInsert.insertId;
    const userInsert = await query(
      `INSERT INTO users(username, password_hash, password_scheme, account_type, club_id, is_active)
       VALUES (?, ?, 'BCRYPT', 'CLUB', ?, FALSE)`,
      [username, passwordHash, clubId],
      connection
    );
    await audit({
      userId: null,
      actionCode: 'REGISTER_CLUB_ACCOUNT',
      entityTable: 'clubs',
      entityId: clubId,
      details: { username, user_id: userInsert.insertId }
    }, connection);
    return { clubId, userId: userInsert.insertId };
  });

  return ok(res, { ...result, registrationStatus: 'PENDING', message: 'Đã gửi đăng ký. Admin FIFA cần phê duyệt trước khi đăng nhập.' }, 201);
});

router.post('/auth/login', loginLimiter, async (req, res) => {
  const username = parseText(req.body.username, 'username', { max: 80 });
  const password = parseText(req.body.password, 'password', { max: 100 });

  const user = await first(
    `SELECT u.*, c.name AS club_name, c.registration_status
     FROM users u
     LEFT JOIN clubs c ON c.id = u.club_id
     WHERE u.username = ? LIMIT 1`,
    [username]
  );

  if (!user || !(await verifyPassword(password, user))) {
    throw new ApiError(401, 'Tên đăng nhập hoặc mật khẩu không đúng.');
  }
  if (!user.is_active) throw new ApiError(403, 'Tài khoản đang chờ duyệt hoặc đã bị khóa.');
  if (user.account_type === 'CLUB' && user.registration_status !== 'APPROVED') {
    throw new ApiError(403, 'CLB chưa được Admin FIFA phê duyệt.');
  }

  await query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [user.id]);
  const safeUser = normalizeUserRow(user);
  return ok(res, { token: signToken(user), user: safeUser });
});

router.get('/auth/me', authenticate, async (req, res) => {
  const user = await first(
    `SELECT u.id, u.username, u.account_type, u.club_id, u.is_active, u.last_login_at,
            c.name AS club_name, c.logo_url, c.registration_status
     FROM users u LEFT JOIN clubs c ON c.id = u.club_id WHERE u.id = ?`,
    [req.user.id]
  );
  return ok(res, user);
});

router.put('/auth/password', authenticate, async (req, res) => {
  const currentPassword = parseText(req.body.current_password, 'current_password', { max: 100 });
  const newPasswordHash = await hashPassword(req.body.new_password);
  const user = await first('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!(await verifyPassword(currentPassword, user))) throw new ApiError(400, 'Mật khẩu hiện tại không đúng.');
  await query(
    `UPDATE users SET password_hash = ?, password_scheme = 'BCRYPT' WHERE id = ?`,
    [newPasswordHash, req.user.id]
  );
  await audit({ userId: req.user.id, actionCode: 'CHANGE_PASSWORD', entityTable: 'users', entityId: req.user.id });
  return ok(res, { message: 'Đã đổi mật khẩu.' });
});

/* ========================================================================== */
/* DASHBOARD                                                                   */
/* ========================================================================== */

router.get('/dashboard', authenticate, async (req, res) => {
  if (req.user.accountType === 'FIFA_ADMIN') {
    const [summary, pendingClubs, activeCompetitions, recentTransactions, clubRanking, playerRanking] = await Promise.all([
      first(`SELECT
          (SELECT COUNT(*) FROM clubs) AS total_clubs,
          (SELECT COUNT(*) FROM clubs WHERE registration_status = 'PENDING') AS pending_clubs,
          (SELECT COUNT(*) FROM players WHERE status <> 'RETIRED') AS total_players,
          (SELECT COUNT(*) FROM competitions WHERE status NOT IN ('FINISHED','CANCELLED')) AS active_competitions,
          (SELECT COALESCE(SUM(balance),0) FROM wallets WHERE wallet_type = 'CLUB') AS total_club_money,
          (SELECT COALESCE(SUM(balance),0) FROM wallets WHERE wallet_type = 'PLAYER') AS total_player_money,
          (SELECT COALESCE(SUM(balance),0) FROM wallets WHERE wallet_type = 'FIFA') AS fifa_balance,
          (SELECT COUNT(*) FROM transfer_offers WHERE status IN ('SENT','ACCEPTED')) AS pending_transfers`),
      query(`SELECT id, code, name, short_name, logo_url, created_at FROM clubs
             WHERE registration_status = 'PENDING' ORDER BY created_at ASC LIMIT 10`),
      query(`SELECT c.id, c.name, c.status, c.format_type, c.starts_on, c.ends_on, s.name AS season_name
             FROM competitions c JOIN seasons s ON s.id = c.season_id
             WHERE c.status NOT IN ('FINISHED','CANCELLED') ORDER BY c.created_at DESC LIMIT 10`),
      query(`SELECT wt.id, wt.transaction_code, wt.direction, wt.transaction_type, wt.amount,
                    wt.balance_after, wt.note, wt.created_at, w.wallet_code, w.wallet_type
             FROM wallet_transactions wt JOIN wallets w ON w.id = wt.wallet_id
             ORDER BY wt.id DESC LIMIT 10`),
      query('SELECT * FROM v_latest_club_world_ranking ORDER BY rank_position LIMIT 10'),
      query(`SELECT * FROM v_latest_player_rankings WHERE category = 'OVERALL' ORDER BY rank_position LIMIT 10`)
    ]);
    return ok(res, { summary, pendingClubs, activeCompetitions, recentTransactions, clubRanking, playerRanking });
  }

  const clubId = req.user.clubId;
  const [club, wallet, playerStats, matches, ranking, achievements] = await Promise.all([
    first(`SELECT c.*,
                  SUBSTRING_INDEX(ms.setting_value, '|', 1) AS mascot_key,
                  (SUBSTRING_INDEX(ms.setting_value, '|', -1) = '1') AS mascot_locked
           FROM clubs c
           LEFT JOIN system_settings ms ON ms.setting_key = CONCAT('CLUB_MASCOT_', c.id)
           WHERE c.id = ?`, [clubId]),
    first('SELECT * FROM v_club_wallets WHERE club_id = ?', [clubId]),
    first(`SELECT COUNT(*) AS total_players,
                  COALESCE(SUM(market_value),0) AS squad_market_value,
                  COALESCE(SUM(salary_per_season),0) AS total_salary
           FROM v_player_list WHERE club_id = ?`, [clubId]),
    query(`SELECT m.*, c.name AS competition_name, hc.name AS home_club_name, ac.name AS away_club_name
           FROM matches m
           JOIN competitions c ON c.id = m.competition_id
           LEFT JOIN clubs hc ON hc.id = m.home_club_id
           LEFT JOIN clubs ac ON ac.id = m.away_club_id
           WHERE (m.home_club_id = ? OR m.away_club_id = ?) AND m.status IN ('SCHEDULED','LIVE')
           ORDER BY m.scheduled_at IS NULL, m.scheduled_at ASC LIMIT 10`, [clubId, clubId]),
    first('SELECT * FROM v_latest_club_world_ranking WHERE club_id = ?', [clubId]),
    query(`SELECT ca.*, c.name AS competition_name, s.name AS season_name
           FROM club_achievements ca JOIN competitions c ON c.id = ca.competition_id
           JOIN seasons s ON s.id = ca.season_id WHERE ca.club_id = ?
           ORDER BY ca.awarded_at DESC LIMIT 10`, [clubId])
  ]);
  return ok(res, { club, wallet, playerStats, matches, ranking, achievements });
});

/* ========================================================================== */
/* DEMO DATA RESET                                                             */
/* ========================================================================== */

router.get('/system/demo-reset-preview', authenticate, requireAdmin, async (_req, res) => {
  return ok(res, await getDemoResetPreview());
});

router.post('/system/reset-demo-data', authenticate, requireAdmin, async (req, res) => {
  const confirmation = parseText(req.body?.confirmation, 'confirmation', { max: 100 });
  const currentPassword = parseText(req.body?.current_password, 'current_password', { max: 100 });
  const expectedPhrase = 'XÓA DỮ LIỆU MẪU';

  if (confirmation !== expectedPhrase) {
    throw new ApiError(400, `Hãy nhập chính xác “${expectedPhrase}” để xác nhận.`);
  }

  const admin = await first("SELECT * FROM users WHERE id = ? AND account_type = 'FIFA_ADMIN'", [req.user.id]);
  if (!admin || !(await verifyPassword(currentPassword, admin))) {
    throw new ApiError(400, 'Mật khẩu Admin FIFA không đúng.');
  }

  const connection = await pool.getConnection();
  let lockAcquired = false;
  let foreignChecksDisabled = false;
  let stage = 'khởi tạo';

  const truncateTables = [
    'audit_logs',
    'player_valuation_results',
    'player_valuation_batches',
    'player_ranking_snapshots',
    'club_ranking_snapshots',
    'ranking_snapshot_batches',
    'player_ranking_points',
    'club_ranking_points',
    'player_awards',
    'club_achievements',
    'competition_upset_rewards',
    'competition_results',
    'competition_special_reward_rules',
    'competition_prize_rules',
    'knockout_pairing_rules',
    'competition_qualified_teams',
    'player_match_stats',
    'match_advancement_links',
    'matches',
    'competition_group_members',
    'competition_rounds',
    'competition_groups',
    'competition_rosters',
    'competition_participants',
    'competitions',
    'salary_payments',
    'player_transfers',
    'transfer_offers',
    'player_market_value_history',
    'wallet_transactions',
    'player_club_history',
    'staff_contracts',
    'player_contracts',
    'wallets',
    'coaching_staff',
    'players',
    'clubs',
    'seasons'
  ];

  try {
    stage = 'khóa thao tác đặt lại';
    const [lockRows] = await connection.query("SELECT GET_LOCK('football_rank_manager_demo_reset', 15) AS acquired");
    lockAcquired = Number(lockRows?.[0]?.acquired || 0) === 1;
    if (!lockAcquired) throw new ApiError(409, 'Hệ thống đang có một thao tác đặt lại khác. Hãy thử lại sau.');

    stage = 'lấy số liệu trước khi xóa';
    const preview = await getDemoResetPreview(connection);

    stage = 'tắt kiểm tra khóa ngoại trong phiên đặt lại';
    await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 0');
    foreignChecksDisabled = true;

    stage = 'xóa tài khoản CLB mẫu';
    await connection.query("DELETE FROM users WHERE account_type = 'CLUB'");

    for (const table of truncateTables) {
      stage = `làm sạch bảng ${table}`;
      await connection.query(`TRUNCATE TABLE \`${table}\``);
    }

    stage = 'khởi tạo lại Ví Quỹ FIFA';
    await connection.query(
      "INSERT INTO wallets(wallet_code, wallet_type, balance, status) VALUES ('FIFA-TREASURY', 'FIFA', 0, 'ACTIVE')"
    );

    stage = 'đưa tài khoản Admin về trạng thái hoạt động';
    await connection.query(
      "UPDATE users SET is_active = TRUE, club_id = NULL, last_login_at = CURRENT_TIMESTAMP(6) WHERE id = ? AND account_type = 'FIFA_ADMIN'",
      [req.user.id]
    );

    stage = 'bật lại kiểm tra khóa ngoại';
    await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 1');
    foreignChecksDisabled = false;

    stage = 'ghi nhật ký đặt lại';
    await audit({
      userId: req.user.id,
      actionCode: 'RESET_DEMO_DATA',
      entityTable: 'system',
      entityId: null,
      details: { deleted: preview.counts, preserved: preview.keeps }
    }, connection);

    return ok(res, {
      message: 'Đã xóa toàn bộ dữ liệu vận hành mẫu. Hệ thống sẵn sàng nhập dữ liệu thật.',
      deleted: preview.counts,
      preserved: preview.keeps
    });
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, `Không thể xóa dữ liệu mẫu ở bước “${stage}”.`, {
      stage,
      code: error.code || null,
      sqlMessage: error.sqlMessage || error.message
    });
  } finally {
    if (foreignChecksDisabled) {
      try { await connection.query('SET SESSION FOREIGN_KEY_CHECKS = 1'); } catch (_) {}
    }
    if (lockAcquired) {
      try { await connection.query("SELECT RELEASE_LOCK('football_rank_manager_demo_reset')"); } catch (_) {}
    }
    connection.release();
  }
});

/* ========================================================================== */
/* SEASONS                                                                     */
/* ========================================================================== */

router.get('/seasons', async (_req, res) => {
  return ok(res, await query('SELECT * FROM seasons ORDER BY sequence_no DESC'));
});

router.get('/seasons/:id', async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const season = await first('SELECT * FROM seasons WHERE id = ?', [id]);
  if (!season) throw new ApiError(404, 'Không tìm thấy mùa giải.');
  return ok(res, season);
});

router.post('/seasons', authenticate, requireAdmin, async (req, res) => {
  const name = parseText(req.body.name, 'name', { max: 100 });
  const sequenceNo = parsePositiveInt(req.body.sequence_no, 'sequence_no');
  const startsOn = parseDate(req.body.starts_on, 'starts_on', { required: true });
  const endsOn = parseDate(req.body.ends_on, 'ends_on', { required: true });
  const status = parseEnum(req.body.status || 'DRAFT', SEASON_STATUSES, 'status');
  const result = await query(
    `INSERT INTO seasons(name, sequence_no, starts_on, ends_on, status) VALUES (?, ?, ?, ?, ?)`,
    [name, sequenceNo, startsOn, endsOn, status]
  );
  await audit({ userId: req.user.id, actionCode: 'CREATE_SEASON', entityTable: 'seasons', entityId: result.insertId });
  return ok(res, await first('SELECT * FROM seasons WHERE id = ?', [result.insertId]), 201);
});

router.patch('/seasons/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const body = {};
  if (req.body.name !== undefined) body.name = parseText(req.body.name, 'name', { max: 100 });
  if (req.body.sequence_no !== undefined) body.sequence_no = parsePositiveInt(req.body.sequence_no, 'sequence_no');
  if (req.body.starts_on !== undefined) body.starts_on = parseDate(req.body.starts_on, 'starts_on', { required: true });
  if (req.body.ends_on !== undefined) body.ends_on = parseDate(req.body.ends_on, 'ends_on', { required: true });
  if (req.body.status !== undefined) body.status = parseEnum(req.body.status, SEASON_STATUSES, 'status');
  const update = buildUpdate(body, ['name', 'sequence_no', 'starts_on', 'ends_on', 'status']);
  const result = await query(`UPDATE seasons SET ${update.sql} WHERE id = ?`, [...update.values, id]);
  if (!result.affectedRows) throw new ApiError(404, 'Không tìm thấy mùa giải.');
  await audit({ userId: req.user.id, actionCode: 'UPDATE_SEASON', entityTable: 'seasons', entityId: id, details: body });
  return ok(res, await first('SELECT * FROM seasons WHERE id = ?', [id]));
});

router.post('/seasons/:id/activate', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  await transaction(async (connection) => {
    const season = await first('SELECT * FROM seasons WHERE id = ? FOR UPDATE', [id], connection);
    if (!season) throw new ApiError(404, 'Không tìm thấy mùa giải.');
    if (season.status === 'FINISHED') throw new ApiError(400, 'Không thể mở lại mùa giải đã kết thúc.');
    await query(`UPDATE seasons SET status = 'DRAFT' WHERE status = 'ACTIVE' AND id <> ?`, [id], connection);
    await query(`UPDATE seasons SET status = 'ACTIVE' WHERE id = ?`, [id], connection);
    await audit({ userId: req.user.id, actionCode: 'ACTIVATE_SEASON', entityTable: 'seasons', entityId: id }, connection);
  });
  return ok(res, await first('SELECT * FROM seasons WHERE id = ?', [id]));
});

router.post('/seasons/:id/close', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const sets = await callProcedure('sp_close_season', [id, req.user.id]);
  let valuation = null;
  let valuationWarning = null;
  try {
    valuation = await recalculatePlayerValues({
      userId: req.user.id,
      note: `Tự động định giá sau khi kết thúc mùa #${id}`
    });
  } catch (error) {
    valuationWarning = error.message;
  }
  return ok(res, {
    message: valuationWarning
      ? 'Đã kết thúc mùa và trả lương; bước định giá tự động cần chạy lại từ trang Cầu thủ.'
      : 'Đã kết thúc mùa, trả lương và tự động cập nhật giá cầu thủ.',
    resultSets: sets,
    valuationBatch: valuation?.batch || null,
    valuationWarning
  });
});


router.get('/seasons/:id/delete-preview', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  return ok(res, await getSeasonDeletePreview(id));
});

router.delete('/seasons/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const confirmation = parseText(req.body?.confirmation, 'confirmation', { max: 100 });
  const force = parseBoolean(req.body?.force, false);
  let stage = 'khởi tạo';

  try {
    const result = await transaction(async (connection) => {
      stage = 'khóa mùa giải';
      const season = await first('SELECT * FROM seasons WHERE id = ? FOR UPDATE', [id], connection);
      if (!season) throw new ApiError(404, 'Không tìm thấy mùa giải.');

      stage = 'kiểm tra dữ liệu liên quan';
      const preview = await getSeasonDeletePreview(id, connection);
      if (confirmation !== season.name) {
        throw new ApiError(400, `Hãy nhập chính xác tên mùa “${season.name}” để xác nhận xóa.`);
      }
      if (!preview.canDelete) {
        throw new ApiError(409, preview.blockers.join(' '), preview);
      }
      if (preview.requiresForce && !force) {
        throw new ApiError(409, 'Mùa đã có dữ liệu tài chính hoặc đã kết thúc. Hãy bật xác nhận xóa toàn bộ và đảo các giao dịch liên quan.', preview);
      }

      stage = 'đảo giao dịch tài chính';
      const financialEntries = await query(
        `SELECT wt.id, wt.wallet_id, wt.direction, wt.amount
         FROM wallet_transactions wt
         WHERE wt.transaction_type <> 'REVERSAL'
           AND NOT EXISTS (SELECT 1 FROM wallet_transactions rv WHERE rv.reversal_of_transaction_id = wt.id)
           AND (
             (wt.reference_table = 'competition_results' AND wt.reference_id IN (
                SELECT cr.id FROM competition_results cr JOIN competitions c ON c.id = cr.competition_id WHERE c.season_id = ?
             ))
             OR (wt.reference_table = 'competition_upset_rewards' AND wt.reference_id IN (
                SELECT ur.id FROM competition_upset_rewards ur JOIN competitions c ON c.id = ur.competition_id WHERE c.season_id = ?
             ))
             OR (wt.reference_table = 'competition_participants' AND wt.reference_id IN (
                SELECT cp.id FROM competition_participants cp JOIN competitions c ON c.id = cp.competition_id WHERE c.season_id = ?
             ))
             OR wt.transfer_group_code IN (
                SELECT sp.transfer_group_code
                FROM salary_payments sp
                WHERE sp.season_id = ?
                   OR sp.player_contract_id IN (SELECT id FROM player_contracts WHERE start_season_id = ?)
                   OR sp.staff_contract_id IN (SELECT id FROM staff_contracts WHERE start_season_id = ?)
             )
             OR (wt.reference_table = 'transfer_offers' AND wt.reference_id IN (
                SELECT id FROM transfer_offers WHERE contract_start_season_id = ? OR contract_end_season_id = ?
             ))
           )
         ORDER BY wt.id DESC`,
        [id, id, id, id, id, id, id, id],
        connection
      );

      for (const entry of financialEntries) {
        await callProcedure('sp_post_wallet_entry_core', [
          entry.wallet_id,
          entry.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
          'REVERSAL',
          entry.amount,
          `PURGE-SEASON-${id}-${entry.id}`,
          null,
          'wallet_transactions',
          entry.id,
          `Đảo giao dịch khi xóa ${season.name}`,
          req.user.id,
          entry.id
        ], connection);
      }

      // Xóa các bảng con theo thứ tự rõ ràng thay vì phụ thuộc hoàn toàn vào cascade.
      stage = 'xóa các khoản lương';
      await query(
        `DELETE FROM salary_payments
         WHERE season_id = ?
            OR player_contract_id IN (SELECT id FROM player_contracts WHERE start_season_id = ?)
            OR staff_contract_id IN (SELECT id FROM staff_contracts WHERE start_season_id = ?)`,
        [id, id, id], connection
      );

      stage = 'xóa ảnh chụp bảng xếp hạng';
      await query(
        `DELETE crs FROM club_ranking_snapshots crs
         JOIN ranking_snapshot_batches rb ON rb.id = crs.batch_id
         WHERE rb.season_id = ?`,
        [id], connection
      );
      await query(
        `DELETE prs FROM player_ranking_snapshots prs
         JOIN ranking_snapshot_batches rb ON rb.id = prs.batch_id
         WHERE rb.season_id = ?`,
        [id], connection
      );
      await query('DELETE FROM ranking_snapshot_batches WHERE season_id = ?', [id], connection);

      stage = 'xóa danh hiệu và điểm xếp hạng';
      await query('DELETE FROM player_ranking_points WHERE season_id = ?', [id], connection);
      await query('DELETE FROM club_ranking_points WHERE season_id = ?', [id], connection);
      await query('DELETE FROM player_awards WHERE season_id = ?', [id], connection);
      await query('DELETE FROM club_achievements WHERE season_id = ?', [id], connection);

      stage = 'xóa đề nghị chuyển nhượng chưa hoàn tất';
      await query(
        `DELETE FROM transfer_offers
         WHERE (contract_start_season_id = ? OR contract_end_season_id = ?)
           AND id NOT IN (SELECT transfer_offer_id FROM player_transfers)`,
        [id, id], connection
      );

      stage = 'xóa dữ liệu trận đấu và giải đấu';
      await query(
        `DELETE mal FROM match_advancement_links mal
         WHERE mal.source_match_id IN (SELECT id FROM matches WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?))
            OR mal.target_match_id IN (SELECT id FROM matches WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?))`,
        [id, id], connection
      );
      await query(
        `DELETE pms FROM player_match_stats pms
         JOIN matches m ON m.id = pms.match_id
         JOIN competitions c ON c.id = m.competition_id
         WHERE c.season_id = ?`,
        [id], connection
      );
      await query('DELETE FROM competition_upset_rewards WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query('DELETE FROM competition_results WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query('DELETE FROM knockout_pairing_rules WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query('DELETE FROM competition_qualified_teams WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query(
        `DELETE cgm FROM competition_group_members cgm
         JOIN competition_groups cg ON cg.id = cgm.group_id
         JOIN competitions c ON c.id = cg.competition_id
         WHERE c.season_id = ?`,
        [id], connection
      );
      await query('DELETE FROM matches WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query('DELETE FROM competition_rounds WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query('DELETE FROM competition_groups WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query('DELETE FROM competition_rosters WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query('DELETE FROM competition_participants WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query('DELETE FROM competition_special_reward_rules WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query('DELETE FROM competition_prize_rules WHERE competition_id IN (SELECT id FROM competitions WHERE season_id = ?)', [id], connection);
      await query('DELETE FROM competitions WHERE season_id = ?', [id], connection);

      stage = 'xóa hợp đồng bắt đầu trong mùa';
      await query('DELETE FROM player_contracts WHERE start_season_id = ?', [id], connection);
      await query('DELETE FROM staff_contracts WHERE start_season_id = ?', [id], connection);

      stage = 'ghi nhật ký';
      await audit({
        userId: req.user.id,
        actionCode: 'DELETE_SEASON_WITH_DATA',
        entityTable: 'seasons',
        entityId: id,
        details: {
          season_name: season.name,
          reversed_financial_entries: financialEntries.length,
          deleted_counts: preview.counts
        }
      }, connection);

      stage = 'xóa bản ghi mùa giải';
      const deletedSeason = await query('DELETE FROM seasons WHERE id = ?', [id], connection);
      if (!deletedSeason.affectedRows) throw new ApiError(404, 'Mùa giải không còn tồn tại.');

      return {
        seasonId: id,
        seasonName: season.name,
        reversedFinancialEntries: financialEntries.length,
        deleted: preview.counts
      };
    });

    return ok(res, result);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (['ER_ROW_IS_REFERENCED_2', 'ER_NO_REFERENCED_ROW_2'].includes(error.code) || [1451, 1452].includes(error.errno)) {
      throw new ApiError(
        409,
        `Không thể xóa mùa ở bước “${stage}” vì vẫn còn dữ liệu liên kết. Bản sửa đã ghi rõ bước lỗi để kiểm tra chính xác.`,
        { stage, code: error.code || null, sqlMessage: error.sqlMessage || error.message }
      );
    }
    throw error;
  }
});

/* ========================================================================== */
/* CLUBS AND SINGLE CLUB ACCOUNT                                               */
/* ========================================================================== */

router.get('/clubs', authenticate, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const search = String(req.query.search || '').trim();
  const status = req.query.status ? parseEnum(req.query.status, CLUB_STATUSES, 'status') : null;
  const where = [];
  const params = [];

  if (req.user.accountType === 'CLUB') {
    where.push('c.id = ?');
    params.push(req.user.clubId);
  } else {
    if (search) {
      where.push('(c.name LIKE ? OR c.code LIKE ? OR c.short_name LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    if (status) {
      where.push('c.registration_status = ?');
      params.push(status);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await first(`SELECT COUNT(*) AS total FROM clubs c ${whereSql}`, params);
  const rows = await query(
    `SELECT c.*, w.id AS wallet_id, w.balance, w.status AS wallet_status,
            u.id AS user_id, u.username, u.is_active AS account_active,
            SUBSTRING_INDEX(ms.setting_value, '|', 1) AS mascot_key,
            (SUBSTRING_INDEX(ms.setting_value, '|', -1) = '1') AS mascot_locked,
            (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id AND p.status <> 'RETIRED') AS player_count
     FROM clubs c
     LEFT JOIN wallets w ON w.club_id = c.id AND w.wallet_type = 'CLUB'
     LEFT JOIN users u ON u.club_id = c.id AND u.account_type = 'CLUB'
     LEFT JOIN system_settings ms ON ms.setting_key = CONCAT('CLUB_MASCOT_', c.id)
     ${whereSql}
     ORDER BY c.created_at DESC ${sqlLimit(limit, offset)}`,
    params
  );
  return ok(res, rows, 200, { page, limit, total: Number(total.total) });
});

router.get('/clubs/:id', authenticate, async (req, res) => {
  const id = assertClubScope(req, parsePositiveInt(req.params.id));
  const club = await first(
    `SELECT c.*, w.id AS wallet_id, w.balance, w.status AS wallet_status,
            u.id AS user_id, u.username, u.is_active AS account_active,
            SUBSTRING_INDEX(ms.setting_value, '|', 1) AS mascot_key,
            (SUBSTRING_INDEX(ms.setting_value, '|', -1) = '1') AS mascot_locked
     FROM clubs c
     LEFT JOIN wallets w ON w.club_id = c.id AND w.wallet_type = 'CLUB'
     LEFT JOIN users u ON u.club_id = c.id AND u.account_type = 'CLUB'
     LEFT JOIN system_settings ms ON ms.setting_key = CONCAT('CLUB_MASCOT_', c.id)
     WHERE c.id = ?`, [id]
  );
  if (!club) throw new ApiError(404, 'Không tìm thấy CLB.');
  const [players, achievements, ranking] = await Promise.all([
    query('SELECT * FROM v_player_list WHERE club_id = ? ORDER BY position, shirt_number, full_name', [id]),
    query(`SELECT ca.*, c.name AS competition_name, s.name AS season_name
           FROM club_achievements ca JOIN competitions c ON c.id = ca.competition_id
           JOIN seasons s ON s.id = ca.season_id WHERE ca.club_id = ? ORDER BY ca.awarded_at DESC`, [id]),
    first('SELECT * FROM v_latest_club_world_ranking WHERE club_id = ?', [id])
  ]);
  return ok(res, { club, players, achievements, ranking });
});

router.post('/clubs', authenticate, requireAdmin, async (req, res) => {
  const code = parseText(req.body.code, 'code', { max: 30 }).toUpperCase();
  const name = parseText(req.body.name, 'name', { max: 150 });
  const shortName = parseText(req.body.short_name, 'short_name', { max: 50 });
  const logoUrl = parseText(req.body.logo_url, 'logo_url', { required: false, nullable: true, max: 500 });
  const registrationStatus = parseEnum(req.body.registration_status || 'APPROVED', CLUB_STATUSES, 'registration_status');
  const isActive = parseBoolean(req.body.is_active, true);

  const result = await query(
    `INSERT INTO clubs(code, name, short_name, logo_url, registration_status, is_active, approved_at)
     VALUES (?, ?, ?, ?, ?, ?, IF(? = 'APPROVED', CURRENT_TIMESTAMP(6), NULL))`,
    [code, name, shortName, logoUrl, registrationStatus, isActive, registrationStatus]
  );
  await audit({ userId: req.user.id, actionCode: 'CREATE_CLUB', entityTable: 'clubs', entityId: result.insertId });
  return ok(res, await first('SELECT * FROM clubs WHERE id = ?', [result.insertId]), 201);
});

router.patch('/clubs/:id', authenticate, requireClubOrAdmin, async (req, res) => {
  const id = assertClubScope(req, parsePositiveInt(req.params.id));
  const body = {};
  const clubFields = ['short_name', 'logo_url'];
  const adminFields = ['code', 'name', 'short_name', 'logo_url', 'is_active'];
  const allowed = req.user.accountType === 'FIFA_ADMIN' ? adminFields : clubFields;

  if (allowed.includes('code') && req.body.code !== undefined) body.code = parseText(req.body.code, 'code', { max: 30 }).toUpperCase();
  if (allowed.includes('name') && req.body.name !== undefined) body.name = parseText(req.body.name, 'name', { max: 150 });
  if (req.body.short_name !== undefined) body.short_name = parseText(req.body.short_name, 'short_name', { max: 50 });
  if (req.body.logo_url !== undefined) body.logo_url = parseText(req.body.logo_url, 'logo_url', { required: false, nullable: true, max: 500 });
  if (allowed.includes('is_active') && req.body.is_active !== undefined) body.is_active = parseBoolean(req.body.is_active);

  const update = buildUpdate(body, allowed);
  const result = await query(`UPDATE clubs SET ${update.sql} WHERE id = ?`, [...update.values, id]);
  if (!result.affectedRows) throw new ApiError(404, 'Không tìm thấy CLB.');
  await audit({ userId: req.user.id, actionCode: 'UPDATE_CLUB', entityTable: 'clubs', entityId: id, details: body });
  return ok(res, await first('SELECT * FROM clubs WHERE id = ?', [id]));
});

router.post('/clubs/:id/approval', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const status = parseEnum(req.body.status, CLUB_STATUSES, 'status');
  if (status === 'PENDING') throw new ApiError(400, 'Không dùng thao tác phê duyệt để đưa CLB về PENDING.');
  await transaction(async (connection) => {
    const result = await query(
      `UPDATE clubs
       SET registration_status = ?,
           is_active = IF(? = 'APPROVED', TRUE, FALSE),
           approved_at = IF(? = 'APPROVED', CURRENT_TIMESTAMP(6), approved_at)
       WHERE id = ?`,
      [status, status, status, id], connection
    );
    if (!result.affectedRows) throw new ApiError(404, 'Không tìm thấy CLB.');
    await query(`UPDATE users SET is_active = ? WHERE club_id = ? AND account_type = 'CLUB'`, [status === 'APPROVED', id], connection);
    await audit({ userId: req.user.id, actionCode: 'SET_CLUB_APPROVAL', entityTable: 'clubs', entityId: id, details: { status } }, connection);
  });
  return ok(res, await first('SELECT * FROM clubs WHERE id = ?', [id]));
});

router.put('/clubs/:id/account', authenticate, requireAdmin, async (req, res) => {
  const clubId = parsePositiveInt(req.params.id);
  const username = parseText(req.body.username, 'username', { max: 80 });
  const isActive = parseBoolean(req.body.is_active, true);
  const existing = await first(`SELECT id FROM users WHERE club_id = ? AND account_type = 'CLUB'`, [clubId]);
  let userId;
  if (existing) {
    const body = { username, is_active: isActive };
    const params = [username, isActive];
    let passwordSql = '';
    if (req.body.password) {
      passwordSql = ", password_hash = ?, password_scheme = 'BCRYPT'";
      params.push(await hashPassword(req.body.password));
    }
    params.push(existing.id);
    await query(`UPDATE users SET username = ?, is_active = ? ${passwordSql} WHERE id = ?`, params);
    userId = existing.id;
  } else {
    if (!req.body.password) throw new ApiError(400, 'password là bắt buộc khi tạo tài khoản CLB.');
    const passwordHash = await hashPassword(req.body.password);
    const result = await query(
      `INSERT INTO users(username, password_hash, password_scheme, account_type, club_id, is_active)
       VALUES (?, ?, 'BCRYPT', 'CLUB', ?, ?)`,
      [username, passwordHash, clubId, isActive]
    );
    userId = result.insertId;
  }
  await audit({ userId: req.user.id, actionCode: 'UPSERT_CLUB_ACCOUNT', entityTable: 'users', entityId: userId, details: { club_id: clubId, username, is_active: isActive } });
  return ok(res, await first(`SELECT id, username, account_type, club_id, is_active, last_login_at FROM users WHERE id = ?`, [userId]));
});

router.get('/club-mascots', authenticate, async (req, res) => {
  const rows = await query(
    `SELECT c.id AS club_id, c.name AS club_name,
            SUBSTRING_INDEX(ms.setting_value, '|', 1) AS mascot_key,
            (SUBSTRING_INDEX(ms.setting_value, '|', -1) = '1') AS mascot_locked,
            ms.updated_at
     FROM clubs c
     LEFT JOIN system_settings ms ON ms.setting_key = CONCAT('CLUB_MASCOT_', c.id)
     WHERE c.registration_status = 'APPROVED'
     ORDER BY c.name`
  );
  return ok(res, { mascot_keys: CLUB_MASCOT_KEYS, assignments: rows });
});

router.patch('/clubs/:id/mascot', authenticate, requireClubOrAdmin, async (req, res) => {
  const clubId = assertClubScope(req, parsePositiveInt(req.params.id));
  const mascotKey = parseText(req.body.mascot_key, 'mascot_key', { max: 50 });
  if (!CLUB_MASCOT_KEYS.includes(mascotKey)) throw new ApiError(400, 'Linh vật không thuộc bộ sưu tập của hệ thống.');
  const isAdmin = req.user.accountType === 'FIFA_ADMIN';
  const requestedLock = isAdmin && req.body.locked !== undefined ? parseBoolean(req.body.locked) : null;
  const allowSwap = isAdmin && parseBoolean(req.body.swap, false);

  const result = await transaction(async (connection) => {
    const lock = await first("SELECT GET_LOCK('football_rank_manager_club_mascots', 5) AS acquired", [], connection);
    if (!Number(lock?.acquired)) throw new ApiError(409, 'Kho linh vật đang được cập nhật. Hãy thử lại.');
    try {
      const key = mascotSettingKey(clubId);
      const currentRow = await first('SELECT * FROM system_settings WHERE setting_key = ? FOR UPDATE', [key], connection);
      const current = parseMascotSetting(currentRow?.setting_value);
      if (current.mascot_locked && !isAdmin) throw new ApiError(409, 'Linh vật đã được Admin FIFA chốt.');

      const occupied = await first(
        `SELECT setting_key, setting_value
         FROM system_settings
         WHERE setting_key LIKE 'CLUB_MASCOT_%'
           AND SUBSTRING_INDEX(setting_value, '|', 1) = ?
           AND setting_key <> ? LIMIT 1 FOR UPDATE`,
        [mascotKey, key], connection
      );
      if (occupied && !allowSwap) {
        const occupiedClubId = Number(String(occupied.setting_key).replace('CLUB_MASCOT_', ''));
        const owner = await first('SELECT name FROM clubs WHERE id = ?', [occupiedClubId], connection);
        throw new ApiError(409, `Linh vật đang thuộc ${owner?.name || 'một CLB khác'}. Admin FIFA có thể dùng Hoán đổi.`);
      }

      if (occupied) {
        if (current.mascot_key) {
          const occupiedState = parseMascotSetting(occupied.setting_value);
          await query(
            'UPDATE system_settings SET setting_value = ? WHERE setting_key = ?',
            [`${current.mascot_key}|${occupiedState.mascot_locked ? 1 : 0}`, occupied.setting_key], connection
          );
        } else {
          await query('DELETE FROM system_settings WHERE setting_key = ?', [occupied.setting_key], connection);
        }
      }

      const locked = requestedLock === null ? current.mascot_locked : requestedLock;
      await query(
        `INSERT INTO system_settings(setting_key, setting_value, description)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), description = VALUES(description)`,
        [key, `${mascotKey}|${locked ? 1 : 0}`, `Linh vật đại diện của CLB #${clubId}`], connection
      );
      await audit({
        userId: req.user.id,
        actionCode: locked ? 'LOCK_CLUB_MASCOT' : 'UPDATE_CLUB_MASCOT',
        entityTable: 'clubs',
        entityId: clubId,
        details: { mascot_key: mascotKey, locked, swapped: Boolean(occupied) }
      }, connection);
      return { mascot_key: mascotKey, mascot_locked: locked, swapped: Boolean(occupied) };
    } finally {
      await query("SELECT RELEASE_LOCK('football_rank_manager_club_mascots')", [], connection);
    }
  });
  return ok(res, result);
});

/* ========================================================================== */
/* WALLETS AND FINANCE                                                         */
/* ========================================================================== */

router.get('/wallets', authenticate, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const type = req.query.type ? parseEnum(req.query.type, ['FIFA', 'CLUB', 'PLAYER', 'STAFF'], 'type') : null;
  const search = String(req.query.search || '').trim();
  const where = [];
  const params = [];
  if (req.user.accountType === 'CLUB') {
    where.push(`w.wallet_type = 'CLUB' AND w.club_id = ?`);
    params.push(req.user.clubId);
  } else {
    if (type) { where.push('w.wallet_type = ?'); params.push(type); }
    if (search) {
      where.push(`(w.wallet_code LIKE ? OR c.name LIKE ? OR p.full_name LIKE ? OR s.full_name LIKE ?)`);
      params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await first(`SELECT COUNT(*) AS total FROM wallets w
     LEFT JOIN clubs c ON c.id = w.club_id LEFT JOIN players p ON p.id = w.player_id
     LEFT JOIN coaching_staff s ON s.id = w.staff_id ${whereSql}`, params);
  const rows = await query(
    `SELECT w.*, COALESCE(c.name, p.full_name, s.full_name, 'Quỹ FIFA') AS owner_name
     FROM wallets w
     LEFT JOIN clubs c ON c.id = w.club_id
     LEFT JOIN players p ON p.id = w.player_id
     LEFT JOIN coaching_staff s ON s.id = w.staff_id
     ${whereSql} ORDER BY w.wallet_type, owner_name ${sqlLimit(limit, offset)}`,
    params
  );
  return ok(res, rows, 200, { page, limit, total: Number(total.total) });
});

router.get('/wallets/:id', authenticate, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const wallet = await first(
    `SELECT w.*, COALESCE(c.name, p.full_name, s.full_name, 'Quỹ FIFA') AS owner_name
     FROM wallets w LEFT JOIN clubs c ON c.id = w.club_id
     LEFT JOIN players p ON p.id = w.player_id LEFT JOIN coaching_staff s ON s.id = w.staff_id
     WHERE w.id = ?`, [id]
  );
  if (!wallet) throw new ApiError(404, 'Không tìm thấy ví.');
  if (req.user.accountType === 'CLUB' && !(wallet.wallet_type === 'CLUB' && Number(wallet.club_id) === req.user.clubId)) {
    throw new ApiError(403, 'CLB chỉ được xem ví của chính CLB.');
  }
  return ok(res, wallet);
});

router.get('/wallets/:id/transactions', authenticate, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const wallet = await first('SELECT * FROM wallets WHERE id = ?', [id]);
  if (!wallet) throw new ApiError(404, 'Không tìm thấy ví.');
  if (req.user.accountType === 'CLUB' && !(wallet.wallet_type === 'CLUB' && Number(wallet.club_id) === req.user.clubId)) {
    throw new ApiError(403, 'CLB chỉ được xem giao dịch của ví CLB mình.');
  }
  const { page, limit, offset } = pagination(req);
  const total = await first('SELECT COUNT(*) AS total FROM wallet_transactions WHERE wallet_id = ?', [id]);
  const rows = await query(
    `SELECT wt.*, cw.wallet_code AS counterparty_wallet_code
     FROM wallet_transactions wt LEFT JOIN wallets cw ON cw.id = wt.counterparty_wallet_id
     WHERE wt.wallet_id = ? ORDER BY wt.id DESC ${sqlLimit(limit, offset)}`,
    [id]
  );
  return ok(res, rows, 200, { page, limit, total: Number(total.total) });
});

router.post('/wallets/:id/actions', authenticate, requireAdmin, async (req, res) => {
  const walletId = parsePositiveInt(req.params.id);
  const type = parseEnum(req.body.transaction_type, MANUAL_TX_TYPES, 'transaction_type');
  let direction = req.body.direction ? parseEnum(req.body.direction, ['CREDIT', 'DEBIT'], 'direction') : null;
  if (!direction) {
    direction = ['DEPOSIT', 'BONUS', 'REFUND'].includes(type) ? 'CREDIT' : type === 'ADJUSTMENT' ? null : 'DEBIT';
  }
  if (!direction) throw new ApiError(400, 'ADJUSTMENT bắt buộc nhập direction CREDIT hoặc DEBIT.');
  const amount = parseMoney(req.body.amount, 'amount', { allowZero: false });
  const note = parseText(req.body.note, 'note', { max: 500 });
  const sets = await callProcedure('sp_admin_wallet_action', [req.user.id, walletId, direction, type, amount, note]);
  return ok(res, { message: 'Đã cập nhật ví.', resultSets: sets, wallet: await first('SELECT * FROM wallets WHERE id = ?', [walletId]) });
});

router.post('/wallet-transactions/:id/reverse', authenticate, requireAdmin, async (req, res) => {
  const transactionId = parsePositiveInt(req.params.id);
  const reason = parseText(req.body.reason, 'reason', { max: 500 });
  const sets = await callProcedure('sp_reverse_wallet_transaction', [req.user.id, transactionId, reason]);
  return ok(res, { message: 'Đã tạo giao dịch đảo. Không xóa lịch sử cũ.', resultSets: sets });
});

router.patch('/wallets/:id/status', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const status = parseEnum(req.body.status, WALLET_STATUSES, 'status');
  const result = await query('UPDATE wallets SET status = ? WHERE id = ?', [status, id]);
  if (!result.affectedRows) throw new ApiError(404, 'Không tìm thấy ví.');
  await audit({ userId: req.user.id, actionCode: 'SET_WALLET_STATUS', entityTable: 'wallets', entityId: id, details: { status } });
  return ok(res, await first('SELECT * FROM wallets WHERE id = ?', [id]));
});

router.get('/finance/summary', authenticate, requireAdmin, async (_req, res) => {
  const summary = await query(
    `SELECT wallet_type, COUNT(*) AS wallet_count, COALESCE(SUM(balance),0) AS total_balance
     FROM wallets GROUP BY wallet_type ORDER BY FIELD(wallet_type,'FIFA','CLUB','PLAYER','STAFF')`
  );
  const byType = await query(
    `SELECT transaction_type, direction, COUNT(*) AS transaction_count, COALESCE(SUM(amount),0) AS total_amount
     FROM wallet_transactions GROUP BY transaction_type, direction ORDER BY transaction_type, direction`
  );
  return ok(res, { wallets: summary, transactions: byType });
});

/* ========================================================================== */
/* SETTINGS AND AUDIT                                                          */
/* ========================================================================== */

router.get('/settings', authenticate, async (_req, res) => {
  return ok(res, await query('SELECT * FROM system_settings ORDER BY setting_key'));
});

router.put('/settings/:key', authenticate, requireAdmin, async (req, res) => {
  const key = parseText(req.params.key, 'key', { max: 100 }).toUpperCase();
  const value = parseText(req.body.value, 'value', { max: 500 });
  const description = parseText(req.body.description, 'description', { required: false, nullable: true, max: 500 });
  await query(
    `INSERT INTO system_settings(setting_key, setting_value, description)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), description = VALUES(description)`,
    [key, value, description]
  );
  await audit({ userId: req.user.id, actionCode: 'UPSERT_SETTING', entityTable: 'system_settings', entityId: null, details: { key, value } });
  return ok(res, await first('SELECT * FROM system_settings WHERE setting_key = ?', [key]));
});

router.get('/audit-logs', authenticate, requireAdmin, async (req, res) => {
  const { page, limit, offset } = pagination(req, { defaultLimit: 30, maxLimit: 200 });
  const entityTable = String(req.query.entity_table || '').trim();
  const action = String(req.query.action || '').trim();
  const where = [];
  const params = [];
  if (entityTable) { where.push('a.entity_table = ?'); params.push(entityTable); }
  if (action) { where.push('a.action_code = ?'); params.push(action); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await first(`SELECT COUNT(*) AS total FROM audit_logs a ${whereSql}`, params);
  const rows = await query(
    `SELECT a.*, u.username FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
     ${whereSql} ORDER BY a.id DESC ${sqlLimit(limit, offset)}`,
    params
  );
  return ok(res, rows, 200, { page, limit, total: Number(total.total) });
});

module.exports = router;
