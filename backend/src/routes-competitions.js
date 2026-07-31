'use strict';

const crypto = require('crypto');
const express = require('express');
const {
  query,
  first,
  transaction,
  callProcedure,
  ApiError,
  parsePositiveInt,
  parseMoney,
  parseDecimal,
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
  authenticate,
  optionalAuthenticate,
  requireAdmin,
  requireClubOrAdmin,
  assertClubScope
} = require('./auth');

const { finalizeCompetitionAwards } = require('./smart-awards');
const { finalizeAllCompetitionMatchRatings, finalizeCompetitionPerformance } = require('./performance-engine');
const { recalculateClubInfluence } = require('./routes-influence');

const router = express.Router();

const FORMAT_TYPES = ['GROUP_ONLY', 'KNOCKOUT_ONLY', 'GROUP_AND_KNOCKOUT'];
const COMPETITION_STATUSES = ['DRAFT', 'REGISTRATION', 'GROUP_STAGE', 'KNOCKOUT_READY', 'KNOCKOUT_STAGE', 'COMPLETED_PENDING_CLOSE', 'FINISHED', 'CANCELLED'];
const PARTICIPANT_STATUSES = ['REGISTERED', 'APPROVED', 'WITHDRAWN', 'DISQUALIFIED'];
const LEG_MODES = ['ONE_LEG', 'TWO_LEG'];
const THIRD_PLACE_MODES = ['SHARED_BRONZE', 'PLAYOFF', 'NONE'];
const MEDAL_TYPES = ['GOLD', 'SILVER', 'BRONZE', 'NONE'];
const MATCH_STATUSES = ['SCHEDULED', 'LIVE', 'CANCELLED'];
const BRACKET_SIZES = [2, 4, 8, 16, 32, 64, 128];

async function getCompetition(id) {
  const competition = await first('SELECT * FROM competitions WHERE id = ?', [id]);
  if (!competition) throw new ApiError(404, 'Không tìm thấy giải đấu.');
  return competition;
}

function assertCompetitionMutable(competition) {
  if (['FINISHED', 'CANCELLED'].includes(competition.status)) {
    throw new ApiError(400, 'Giải đấu đã kết thúc hoặc bị hủy nên không thể chỉnh sửa.');
  }
}

function shuffle(items) {
  const array = [...items];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const randomIndex = crypto.randomInt(index + 1);
    [array[index], array[randomIndex]] = [array[randomIndex], array[index]];
  }
  return array;
}


function procedureFirstRow(resultSets) {
  return Array.isArray(resultSets?.[0]) ? (resultSets[0][0] || null) : null;
}

async function syncClubRosterForCompetition({ competitionId, clubId, userId, source = 'AUTO_CLUB_ROSTER', connection = undefined }) {
  const resultSets = await callProcedure(
    'sp_sync_competition_roster',
    [competitionId, clubId, userId, source],
    connection
  );
  return procedureFirstRow(resultSets);
}

const PARTICIPANT_ROSTER_SELECT = `
  SELECT enriched.*,
         GREATEST(enriched.minimum_required - enriched.official_roster_count, 0) AS shortage_count,
         (
           enriched.official_roster_count < enriched.minimum_required
           OR enriched.competition_roster_count < enriched.official_roster_count
         ) AS roster_warning
  FROM (
    SELECT cp.*, c.code AS club_code, c.name AS club_name, c.logo_url,
           w.balance AS club_balance,
           (SELECT COUNT(*) FROM players p
            WHERE p.club_id = cp.club_id AND p.status IN ('ACTIVE','TRANSFER_LISTED')) AS official_roster_count,
           (SELECT COUNT(*) FROM competition_rosters cr
            WHERE cr.competition_id = cp.competition_id
              AND cr.club_id = cp.club_id
              AND cr.status = 'ACTIVE') AS competition_roster_count,
           COALESCE((SELECT CAST(setting_value AS UNSIGNED)
                     FROM system_settings
                     WHERE setting_key = 'MIN_ACTIVE_CLUB_PLAYERS' LIMIT 1), 11) AS minimum_required
    FROM competition_participants cp
    JOIN clubs c ON c.id = cp.club_id
    LEFT JOIN wallets w ON w.club_id = c.id AND w.wallet_type = 'CLUB'
  ) enriched`;

/* ========================================================================== */
/* SERIES                                                                      */
/* ========================================================================== */

router.get('/competition-series', async (_req, res) => {
  return ok(res, await query('SELECT * FROM competition_series ORDER BY name'));
});

router.post('/competition-series', authenticate, requireAdmin, async (req, res) => {
  const code = parseText(req.body.code, 'code', { max: 30 }).toUpperCase();
  const name = parseText(req.body.name, 'name', { max: 150 });
  const description = parseText(req.body.description, 'description', { required: false, nullable: true, max: 500 });
  const result = await query(`INSERT INTO competition_series(code, name, description, is_active) VALUES (?, ?, ?, TRUE)`, [code, name, description]);
  await audit({ userId: req.user.id, actionCode: 'CREATE_COMPETITION_SERIES', entityTable: 'competition_series', entityId: result.insertId });
  return ok(res, await first('SELECT * FROM competition_series WHERE id = ?', [result.insertId]), 201);
});

router.patch('/competition-series/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const body = {};
  if (req.body.code !== undefined) body.code = parseText(req.body.code, 'code', { max: 30 }).toUpperCase();
  if (req.body.name !== undefined) body.name = parseText(req.body.name, 'name', { max: 150 });
  if (req.body.description !== undefined) body.description = parseText(req.body.description, 'description', { required: false, nullable: true, max: 500 });
  if (req.body.is_active !== undefined) body.is_active = parseBoolean(req.body.is_active);
  const update = buildUpdate(body, ['code', 'name', 'description', 'is_active']);
  const result = await query(`UPDATE competition_series SET ${update.sql} WHERE id = ?`, [...update.values, id]);
  if (!result.affectedRows) throw new ApiError(404, 'Không tìm thấy hệ giải.');
  return ok(res, await first('SELECT * FROM competition_series WHERE id = ?', [id]));
});

/* ========================================================================== */
/* COMPETITIONS                                                                */
/* ========================================================================== */

router.get('/competitions', optionalAuthenticate, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = [];
  const params = [];
  if (req.query.season_id) { where.push('c.season_id = ?'); params.push(parsePositiveInt(req.query.season_id, 'season_id')); }
  if (req.query.status) { where.push('c.status = ?'); params.push(parseEnum(req.query.status, COMPETITION_STATUSES, 'status')); }
  if (req.query.format_type) { where.push('c.format_type = ?'); params.push(parseEnum(req.query.format_type, FORMAT_TYPES, 'format_type')); }
  if (req.user?.accountType === 'CLUB') {
    where.push(`EXISTS (SELECT 1 FROM competition_participants cp WHERE cp.competition_id = c.id AND cp.club_id = ?)`);
    params.push(req.user.clubId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await first(`SELECT COUNT(*) AS total FROM competitions c ${whereSql}`, params);
  const rows = await query(
    `SELECT c.*, cs.code AS series_code, cs.name AS series_name, s.name AS season_name,
            CASE WHEN EXISTS (SELECT 1 FROM world_cup_profiles wcp WHERE wcp.competition_id = c.id)
              THEN 'WORLD_CUP_48' ELSE 'CLUB' END AS competition_mode,
            CASE WHEN EXISTS (SELECT 1 FROM world_cup_profiles wcp WHERE wcp.competition_id = c.id)
              THEN (SELECT COUNT(*) FROM world_cup_entries wce WHERE wce.competition_id = c.id AND wce.status = 'APPROVED')
              ELSE (SELECT COUNT(*) FROM competition_participants cp WHERE cp.competition_id = c.id AND cp.registration_status = 'APPROVED') END AS approved_teams,
            CASE WHEN EXISTS (SELECT 1 FROM world_cup_profiles wcp WHERE wcp.competition_id = c.id)
              THEN (SELECT COUNT(*) FROM world_cup_matches wcm WHERE wcm.competition_id = c.id)
              ELSE (SELECT COUNT(*) FROM matches m WHERE m.competition_id = c.id) END AS match_count,
            CASE WHEN EXISTS (SELECT 1 FROM world_cup_profiles wcp WHERE wcp.competition_id = c.id)
              THEN (SELECT COUNT(*) FROM world_cup_matches wcm WHERE wcm.competition_id = c.id AND wcm.status = 'FINISHED')
              ELSE (SELECT COUNT(*) FROM matches m WHERE m.competition_id = c.id AND m.status = 'FINISHED') END AS finished_matches
     FROM competitions c JOIN competition_series cs ON cs.id = c.series_id JOIN seasons s ON s.id = c.season_id
     ${whereSql} ORDER BY s.sequence_no DESC, c.created_at DESC ${sqlLimit(limit, offset)}`, params
  );
  return ok(res, rows, 200, { page, limit, total: Number(total.total) });
});

router.get('/competitions/:id', optionalAuthenticate, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const competition = await first(
    `SELECT c.*, cs.code AS series_code, cs.name AS series_name, s.name AS season_name,
            CASE WHEN wcp.competition_id IS NOT NULL THEN 'WORLD_CUP_48' ELSE 'CLUB' END AS competition_mode,
            wcp.visual_theme AS world_cup_visual_theme,
            wcp.draw_mode AS world_cup_draw_mode,
            wcp.pairing_mode AS world_cup_pairing_mode
     FROM competitions c
     JOIN competition_series cs ON cs.id = c.series_id
     JOIN seasons s ON s.id = c.season_id
     LEFT JOIN world_cup_profiles wcp ON wcp.competition_id = c.id
     WHERE c.id = ?`, [id]
  );
  if (!competition) throw new ApiError(404, 'Không tìm thấy giải đấu.');
  if (req.user?.accountType === 'CLUB') {
    const participant = await first('SELECT * FROM competition_participants WHERE competition_id = ? AND club_id = ?', [id, req.user.clubId]);
    competition.current_club_participant = participant;
  }
  const [participants, groups, rounds, prizes, specialRule, results] = await Promise.all([
    query(`${PARTICIPANT_ROSTER_SELECT}
           WHERE enriched.competition_id = ?
           ORDER BY enriched.seed_no IS NULL, enriched.seed_no, enriched.club_name`, [id]),
    query(`SELECT g.*, COUNT(gm.id) AS team_count FROM competition_groups g
           LEFT JOIN competition_group_members gm ON gm.group_id = g.id
           WHERE g.competition_id = ? GROUP BY g.id ORDER BY g.display_order`, [id]),
    query('SELECT * FROM competition_rounds WHERE competition_id = ? ORDER BY round_order', [id]),
    query('SELECT * FROM competition_prize_rules WHERE competition_id = ? ORDER BY placement_from', [id]),
    first('SELECT * FROM competition_special_reward_rules WHERE competition_id = ?', [id]),
    query(`SELECT cr.*, c.name AS club_name FROM competition_results cr JOIN clubs c ON c.id = cr.club_id
           WHERE cr.competition_id = ? ORDER BY cr.placement, c.name`, [id])
  ]);
  return ok(res, { competition, participants, groups, rounds, prizes, specialRule, results });
});

router.post('/competitions', authenticate, requireAdmin, async (req, res) => {
  const seriesId = parsePositiveInt(req.body.series_id, 'series_id');
  const seasonId = parsePositiveInt(req.body.season_id, 'season_id');
  const name = parseText(req.body.name, 'name', { max: 180 });
  const logoUrl = parseText(req.body.logo_url, 'logo_url', { required: false, nullable: true, max: 500 });
  const formatType = parseEnum(req.body.format_type, FORMAT_TYPES, 'format_type');
  const coefficient = parseDecimal(req.body.coefficient || '1.000', 'coefficient', { min: 0.001, max: 99999 });
  const entryFee = parseMoney(req.body.entry_fee || 0, 'entry_fee');
  const status = parseEnum(req.body.status || 'DRAFT', COMPETITION_STATUSES, 'status');
  const groupCount = parsePositiveInt(req.body.group_count ?? 0, 'group_count', { min: 0, max: 128 });
  const teamsPerGroup = parsePositiveInt(req.body.teams_per_group ?? 0, 'teams_per_group', { min: 0, max: 128 });
  const advancePerGroup = parsePositiveInt(req.body.advance_per_group ?? 0, 'advance_per_group', { min: 0, max: 128 });
  const bestThirdCount = parsePositiveInt(req.body.best_third_count ?? 0, 'best_third_count', { min: 0, max: 128 });
  const legMode = parseEnum(req.body.group_leg_mode || 'ONE_LEG', LEG_MODES, 'group_leg_mode');
  const knockoutSize = req.body.knockout_size ? parsePositiveInt(req.body.knockout_size, 'knockout_size') : null;
  if (knockoutSize && !BRACKET_SIZES.includes(knockoutSize)) throw new ApiError(400, 'knockout_size phải là 2, 4, 8, 16, 32, 64 hoặc 128.');
  const thirdPlaceMode = parseEnum(req.body.third_place_mode || 'SHARED_BRONZE', THIRD_PLACE_MODES, 'third_place_mode');
  const startsOn = parseDate(req.body.starts_on, 'starts_on');
  const endsOn = parseDate(req.body.ends_on, 'ends_on');

  const result = await query(
    `INSERT INTO competitions(series_id, season_id, name, logo_url, format_type, coefficient, entry_fee, status,
      group_count, teams_per_group, advance_per_group, best_third_count, group_leg_mode, knockout_size,
      third_place_mode, starts_on, ends_on, created_by_user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [seriesId, seasonId, name, logoUrl, formatType, coefficient, entryFee, status, groupCount, teamsPerGroup,
      advancePerGroup, bestThirdCount, legMode, knockoutSize, thirdPlaceMode, startsOn, endsOn, req.user.id]
  );
  await audit({ userId: req.user.id, actionCode: 'CREATE_COMPETITION', entityTable: 'competitions', entityId: result.insertId });
  return ok(res, await first('SELECT * FROM competitions WHERE id = ?', [result.insertId]), 201);
});

router.patch('/competitions/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const competition = await getCompetition(id);
  assertCompetitionMutable(competition);
  const body = {};
  const simpleText = [['name', 180], ['logo_url', 500]];
  for (const [field, max] of simpleText) {
    if (req.body[field] !== undefined) body[field] = parseText(req.body[field], field, { required: field === 'name', nullable: field !== 'name', max });
  }
  if (req.body.format_type !== undefined) body.format_type = parseEnum(req.body.format_type, FORMAT_TYPES, 'format_type');
  if (req.body.coefficient !== undefined) body.coefficient = parseDecimal(req.body.coefficient, 'coefficient', { min: 0.001, max: 99999 });
  if (req.body.entry_fee !== undefined) body.entry_fee = parseMoney(req.body.entry_fee, 'entry_fee');
  if (req.body.status !== undefined) body.status = parseEnum(req.body.status, COMPETITION_STATUSES, 'status');
  for (const field of ['group_count', 'teams_per_group', 'advance_per_group', 'best_third_count']) {
    if (req.body[field] !== undefined) body[field] = parsePositiveInt(req.body[field], field, { min: 0, max: 128 });
  }
  if (req.body.group_leg_mode !== undefined) body.group_leg_mode = parseEnum(req.body.group_leg_mode, LEG_MODES, 'group_leg_mode');
  if (req.body.knockout_size !== undefined) {
    body.knockout_size = req.body.knockout_size ? parsePositiveInt(req.body.knockout_size, 'knockout_size') : null;
    if (body.knockout_size && !BRACKET_SIZES.includes(body.knockout_size)) throw new ApiError(400, 'knockout_size không hợp lệ.');
  }
  if (req.body.third_place_mode !== undefined) body.third_place_mode = parseEnum(req.body.third_place_mode, THIRD_PLACE_MODES, 'third_place_mode');
  if (req.body.starts_on !== undefined) body.starts_on = parseDate(req.body.starts_on, 'starts_on');
  if (req.body.ends_on !== undefined) body.ends_on = parseDate(req.body.ends_on, 'ends_on');
  const update = buildUpdate(body, ['name', 'logo_url', 'format_type', 'coefficient', 'entry_fee', 'status', 'group_count', 'teams_per_group', 'advance_per_group', 'best_third_count', 'group_leg_mode', 'knockout_size', 'third_place_mode', 'starts_on', 'ends_on']);
  await query(`UPDATE competitions SET ${update.sql} WHERE id = ?`, [...update.values, id]);
  await audit({ userId: req.user.id, actionCode: 'UPDATE_COMPETITION', entityTable: 'competitions', entityId: id, details: body });
  return ok(res, await first('SELECT * FROM competitions WHERE id = ?', [id]));
});

/* ========================================================================== */
/* PARTICIPANTS AND ENTRY FEES                                                 */
/* ========================================================================== */

router.get('/competitions/:id/participants', optionalAuthenticate, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  return ok(res, await query(
    `${PARTICIPANT_ROSTER_SELECT}
     WHERE enriched.competition_id = ?
     ORDER BY enriched.seed_no IS NULL, enriched.seed_no, enriched.club_name`,
    [competitionId]
  ));
});

router.post('/competitions/:id/participants', authenticate, requireClubOrAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const competition = await getCompetition(competitionId);
  assertCompetitionMutable(competition);
  if (!['DRAFT', 'REGISTRATION'].includes(competition.status)) {
    throw new ApiError(400, 'Giải đã đóng đăng ký đội tham dự.');
  }
  let clubId = parsePositiveInt(req.body.club_id, 'club_id');
  if (req.user.accountType === 'CLUB') clubId = req.user.clubId;
  const seedNo = req.body.seed_no ? parsePositiveInt(req.body.seed_no, 'seed_no') : null;
  // CLB tự đăng ký sẽ ở trạng thái chờ FIFA duyệt. Khi Admin FIFA trực tiếp
  // thêm CLB vào giải, CLB được duyệt ngay để hệ thống có thể đồng bộ đội hình.
  const status = req.user.accountType === 'CLUB'
    ? 'REGISTERED'
    : parseEnum(req.body.registration_status || 'APPROVED', PARTICIPANT_STATUSES, 'registration_status');

  const created = await transaction(async (connection) => {
    const result = await query(
      `INSERT INTO competition_participants(competition_id, club_id, seed_no, registration_status)
       VALUES (?, ?, ?, ?)`,
      [competitionId, clubId, seedNo, status],
      connection
    );

    // Trigger database chỉ cho phép thêm cầu thủ khi CLB đã APPROVED.
    // Vì vậy chỉ đồng bộ ngay với CLB do Admin thêm/duyệt; CLB tự đăng ký
    // sẽ được đồng bộ ở route PATCH khi FIFA bấm Duyệt.
    const rosterSync = status === 'APPROVED'
      ? await syncClubRosterForCompetition({
          competitionId,
          clubId,
          userId: req.user.id,
          source: 'AUTO_CLUB_ROSTER',
          connection
        })
      : null;

    await audit({
      userId: req.user.id,
      actionCode: 'REGISTER_COMPETITION_PARTICIPANT',
      entityTable: 'competition_participants',
      entityId: result.insertId,
      details: { competition_id: competitionId, club_id: clubId, automatic_roster: true }
    }, connection);

    return { participantId: result.insertId, rosterSync };
  });

  const participant = await first(
    `${PARTICIPANT_ROSTER_SELECT} WHERE enriched.id = ?`,
    [created.participantId]
  );
  return ok(res, { participant, rosterSync: created.rosterSync }, 201);
});

router.patch('/competition-participants/:id', authenticate, requireAdmin, async (req, res) => {
  const participantId = parsePositiveInt(req.params.id);
  const status = parseEnum(req.body.registration_status, PARTICIPANT_STATUSES, 'registration_status');
  const seedNo = req.body.seed_no === undefined ? undefined : (req.body.seed_no ? parsePositiveInt(req.body.seed_no, 'seed_no') : null);

  await transaction(async (connection) => {
    const participant = await first(
      `SELECT cp.*, comp.entry_fee, comp.name AS competition_name
       FROM competition_participants cp JOIN competitions comp ON comp.id = cp.competition_id
       WHERE cp.id = ? FOR UPDATE`, [participantId], connection
    );
    if (!participant) throw new ApiError(404, 'Không tìm thấy đăng ký tham dự.');

    if (status === 'APPROVED' && participant.registration_status !== 'APPROVED' && String(participant.entry_fee) !== '0') {
      const alreadyPaid = await first(
        `SELECT id FROM wallet_transactions WHERE reference_table = 'competition_participants'
         AND reference_id = ? AND transaction_type = 'ENTRY_FEE' AND direction = 'DEBIT' LIMIT 1`, [participantId], connection
      );
      if (!alreadyPaid) {
        const clubWallet = await first(`SELECT id FROM wallets WHERE wallet_type = 'CLUB' AND club_id = ?`, [participant.club_id], connection);
        const fifaWallet = await first(`SELECT id FROM wallets WHERE wallet_type = 'FIFA' LIMIT 1`, [], connection);
        if (!clubWallet || !fifaWallet) throw new ApiError(400, 'Thiếu ví CLB hoặc ví FIFA.');
        const groupCode = `ENTRY-${participantId}-${crypto.randomUUID().replaceAll('-', '')}`;
        await callProcedure('sp_wallet_transfer_core', [
          clubWallet.id, fifaWallet.id, 'ENTRY_FEE', participant.entry_fee, groupCode,
          'competition_participants', participantId, `Phí tham dự ${participant.competition_name}`, req.user.id
        ], connection);
      }
    }

    const fields = ['registration_status = ?'];
    const params = [status];
    if (seedNo !== undefined) { fields.push('seed_no = ?'); params.push(seedNo); }
    params.push(participantId);
    await query(`UPDATE competition_participants SET ${fields.join(', ')} WHERE id = ?`, params, connection);
    if (status === 'APPROVED') {
      await syncClubRosterForCompetition({
        competitionId: Number(participant.competition_id),
        clubId: Number(participant.club_id),
        userId: req.user.id,
        source: 'AUTO_CLUB_ROSTER',
        connection
      });
    }
    await audit({ userId: req.user.id, actionCode: 'UPDATE_COMPETITION_PARTICIPANT', entityTable: 'competition_participants', entityId: participantId, details: { status, seed_no: seedNo, automatic_roster: status === 'APPROVED' } }, connection);
  });

  return ok(res, await first('SELECT * FROM competition_participants WHERE id = ?', [participantId]));
});

/* ========================================================================== */
/* ROSTERS                                                                     */
/* ========================================================================== */

router.get('/competitions/:id/rosters', optionalAuthenticate, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const clubId = req.query.club_id ? parsePositiveInt(req.query.club_id, 'club_id') : null;
  const params = [competitionId];
  let extra = '';
  if (clubId) { extra = 'AND cr.club_id = ?'; params.push(clubId); }
  return ok(res, await query(
    `SELECT cr.*, p.full_name, p.position, p.shirt_number, p.photo_url, c.name AS club_name
     FROM competition_rosters cr JOIN players p ON p.id = cr.player_id JOIN clubs c ON c.id = cr.club_id
     WHERE cr.competition_id = ? ${extra} ORDER BY c.name, p.position, p.shirt_number, p.full_name`, params
  ));
});

router.put('/competitions/:id/rosters/:clubId', authenticate, requireClubOrAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const clubId = assertClubScope(req, parsePositiveInt(req.params.clubId));
  if (!Array.isArray(req.body.player_ids)) throw new ApiError(400, 'player_ids phải là một mảng.');
  const playerIds = [...new Set(req.body.player_ids.map((id) => parsePositiveInt(id, 'player_id')))];

  await transaction(async (connection) => {
    const participant = await first(`SELECT id FROM competition_participants WHERE competition_id = ? AND club_id = ? AND registration_status = 'APPROVED'`, [competitionId, clubId], connection);
    if (!participant) throw new ApiError(400, 'CLB chưa được duyệt tham dự giải.');
    if (playerIds.length) {
      const placeholders = playerIds.map(() => '?').join(',');
      const valid = await query(`SELECT id FROM players WHERE club_id = ? AND id IN (${placeholders}) AND status IN ('ACTIVE','TRANSFER_LISTED')`, [clubId, ...playerIds], connection);
      if (valid.length !== playerIds.length) throw new ApiError(400, 'Có cầu thủ không thuộc CLB hoặc không hoạt động.');
    }
    await query(`UPDATE competition_rosters SET status = 'REMOVED' WHERE competition_id = ? AND club_id = ?`, [competitionId, clubId], connection);
    for (const playerId of playerIds) {
      await query(
        `INSERT INTO competition_rosters(competition_id, club_id, player_id, status)
         VALUES (?, ?, ?, 'ACTIVE')
         ON DUPLICATE KEY UPDATE club_id = VALUES(club_id), status = 'ACTIVE'`,
        [competitionId, clubId, playerId], connection
      );
    }
    await audit({ userId: req.user.id, actionCode: 'SET_COMPETITION_ROSTER', entityTable: 'competitions', entityId: competitionId, details: { club_id: clubId, player_ids: playerIds } }, connection);
  });
  return ok(res, await query(`SELECT * FROM competition_rosters WHERE competition_id = ? AND club_id = ? ORDER BY player_id`, [competitionId, clubId]));
});

router.post('/competitions/:id/rosters/:clubId/sync', authenticate, requireClubOrAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const clubId = assertClubScope(req, parsePositiveInt(req.params.clubId));
  const rosterSync = await transaction(async (connection) => syncClubRosterForCompetition({
    competitionId,
    clubId,
    userId: req.user.id,
    source: req.user.accountType === 'CLUB' ? 'CLUB_SYNC' : 'AUTO_CLUB_ROSTER',
    connection
  }));
  return ok(res, {
    message: rosterSync?.has_warning
      ? `Đã đồng bộ đội hình nhưng CLB còn thiếu ${rosterSync.shortage_count} cầu thủ so với mức tối thiểu.`
      : 'Đã đồng bộ toàn bộ đội hình cố định của CLB vào giải.',
    rosterSync
  });
});

router.get('/competitions/:id/medal-backfill-preview', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const competition = await getCompetition(competitionId);
  const rows = await query(
    `SELECT ca.club_id, c.name AS club_name, ca.medal_type, ca.achievement_name,
            (SELECT COUNT(*) FROM competition_rosters cr
             WHERE cr.competition_id = ca.competition_id
               AND cr.club_id = ca.club_id AND cr.status = 'ACTIVE') AS roster_count,
            (SELECT COUNT(*) FROM player_awards pa
             JOIN award_types atp ON atp.id = pa.award_type_id
             WHERE pa.competition_id = ca.competition_id
               AND pa.club_id_at_award = ca.club_id
               AND atp.category = 'TEAM_MEDAL') AS existing_medals
     FROM club_achievements ca
     JOIN clubs c ON c.id = ca.club_id
     WHERE ca.competition_id = ?
       AND ca.medal_type IN ('GOLD','SILVER','BRONZE')
     ORDER BY ca.placement, c.name`,
    [competitionId]
  );
  return ok(res, { competition, clubs: rows });
});

router.post('/competitions/:id/backfill-team-medals', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const resultSets = await callProcedure('sp_auto_award_team_medals', [competitionId, req.user.id, true]);
  return ok(res, {
    message: 'Đã khôi phục danh sách cầu thủ và bổ sung huy chương tập thể cho giải.',
    result: procedureFirstRow(resultSets)
  });
});

router.post('/competitions/backfill-finished-team-medals', authenticate, requireAdmin, async (req, res) => {
  const resultSets = await callProcedure('sp_backfill_all_finished_team_medals', [req.user.id]);
  return ok(res, {
    message: 'Đã rà soát toàn bộ giải đã kết thúc và bổ sung huy chương còn thiếu cho cầu thủ.',
    resultSets
  });
});

/* ========================================================================== */
/* GROUPS AND GROUP MATCHES                                                    */
/* ========================================================================== */

router.get('/competitions/:id/groups', optionalAuthenticate, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const groups = await query('SELECT * FROM competition_groups WHERE competition_id = ? ORDER BY display_order', [competitionId]);
  const members = await query(
    `SELECT gm.*, g.group_code, c.name AS club_name, c.logo_url
     FROM competition_group_members gm JOIN competition_groups g ON g.id = gm.group_id JOIN clubs c ON c.id = gm.club_id
     WHERE g.competition_id = ? ORDER BY g.display_order, gm.slot_no`, [competitionId]
  );
  const standings = await query('SELECT * FROM v_group_standings WHERE competition_id = ? ORDER BY group_id, group_rank', [competitionId]);
  return ok(res, { groups, members, standings });
});

router.put('/competitions/:id/groups', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const competition = await getCompetition(competitionId);
  assertCompetitionMutable(competition);
  if (!Array.isArray(req.body.groups) || !req.body.groups.length) throw new ApiError(400, 'groups phải là mảng có ít nhất một bảng.');

  await transaction(async (connection) => {
    const existingMatches = await first(`SELECT COUNT(*) AS total FROM matches WHERE competition_id = ? AND stage_type = 'GROUP'`, [competitionId], connection);
    if (Number(existingMatches.total) > 0) throw new ApiError(400, 'Giải đã có trận vòng bảng; hãy reset dữ liệu giải trước khi chia lại bảng.');
    await query('DELETE FROM competition_groups WHERE competition_id = ?', [competitionId], connection);

    let maxTeams = 0;
    let order = 1;
    const seenClubs = new Set();
    for (const groupInput of req.body.groups) {
      const code = parseText(groupInput.group_code, 'group_code', { max: 10 }).toUpperCase();
      const displayName = parseText(groupInput.display_name || `Bảng ${code}`, 'display_name', { max: 50 });
      const displayOrder = groupInput.display_order ? parsePositiveInt(groupInput.display_order, 'display_order') : order;
      if (!Array.isArray(groupInput.club_ids) || groupInput.club_ids.length < 2) throw new ApiError(400, `Bảng ${code} phải có ít nhất 2 CLB.`);
      const clubIds = groupInput.club_ids.map((id) => parsePositiveInt(id, 'club_id'));
      for (const clubId of clubIds) {
        if (seenClubs.has(clubId)) throw new ApiError(400, `CLB ${clubId} bị xếp vào nhiều bảng.`);
        seenClubs.add(clubId);
        const approved = await first(`SELECT id FROM competition_participants WHERE competition_id = ? AND club_id = ? AND registration_status = 'APPROVED'`, [competitionId, clubId], connection);
        if (!approved) throw new ApiError(400, `CLB ${clubId} chưa được duyệt tham dự giải.`);
      }
      const inserted = await query(`INSERT INTO competition_groups(competition_id, group_code, display_name, display_order) VALUES (?, ?, ?, ?)`, [competitionId, code, displayName, displayOrder], connection);
      let slot = 1;
      for (const clubId of clubIds) {
        await query(`INSERT INTO competition_group_members(group_id, club_id, slot_no) VALUES (?, ?, ?)`, [inserted.insertId, clubId, slot], connection);
        slot += 1;
      }
      maxTeams = Math.max(maxTeams, clubIds.length);
      order += 1;
    }
    await query(`UPDATE competitions SET group_count = ?, teams_per_group = ? WHERE id = ?`, [req.body.groups.length, maxTeams, competitionId], connection);
    await audit({ userId: req.user.id, actionCode: 'SET_COMPETITION_GROUPS', entityTable: 'competitions', entityId: competitionId, details: { group_count: req.body.groups.length } }, connection);
  });

  const groups = await query('SELECT * FROM competition_groups WHERE competition_id = ? ORDER BY display_order', [competitionId]);
  return ok(res, groups);
});

router.post('/competitions/:id/groups/generate-matches', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const sets = await callProcedure('sp_generate_group_matches', [competitionId, req.user.id]);
  return ok(res, { message: 'Đã tạo toàn bộ lịch vòng bảng.', resultSets: sets });
});

router.get('/competitions/:id/standings', async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  return ok(res, await query('SELECT * FROM v_group_standings WHERE competition_id = ? ORDER BY group_id, group_rank', [competitionId]));
});

router.post('/competitions/:id/groups/finalize', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const sets = await callProcedure('sp_finalize_group_stage', [competitionId, req.user.id]);
  return ok(res, { message: 'Đã chốt vòng bảng và xác định các đội đi tiếp.', qualifiedTeams: sets[0] || [] });
});

/* ========================================================================== */
/* KNOCKOUT BRACKET AND PAIRING                                                */
/* ========================================================================== */

router.get('/competitions/:id/bracket', async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const [rounds, matches, links, qualified, pairingRules] = await Promise.all([
    query('SELECT * FROM competition_rounds WHERE competition_id = ? ORDER BY round_order', [competitionId]),
    query(`SELECT m.*, hc.name AS home_club_name, hc.logo_url AS home_logo,
                  ac.name AS away_club_name, ac.logo_url AS away_logo,
                  wc.name AS winner_club_name, lc.name AS loser_club_name
           FROM matches m LEFT JOIN clubs hc ON hc.id = m.home_club_id LEFT JOIN clubs ac ON ac.id = m.away_club_id
           LEFT JOIN clubs wc ON wc.id = m.winner_club_id LEFT JOIN clubs lc ON lc.id = m.loser_club_id
           WHERE m.competition_id = ? AND m.stage_type = 'KNOCKOUT'
           ORDER BY m.round_id, m.match_no, m.leg_no`, [competitionId]),
    query(`SELECT mal.* FROM match_advancement_links mal JOIN matches m ON m.id = mal.source_match_id WHERE m.competition_id = ?`, [competitionId]),
    query(`SELECT qt.*, g.group_code, c.name AS club_name FROM competition_qualified_teams qt
           JOIN competition_groups g ON g.id = qt.group_id JOIN clubs c ON c.id = qt.club_id
           WHERE qt.competition_id = ? ORDER BY qt.qualification_type, g.display_order, qt.group_rank`, [competitionId]),
    query(`SELECT r.*, hg.group_code AS home_group_code, ag.group_code AS away_group_code
           FROM knockout_pairing_rules r JOIN competition_groups hg ON hg.id = r.home_group_id
           JOIN competition_groups ag ON ag.id = r.away_group_id WHERE r.competition_id = ? ORDER BY r.match_no`, [competitionId])
  ]);
  return ok(res, { rounds, matches, links, qualified, pairingRules });
});

router.post('/competitions/:id/bracket', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const bracketSize = parsePositiveInt(req.body.bracket_size, 'bracket_size');
  if (!BRACKET_SIZES.includes(bracketSize)) throw new ApiError(400, 'Nhánh đấu chỉ hỗ trợ 2, 4, 8, 16, 32, 64 hoặc 128 đội.');
  const sets = await callProcedure('sp_create_knockout_bracket', [competitionId, bracketSize, req.user.id]);
  return ok(res, { message: 'Đã tạo nhánh đấu.', rounds: sets[0] || [] }, 201);
});

router.put('/competitions/:id/pairing-rules', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  if (!Array.isArray(req.body.rules) || !req.body.rules.length) throw new ApiError(400, 'rules phải là một mảng.');
  const firstRound = await first('SELECT * FROM competition_rounds WHERE competition_id = ? ORDER BY round_order LIMIT 1', [competitionId]);
  if (!firstRound) throw new ApiError(400, 'Giải chưa có nhánh đấu.');
  await transaction(async (connection) => {
    await query('DELETE FROM knockout_pairing_rules WHERE round_id = ?', [firstRound.id], connection);
    for (const rule of req.body.rules) {
      await query(
        `INSERT INTO knockout_pairing_rules(competition_id, round_id, match_no, home_group_id, home_group_rank, away_group_id, away_group_rank)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [competitionId, firstRound.id,
          parsePositiveInt(rule.match_no, 'match_no'),
          parsePositiveInt(rule.home_group_id, 'home_group_id'),
          parsePositiveInt(rule.home_group_rank, 'home_group_rank'),
          parsePositiveInt(rule.away_group_id, 'away_group_id'),
          parsePositiveInt(rule.away_group_rank, 'away_group_rank')], connection
      );
    }
    await audit({ userId: req.user.id, actionCode: 'SET_KNOCKOUT_PAIRING_RULES', entityTable: 'competitions', entityId: competitionId, details: { rule_count: req.body.rules.length } }, connection);
  });
  return ok(res, await query('SELECT * FROM knockout_pairing_rules WHERE round_id = ? ORDER BY match_no', [firstRound.id]));
});

router.post('/competitions/:id/pairing-rules/auto-cross', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const competition = await getCompetition(competitionId);
  if (Number(competition.advance_per_group) !== 2 || Number(competition.best_third_count) !== 0) {
    throw new ApiError(400, 'Chia tự động A1-B2 chỉ dùng khi mỗi bảng lấy đúng 2 đội và không có đội hạng ba tốt nhất. Trường hợp khác hãy nhập quy tắc thủ công.');
  }
  const groups = await query('SELECT * FROM competition_groups WHERE competition_id = ? ORDER BY display_order', [competitionId]);
  if (groups.length < 2 || groups.length % 2 !== 0) throw new ApiError(400, 'Số bảng phải là số chẵn để tự ghép từng cặp bảng.');
  const firstRound = await first('SELECT * FROM competition_rounds WHERE competition_id = ? ORDER BY round_order LIMIT 1', [competitionId]);
  if (!firstRound) throw new ApiError(400, 'Giải chưa có nhánh đấu.');
  const rules = [];
  let matchNo = 1;
  for (let index = 0; index < groups.length; index += 2) {
    const a = groups[index];
    const b = groups[index + 1];
    rules.push({ match_no: matchNo, home_group_id: a.id, home_group_rank: 1, away_group_id: b.id, away_group_rank: 2 });
    matchNo += 1;
    rules.push({ match_no: matchNo, home_group_id: b.id, home_group_rank: 1, away_group_id: a.id, away_group_rank: 2 });
    matchNo += 1;
  }
  if (rules.length !== Number(firstRound.match_count)) throw new ApiError(400, 'Số quy tắc tự sinh không khớp kích thước vòng đầu của nhánh.');
  await transaction(async (connection) => {
    await query('DELETE FROM knockout_pairing_rules WHERE round_id = ?', [firstRound.id], connection);
    for (const rule of rules) {
      await query(`INSERT INTO knockout_pairing_rules(competition_id, round_id, match_no, home_group_id, home_group_rank, away_group_id, away_group_rank)
        VALUES (?, ?, ?, ?, ?, ?, ?)`, [competitionId, firstRound.id, rule.match_no, rule.home_group_id, rule.home_group_rank, rule.away_group_id, rule.away_group_rank], connection);
    }
    await audit({ userId: req.user.id, actionCode: 'AUTO_CROSS_PAIRING_RULES', entityTable: 'competitions', entityId: competitionId, details: { rule_count: rules.length } }, connection);
  });
  return ok(res, rules);
});

router.post('/competitions/:id/bracket/seed-from-groups', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const sets = await callProcedure('sp_seed_first_knockout_round', [competitionId, req.user.id]);
  return ok(res, { message: 'Đã đưa đội từ vòng bảng vào nhánh theo quy tắc.', resultSets: sets });
});

router.post('/competitions/:id/bracket/seed-participants', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const mode = parseEnum(req.body.mode || 'SEED', ['SEED', 'RANDOM', 'MANUAL_ORDER'], 'mode');
  const firstRound = await first('SELECT * FROM competition_rounds WHERE competition_id = ? ORDER BY round_order LIMIT 1', [competitionId]);
  if (!firstRound) throw new ApiError(400, 'Giải chưa có nhánh đấu.');
  let clubIds;
  if (mode === 'MANUAL_ORDER') {
    if (!Array.isArray(req.body.club_ids)) throw new ApiError(400, 'club_ids là bắt buộc cho MANUAL_ORDER.');
    clubIds = req.body.club_ids.map((id) => parsePositiveInt(id, 'club_id'));
  } else {
    const participants = await query(`SELECT club_id FROM competition_participants WHERE competition_id = ? AND registration_status = 'APPROVED' ORDER BY seed_no IS NULL, seed_no, id`, [competitionId]);
    clubIds = participants.map((item) => Number(item.club_id));
    if (mode === 'RANDOM') clubIds = shuffle(clubIds);
  }
  if (clubIds.length !== Number(firstRound.team_count)) throw new ApiError(400, `Vòng đầu cần đúng ${firstRound.team_count} đội nhưng nhận ${clubIds.length}.`);
  if (new Set(clubIds).size !== clubIds.length) throw new ApiError(400, 'Danh sách có CLB trùng nhau.');

  await transaction(async (connection) => {
    const matches = await query('SELECT * FROM matches WHERE round_id = ? ORDER BY match_no', [firstRound.id], connection);
    let index = 0;
    for (const match of matches) {
      await query(`UPDATE matches SET home_club_id = ?, away_club_id = ?, status = 'SCHEDULED' WHERE id = ?`, [clubIds[index], clubIds[index + 1], match.id], connection);
      index += 2;
    }
    await query(`UPDATE competition_rounds SET status = 'IN_PROGRESS' WHERE id = ?`, [firstRound.id], connection);
    await query(`UPDATE competitions SET status = 'KNOCKOUT_STAGE' WHERE id = ?`, [competitionId], connection);
    await audit({ userId: req.user.id, actionCode: 'SEED_KNOCKOUT_PARTICIPANTS', entityTable: 'competitions', entityId: competitionId, details: { mode, club_ids: clubIds } }, connection);
  });
  return ok(res, { mode, clubIds });
});

router.post('/matches/:id/teams', authenticate, requireAdmin, async (req, res) => {
  const matchId = parsePositiveInt(req.params.id);
  const homeClubId = parsePositiveInt(req.body.home_club_id, 'home_club_id');
  const awayClubId = parsePositiveInt(req.body.away_club_id, 'away_club_id');
  await callProcedure('sp_set_knockout_match_teams', [matchId, homeClubId, awayClubId, req.user.id]);
  return ok(res, await first('SELECT * FROM matches WHERE id = ?', [matchId]));
});

/* ========================================================================== */
/* MATCHES AND RESULTS                                                         */
/* ========================================================================== */

router.get('/competitions/:id/matches', async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const stage = req.query.stage_type ? parseEnum(req.query.stage_type, ['GROUP', 'KNOCKOUT'], 'stage_type') : null;
  const params = [competitionId];
  let extra = '';
  if (stage) { extra = 'AND m.stage_type = ?'; params.push(stage); }
  return ok(res, await query(
    `SELECT m.*, g.group_code, r.round_name, r.round_order,
            hc.name AS home_club_name, hc.logo_url AS home_logo,
            ac.name AS away_club_name, ac.logo_url AS away_logo,
            wc.name AS winner_club_name, lc.name AS loser_club_name
     FROM matches m LEFT JOIN competition_groups g ON g.id = m.group_id
     LEFT JOIN competition_rounds r ON r.id = m.round_id
     LEFT JOIN clubs hc ON hc.id = m.home_club_id LEFT JOIN clubs ac ON ac.id = m.away_club_id
     LEFT JOIN clubs wc ON wc.id = m.winner_club_id LEFT JOIN clubs lc ON lc.id = m.loser_club_id
     WHERE m.competition_id = ? ${extra}
     ORDER BY m.stage_type, COALESCE(g.display_order, r.round_order), m.match_no, m.leg_no`, params
  ));
});

router.patch('/matches/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const body = {};
  if (req.body.scheduled_at !== undefined) body.scheduled_at = req.body.scheduled_at || null;
  if (req.body.status !== undefined) body.status = parseEnum(req.body.status, MATCH_STATUSES, 'status');
  if (req.body.note !== undefined) body.note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 500 });
  const update = buildUpdate(body, ['scheduled_at', 'status', 'note']);
  const result = await query(`UPDATE matches SET ${update.sql} WHERE id = ?`, [...update.values, id]);
  if (!result.affectedRows) throw new ApiError(404, 'Không tìm thấy trận đấu.');
  await audit({ userId: req.user.id, actionCode: 'UPDATE_MATCH', entityTable: 'matches', entityId: id, details: body });
  return ok(res, await first('SELECT * FROM matches WHERE id = ?', [id]));
});

router.post('/matches/:id/result', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const homeScore = parsePositiveInt(req.body.home_score, 'home_score', { min: 0, max: 999 });
  const awayScore = parsePositiveInt(req.body.away_score, 'away_score', { min: 0, max: 999 });
  const homePenalty = req.body.home_penalty_score === null || req.body.home_penalty_score === undefined ? null : parsePositiveInt(req.body.home_penalty_score, 'home_penalty_score', { min: 0, max: 999 });
  const awayPenalty = req.body.away_penalty_score === null || req.body.away_penalty_score === undefined ? null : parsePositiveInt(req.body.away_penalty_score, 'away_penalty_score', { min: 0, max: 999 });
  const note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 500 });
  await callProcedure('sp_set_match_result', [id, homeScore, awayScore, homePenalty, awayPenalty, req.user.id, note]);
  return ok(res, await first(`SELECT m.*, hc.name AS home_club_name, ac.name AS away_club_name, wc.name AS winner_club_name
    FROM matches m LEFT JOIN clubs hc ON hc.id = m.home_club_id LEFT JOIN clubs ac ON ac.id = m.away_club_id
    LEFT JOIN clubs wc ON wc.id = m.winner_club_id WHERE m.id = ?`, [id]));
});

router.post('/matches/:id/reset', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const reason = parseText(req.body.reason, 'reason', { max: 500 });
  await callProcedure('sp_reset_match_result', [id, req.user.id, reason]);
  return ok(res, await first('SELECT * FROM matches WHERE id = ?', [id]));
});

/* ========================================================================== */
/* PRIZES, SPECIAL REWARDS, FINAL PLACEMENTS                                   */
/* ========================================================================== */

router.get('/competitions/:id/prize-rules', async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  return ok(res, await query('SELECT * FROM competition_prize_rules WHERE competition_id = ? ORDER BY placement_from', [competitionId]));
});

router.put('/competitions/:id/prize-rules', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  assertCompetitionMutable(await getCompetition(competitionId));
  if (!Array.isArray(req.body.rules) || !req.body.rules.length) throw new ApiError(400, 'rules phải là mảng có ít nhất một mức thưởng.');
  await transaction(async (connection) => {
    await query('DELETE FROM competition_prize_rules WHERE competition_id = ?', [competitionId], connection);
    for (const rule of req.body.rules) {
      await query(
        `INSERT INTO competition_prize_rules(competition_id, placement_from, placement_to, placement_label, prize_amount, base_ranking_points, medal_type)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [competitionId,
          parsePositiveInt(rule.placement_from, 'placement_from'),
          parsePositiveInt(rule.placement_to, 'placement_to'),
          parseText(rule.placement_label, 'placement_label', { max: 100 }),
          parseMoney(rule.prize_amount || 0, 'prize_amount'),
          parseDecimal(rule.base_ranking_points || 0, 'base_ranking_points', { min: 0 }),
          parseEnum(rule.medal_type || 'NONE', MEDAL_TYPES, 'medal_type')], connection
      );
    }
    await audit({ userId: req.user.id, actionCode: 'SET_COMPETITION_PRIZE_RULES', entityTable: 'competitions', entityId: competitionId, details: { rule_count: req.body.rules.length } }, connection);
  });
  return ok(res, await query('SELECT * FROM competition_prize_rules WHERE competition_id = ? ORDER BY placement_from', [competitionId]));
});

router.get('/competitions/:id/special-reward-rule', async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  return ok(res, await first('SELECT * FROM competition_special_reward_rules WHERE competition_id = ?', [competitionId]));
});

router.put('/competitions/:id/special-reward-rule', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  assertCompetitionMutable(await getCompetition(competitionId));
  const enabled = parseBoolean(req.body.enabled, false);
  const championFraction = parseDecimal(req.body.champion_reward_fraction ?? '0.2500', 'champion_reward_fraction', { min: 0, max: 1 });
  const runnerupFraction = parseDecimal(req.body.runnerup_reward_fraction ?? '0.2500', 'runnerup_reward_fraction', { min: 0, max: 1 });
  const fifaShare = parseDecimal(req.body.fifa_share_fraction ?? '0.5000', 'fifa_share_fraction', { min: 0, max: 1 });
  const defeatedShare = parseDecimal(req.body.defeated_share_fraction ?? '0.5000', 'defeated_share_fraction', { min: 0, max: 1 });
  const maxChampion = parsePositiveInt(req.body.max_champion_rewards ?? 1, 'max_champion_rewards', { min: 0, max: 100 });
  const maxRunnerup = parsePositiveInt(req.body.max_runnerup_rewards ?? 1, 'max_runnerup_rewards', { min: 0, max: 100 });
  await query(
    `INSERT INTO competition_special_reward_rules(competition_id, enabled, champion_reward_fraction, runnerup_reward_fraction,
      fifa_share_fraction, defeated_share_fraction, max_champion_rewards, max_runnerup_rewards)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), champion_reward_fraction = VALUES(champion_reward_fraction),
      runnerup_reward_fraction = VALUES(runnerup_reward_fraction), fifa_share_fraction = VALUES(fifa_share_fraction),
      defeated_share_fraction = VALUES(defeated_share_fraction), max_champion_rewards = VALUES(max_champion_rewards),
      max_runnerup_rewards = VALUES(max_runnerup_rewards)`,
    [competitionId, enabled, championFraction, runnerupFraction, fifaShare, defeatedShare, maxChampion, maxRunnerup]
  );
  await audit({ userId: req.user.id, actionCode: 'SET_SPECIAL_REWARD_RULE', entityTable: 'competitions', entityId: competitionId });
  return ok(res, await first('SELECT * FROM competition_special_reward_rules WHERE competition_id = ?', [competitionId]));
});

router.get('/competitions/:id/results', async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  return ok(res, await query(`SELECT cr.*, c.name AS club_name, c.logo_url FROM competition_results cr JOIN clubs c ON c.id = cr.club_id
    WHERE cr.competition_id = ? ORDER BY cr.placement, c.name`, [competitionId]));
});

router.put('/competitions/:id/results', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  assertCompetitionMutable(await getCompetition(competitionId));
  if (!Array.isArray(req.body.results) || !req.body.results.length) throw new ApiError(400, 'results phải là mảng.');
  await transaction(async (connection) => {
    await query('DELETE FROM competition_results WHERE competition_id = ?', [competitionId], connection);
    for (const item of req.body.results) {
      await query(
        `INSERT INTO competition_results(competition_id, club_id, placement, is_joint_placement, confirmed_by_user_id, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [competitionId, parsePositiveInt(item.club_id, 'club_id'), parsePositiveInt(item.placement, 'placement'),
          parseBoolean(item.is_joint_placement, false), req.user.id,
          parseText(item.note, 'note', { required: false, nullable: true, max: 500 })], connection
      );
    }
    await query(`UPDATE competitions SET status = 'COMPLETED_PENDING_CLOSE' WHERE id = ?`, [competitionId], connection);
    await audit({ userId: req.user.id, actionCode: 'SET_COMPETITION_RESULTS', entityTable: 'competitions', entityId: competitionId, details: { result_count: req.body.results.length } }, connection);
  });
  return ok(res, await query('SELECT * FROM competition_results WHERE competition_id = ? ORDER BY placement, club_id', [competitionId]));
});

router.post('/competitions/:id/results/derive-knockout', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const competition = await getCompetition(competitionId);
  assertCompetitionMutable(competition);
  const finalMatch = await first(
    `SELECT m.* FROM matches m JOIN competition_rounds r ON r.id = m.round_id
     WHERE m.competition_id = ? AND r.team_count = 2 AND m.status = 'FINISHED' ORDER BY m.id DESC LIMIT 1`, [competitionId]
  );
  if (!finalMatch || !finalMatch.winner_club_id || !finalMatch.loser_club_id) throw new ApiError(400, 'Chung kết chưa có kết quả hợp lệ.');
  const results = [
    { club_id: Number(finalMatch.winner_club_id), placement: 1, is_joint_placement: false, note: 'Tự xác định từ trận chung kết' },
    { club_id: Number(finalMatch.loser_club_id), placement: 2, is_joint_placement: false, note: 'Tự xác định từ trận chung kết' }
  ];
  if (competition.third_place_mode === 'SHARED_BRONZE' && Number(competition.knockout_size) >= 4) {
    const semifinalLosers = await query(
      `SELECT m.loser_club_id FROM matches m JOIN competition_rounds r ON r.id = m.round_id
       WHERE m.competition_id = ? AND r.team_count = 4 AND m.status = 'FINISHED' ORDER BY m.match_no`, [competitionId]
    );
    if (semifinalLosers.length !== 2 || semifinalLosers.some((item) => !item.loser_club_id)) throw new ApiError(400, 'Chưa đủ hai đội thua bán kết để đồng hạng ba.');
    for (const item of semifinalLosers) results.push({ club_id: Number(item.loser_club_id), placement: 3, is_joint_placement: true, note: 'Đồng hạng ba từ hai đội thua bán kết' });
  }
  if (competition.third_place_mode === 'PLAYOFF') {
    throw new ApiError(400, 'Chế độ tranh hạng ba cần Admin nhập kết quả thứ hạng bằng API PUT /competitions/:id/results.');
  }

  await transaction(async (connection) => {
    await query('DELETE FROM competition_results WHERE competition_id = ?', [competitionId], connection);
    for (const item of results) {
      await query(`INSERT INTO competition_results(competition_id, club_id, placement, is_joint_placement, confirmed_by_user_id, note)
        VALUES (?, ?, ?, ?, ?, ?)`, [competitionId, item.club_id, item.placement, item.is_joint_placement, req.user.id, item.note], connection);
    }
    await query(`UPDATE competitions SET status = 'COMPLETED_PENDING_CLOSE' WHERE id = ?`, [competitionId], connection);
    await audit({ userId: req.user.id, actionCode: 'DERIVE_KNOCKOUT_RESULTS', entityTable: 'competitions', entityId: competitionId, details: { results } }, connection);
  });
  return ok(res, results);
});

router.get('/competitions/:id/upset-rewards', async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  return ok(res, await query(
    `SELECT ur.*, wc.name AS winning_club_name, dc.name AS defeated_club_name
     FROM competition_upset_rewards ur JOIN clubs wc ON wc.id = ur.winning_club_id JOIN clubs dc ON dc.id = ur.defeated_club_id
     WHERE ur.competition_id = ? ORDER BY ur.id`, [competitionId]
  ));
});

router.post('/competitions/:id/finalize', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const resultSets = await callProcedure('sp_finalize_competition', [competitionId, req.user.id]);
  let medalResult = null;
  let medalWarning = null;
  try {
    const medalSets = await callProcedure('sp_auto_award_team_medals', [competitionId, req.user.id, false]);
    medalResult = procedureFirstRow(medalSets);
  } catch (error) {
    medalWarning = error.message;
    await audit({
      userId: req.user.id,
      actionCode: 'AUTO_TEAM_MEDALS_WARNING',
      entityTable: 'competitions',
      entityId: competitionId,
      details: { message: error.message }
    });
  }

  let matchRatings = null;
  let performanceBonuses = null;
  let performanceWarning = null;
  try {
    matchRatings = await finalizeAllCompetitionMatchRatings(competitionId, req.user.id, { skipIncomplete: true });
    performanceBonuses = await finalizeCompetitionPerformance(competitionId, req.user.id, { allowIncomplete: false });
  } catch (error) {
    performanceWarning = error.message;
    await audit({
      userId: req.user.id,
      actionCode: 'AUTO_PERFORMANCE_RATING_WARNING',
      entityTable: 'competitions',
      entityId: competitionId,
      details: { message: error.message, matchRatings }
    });
  }

  let individualAwards = null;
  let individualAwardWarning = null;
  try {
    individualAwards = await finalizeCompetitionAwards(competitionId, req.user.id);
  } catch (error) {
    individualAwardWarning = error.message;
    await audit({
      userId: req.user.id,
      actionCode: 'AUTO_INDIVIDUAL_AWARDS_WARNING',
      entityTable: 'competitions',
      entityId: competitionId,
      details: { message: error.message }
    });
  }

  let influenceUpdate = [];
  let influenceWarning = null;
  try {
    const participantClubs = await query(
      `SELECT DISTINCT club_id FROM competition_participants WHERE competition_id=? AND registration_status='APPROVED'`,
      [competitionId]
    );
    for (const row of participantClubs) {
      influenceUpdate.push(await recalculateClubInfluence(Number(row.club_id), undefined, 'COMPETITION_FINISHED'));
    }
  } catch (error) {
    influenceWarning = error.message;
    await audit({
      userId: req.user.id,
      actionCode: 'AUTO_INFLUENCE_RECALC_WARNING',
      entityTable: 'competitions',
      entityId: competitionId,
      details: { message: error.message }
    });
  }
  return ok(res, {
    message: [
      'Đã kết thúc giải, chuyển tiền thưởng, cộng điểm và trao thành tích CLB.',
      medalWarning ? 'Huy chương tập thể cần được bổ sung lại tại mục Danh hiệu & BXH.' : 'Huy chương tập thể đã được trao tự động.',
      performanceWarning
        ? `Điểm hiệu suất chưa chốt hoàn toàn: ${performanceWarning}`
        : `Đã chốt BXH hiệu suất và thưởng ${performanceBonuses?.awarded?.length || 0} cầu thủ.`,
      individualAwardWarning
        ? `Danh hiệu cá nhân chưa tự trao: ${individualAwardWarning}`
        : `Đã tự tính và trao ${individualAwards?.assigned?.length || 0} danh hiệu cá nhân.`
    ].join(' '),
    resultSets,
    medalResult,
    medalWarning,
    matchRatings,
    performanceBonuses,
    performanceWarning,
    individualAwards,
    individualAwardWarning,
    influenceUpdate,
    influenceWarning
  });
});

router.post('/competitions/:id/lock-player-awards', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  await callProcedure('sp_lock_competition_player_awards', [competitionId, req.user.id]);
  return ok(res, { message: 'Đã khóa danh hiệu cầu thủ của giải.' });
});

module.exports = router;
