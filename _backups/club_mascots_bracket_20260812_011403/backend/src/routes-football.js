'use strict';

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

const { previewCompetitionAwards, finalizeCompetitionAwards } = require('./smart-awards');
const { finalizeMatchRatings } = require('./performance-engine');

const router = express.Router();


async function syncPlayerIntoOpenCompetitionRosters({ playerId, clubId, userId, connection = undefined }) {
  if (!clubId) return;
  const participants = await query(
    `SELECT cp.competition_id
     FROM competition_participants cp
     JOIN competitions c ON c.id = cp.competition_id
     WHERE cp.club_id = ?
       AND cp.registration_status NOT IN ('WITHDRAWN','DISQUALIFIED')
       AND c.status NOT IN ('FINISHED','CANCELLED')`,
    [clubId],
    connection
  );
  for (const participant of participants) {
    await callProcedure(
      'sp_sync_competition_roster',
      [Number(participant.competition_id), clubId, userId, 'CLUB_SYNC'],
      connection
    );
  }
}

const PLAYER_POSITIONS = ['GK', 'DF', 'MF', 'FW'];
const PLAYER_STATUSES = ['ACTIVE', 'FREE_AGENT', 'TRANSFER_LISTED', 'RETIRED', 'SUSPENDED'];
const STAFF_STATUSES = ['ACTIVE', 'FREE_AGENT', 'RETIRED', 'SUSPENDED'];
const CONTRACT_STATUSES = ['ACTIVE', 'EXPIRED', 'TERMINATED'];
const TRANSFER_TYPES = ['PAID', 'FREE'];
const TRANSFER_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'COMPLETED'];
const AWARD_CATEGORIES = ['TEAM_MEDAL', 'BEST_PLAYER', 'TOP_SCORER', 'BEST_GOALKEEPER', 'BEST_YOUNG_PLAYER', 'BEST_ASSIST', 'OTHER'];
const MEDAL_TYPES = ['GOLD', 'SILVER', 'BRONZE', 'NONE'];
const RANKING_CATEGORIES = ['OVERALL', 'NATIONAL', 'GOALS', 'GOALKEEPER', 'WEALTH', 'MARKET_VALUE'];
const SNAPSHOT_RANKING_CATEGORIES = ['OVERALL', 'GOALS', 'GOALKEEPER', 'WEALTH', 'MARKET_VALUE'];
const PLAYER_SORTS = ['NAME_ASC', 'VALUE_DESC', 'VALUE_ASC', 'CHANGE_DESC', 'CHANGE_ASC'];

function compareMoney(left, right) {
  return BigInt(String(left || 0)) - BigInt(String(right || 0));
}

function moneyLabel(value) {
  return `${BigInt(String(value || 0)).toLocaleString('vi-VN')} đ`;
}

function assertMarketFloor(amount, player, fieldLabel) {
  if (compareMoney(amount, player.market_value) < 0n) {
    throw new ApiError(400, `${fieldLabel} không được thấp hơn giá sàn hiện tại của ${player.full_name}: ${moneyLabel(player.market_value)}.`);
  }
}

function playerOrder(sort) {
  return {
    NAME_ASC: 'full_name ASC,id ASC',
    VALUE_DESC: 'market_value DESC,valuation_score DESC,full_name ASC',
    VALUE_ASC: 'market_value ASC,valuation_score ASC,full_name ASC',
    CHANGE_DESC: 'latest_value_change DESC,market_value DESC,full_name ASC',
    CHANGE_ASC: 'latest_value_change ASC,market_value DESC,full_name ASC'
  }[sort];
}

async function getPlayer(id) {
  const player = await first('SELECT * FROM players WHERE id = ?', [id]);
  if (!player) throw new ApiError(404, 'Không tìm thấy cầu thủ.');
  return player;
}

async function getStaff(id) {
  const staff = await first('SELECT * FROM coaching_staff WHERE id = ?', [id]);
  if (!staff) throw new ApiError(404, 'Không tìm thấy thành viên ban huấn luyện.');
  return staff;
}

function assertOwner(req, clubId) {
  if (req.user.accountType === 'CLUB' && Number(clubId) !== req.user.clubId) {
    throw new ApiError(403, 'CLB chỉ được thao tác dữ liệu thuộc CLB mình.');
  }
}

/* ========================================================================== */
/* PUBLIC HOME, CLUBS, PLAYERS, RANKINGS                                       */
/* ========================================================================== */

router.get('/public/home', async (_req, res) => {
  const [clubRanking, playerRanking, competitions, recentMatches, champions, valueMovers] = await Promise.all([
    query('SELECT * FROM v_latest_club_world_ranking ORDER BY rank_position LIMIT 10'),
    query(`SELECT lpr.*, p.market_value, p.photo_url
           FROM v_latest_player_rankings lpr JOIN players p ON p.id = lpr.player_id
           WHERE lpr.category = 'OVERALL' ORDER BY lpr.rank_position LIMIT 10`),
    query(`SELECT c.id, c.name, c.logo_url, c.status, c.format_type, c.starts_on, c.ends_on,
                  s.name AS season_name, cs.name AS series_name
           FROM competitions c JOIN seasons s ON s.id = c.season_id
           JOIN competition_series cs ON cs.id = c.series_id
           WHERE c.status NOT IN ('CANCELLED') ORDER BY c.created_at DESC LIMIT 8`),
    query(`SELECT m.id, m.competition_id, comp.name AS competition_name, m.stage_type, m.status,
                  m.home_score, m.away_score, m.highlighted_upset, m.scheduled_at,
                  hc.name AS home_club_name, hc.logo_url AS home_logo,
                  ac.name AS away_club_name, ac.logo_url AS away_logo
           FROM matches m JOIN competitions comp ON comp.id = m.competition_id
           LEFT JOIN clubs hc ON hc.id = m.home_club_id LEFT JOIN clubs ac ON ac.id = m.away_club_id
           ORDER BY m.status = 'FINISHED' DESC, COALESCE(m.scheduled_at, m.updated_at) DESC LIMIT 10`),
    query(`SELECT ca.*, c.name AS club_name, c.logo_url, comp.name AS competition_name, s.name AS season_name
           FROM club_achievements ca JOIN clubs c ON c.id = ca.club_id
           JOIN competitions comp ON comp.id = ca.competition_id JOIN seasons s ON s.id = ca.season_id
           WHERE ca.placement = 1 ORDER BY ca.awarded_at DESC LIMIT 8`),
    query(`SELECT vmvc.*, p.photo_url, c.name AS club_name
           FROM v_player_market_value_changes vmvc JOIN players p ON p.id = vmvc.player_id
           LEFT JOIN clubs c ON c.id = p.club_id
           WHERE vmvc.value_change IS NOT NULL ORDER BY ABS(vmvc.value_change) DESC LIMIT 10`)
  ]);
  return ok(res, { clubRanking, playerRanking, competitions, recentMatches, champions, valueMovers });
});


router.get('/public/pulse', async (_req, res) => {
  const [
    recentMatches,
    upcomingMatches,
    transfers,
    awards,
    champions,
    topScorer,
    topAssister,
    mostDecorated,
    mostValuable,
    richestPlayer,
    topClub,
    valueMovers,
    formMatches,
    totals
  ] = await Promise.all([
    query(`SELECT m.id, m.competition_id, comp.name AS competition_name, m.stage_type,
                  m.home_score, m.away_score, m.highlighted_upset,
                  COALESCE(m.scheduled_at, m.updated_at) AS occurred_at,
                  hc.id AS home_club_id, hc.name AS home_club_name, hc.logo_url AS home_logo,
                  ac.id AS away_club_id, ac.name AS away_club_name, ac.logo_url AS away_logo
           FROM matches m
           JOIN competitions comp ON comp.id = m.competition_id
           LEFT JOIN clubs hc ON hc.id = m.home_club_id
           LEFT JOIN clubs ac ON ac.id = m.away_club_id
           WHERE m.status = 'FINISHED'
             AND m.home_club_id IS NOT NULL AND m.away_club_id IS NOT NULL
           ORDER BY COALESCE(m.scheduled_at, m.updated_at) DESC, m.id DESC LIMIT 18`),
    query(`SELECT m.id, m.competition_id, comp.name AS competition_name, m.stage_type, m.status,
                  m.scheduled_at,
                  hc.id AS home_club_id, hc.name AS home_club_name, hc.logo_url AS home_logo,
                  ac.id AS away_club_id, ac.name AS away_club_name, ac.logo_url AS away_logo
           FROM matches m
           JOIN competitions comp ON comp.id = m.competition_id
           LEFT JOIN clubs hc ON hc.id = m.home_club_id
           LEFT JOIN clubs ac ON ac.id = m.away_club_id
           WHERE m.status IN ('SCHEDULED','LIVE')
             AND m.home_club_id IS NOT NULL AND m.away_club_id IS NOT NULL
           ORDER BY m.status = 'LIVE' DESC, m.scheduled_at IS NULL, m.scheduled_at, m.id LIMIT 10`),
    query(`SELECT pt.id, pt.player_id, p.full_name, p.photo_url,
                  pt.from_club_id, fc.name AS from_club_name,
                  pt.to_club_id, tc.name AS to_club_name,
                  pt.transfer_type, pt.transfer_fee, pt.completed_at AS occurred_at
           FROM player_transfers pt
           JOIN players p ON p.id = pt.player_id
           LEFT JOIN clubs fc ON fc.id = pt.from_club_id
           JOIN clubs tc ON tc.id = pt.to_club_id
           ORDER BY pt.completed_at DESC, pt.id DESC LIMIT 12`),
    query(`SELECT pa.id, pa.player_id, p.full_name, p.photo_url,
                  at.name AS award_name, at.category, pa.display_name,
                  pa.awarded_points, pa.awarded_at AS occurred_at,
                  comp.id AS competition_id, comp.name AS competition_name,
                  COALESCE(c.name, pa.country_name_at_award) AS represented_name
           FROM player_awards pa
           JOIN players p ON p.id = pa.player_id
           JOIN award_types at ON at.id = pa.award_type_id
           JOIN competitions comp ON comp.id = pa.competition_id
           LEFT JOIN clubs c ON c.id = pa.club_id_at_award
           ORDER BY pa.awarded_at DESC, pa.id DESC LIMIT 12`),
    query(`SELECT ca.id, ca.club_id, c.name AS club_name, c.logo_url,
                  ca.competition_id, comp.name AS competition_name,
                  s.name AS season_name, ca.awarded_points,
                  ca.awarded_at AS occurred_at
           FROM club_achievements ca
           JOIN clubs c ON c.id = ca.club_id
           JOIN competitions comp ON comp.id = ca.competition_id
           JOIN seasons s ON s.id = ca.season_id
           WHERE ca.placement = 1
           ORDER BY ca.awarded_at DESC, ca.id DESC LIMIT 10`),
    first(`SELECT p.id AS player_id, p.full_name, p.photo_url, c.name AS club_name,
                  COALESCE(SUM(pms.goals),0) AS total_value
           FROM player_match_stats pms
           JOIN players p ON p.id = pms.player_id
           LEFT JOIN clubs c ON c.id = p.club_id
           WHERE pms.verification_status IN ('VERIFIED','LOCKED')
           GROUP BY p.id, p.full_name, p.photo_url, c.name
           ORDER BY total_value DESC, p.full_name LIMIT 1`),
    first(`SELECT p.id AS player_id, p.full_name, p.photo_url, c.name AS club_name,
                  COALESCE(SUM(pms.assists),0) AS total_value
           FROM player_match_stats pms
           JOIN players p ON p.id = pms.player_id
           LEFT JOIN clubs c ON c.id = p.club_id
           WHERE pms.verification_status IN ('VERIFIED','LOCKED')
           GROUP BY p.id, p.full_name, p.photo_url, c.name
           ORDER BY total_value DESC, p.full_name LIMIT 1`),
    first(`SELECT p.id AS player_id, p.full_name, p.photo_url, c.name AS club_name,
                  COUNT(pa.id) AS total_value,
                  COALESCE(SUM(pa.awarded_points),0) AS secondary_value
           FROM player_awards pa
           JOIN players p ON p.id = pa.player_id
           LEFT JOIN clubs c ON c.id = p.club_id
           GROUP BY p.id, p.full_name, p.photo_url, c.name
           ORDER BY total_value DESC, secondary_value DESC, p.full_name LIMIT 1`),
    first(`SELECT p.id AS player_id, p.full_name, p.photo_url, c.name AS club_name,
                  p.market_value AS total_value
           FROM players p LEFT JOIN clubs c ON c.id = p.club_id
           WHERE p.status <> 'RETIRED'
           ORDER BY p.market_value DESC, p.full_name LIMIT 1`),
    first(`SELECT p.id AS player_id, p.full_name, p.photo_url, c.name AS club_name,
                  w.balance AS total_value
           FROM wallets w
           JOIN players p ON p.id = w.player_id
           LEFT JOIN clubs c ON c.id = p.club_id
           WHERE w.wallet_type = 'PLAYER' AND w.status = 'ACTIVE'
           ORDER BY w.balance DESC, p.full_name LIMIT 1`),
    first(`SELECT c.id AS club_id, c.name AS club_name, c.logo_url,
                  SUM(ca.medal_type = 'GOLD') AS gold_count,
                  SUM(ca.medal_type = 'SILVER') AS silver_count,
                  SUM(ca.medal_type = 'BRONZE') AS bronze_count,
                  COUNT(ca.id) AS total_value,
                  COALESCE(SUM(ca.awarded_points),0) AS secondary_value
           FROM club_achievements ca
           JOIN clubs c ON c.id = ca.club_id
           GROUP BY c.id, c.name, c.logo_url
           ORDER BY gold_count DESC, silver_count DESC, bronze_count DESC,
                    secondary_value DESC, c.name LIMIT 1`),
    query(`SELECT vmvc.*, p.photo_url, c.name AS club_name
           FROM v_player_market_value_changes vmvc
           JOIN players p ON p.id = vmvc.player_id
           LEFT JOIN clubs c ON c.id = p.club_id
           WHERE vmvc.value_change IS NOT NULL AND vmvc.value_change <> 0
           ORDER BY ABS(vmvc.value_change) DESC LIMIT 8`),
    query(`SELECT m.id, m.home_club_id, m.away_club_id, m.home_score, m.away_score,
                  COALESCE(m.scheduled_at, m.updated_at) AS occurred_at,
                  hc.name AS home_club_name, hc.logo_url AS home_logo,
                  ac.name AS away_club_name, ac.logo_url AS away_logo
           FROM matches m
           LEFT JOIN clubs hc ON hc.id = m.home_club_id
           LEFT JOIN clubs ac ON ac.id = m.away_club_id
           WHERE m.status = 'FINISHED'
             AND m.home_club_id IS NOT NULL AND m.away_club_id IS NOT NULL
           ORDER BY COALESCE(m.scheduled_at, m.updated_at) DESC, m.id DESC LIMIT 160`),
    first(`SELECT
             (SELECT COUNT(*) FROM matches WHERE status = 'FINISHED') AS finished_matches,
             (SELECT COALESCE(SUM(COALESCE(home_score,0) + COALESCE(away_score,0)),0)
                FROM matches WHERE status = 'FINISHED') AS total_goals,
             (SELECT COUNT(*) FROM player_transfers) AS completed_transfers,
             (SELECT COUNT(*) FROM player_awards) AS player_awards,
             (SELECT COUNT(*) FROM clubs WHERE registration_status = 'APPROVED' AND is_active = TRUE) AS active_clubs,
             (SELECT COUNT(*) FROM players WHERE status <> 'RETIRED') AS active_players`)
  ]);

  const eventRows = [];
  for (const item of recentMatches) {
    eventRows.push({
      id: `match-${item.id}`,
      type: item.highlighted_upset ? 'UPSET' : 'MATCH',
      occurred_at: item.occurred_at,
      title: item.highlighted_upset ? 'Cú sốc vừa xảy ra' : 'Kết quả mới nhất',
      description: `${item.home_club_name} ${item.home_score}–${item.away_score} ${item.away_club_name}`,
      meta: item.competition_name,
      link: `/competitions/${item.competition_id}`,
      accent: item.highlighted_upset ? 'red' : 'blue'
    });
  }
  for (const item of transfers) {
    eventRows.push({
      id: `transfer-${item.id}`,
      type: 'TRANSFER',
      occurred_at: item.occurred_at,
      title: 'Chuyển nhượng hoàn tất',
      description: `${item.full_name}: ${item.from_club_name || 'Tự do'} → ${item.to_club_name}`,
      meta: Number(item.transfer_fee || 0) > 0 ? `${item.transfer_fee} VND` : 'Chuyển nhượng tự do',
      link: `/players/${item.player_id}`,
      accent: 'cyan'
    });
  }
  for (const item of awards) {
    eventRows.push({
      id: `award-${item.id}`,
      type: 'AWARD',
      occurred_at: item.occurred_at,
      title: item.award_name,
      description: `${item.full_name} · ${item.represented_name || 'Đại diện cá nhân'}`,
      meta: `${item.competition_name} · +${Number(item.awarded_points || 0)} điểm`,
      link: `/players/${item.player_id}`,
      accent: 'yellow'
    });
  }
  for (const item of champions) {
    eventRows.push({
      id: `champion-${item.id}`,
      type: 'CHAMPION',
      occurred_at: item.occurred_at,
      title: 'Nhà vô địch mới',
      description: `${item.club_name} đăng quang ${item.competition_name}`,
      meta: item.season_name,
      link: `/clubs/${item.club_id}`,
      accent: 'green'
    });
  }
  eventRows.sort((a, b) => new Date(b.occurred_at || 0) - new Date(a.occurred_at || 0));

  const clubs = new Map();
  const ensureClub = (id, name, logo) => {
    if (!id) return null;
    if (!clubs.has(Number(id))) clubs.set(Number(id), {
      club_id: Number(id), club_name: name, logo_url: logo,
      played: 0, wins: 0, draws: 0, losses: 0, goals_for: 0, goals_against: 0,
      form: [], points: 0, unbeaten: 0
    });
    return clubs.get(Number(id));
  };
  for (const match of formMatches) {
    for (const side of ['home', 'away']) {
      const id = match[`${side}_club_id`];
      const club = ensureClub(id, match[`${side}_club_name`], match[`${side}_logo`]);
      if (!club || club.played >= 5) continue;
      const own = Number(match[`${side}_score`] || 0);
      const other = Number(match[side === 'home' ? 'away_score' : 'home_score'] || 0);
      const result = own > other ? 'W' : own === other ? 'D' : 'L';
      club.played += 1;
      club.goals_for += own;
      club.goals_against += other;
      club.form.push(result);
      if (result === 'W') { club.wins += 1; club.points += 3; }
      else if (result === 'D') { club.draws += 1; club.points += 1; }
      else club.losses += 1;
    }
  }
  for (const club of clubs.values()) {
    club.unbeaten = club.form.findIndex((value) => value === 'L');
    if (club.unbeaten < 0) club.unbeaten = club.form.length;
    club.goal_difference = club.goals_for - club.goals_against;
  }
  const formTable = [...clubs.values()]
    .filter((club) => club.played > 0)
    .sort((a, b) => b.points - a.points || b.goal_difference - a.goal_difference || b.goals_for - a.goals_for)
    .slice(0, 10);

  const records = [
    { key: 'TOP_SCORER', label: 'Vua phá lưới lịch sử', unit: 'bàn', entity_type: 'PLAYER', ...topScorer },
    { key: 'TOP_ASSIST', label: 'Kiến tạo nhiều nhất', unit: 'kiến tạo', entity_type: 'PLAYER', ...topAssister },
    { key: 'MOST_DECORATED', label: 'Nhiều danh hiệu nhất', unit: 'danh hiệu', entity_type: 'PLAYER', ...mostDecorated },
    { key: 'MOST_VALUABLE', label: 'Giá trị cao nhất', unit: 'VND', entity_type: 'PLAYER', ...mostValuable },
    { key: 'RICHEST_PLAYER', label: 'Cầu thủ giàu nhất', unit: 'VND', entity_type: 'PLAYER', ...richestPlayer },
    { key: 'TOP_CLUB', label: 'CLB giàu thành tích nhất', unit: 'thành tích', entity_type: 'CLUB', ...topClub }
  ].filter((item) => item.player_id || item.club_id);

  return ok(res, {
    generatedAt: new Date().toISOString(),
    events: eventRows.slice(0, 28),
    upcomingMatches,
    records,
    formTable,
    valueMovers,
    totals: totals || {}
  });
});

router.get('/public/clubs', async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const search = String(req.query.search || '').trim();
  const params = [];
  let where = `WHERE c.registration_status = 'APPROVED' AND c.is_active = TRUE`;
  if (search) {
    where += ' AND (c.name LIKE ? OR c.short_name LIKE ? OR c.code LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  const total = await first(`SELECT COUNT(*) AS total FROM clubs c ${where}`, params);
  const rows = await query(
    `SELECT c.id, c.code, c.name, c.short_name, c.logo_url,
            w.balance,
            (SELECT COUNT(*) FROM players p WHERE p.club_id = c.id AND p.status <> 'RETIRED') AS player_count,
            r.rank_position, r.previous_rank, r.rank_change, r.score
     FROM clubs c
     LEFT JOIN wallets w ON w.club_id = c.id AND w.wallet_type = 'CLUB'
     LEFT JOIN v_latest_club_world_ranking r ON r.club_id = c.id
     ${where}
     ORDER BY COALESCE(r.rank_position, 999999), c.name ${sqlLimit(limit, offset)}`,
    params
  );
  return ok(res, rows, 200, { page, limit, total: Number(total.total) });
});

router.get('/public/clubs/:id', async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const club = await first(
    `SELECT c.id, c.code, c.name, c.short_name, c.logo_url, c.registration_status,
            w.balance, r.rank_position, r.previous_rank, r.rank_change, r.score
     FROM clubs c LEFT JOIN wallets w ON w.club_id = c.id AND w.wallet_type = 'CLUB'
     LEFT JOIN v_latest_club_world_ranking r ON r.club_id = c.id
     WHERE c.id = ? AND c.registration_status = 'APPROVED'`, [id]
  );
  if (!club) throw new ApiError(404, 'Không tìm thấy CLB.');
  const [players, achievements, matches, playerRankings, honourSummary] = await Promise.all([
    query(`SELECT * FROM v_player_list WHERE club_id = ? AND status <> 'RETIRED' ORDER BY position, shirt_number, full_name`, [id]),
    query(`SELECT ca.*, comp.name AS competition_name, s.name AS season_name
           FROM club_achievements ca JOIN competitions comp ON comp.id = ca.competition_id
           JOIN seasons s ON s.id = ca.season_id WHERE ca.club_id = ? ORDER BY ca.awarded_at DESC`, [id]),
    query(`SELECT m.*, comp.name AS competition_name, hc.name AS home_club_name, ac.name AS away_club_name
           FROM matches m JOIN competitions comp ON comp.id = m.competition_id
           LEFT JOIN clubs hc ON hc.id = m.home_club_id LEFT JOIN clubs ac ON ac.id = m.away_club_id
           WHERE m.home_club_id = ? OR m.away_club_id = ? ORDER BY COALESCE(m.scheduled_at,m.created_at) DESC LIMIT 20`, [id, id]),
    query(`SELECT * FROM v_player_rankings_current WHERE club_id = ? ORDER BY overall_club_rank, full_name`, [id]),
    first(`SELECT
             SUM(medal_type = 'GOLD') AS gold_count,
             SUM(medal_type = 'SILVER') AS silver_count,
             SUM(medal_type = 'BRONZE') AS bronze_count,
             SUM(LOWER(achievement_name) LIKE '%tứ kết%' OR (placement BETWEEN 5 AND 8)) AS quarterfinal_count,
             COUNT(*) AS total_achievements,
             COALESCE(SUM(awarded_points), 0) AS honour_points
           FROM club_achievements WHERE club_id = ?`, [id])
  ]);
  return ok(res, { club, players, achievements, matches, playerRankings, honourSummary });
});

router.get('/public/players', async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const search = String(req.query.search || '').trim();
  const position = req.query.position ? parseEnum(req.query.position, PLAYER_POSITIONS, 'position') : null;
  const clubId = req.query.club_id ? parsePositiveInt(req.query.club_id, 'club_id') : null;
  const sort = parseEnum(req.query.sort || 'VALUE_DESC', PLAYER_SORTS, 'sort');
  const where = [];
  const params = [];
  if (search) { where.push('full_name LIKE ?'); params.push(`%${search}%`); }
  if (position) { where.push('position = ?'); params.push(position); }
  if (clubId) { where.push('club_id = ?'); params.push(clubId); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await first(`SELECT COUNT(*) AS total FROM v_player_list ${whereSql}`, params);
  const rows = await query(`SELECT * FROM v_player_list ${whereSql} ORDER BY ${playerOrder(sort)} ${sqlLimit(limit, offset)}`, params);
  return ok(res, rows, 200, { page, limit, total: Number(total.total), sort });
});

router.get('/public/players/:id', async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const dossier = await first('SELECT * FROM v_player_dossier_summary WHERE player_id = ?', [id]);
  if (!dossier) throw new ApiError(404, 'Không tìm thấy cầu thủ.');
  const [awards, history, contracts, values, ranking, recentStats, honourSummary] = await Promise.all([
    query('SELECT * FROM v_player_award_history WHERE player_id = ? ORDER BY awarded_at DESC', [id]),
    query(`SELECT h.*, c.name AS club_name FROM player_club_history h JOIN clubs c ON c.id = h.club_id
           WHERE h.player_id = ? ORDER BY h.joined_at DESC`, [id]),
    query(`SELECT pc.*, c.name AS club_name, ss.name AS start_season_name, es.name AS end_season_name
           FROM player_contracts pc JOIN clubs c ON c.id = pc.club_id
           JOIN seasons ss ON ss.id = pc.start_season_id LEFT JOIN seasons es ON es.id = pc.end_season_id
           WHERE pc.player_id = ? ORDER BY pc.signed_at DESC`, [id]),
    query('SELECT * FROM player_market_value_history WHERE player_id = ? ORDER BY changed_at DESC', [id]),
    first('SELECT * FROM v_player_rankings_current WHERE player_id = ?', [id]),
    query(`SELECT pms.*, m.competition_id, comp.name AS competition_name, m.scheduled_at,
                  hc.name AS home_club_name, ac.name AS away_club_name
           FROM player_match_stats pms JOIN matches m ON m.id = pms.match_id
           JOIN competitions comp ON comp.id = m.competition_id
           LEFT JOIN clubs hc ON hc.id = m.home_club_id LEFT JOIN clubs ac ON ac.id = m.away_club_id
           WHERE pms.player_id = ? AND pms.verification_status IN ('VERIFIED','LOCKED')
           ORDER BY m.scheduled_at DESC, pms.id DESC LIMIT 20`, [id]),
    first(`SELECT
             SUM(at.required_medal_type = 'GOLD') AS gold_count,
             SUM(at.required_medal_type = 'SILVER') AS silver_count,
             SUM(at.required_medal_type = 'BRONZE') AS bronze_count,
             SUM(at.category <> 'TEAM_MEDAL') AS individual_award_count,
             COUNT(*) AS total_awards,
             COALESCE(SUM(pa.awarded_points), 0) AS honour_points
           FROM player_awards pa JOIN award_types at ON at.id = pa.award_type_id
           WHERE pa.player_id = ?`, [id])
  ]);
  return ok(res, { dossier, awards, history, contracts, values, ranking, recentStats, honourSummary });
});

router.get('/rankings/clubs', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
  let rows = await query(`SELECT * FROM v_latest_club_world_ranking ORDER BY rank_position ${sqlLimit(limit)}`);
  if (!rows.length) {
    rows = await query(
      `SELECT ranked.* FROM (
         SELECT c.id AS club_id, c.code AS club_code, c.name AS club_name,
                DENSE_RANK() OVER (ORDER BY COALESCE(SUM(crp.points),0) DESC, c.id) AS rank_position,
                NULL AS previous_rank, NULL AS rank_change, COALESCE(SUM(crp.points),0) AS score
         FROM clubs c LEFT JOIN club_ranking_points crp ON crp.club_id = c.id
         WHERE c.registration_status = 'APPROVED'
         GROUP BY c.id, c.code, c.name
       ) ranked ORDER BY rank_position ${sqlLimit(limit)}`
    );
  }
  return ok(res, rows);
});

router.get('/rankings/players', async (req, res) => {
  const category = parseEnum(req.query.category || 'OVERALL', RANKING_CATEGORIES, 'category');
  const clubId = req.query.club_id ? parsePositiveInt(req.query.club_id, 'club_id') : null;
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
  if (category === 'NATIONAL') {
    const rows = await query(
      `SELECT ranked.*,
              DENSE_RANK() OVER(
                ORDER BY ranked.gold_count DESC,ranked.silver_count DESC,ranked.bronze_count DESC,
                         ranked.score DESC,ranked.individual_award_count DESC,ranked.player_id
              ) AS rank_position,
              NULL AS previous_rank,NULL AS rank_change,NULL AS snapshot_at
       FROM (
         SELECT p.id AS player_id,p.full_name,p.photo_url,p.position,p.club_id,c.name AS club_name,
                p.market_value,COALESCE(w.balance,0) AS wallet_balance,
                COALESCE(np.national_points,0) AS score,
                COALESCE(aw.gold_count,0) AS gold_count,COALESCE(aw.silver_count,0) AS silver_count,
                COALESCE(aw.bronze_count,0) AS bronze_count,COALESCE(aw.individual_award_count,0) AS individual_award_count,
                np.last_national_point_at
         FROM players p LEFT JOIN clubs c ON c.id=p.club_id
         LEFT JOIN wallets w ON w.player_id=p.id AND w.wallet_type='PLAYER'
         LEFT JOIN (
           SELECT player_id,SUM(points) AS national_points,MAX(created_at) AS last_national_point_at
           FROM player_ranking_points WHERE ranking_scope='NATIONAL_TEAM' GROUP BY player_id
         ) np ON np.player_id=p.id
         LEFT JOIN (
           SELECT pa.player_id,
                  SUM(atp.required_medal_type='GOLD') AS gold_count,
                  SUM(atp.required_medal_type='SILVER') AS silver_count,
                  SUM(atp.required_medal_type='BRONZE') AS bronze_count,
                  SUM(atp.category<>'TEAM_MEDAL') AS individual_award_count
           FROM player_awards pa JOIN award_types atp ON atp.id=pa.award_type_id
           WHERE pa.award_context_type='NATIONAL_TEAM' GROUP BY pa.player_id
         ) aw ON aw.player_id=p.id
         WHERE (np.player_id IS NOT NULL OR aw.player_id IS NOT NULL)
           AND (? IS NULL OR p.club_id=?)
       ) ranked ORDER BY rank_position,ranked.player_id ${sqlLimit(limit)}`,
      [clubId, clubId]
    );
    return ok(res, rows, 200, { category, clubId, rankingScope: 'NATIONAL_TEAM' });
  }
  const scoreColumn = {
    OVERALL: 'overall_score', GOALS: 'goals', GOALKEEPER: 'goalkeeper_score', WEALTH: 'wallet_balance', MARKET_VALUE: 'market_value'
  }[category];
  const rankColumn = clubId ? {
    OVERALL: 'overall_club_rank', GOALS: 'goals_club_rank', GOALKEEPER: 'goalkeeper_club_rank', WEALTH: 'wealth_club_rank', MARKET_VALUE: 'market_value_club_rank'
  }[category] : {
    OVERALL: 'overall_world_rank', GOALS: 'goals_world_rank', GOALKEEPER: 'goalkeeper_world_rank', WEALTH: 'wealth_world_rank', MARKET_VALUE: 'market_value_world_rank'
  }[category];
  const where = ['1=1'];
  const params = [category, clubId];
  if (category === 'GOALKEEPER') where.push(`v.position = 'GK'`);
  if (clubId) { where.push('v.club_id = ?'); params.push(clubId); }
    const rows = await query(
    `SELECT v.player_id, v.full_name, v.position, v.club_id, v.club_name, v.market_value, v.wallet_balance,
            v.appearances, v.goals, v.assists, v.clean_sheets, v.goals_conceded, v.award_points,
            v.overall_score, v.goalkeeper_score,
            COALESCE(snap.rank_position, v.${rankColumn}) AS rank_position,
            snap.previous_rank,
            CASE WHEN snap.previous_rank IS NULL THEN NULL
                 ELSE CAST(snap.previous_rank AS SIGNED) - CAST(snap.rank_position AS SIGNED) END AS rank_change,
            COALESCE(snap.score, v.${scoreColumn}) AS score,
            rb.created_at AS snapshot_at
     FROM v_player_rankings_current v
     LEFT JOIN ranking_snapshot_batches rb
       ON rb.id = (
         SELECT MAX(rb2.id) FROM ranking_snapshot_batches rb2
         WHERE rb2.entity_type = 'PLAYER' AND rb2.category = ?
           AND rb2.club_context_id <=> ?
       )
     LEFT JOIN player_ranking_snapshots snap ON snap.batch_id = rb.id AND snap.player_id = v.player_id
     WHERE ${where.join(' AND ')}
     ORDER BY COALESCE(snap.rank_position, v.${rankColumn}) ASC, v.player_id ASC ${sqlLimit(limit)}`,
    params
  );
  return ok(res, rows, 200, { category, clubId });
});

router.get('/rankings/player-value-changes', async (req, res) => {
  const direction = String(req.query.direction || 'ALL').toUpperCase();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));
  let where = '';
  if (direction === 'UP') where = 'WHERE value_change > 0';
  if (direction === 'DOWN') where = 'WHERE value_change < 0';
  const order = direction === 'DOWN' ? 'value_change ASC' : 'value_change DESC';
  return ok(res, await query(`SELECT * FROM v_player_market_value_changes ${where} ORDER BY ${order} ${sqlLimit(limit)}`));
});

router.get('/clubs/:id/roster-status', optionalAuthenticate, async (req, res) => {
  let clubId = parsePositiveInt(req.params.id);
  if (req.user?.accountType === 'CLUB') clubId = req.user.clubId;
  const club = await first('SELECT id, name, short_name, logo_url FROM clubs WHERE id = ?', [clubId]);
  if (!club) throw new ApiError(404, 'Không tìm thấy CLB.');
  const minimum = await first(
    `SELECT COALESCE(CAST(setting_value AS UNSIGNED), 11) AS minimum_required
     FROM system_settings WHERE setting_key = 'MIN_ACTIVE_CLUB_PLAYERS' LIMIT 1`
  );
  const players = await query(
    `SELECT id, full_name, position, shirt_number, status, photo_url, market_value
     FROM players
     WHERE club_id = ? AND status IN ('ACTIVE','TRANSFER_LISTED')
     ORDER BY position, shirt_number, full_name`,
    [clubId]
  );
  const minimumRequired = Number(minimum?.minimum_required || 11);
  return ok(res, {
    club,
    players,
    active_count: players.length,
    minimum_required: minimumRequired,
    shortage_count: Math.max(minimumRequired - players.length, 0),
    has_warning: players.length < minimumRequired
  });
});

/* ========================================================================== */
/* PLAYERS                                                                     */
/* ========================================================================== */

router.get('/players', optionalAuthenticate, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const search = String(req.query.search || '').trim();
  const position = req.query.position ? parseEnum(req.query.position, PLAYER_POSITIONS, 'position') : null;
  let clubId = req.query.club_id ? parsePositiveInt(req.query.club_id, 'club_id') : null;
  if (req.user?.accountType === 'CLUB') clubId = req.user.clubId;
  const status = req.query.status ? parseEnum(req.query.status, PLAYER_STATUSES, 'status') : null;
  const sort = parseEnum(req.query.sort || 'VALUE_DESC', PLAYER_SORTS, 'sort');
  const where = [];
  const params = [];
  if (search) { where.push('full_name LIKE ?'); params.push(`%${search}%`); }
  if (position) { where.push('position = ?'); params.push(position); }
  if (clubId) { where.push('club_id = ?'); params.push(clubId); }
  if (status) { where.push('status = ?'); params.push(status); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await first(`SELECT COUNT(*) AS total FROM v_player_list ${whereSql}`, params);
  const rows = await query(`SELECT * FROM v_player_list ${whereSql} ORDER BY ${playerOrder(sort)} ${sqlLimit(limit, offset)}`, params);
  return ok(res, rows, 200, { page, limit, total: Number(total.total), sort });
});

router.get('/players/:id', optionalAuthenticate, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const dossier = await first('SELECT * FROM v_player_dossier_summary WHERE player_id = ?', [id]);
  if (!dossier) throw new ApiError(404, 'Không tìm thấy cầu thủ.');
  if (req.user?.accountType === 'CLUB' && dossier.club_id && Number(dossier.club_id) !== req.user.clubId) {
    throw new ApiError(403, 'CLB chỉ được mở hồ sơ quản trị của cầu thủ thuộc CLB mình.');
  }
  const [awards, history, contracts, wallet, valueHistory] = await Promise.all([
    query('SELECT * FROM v_player_award_history WHERE player_id = ? ORDER BY awarded_at DESC', [id]),
    query(`SELECT h.*, c.name AS club_name FROM player_club_history h JOIN clubs c ON c.id = h.club_id WHERE h.player_id = ? ORDER BY h.joined_at DESC`, [id]),
    query(`SELECT pc.*, c.name AS club_name, ss.name AS start_season_name, es.name AS end_season_name
           FROM player_contracts pc JOIN clubs c ON c.id = pc.club_id JOIN seasons ss ON ss.id = pc.start_season_id
           LEFT JOIN seasons es ON es.id = pc.end_season_id WHERE pc.player_id = ? ORDER BY pc.signed_at DESC`, [id]),
    first('SELECT * FROM v_player_wallets WHERE player_id = ?', [id]),
    query('SELECT * FROM player_market_value_history WHERE player_id = ? ORDER BY changed_at DESC', [id])
  ]);
  const privateWallet = req.user?.accountType === 'FIFA_ADMIN' ? wallet : null;
  return ok(res, { dossier, awards, history, contracts, wallet: privateWallet, valueHistory });
});

router.post('/players', authenticate, requireClubOrAdmin, async (req, res) => {
  const fullName = parseText(req.body.full_name, 'full_name', { max: 150 });
  const position = parseEnum(req.body.position, PLAYER_POSITIONS, 'position');
  const shirtNumber = req.body.shirt_number === null || req.body.shirt_number === '' ? null : parsePositiveInt(req.body.shirt_number, 'shirt_number', { min: 1, max: 99 });
  let clubId = req.body.club_id ? parsePositiveInt(req.body.club_id, 'club_id') : null;
  if (req.user.accountType === 'CLUB') clubId = req.user.clubId;
  // Cầu thủ mới luôn bắt đầu từ 0; giá chỉ xuất hiện sau khi có dữ liệu đã xác nhận.
  const marketValue = '0';
  const status = clubId ? 'ACTIVE' : 'FREE_AGENT';
  const photoUrl = parseText(req.body.photo_url, 'photo_url', { required: false, nullable: true, max: 500 });

  const playerId = await transaction(async (connection) => {
    const result = await query(
      `INSERT INTO players(full_name, position, shirt_number, club_id, market_value, status, photo_url)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [fullName, position, shirtNumber, clubId, marketValue, status, photoUrl], connection
    );
    if (clubId) {
      await query(
        `INSERT INTO player_club_history(player_id, club_id, movement_type, note)
         VALUES (?, ?, 'INITIAL', 'Khởi tạo hồ sơ cầu thủ')`,
        [result.insertId, clubId], connection
      );
    }
    if (req.body.contract) {
      if (!clubId) throw new ApiError(400, 'Không thể tạo hợp đồng khi cầu thủ chưa thuộc CLB.');
      const startSeasonId = parsePositiveInt(req.body.contract.start_season_id, 'contract.start_season_id');
      const endSeasonId = req.body.contract.end_season_id ? parsePositiveInt(req.body.contract.end_season_id, 'contract.end_season_id') : null;
      const salary = parseMoney(req.body.contract.salary_per_season, 'contract.salary_per_season');
      await query(
        `INSERT INTO player_contracts(player_id, club_id, start_season_id, end_season_id, salary_per_season, status, note)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        [result.insertId, clubId, startSeasonId, endSeasonId, salary, req.body.contract.note || null], connection
      );
    }
    if (clubId) {
      await syncPlayerIntoOpenCompetitionRosters({
        playerId: result.insertId,
        clubId,
        userId: req.user.id,
        connection
      });
    }
    await audit({ userId: req.user.id, actionCode: 'CREATE_PLAYER', entityTable: 'players', entityId: result.insertId, details: { club_id: clubId, auto_synced_open_competitions: Boolean(clubId) } }, connection);
    return result.insertId;
  });

  return ok(res, await first('SELECT * FROM v_player_list WHERE id = ?', [playerId]), 201);
});

router.patch('/players/:id', authenticate, requireClubOrAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const player = await getPlayer(id);
  if (req.user.accountType === 'CLUB') assertOwner(req, player.club_id);

  const body = {};
  if (req.body.full_name !== undefined) body.full_name = parseText(req.body.full_name, 'full_name', { max: 150 });
  if (req.body.position !== undefined) body.position = parseEnum(req.body.position, PLAYER_POSITIONS, 'position');
  if (req.body.shirt_number !== undefined) body.shirt_number = req.body.shirt_number === null || req.body.shirt_number === '' ? null : parsePositiveInt(req.body.shirt_number, 'shirt_number', { min: 1, max: 99 });
  if (req.body.photo_url !== undefined) body.photo_url = parseText(req.body.photo_url, 'photo_url', { required: false, nullable: true, max: 500 });
  if (req.body.status !== undefined) {
    const status = parseEnum(req.body.status, PLAYER_STATUSES, 'status');
    if (req.user.accountType === 'CLUB' && !['ACTIVE', 'TRANSFER_LISTED', 'SUSPENDED'].includes(status)) {
      throw new ApiError(403, 'CLB không được tự chuyển cầu thủ thành tự do, giải nghệ hoặc đổi CLB.');
    }
    body.status = status;
  }
  const update = buildUpdate(body, ['full_name', 'position', 'shirt_number', 'photo_url', 'status']);
  await query(`UPDATE players SET ${update.sql} WHERE id = ?`, [...update.values, id]);
  if (player.club_id && req.body.status !== undefined) {
    if (['ACTIVE', 'TRANSFER_LISTED'].includes(body.status)) {
      await syncPlayerIntoOpenCompetitionRosters({
        playerId: id,
        clubId: Number(player.club_id),
        userId: req.user.id
      });
    } else {
      await query(
        `UPDATE competition_rosters cr
         JOIN competitions c ON c.id = cr.competition_id
         SET cr.status = 'REMOVED'
         WHERE cr.player_id = ?
           AND c.status NOT IN ('FINISHED','CANCELLED')`,
        [id]
      );
    }
  }
  await audit({ userId: req.user.id, actionCode: 'UPDATE_PLAYER', entityTable: 'players', entityId: id, details: { ...body, roster_sync_applied: req.body.status !== undefined } });
  return ok(res, await first('SELECT * FROM v_player_list WHERE id = ?', [id]));
});

router.post('/players/:id/market-value', authenticate, requireAdmin, async (req, res) => {
  parsePositiveInt(req.params.id);
  throw new ApiError(400, 'Giá cầu thủ được hệ thống định giá tự động. Hãy dùng nút “Làm mới định giá”.');
});

router.post('/players/:id/release', authenticate, requireClubOrAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const reason = parseText(req.body.reason || 'Thanh lý hợp đồng', 'reason', { max: 500 });
  await transaction(async (connection) => {
    const player = await first('SELECT * FROM players WHERE id = ? FOR UPDATE', [id], connection);
    if (!player) throw new ApiError(404, 'Không tìm thấy cầu thủ.');
    if (!player.club_id) throw new ApiError(400, 'Cầu thủ đã là cầu thủ tự do.');
    assertOwner(req, player.club_id);
    await query(`UPDATE player_contracts SET status = 'TERMINATED', ended_at = CURRENT_TIMESTAMP(6), note = CONCAT(COALESCE(note,''), ' | ', ?)
                 WHERE player_id = ? AND status = 'ACTIVE'`, [reason, id], connection);
    await query(`UPDATE player_club_history SET left_at = CURRENT_TIMESTAMP(6), movement_type = 'RELEASE', note = ?
                 WHERE player_id = ? AND club_id = ? AND left_at IS NULL`, [reason, id, player.club_id], connection);
    await query(`UPDATE players SET club_id = NULL, shirt_number = NULL, status = 'FREE_AGENT' WHERE id = ?`, [id], connection);
    await query(
      `UPDATE competition_rosters cr
       JOIN competitions c ON c.id = cr.competition_id
       SET cr.status = 'REMOVED'
       WHERE cr.player_id = ?
         AND c.status NOT IN ('FINISHED','CANCELLED')`,
      [id],
      connection
    );
    await audit({ userId: req.user.id, actionCode: 'RELEASE_PLAYER', entityTable: 'players', entityId: id, details: { old_club_id: player.club_id, reason, removed_from_open_competitions: true } }, connection);
  });
  return ok(res, await first('SELECT * FROM v_player_list WHERE id = ?', [id]));
});

/* ========================================================================== */
/* PLAYER CONTRACTS                                                           */
/* ========================================================================== */

router.get('/players/:id/contracts', authenticate, async (req, res) => {
  const playerId = parsePositiveInt(req.params.id);
  const player = await getPlayer(playerId);
  if (req.user.accountType === 'CLUB') assertOwner(req, player.club_id);
  return ok(res, await query(`SELECT pc.*, c.name AS club_name, ss.name AS start_season_name, es.name AS end_season_name
    FROM player_contracts pc JOIN clubs c ON c.id = pc.club_id JOIN seasons ss ON ss.id = pc.start_season_id
    LEFT JOIN seasons es ON es.id = pc.end_season_id WHERE pc.player_id = ? ORDER BY pc.signed_at DESC`, [playerId]));
});

router.post('/player-contracts', authenticate, requireClubOrAdmin, async (req, res) => {
  const playerId = parsePositiveInt(req.body.player_id, 'player_id');
  let clubId = parsePositiveInt(req.body.club_id, 'club_id');
  if (req.user.accountType === 'CLUB') clubId = assertClubScope(req, clubId);
  const startSeasonId = parsePositiveInt(req.body.start_season_id, 'start_season_id');
  const endSeasonId = req.body.end_season_id ? parsePositiveInt(req.body.end_season_id, 'end_season_id') : null;
  const salary = parseMoney(req.body.salary_per_season, 'salary_per_season');
  const note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 500 });

  const contractId = await transaction(async (connection) => {
    const player = await first('SELECT * FROM players WHERE id = ? FOR UPDATE', [playerId], connection);
    if (!player) throw new ApiError(404, 'Không tìm thấy cầu thủ.');
    assertMarketFloor(salary, player, 'Lương mỗi mùa');
    if (player.club_id && Number(player.club_id) !== clubId) {
      throw new ApiError(400, 'Cầu thủ đang thuộc CLB khác; phải dùng quy trình chuyển nhượng.');
    }
    const result = await query(
      `INSERT INTO player_contracts(player_id, club_id, start_season_id, end_season_id, salary_per_season, status, note)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [playerId, clubId, startSeasonId, endSeasonId, salary, note], connection
    );
    if (!player.club_id) {
      await query(`UPDATE players SET club_id = ?, status = 'ACTIVE' WHERE id = ?`, [clubId, playerId], connection);
      await query(`INSERT INTO player_club_history(player_id, club_id, movement_type, note)
                   VALUES (?, ?, 'FREE_TRANSFER', 'Ký hợp đồng cầu thủ tự do')`, [playerId, clubId], connection);
    }
    await audit({ userId: req.user.id, actionCode: 'CREATE_PLAYER_CONTRACT', entityTable: 'player_contracts', entityId: result.insertId, details: { player_id: playerId, club_id: clubId, salary } }, connection);
    return result.insertId;
  });
  return ok(res, await first('SELECT * FROM player_contracts WHERE id = ?', [contractId]), 201);
});

router.patch('/player-contracts/:id', authenticate, requireClubOrAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const contract = await first(
    `SELECT pc.*,p.market_value,p.full_name FROM player_contracts pc
     JOIN players p ON p.id=pc.player_id WHERE pc.id=?`, [id]
  );
  if (!contract) throw new ApiError(404, 'Không tìm thấy hợp đồng.');
  assertOwner(req, contract.club_id);
  const body = {};
  if (req.body.salary_per_season !== undefined) {
    body.salary_per_season = parseMoney(req.body.salary_per_season, 'salary_per_season');
    assertMarketFloor(body.salary_per_season, contract, 'Lương mỗi mùa');
  }
  if (req.body.end_season_id !== undefined) body.end_season_id = req.body.end_season_id ? parsePositiveInt(req.body.end_season_id, 'end_season_id') : null;
  if (req.body.note !== undefined) body.note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 500 });
  if (req.body.status !== undefined) {
    const status = parseEnum(req.body.status, CONTRACT_STATUSES, 'status');
    if (req.user.accountType === 'CLUB' && status === 'EXPIRED') throw new ApiError(403, 'Trạng thái hết hạn do hệ thống hoặc Admin xử lý.');
    body.status = status;
    if (status !== 'ACTIVE') body.ended_at = new Date();
  }
  const update = buildUpdate(body, ['salary_per_season', 'end_season_id', 'note', 'status', 'ended_at']);
  await query(`UPDATE player_contracts SET ${update.sql} WHERE id = ?`, [...update.values, id]);
  await audit({ userId: req.user.id, actionCode: 'UPDATE_PLAYER_CONTRACT', entityTable: 'player_contracts', entityId: id, details: body });
  return ok(res, await first('SELECT * FROM player_contracts WHERE id = ?', [id]));
});

/* ========================================================================== */
/* COACHING STAFF AND STAFF CONTRACTS                                          */
/* ========================================================================== */

router.get('/staff', authenticate, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  let clubId = req.query.club_id ? parsePositiveInt(req.query.club_id, 'club_id') : null;
  if (req.user.accountType === 'CLUB') clubId = req.user.clubId;
  const where = clubId ? 'WHERE s.club_id = ?' : '';
  const params = clubId ? [clubId] : [];
  const total = await first(`SELECT COUNT(*) AS total FROM coaching_staff s ${where}`, params);
  const rows = await query(
    `SELECT s.*, c.name AS club_name, w.balance AS wallet_balance,
            COALESCE(sc.salary_per_season,0) AS salary_per_season
     FROM coaching_staff s LEFT JOIN clubs c ON c.id = s.club_id
     LEFT JOIN wallets w ON w.staff_id = s.id AND w.wallet_type = 'STAFF'
     LEFT JOIN staff_contracts sc ON sc.staff_id = s.id AND sc.status = 'ACTIVE'
     ${where} ORDER BY s.full_name ${sqlLimit(limit, offset)}`, params
  );
  return ok(res, rows, 200, { page, limit, total: Number(total.total) });
});

router.post('/staff', authenticate, requireClubOrAdmin, async (req, res) => {
  const fullName = parseText(req.body.full_name, 'full_name', { max: 150 });
  const role = parseText(req.body.staff_role, 'staff_role', { max: 100 });
  let clubId = req.body.club_id ? parsePositiveInt(req.body.club_id, 'club_id') : null;
  if (req.user.accountType === 'CLUB') clubId = req.user.clubId;
  const status = clubId ? 'ACTIVE' : 'FREE_AGENT';
  const id = await transaction(async (connection) => {
    const result = await query(`INSERT INTO coaching_staff(full_name, staff_role, club_id, status) VALUES (?, ?, ?, ?)`, [fullName, role, clubId, status], connection);
    if (req.body.contract) {
      if (!clubId) throw new ApiError(400, 'Không thể tạo hợp đồng khi nhân sự chưa thuộc CLB.');
      await query(
        `INSERT INTO staff_contracts(staff_id, club_id, start_season_id, end_season_id, salary_per_season, status, note)
         VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
        [result.insertId, clubId,
          parsePositiveInt(req.body.contract.start_season_id, 'contract.start_season_id'),
          req.body.contract.end_season_id ? parsePositiveInt(req.body.contract.end_season_id, 'contract.end_season_id') : null,
          parseMoney(req.body.contract.salary_per_season, 'contract.salary_per_season'),
          req.body.contract.note || null], connection
      );
    }
    await audit({ userId: req.user.id, actionCode: 'CREATE_STAFF', entityTable: 'coaching_staff', entityId: result.insertId, details: { club_id: clubId } }, connection);
    return result.insertId;
  });
  return ok(res, await first('SELECT * FROM coaching_staff WHERE id = ?', [id]), 201);
});

router.patch('/staff/:id', authenticate, requireClubOrAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const staff = await getStaff(id);
  assertOwner(req, staff.club_id);
  const body = {};
  if (req.body.full_name !== undefined) body.full_name = parseText(req.body.full_name, 'full_name', { max: 150 });
  if (req.body.staff_role !== undefined) body.staff_role = parseText(req.body.staff_role, 'staff_role', { max: 100 });
  if (req.body.status !== undefined) body.status = parseEnum(req.body.status, STAFF_STATUSES, 'status');
  const update = buildUpdate(body, ['full_name', 'staff_role', 'status']);
  await query(`UPDATE coaching_staff SET ${update.sql} WHERE id = ?`, [...update.values, id]);
  await audit({ userId: req.user.id, actionCode: 'UPDATE_STAFF', entityTable: 'coaching_staff', entityId: id, details: body });
  return ok(res, await first('SELECT * FROM coaching_staff WHERE id = ?', [id]));
});

router.post('/staff-contracts', authenticate, requireClubOrAdmin, async (req, res) => {
  const staffId = parsePositiveInt(req.body.staff_id, 'staff_id');
  let clubId = parsePositiveInt(req.body.club_id, 'club_id');
  if (req.user.accountType === 'CLUB') clubId = assertClubScope(req, clubId);
  const staff = await getStaff(staffId);
  if (staff.club_id && Number(staff.club_id) !== clubId) throw new ApiError(400, 'Nhân sự đang thuộc CLB khác.');
  const result = await transaction(async (connection) => {
    const inserted = await query(
      `INSERT INTO staff_contracts(staff_id, club_id, start_season_id, end_season_id, salary_per_season, status, note)
       VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [staffId, clubId, parsePositiveInt(req.body.start_season_id, 'start_season_id'),
        req.body.end_season_id ? parsePositiveInt(req.body.end_season_id, 'end_season_id') : null,
        parseMoney(req.body.salary_per_season, 'salary_per_season'), req.body.note || null], connection
    );
    if (!staff.club_id) await query(`UPDATE coaching_staff SET club_id = ?, status = 'ACTIVE' WHERE id = ?`, [clubId, staffId], connection);
    await audit({ userId: req.user.id, actionCode: 'CREATE_STAFF_CONTRACT', entityTable: 'staff_contracts', entityId: inserted.insertId }, connection);
    return inserted.insertId;
  });
  return ok(res, await first('SELECT * FROM staff_contracts WHERE id = ?', [result]), 201);
});

router.patch('/staff-contracts/:id', authenticate, requireClubOrAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const contract = await first('SELECT * FROM staff_contracts WHERE id = ?', [id]);
  if (!contract) throw new ApiError(404, 'Không tìm thấy hợp đồng ban huấn luyện.');
  assertOwner(req, contract.club_id);
  const body = {};
  if (req.body.salary_per_season !== undefined) body.salary_per_season = parseMoney(req.body.salary_per_season, 'salary_per_season');
  if (req.body.end_season_id !== undefined) body.end_season_id = req.body.end_season_id ? parsePositiveInt(req.body.end_season_id, 'end_season_id') : null;
  if (req.body.note !== undefined) body.note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 500 });
  if (req.body.status !== undefined) body.status = parseEnum(req.body.status, CONTRACT_STATUSES, 'status');
  const update = buildUpdate(body, ['salary_per_season', 'end_season_id', 'note', 'status']);
  await query(`UPDATE staff_contracts SET ${update.sql} WHERE id = ?`, [...update.values, id]);
  await audit({ userId: req.user.id, actionCode: 'UPDATE_STAFF_CONTRACT', entityTable: 'staff_contracts', entityId: id, details: body });
  return ok(res, await first('SELECT * FROM staff_contracts WHERE id = ?', [id]));
});

/* ========================================================================== */
/* TRANSFERS                                                                   */
/* ========================================================================== */

router.get('/transfer-offers', authenticate, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = [];
  const params = [];
  if (req.user.accountType === 'CLUB') {
    where.push('(t.seller_club_id = ? OR t.buyer_club_id = ?)');
    params.push(req.user.clubId, req.user.clubId);
  }
  if (req.query.status) { where.push('t.status = ?'); params.push(parseEnum(req.query.status, TRANSFER_STATUSES, 'status')); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await first(`SELECT COUNT(*) AS total FROM transfer_offers t ${whereSql}`, params);
  const rows = await query(
    `SELECT t.*, p.full_name AS player_name, sc.name AS seller_club_name, bc.name AS buyer_club_name,
            ss.name AS start_season_name, es.name AS end_season_name
     FROM transfer_offers t JOIN players p ON p.id = t.player_id
     LEFT JOIN clubs sc ON sc.id = t.seller_club_id JOIN clubs bc ON bc.id = t.buyer_club_id
     JOIN seasons ss ON ss.id = t.contract_start_season_id LEFT JOIN seasons es ON es.id = t.contract_end_season_id
     ${whereSql} ORDER BY t.id DESC ${sqlLimit(limit, offset)}`, params
  );
  return ok(res, rows, 200, { page, limit, total: Number(total.total) });
});

router.post('/transfer-offers', authenticate, requireClubOrAdmin, async (req, res) => {
  const playerId = parsePositiveInt(req.body.player_id, 'player_id');
  const player = await getPlayer(playerId);
  const transferType = parseEnum(req.body.transfer_type, TRANSFER_TYPES, 'transfer_type');
  let buyerClubId = parsePositiveInt(req.body.buyer_club_id, 'buyer_club_id');
  if (req.user.accountType === 'CLUB') buyerClubId = req.user.clubId;
  const sellerClubId = transferType === 'FREE' ? null : Number(player.club_id || 0) || null;
  if (transferType === 'PAID' && !sellerClubId) throw new ApiError(400, 'Chuyển nhượng có phí yêu cầu cầu thủ đang thuộc một CLB.');
  if (transferType === 'FREE' && player.club_id) throw new ApiError(400, 'Cầu thủ đang thuộc CLB; phải thanh lý hoặc dùng chuyển nhượng có phí.');
  const transferFee = transferType === 'FREE' ? '0' : parseMoney(req.body.transfer_fee, 'transfer_fee');
  const salary = parseMoney(req.body.new_salary_per_season, 'new_salary_per_season');
  assertMarketFloor(salary, player, 'Lương mới mỗi mùa');
  if (transferType === 'PAID') assertMarketFloor(transferFee, player, 'Phí chuyển nhượng');
  const startSeasonId = parsePositiveInt(req.body.contract_start_season_id, 'contract_start_season_id');
  const endSeasonId = req.body.contract_end_season_id ? parsePositiveInt(req.body.contract_end_season_id, 'contract_end_season_id') : null;
  const status = req.user.accountType === 'CLUB' ? 'SENT' : parseEnum(req.body.status || 'SENT', TRANSFER_STATUSES, 'status');
  const note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 500 });
  const result = await query(
    `INSERT INTO transfer_offers(player_id, seller_club_id, buyer_club_id, transfer_type, transfer_fee,
      new_salary_per_season, contract_start_season_id, contract_end_season_id, status, created_by_user_id, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [playerId, sellerClubId, buyerClubId, transferType, transferFee, salary, startSeasonId, endSeasonId, status, req.user.id, note]
  );
  await audit({ userId: req.user.id, actionCode: 'CREATE_TRANSFER_OFFER', entityTable: 'transfer_offers', entityId: result.insertId, details: { player_id: playerId, buyer_club_id: buyerClubId } });
  return ok(res, await first('SELECT * FROM transfer_offers WHERE id = ?', [result.insertId]), 201);
});

router.patch('/transfer-offers/:id/status', authenticate, requireClubOrAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const status = parseEnum(req.body.status, ['ACCEPTED', 'REJECTED', 'CANCELLED'], 'status');
  const offer = await first('SELECT * FROM transfer_offers WHERE id = ?', [id]);
  if (!offer) throw new ApiError(404, 'Không tìm thấy đề nghị chuyển nhượng.');
  if (req.user.accountType === 'CLUB') {
    const isSeller = offer.seller_club_id && Number(offer.seller_club_id) === req.user.clubId;
    const isBuyer = Number(offer.buyer_club_id) === req.user.clubId;
    if (['ACCEPTED', 'REJECTED'].includes(status) && !isSeller && offer.transfer_type !== 'FREE') throw new ApiError(403, 'Chỉ CLB bán được chấp nhận hoặc từ chối.');
    if (offer.transfer_type === 'FREE' && ['ACCEPTED', 'REJECTED'].includes(status) && !isBuyer) throw new ApiError(403, 'Không có quyền xử lý đề nghị này.');
    if (status === 'CANCELLED' && !isBuyer) throw new ApiError(403, 'Chỉ CLB mua được hủy đề nghị.');
  }
  if (!['DRAFT', 'SENT', 'ACCEPTED'].includes(offer.status)) throw new ApiError(400, 'Đề nghị không còn ở trạng thái có thể thay đổi.');
  await query(`UPDATE transfer_offers SET status = ?, accepted_at = IF(? = 'ACCEPTED', CURRENT_TIMESTAMP(6), accepted_at) WHERE id = ?`, [status, status, id]);
  await audit({ userId: req.user.id, actionCode: 'SET_TRANSFER_OFFER_STATUS', entityTable: 'transfer_offers', entityId: id, details: { status } });
  return ok(res, await first('SELECT * FROM transfer_offers WHERE id = ?', [id]));
});

router.post('/transfer-offers/:id/complete', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const offer = await first(
    `SELECT t.player_id,t.seller_club_id,t.buyer_club_id,t.transfer_type,t.transfer_fee,
            t.new_salary_per_season,p.market_value,p.full_name
     FROM transfer_offers t JOIN players p ON p.id=t.player_id WHERE t.id=?`,
    [id]
  );
  if (!offer) throw new ApiError(404, 'Không tìm thấy đề nghị chuyển nhượng.');
  assertMarketFloor(offer.new_salary_per_season, offer, 'Lương mới mỗi mùa');
  if (offer.transfer_type === 'PAID') assertMarketFloor(offer.transfer_fee, offer, 'Phí chuyển nhượng');

  const resultSets = await callProcedure('sp_complete_transfer', [id, req.user.id]);

  await query(
    `UPDATE competition_rosters cr
     JOIN competitions c ON c.id = cr.competition_id
     SET cr.status = 'REMOVED'
     WHERE cr.player_id = ?
       AND cr.club_id <> ?
       AND c.status NOT IN ('FINISHED','CANCELLED')`,
    [offer.player_id, offer.buyer_club_id]
  );

  await syncPlayerIntoOpenCompetitionRosters({
    playerId: Number(offer.player_id),
    clubId: Number(offer.buyer_club_id),
    userId: req.user.id
  });

  return ok(res, {
    message: 'Đã hoàn tất chuyển nhượng, cập nhật ví, hợp đồng, lịch sử CLB và đồng bộ đội hình các giải đang mở.',
    resultSets
  });
});

router.get('/transfers/history', optionalAuthenticate, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const where = [];
  const params = [];
  if (req.user?.accountType === 'CLUB') {
    where.push('(pt.from_club_id = ? OR pt.to_club_id = ?)');
    params.push(req.user.clubId, req.user.clubId);
  }
  if (req.query.player_id) { where.push('pt.player_id = ?'); params.push(parsePositiveInt(req.query.player_id, 'player_id')); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await first(`SELECT COUNT(*) AS total FROM player_transfers pt ${whereSql}`, params);
  const rows = await query(
    `SELECT pt.*, p.full_name AS player_name, fc.name AS from_club_name, tc.name AS to_club_name
     FROM player_transfers pt JOIN players p ON p.id = pt.player_id
     LEFT JOIN clubs fc ON fc.id = pt.from_club_id JOIN clubs tc ON tc.id = pt.to_club_id
     ${whereSql} ORDER BY pt.completed_at DESC ${sqlLimit(limit, offset)}`, params
  );
  return ok(res, rows, 200, { page, limit, total: Number(total.total) });
});

/* ========================================================================== */
/* PLAYER MATCH STATISTICS                                                     */
/* ========================================================================== */

router.get('/matches/:matchId/player-stats', optionalAuthenticate, async (req, res) => {
  const matchId = parsePositiveInt(req.params.matchId, 'matchId');
  return ok(res, await query(
    `SELECT pms.*, p.full_name, p.position, p.shirt_number, c.name AS club_name
     FROM player_match_stats pms JOIN players p ON p.id = pms.player_id JOIN clubs c ON c.id = pms.club_id
     WHERE pms.match_id = ? ORDER BY c.name, p.shirt_number, p.full_name`, [matchId]
  ));
});

router.put('/matches/:matchId/player-stats/:playerId', authenticate, requireClubOrAdmin, async (req, res) => {
  const matchId = parsePositiveInt(req.params.matchId, 'matchId');
  const playerId = parsePositiveInt(req.params.playerId, 'playerId');
  const [match, player] = await Promise.all([first('SELECT * FROM matches WHERE id = ?', [matchId]), getPlayer(playerId)]);
  if (!match) throw new ApiError(404, 'Không tìm thấy trận đấu.');
  const clubId = parsePositiveInt(req.body.club_id || player.club_id, 'club_id');
  if (![Number(match.home_club_id), Number(match.away_club_id)].includes(clubId)) throw new ApiError(400, 'CLB không tham gia trận đấu này.');
  if (Number(player.club_id) !== clubId) throw new ApiError(400, 'Cầu thủ không thuộc CLB đã chọn.');
  assertOwner(req, clubId);

  const appeared = parseBoolean(req.body.appeared, true);
  const minutesPlayed = appeared ? parsePositiveInt(req.body.minutes_played ?? 90, 'minutes_played', { min: 1, max: 130 }) : 0;
  const goals = parsePositiveInt(req.body.goals ?? 0, 'goals', { min: 0, max: 100 });
  const assists = parsePositiveInt(req.body.assists ?? 0, 'assists', { min: 0, max: 100 });
  const shotsOnTarget = parsePositiveInt(req.body.shots_on_target ?? 0, 'shots_on_target', { min: 0, max: 100 });
  const keyPasses = parsePositiveInt(req.body.key_passes ?? 0, 'key_passes', { min: 0, max: 100 });
  const tacklesWon = parsePositiveInt(req.body.tackles_won ?? 0, 'tackles_won', { min: 0, max: 100 });
  const interceptions = parsePositiveInt(req.body.interceptions ?? 0, 'interceptions', { min: 0, max: 100 });
  const saves = parsePositiveInt(req.body.saves ?? 0, 'saves', { min: 0, max: 100 });
  const penaltiesSaved = parsePositiveInt(req.body.penalties_saved ?? 0, 'penalties_saved', { min: 0, max: 20 });
  const ownGoals = parsePositiveInt(req.body.own_goals ?? 0, 'own_goals', { min: 0, max: 20 });
  const defensivePosition = ['GK', 'DF'].includes(player.position);
  const opponentScore = Number(clubId) === Number(match.home_club_id)
    ? Number(match.away_score ?? 0)
    : Number(match.home_score ?? 0);
  const cleanSheet = match.status === 'FINISHED' && defensivePosition && appeared
    ? opponentScore === 0
    : parseBoolean(req.body.clean_sheet, false);
  const goalsConceded = match.status === 'FINISHED' && defensivePosition && appeared
    ? opponentScore
    : parsePositiveInt(req.body.goals_conceded ?? 0, 'goals_conceded', { min: 0, max: 100 });
  const yellowCards = parsePositiveInt(req.body.yellow_cards ?? 0, 'yellow_cards', { min: 0, max: 10 });
  const redCards = parsePositiveInt(req.body.red_cards ?? 0, 'red_cards', { min: 0, max: 10 });
  const verificationStatus = req.user.accountType === 'FIFA_ADMIN'
    ? parseEnum(req.body.verification_status || 'VERIFIED', ['PENDING', 'VERIFIED', 'LOCKED'], 'verification_status')
    : 'PENDING';

  await query(
    `INSERT INTO player_match_stats(match_id, player_id, club_id, appeared, minutes_played, goals, assists,
      shots_on_target, key_passes, tackles_won, interceptions, saves, penalties_saved, own_goals, clean_sheet,
      goals_conceded, yellow_cards, red_cards, entered_by_user_id, verified_by_user_id, verification_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE club_id = VALUES(club_id), appeared = VALUES(appeared), minutes_played=VALUES(minutes_played),
       goals = VALUES(goals), assists = VALUES(assists), shots_on_target=VALUES(shots_on_target), key_passes=VALUES(key_passes),
       tackles_won=VALUES(tackles_won), interceptions=VALUES(interceptions), saves=VALUES(saves),
       penalties_saved=VALUES(penalties_saved), own_goals=VALUES(own_goals), clean_sheet = VALUES(clean_sheet),
       goals_conceded = VALUES(goals_conceded), yellow_cards = VALUES(yellow_cards), red_cards = VALUES(red_cards),
       entered_by_user_id = VALUES(entered_by_user_id), verified_by_user_id = VALUES(verified_by_user_id),
       verification_status = VALUES(verification_status)`,
    [matchId, playerId, clubId, appeared, minutesPlayed, goals, assists, shotsOnTarget, keyPasses, tacklesWon,
      interceptions, saves, penaltiesSaved, ownGoals, cleanSheet, goalsConceded, yellowCards, redCards,
      req.user.id, req.user.accountType === 'FIFA_ADMIN' ? req.user.id : null, verificationStatus]
  );

  let ratingUpdate = null;
  if (req.user.accountType === 'FIFA_ADMIN' && match.status === 'FINISHED' && ['VERIFIED', 'LOCKED'].includes(verificationStatus)) {
    try {
      const finalized = await finalizeMatchRatings(matchId, req.user.id, { allowIncomplete: false });
      ratingUpdate = {
        finalized: true,
        player_count: finalized.finalized.length,
        match_mvp: finalized.match_mvp ? { player_id: Number(finalized.match_mvp.player_id), full_name: finalized.match_mvp.full_name, rating: finalized.match_mvp.rating } : null
      };
    } catch (error) {
      ratingUpdate = { finalized: false, pending_reason: error.message };
    }
  }
  const saved = await first('SELECT * FROM player_match_stats WHERE match_id = ? AND player_id = ?', [matchId, playerId]);
  return ok(res, { ...saved, rating_update: ratingUpdate });
});

router.post('/player-match-stats/:id/verify', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const status = parseEnum(req.body.status || 'VERIFIED', ['VERIFIED', 'LOCKED'], 'status');
  const result = await query(`UPDATE player_match_stats SET verification_status = ?, verified_by_user_id = ? WHERE id = ? AND verification_status <> 'LOCKED'`, [status, req.user.id, id]);
  if (!result.affectedRows) throw new ApiError(404, 'Không tìm thấy thống kê hoặc thống kê đã bị khóa.');
  await audit({ userId: req.user.id, actionCode: 'VERIFY_PLAYER_MATCH_STATS', entityTable: 'player_match_stats', entityId: id, details: { status } });
  const saved = await first('SELECT * FROM player_match_stats WHERE id = ?', [id]);
  let ratingUpdate = null;
  try {
    const finalized = await finalizeMatchRatings(Number(saved.match_id), req.user.id, { allowIncomplete: false });
    ratingUpdate = { finalized: true, player_count: finalized.finalized.length };
  } catch (error) {
    ratingUpdate = { finalized: false, pending_reason: error.message };
  }
  return ok(res, { ...saved, rating_update: ratingUpdate });
});


/* ========================================================================== */
/* HONOURS TABLES - MEDALS AND HISTORICAL ACHIEVEMENTS                         */
/* ========================================================================== */

router.get('/honours/players', async (req, res) => {
  const seasonId = req.query.season_id ? parsePositiveInt(req.query.season_id, 'season_id') : null;
  const scope = parseEnum(req.query.scope || 'ALL', ['ALL', 'CLUB', 'NATIONAL_TEAM'], 'scope');
  const limit = Math.min(300, Math.max(1, Number.parseInt(req.query.limit || '100', 10) || 100));
  const rows = await query(
    `SELECT ranked.*,
            DENSE_RANK() OVER (
              ORDER BY ranked.gold_count DESC, ranked.silver_count DESC, ranked.bronze_count DESC,
                       ranked.individual_award_count DESC, ranked.honour_points DESC, ranked.total_awards DESC
            ) AS rank_position
     FROM (
       SELECT p.id AS player_id, p.full_name, p.photo_url, p.position, p.shirt_number,
              p.club_id, current_club.name AS current_club_name,
              SUM(at.required_medal_type = 'GOLD') AS gold_count,
              SUM(at.required_medal_type = 'SILVER') AS silver_count,
              SUM(at.required_medal_type = 'BRONZE') AS bronze_count,
              SUM(at.category <> 'TEAM_MEDAL') AS individual_award_count,
              COUNT(*) AS total_awards,
              COALESCE(SUM(pa.awarded_points), 0) AS honour_points,
              GROUP_CONCAT(
                CASE WHEN at.required_medal_type <> 'NONE' THEN
                  CONCAT(
                    CASE at.required_medal_type WHEN 'GOLD' THEN 'HCV' WHEN 'SILVER' THEN 'HCB' ELSE 'HCĐ' END,
                    ' ', comp.name, ' ', season.name, ' (', COALESCE(pa.country_name_at_award, award_club.short_name), ')'
                  ) END
                ORDER BY pa.awarded_at DESC SEPARATOR ' • '
              ) AS medal_history
       FROM player_awards pa
       JOIN players p ON p.id = pa.player_id
       JOIN award_types at ON at.id = pa.award_type_id
       LEFT JOIN clubs award_club ON award_club.id = pa.club_id_at_award
       JOIN competitions comp ON comp.id = pa.competition_id
       JOIN seasons season ON season.id = pa.season_id
       LEFT JOIN clubs current_club ON current_club.id = p.club_id
       WHERE (? IS NULL OR pa.season_id = ?)
         AND (?='ALL' OR pa.award_context_type=?)
       GROUP BY p.id, p.full_name, p.photo_url, p.position, p.shirt_number, p.club_id, current_club.name
     ) ranked
     ORDER BY rank_position, ranked.full_name ${sqlLimit(limit)}`,
    [seasonId, seasonId, scope, scope]
  );
  return ok(res, rows, 200, { scope, seasonId });
});

router.get('/honours/clubs', async (req, res) => {
  const seasonId = req.query.season_id ? parsePositiveInt(req.query.season_id, 'season_id') : null;
  const limit = Math.min(300, Math.max(1, Number.parseInt(req.query.limit || '100', 10) || 100));
  const rows = await query(
    `SELECT ranked.*,
            DENSE_RANK() OVER (
              ORDER BY ranked.gold_count DESC, ranked.silver_count DESC, ranked.bronze_count DESC,
                       ranked.quarterfinal_count DESC, ranked.honour_points DESC, ranked.total_achievements DESC
            ) AS rank_position
     FROM (
       SELECT c.id AS club_id, c.code, c.name AS club_name, c.short_name, c.logo_url,
              SUM(ca.medal_type = 'GOLD') AS gold_count,
              SUM(ca.medal_type = 'SILVER') AS silver_count,
              SUM(ca.medal_type = 'BRONZE') AS bronze_count,
              SUM(LOWER(ca.achievement_name) LIKE '%tứ kết%' OR (ca.placement BETWEEN 5 AND 8)) AS quarterfinal_count,
              SUM(LOWER(ca.achievement_name) LIKE '%vòng 16%' OR (ca.placement BETWEEN 9 AND 16)) AS round_of_16_count,
              COUNT(*) AS total_achievements,
              COALESCE(SUM(ca.awarded_points), 0) AS honour_points,
              COALESCE(SUM(ca.prize_amount), 0) AS total_prize_amount,
              GROUP_CONCAT(
                CONCAT(ca.achievement_name, ' · ', season.name)
                ORDER BY ca.awarded_at DESC SEPARATOR ' • '
              ) AS achievement_history
       FROM club_achievements ca
       JOIN clubs c ON c.id = ca.club_id
       JOIN seasons season ON season.id = ca.season_id
       WHERE (? IS NULL OR ca.season_id = ?)
       GROUP BY c.id, c.code, c.name, c.short_name, c.logo_url
     ) ranked
     ORDER BY rank_position, ranked.club_name ${sqlLimit(limit)}`,
    [seasonId, seasonId]
  );
  return ok(res, rows);
});

/* ========================================================================== */
/* SMART AUTOMATIC INDIVIDUAL AWARDS                                           */
/* ========================================================================== */

router.get('/competitions/:id/auto-awards/preview', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id, 'competitionId');
  return ok(res, await previewCompetitionAwards(competitionId));
});

router.post('/competitions/:id/auto-awards/finalize', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id, 'competitionId');
  const result = await finalizeCompetitionAwards(competitionId, req.user.id, {
    allowIncomplete: parseBoolean(req.body?.allow_incomplete, false)
  });
  return ok(res, {
    message: result.assigned.length
      ? `Đã tự động trao ${result.assigned.length} danh hiệu cá nhân và cộng điểm BXH.`
      : 'Chưa có danh hiệu nào đủ điều kiện để trao.',
    ...result
  });
});

router.get('/award-auto-rules', authenticate, requireAdmin, async (_req, res) => {
  return ok(res, await query(
    `SELECT ar.*, atp.code AS award_code, atp.name AS award_name,
            atp.base_ranking_points
     FROM award_auto_rules ar JOIN award_types atp ON atp.id=ar.award_type_id
     ORDER BY atp.name`
  ));
});

router.patch('/award-auto-rules/:awardTypeId', authenticate, requireAdmin, async (req, res) => {
  const awardTypeId = parsePositiveInt(req.params.awardTypeId, 'awardTypeId');
  const fields = {};
  if (req.body.metric_code !== undefined) fields.metric_code = parseEnum(req.body.metric_code, ['OVERALL','GOALS','ASSISTS','CLEAN_SHEETS','GOALKEEPER'], 'metric_code');
  if (req.body.position_filter !== undefined) fields.position_filter = parseEnum(req.body.position_filter, ['ANY','GK','DF','MF','FW'], 'position_filter');
  if (req.body.min_appearances !== undefined) fields.min_appearances = parsePositiveInt(req.body.min_appearances, 'min_appearances', { max: 999 });
  if (req.body.auto_enabled !== undefined) fields.auto_enabled = parseBoolean(req.body.auto_enabled);
  if (req.body.explanation !== undefined) fields.explanation = parseText(req.body.explanation, 'explanation', { max: 500 });
  const update = buildUpdate(fields, ['metric_code','position_filter','min_appearances','auto_enabled','explanation']);
  await query(`UPDATE award_auto_rules SET ${update.sql} WHERE award_type_id=?`, [...update.values, awardTypeId]);
  return ok(res, await first(
    `SELECT ar.*, atp.code AS award_code, atp.name AS award_name, atp.base_ranking_points
     FROM award_auto_rules ar JOIN award_types atp ON atp.id=ar.award_type_id
     WHERE ar.award_type_id=?`, [awardTypeId]
  ));
});

/* ========================================================================== */
/* AWARDS AND RANKING SNAPSHOTS                                                */
/* ========================================================================== */

router.get('/award-types', async (_req, res) => {
  return ok(res, await query('SELECT * FROM award_types ORDER BY category, name'));
});

router.post('/award-types', authenticate, requireAdmin, async (req, res) => {
  const code = parseText(req.body.code, 'code', { max: 50 }).toUpperCase();
  const name = parseText(req.body.name, 'name', { max: 150 });
  const category = parseEnum(req.body.category, AWARD_CATEGORIES, 'category');
  const medal = parseEnum(req.body.required_medal_type || 'NONE', MEDAL_TYPES, 'required_medal_type');
  const points = parseDecimal(req.body.base_ranking_points || 0, 'base_ranking_points', { min: 0 });
  const result = await query(`INSERT INTO award_types(code, name, category, required_medal_type, base_ranking_points, is_active)
    VALUES (?, ?, ?, ?, ?, TRUE)`, [code, name, category, medal, points]);
  return ok(res, await first('SELECT * FROM award_types WHERE id = ?', [result.insertId]), 201);
});

router.patch('/award-types/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id);
  const body = {};
  if (req.body.name !== undefined) body.name = parseText(req.body.name, 'name', { max: 150 });
  if (req.body.category !== undefined) body.category = parseEnum(req.body.category, AWARD_CATEGORIES, 'category');
  if (req.body.required_medal_type !== undefined) body.required_medal_type = parseEnum(req.body.required_medal_type, MEDAL_TYPES, 'required_medal_type');
  if (req.body.base_ranking_points !== undefined) body.base_ranking_points = parseDecimal(req.body.base_ranking_points, 'base_ranking_points', { min: 0 });
  if (req.body.is_active !== undefined) body.is_active = parseBoolean(req.body.is_active);
  const update = buildUpdate(body, ['name', 'category', 'required_medal_type', 'base_ranking_points', 'is_active']);
  await query(`UPDATE award_types SET ${update.sql} WHERE id = ?`, [...update.values, id]);
  return ok(res, await first('SELECT * FROM award_types WHERE id = ?', [id]));
});

router.post('/player-awards', authenticate, requireAdmin, async (req, res) => {
  const playerId = parsePositiveInt(req.body.player_id, 'player_id');
  let clubId = parsePositiveInt(req.body.club_id_at_award, 'club_id_at_award');
  if (req.user.accountType === 'CLUB') clubId = assertClubScope(req, clubId);
  const competitionId = parsePositiveInt(req.body.competition_id, 'competition_id');
  const awardTypeId = parsePositiveInt(req.body.award_type_id, 'award_type_id');
  await callProcedure('sp_assign_player_award', [playerId, clubId, competitionId, awardTypeId, req.user.id]);
  return ok(res, await first(`SELECT * FROM v_player_award_history WHERE player_id = ? AND competition_id = ? AND award_code = (SELECT code FROM award_types WHERE id = ?)`, [playerId, competitionId, awardTypeId]), 201);
});

router.get('/club-achievements', optionalAuthenticate, async (req, res) => {
  let clubId = req.query.club_id ? parsePositiveInt(req.query.club_id, 'club_id') : null;
  if (req.user?.accountType === 'CLUB') clubId = req.user.clubId;
  const where = clubId ? 'WHERE ca.club_id = ?' : '';
  const params = clubId ? [clubId] : [];
  return ok(res, await query(
    `SELECT ca.*, c.name AS club_name, comp.name AS competition_name, s.name AS season_name
     FROM club_achievements ca JOIN clubs c ON c.id = ca.club_id JOIN competitions comp ON comp.id = ca.competition_id
     JOIN seasons s ON s.id = ca.season_id ${where} ORDER BY ca.awarded_at DESC`, params
  ));
});

router.post('/rankings/snapshot', authenticate, requireAdmin, async (req, res) => {
  const seasonId = parsePositiveInt(req.body.season_id, 'season_id');
  const entity = parseEnum(req.body.entity || 'ALL', ['ALL', 'CLUB', 'PLAYER'], 'entity');
  const clubId = req.body.club_id ? parsePositiveInt(req.body.club_id, 'club_id') : null;
  const category = req.body.category ? parseEnum(req.body.category, SNAPSHOT_RANKING_CATEGORIES, 'category') : null;
  if (clubId && entity !== 'PLAYER') throw new ApiError(400, 'club_id chỉ áp dụng khi entity = PLAYER.');

  if (entity === 'ALL' || entity === 'CLUB') await callProcedure('sp_snapshot_club_rankings', [seasonId]);
  if (entity === 'ALL' || entity === 'PLAYER') {
    if (!clubId && !category) {
      await callProcedure('sp_snapshot_all_player_rankings', [seasonId]);
    } else if (category) {
      await callProcedure('sp_snapshot_player_category', [seasonId, category, clubId]);
    } else {
      for (const item of SNAPSHOT_RANKING_CATEGORIES) {
        await callProcedure('sp_snapshot_player_category', [seasonId, item, clubId]);
      }
    }
  }
  return ok(res, { message: 'Đã tạo ảnh chụp bảng xếp hạng để tính mũi tên tăng/giảm.', seasonId, entity, clubId, category });
});

router.post('/ranking-points/clubs', authenticate, requireAdmin, async (req, res) => {
  const clubId = parsePositiveInt(req.body.club_id, 'club_id');
  const seasonId = parsePositiveInt(req.body.season_id, 'season_id');
  const competitionId = req.body.competition_id ? parsePositiveInt(req.body.competition_id, 'competition_id') : null;
  const points = parseDecimal(req.body.points, 'points');
  const sourceType = parseEnum(req.body.source_type || 'ADMIN_ADJUSTMENT', ['BONUS', 'PENALTY', 'ADMIN_ADJUSTMENT'], 'source_type');
  const description = parseText(req.body.description, 'description', { max: 500 });
  const result = await query(`INSERT INTO club_ranking_points(club_id, season_id, competition_id, source_type, points, description)
    VALUES (?, ?, ?, ?, ?, ?)`, [clubId, seasonId, competitionId, sourceType, points, description]);
  await audit({ userId: req.user.id, actionCode: 'ADJUST_CLUB_RANKING_POINTS', entityTable: 'club_ranking_points', entityId: result.insertId });
  return ok(res, await first('SELECT * FROM club_ranking_points WHERE id = ?', [result.insertId]), 201);
});

router.post('/ranking-points/players', authenticate, requireAdmin, async (req, res) => {
  const playerId = parsePositiveInt(req.body.player_id, 'player_id');
  const seasonId = parsePositiveInt(req.body.season_id, 'season_id');
  const competitionId = req.body.competition_id ? parsePositiveInt(req.body.competition_id, 'competition_id') : null;
  const points = parseDecimal(req.body.points, 'points');
  const sourceType = parseEnum(req.body.source_type || 'ADMIN_ADJUSTMENT', ['BONUS', 'PENALTY', 'ADMIN_ADJUSTMENT'], 'source_type');
  const rankingScope = parseEnum(req.body.ranking_scope || 'CLUB', ['CLUB', 'NATIONAL_TEAM'], 'ranking_scope');
  const description = parseText(req.body.description, 'description', { max: 500 });
  const result = await query(`INSERT INTO player_ranking_points(player_id, season_id, competition_id, source_type, ranking_scope, points, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [playerId, seasonId, competitionId, sourceType, rankingScope, points, description]);
  await audit({ userId: req.user.id, actionCode: 'ADJUST_PLAYER_RANKING_POINTS', entityTable: 'player_ranking_points', entityId: result.insertId });
  return ok(res, await first('SELECT * FROM player_ranking_points WHERE id = ?', [result.insertId]), 201);
});


/* ========================================================================== */
/* SALARY PAYMENT HISTORY                                                      */
/* ========================================================================== */

router.get('/salary-payments', authenticate, async (req, res) => {
  const { page, limit, offset } = pagination(req);
  const seasonId = req.query.season_id ? parsePositiveInt(req.query.season_id, 'season_id') : null;
  let clubId = req.query.club_id ? parsePositiveInt(req.query.club_id, 'club_id') : null;
  if (req.user.accountType === 'CLUB') clubId = req.user.clubId;
  const where = [];
  const params = [];
  if (seasonId) { where.push('sp.season_id = ?'); params.push(seasonId); }
  if (clubId) { where.push('COALESCE(pc.club_id, sc.club_id) = ?'); params.push(clubId); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = await first(`SELECT COUNT(*) AS total FROM salary_payments sp
    LEFT JOIN player_contracts pc ON pc.id = sp.player_contract_id
    LEFT JOIN staff_contracts sc ON sc.id = sp.staff_contract_id ${whereSql}`, params);
  const rows = await query(
    `SELECT sp.*, s.name AS season_name,
            COALESCE(p.full_name, cs.full_name) AS recipient_name,
            COALESCE(pc.club_id, sc.club_id) AS club_id,
            c.name AS club_name
     FROM salary_payments sp JOIN seasons s ON s.id = sp.season_id
     LEFT JOIN player_contracts pc ON pc.id = sp.player_contract_id
     LEFT JOIN players p ON p.id = pc.player_id
     LEFT JOIN staff_contracts sc ON sc.id = sp.staff_contract_id
     LEFT JOIN coaching_staff cs ON cs.id = sc.staff_id
     LEFT JOIN clubs c ON c.id = COALESCE(pc.club_id, sc.club_id)
     ${whereSql} ORDER BY sp.paid_at DESC ${sqlLimit(limit, offset)}`, params
  );
  return ok(res, rows, 200, { page, limit, total: Number(total.total) });
});

module.exports = router;
