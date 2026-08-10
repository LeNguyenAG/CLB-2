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
  parseDate,
  ok,
  audit
} = require('./db');
const { authenticate, requireAdmin } = require('./auth');
const {
  drawPots,
  drawFullRandom,
  groupRoundRobinPairs,
  constrainedSeededPairs,
  constrainedRandomPairs
} = require('./world-cup-algorithms');

const { finalizeCompetitionAwards } = require('./smart-awards');

const router = express.Router();

const DRAW_MODES = ['POTS', 'FULL_RANDOM'];
const PAIRING_MODES = ['SEEDED_CONSTRAINED', 'FULL_RANDOM'];
const THEMES = ['COSMIC_GOLD', 'AURORA_BLUE', 'ROYAL_PURPLE'];
const CONFEDERATIONS = ['AFC', 'CAF', 'CONCACAF', 'CONMEBOL', 'OFC', 'UEFA', 'OTHER'];
const WORLD_CUP_SIZE = 48;
const GROUP_CODES = 'ABCDEFGHIJKL'.split('');


async function searchCountryCatalog(text, limit = 20, connection = undefined) {
  const queryText = String(text || '').trim();
  if (!queryText) return [];
  const like = `%${queryText}%`;
  return query(
    `SELECT DISTINCT cc.id, cc.iso2, cc.iso3, cc.fifa_code,
            cc.name_vi, cc.name_en, cc.confederation,
            cc.flag_url, cc.flag_emoji
     FROM country_catalog cc
     LEFT JOIN country_aliases ca ON ca.country_id=cc.id
     WHERE cc.is_active=TRUE
       AND (cc.name_vi LIKE ? OR cc.name_en LIKE ? OR cc.iso2 LIKE ?
            OR cc.iso3 LIKE ? OR cc.fifa_code LIKE ? OR ca.alias_text LIKE ?)
     ORDER BY
       (LOWER(cc.name_vi)=LOWER(?)) DESC,
       (LOWER(cc.name_en)=LOWER(?)) DESC,
       (UPPER(cc.fifa_code)=UPPER(?)) DESC,
       cc.name_vi
     LIMIT ${Math.min(50, Math.max(1, Number(limit) || 20))}`,
    [like, like, like, like, like, like, queryText, queryText, queryText],
    connection
  );
}

async function resolveCountryCatalog(body, connection = undefined) {
  if (body.country_catalog_id) {
    const id = parsePositiveInt(body.country_catalog_id, 'country_catalog_id');
    const country = await first('SELECT * FROM country_catalog WHERE id=? AND is_active=TRUE', [id], connection);
    if (!country) throw new ApiError(404, 'Không tìm thấy quốc gia trong thư viện.');
    return country;
  }
  const text = parseText(body.country_name || body.country_query, 'country_name', { max: 160 });
  const matches = await searchCountryCatalog(text, 5, connection);
  if (!matches.length) throw new ApiError(400, 'Không nhận diện được quốc gia. Hãy chọn từ danh sách gợi ý song ngữ.');
  const exact = matches.filter((item) => [item.name_vi, item.name_en, item.iso2, item.iso3, item.fifa_code]
    .some((value) => String(value || '').toLowerCase() === text.toLowerCase()));
  if (exact.length === 1) return exact[0];
  if (matches.length === 1) return matches[0];
  throw new ApiError(400, 'Tên quốc gia có nhiều kết quả. Hãy chọn đúng quốc gia từ danh sách gợi ý.');
}

async function getWorldCupProfile(competitionId, connection = undefined) {
  const profile = await first(
    `SELECT wcp.*,
            c.series_id,
            c.season_id,
            c.name AS competition_name,
            c.logo_url,
            c.format_type,
            c.coefficient,
            c.entry_fee,
            c.status AS competition_status,
            c.starts_on,
            c.ends_on,
            c.created_by_user_id,
            cs.code AS series_code,
            cs.name AS series_name,
            s.name AS season_name,
            s.sequence_no,
            s.status AS season_status
     FROM world_cup_profiles wcp
     JOIN competitions c ON c.id = wcp.competition_id
     JOIN competition_series cs ON cs.id = c.series_id
     JOIN seasons s ON s.id = c.season_id
     WHERE wcp.competition_id = ?
     LIMIT 1`,
    [competitionId],
    connection
  );

  if (!profile) {
    throw new ApiError(404, 'Không tìm thấy hồ sơ World Cup 48.');
  }

  return profile;
}

async function worldCupPayload(competitionId) {
  const profile = await getWorldCupProfile(competitionId);
  const [entries, groups, groupMembers, standings, rounds, matches, qualified, results, upsetRewards, awards, rewardRules] = await Promise.all([
    query(
      `SELECT wce.*, p.full_name AS player_name, p.photo_url, p.position,
              c.name AS current_club_name
       FROM world_cup_entries wce
       JOIN players p ON p.id = wce.player_id
       LEFT JOIN clubs c ON c.id = p.club_id
       WHERE wce.competition_id = ?
       ORDER BY wce.seed_rank IS NULL, wce.seed_rank, wce.country_name`,
      [competitionId]
    ),
    query('SELECT * FROM world_cup_groups WHERE competition_id = ? ORDER BY display_order', [competitionId]),
    query(
      `SELECT gm.*, g.group_code, e.country_name, e.country_code, e.flag_url,
              e.player_id, p.full_name AS player_name
       FROM world_cup_group_members gm
       JOIN world_cup_groups g ON g.id = gm.group_id
       JOIN world_cup_entries e ON e.id = gm.entry_id
       JOIN players p ON p.id = e.player_id
       WHERE g.competition_id = ?
       ORDER BY g.display_order, gm.slot_no`,
      [competitionId]
    ),
    query('SELECT * FROM v_world_cup_group_standings WHERE competition_id = ? ORDER BY display_order, group_rank', [competitionId]),
    query('SELECT * FROM world_cup_rounds WHERE competition_id = ? ORDER BY round_order', [competitionId]),
    query(
      `SELECT m.*, g.group_code, r.round_code, r.round_name, r.round_order,
              he.country_name AS home_country_name, he.country_code AS home_country_code, he.flag_url AS home_flag_url,
              ae.country_name AS away_country_name, ae.country_code AS away_country_code, ae.flag_url AS away_flag_url,
              we.country_name AS winner_country_name, le.country_name AS loser_country_name
       FROM world_cup_matches m
       LEFT JOIN world_cup_groups g ON g.id = m.group_id
       LEFT JOIN world_cup_rounds r ON r.id = m.round_id
       LEFT JOIN world_cup_entries he ON he.id = m.home_entry_id
       LEFT JOIN world_cup_entries ae ON ae.id = m.away_entry_id
       LEFT JOIN world_cup_entries we ON we.id = m.winner_entry_id
       LEFT JOIN world_cup_entries le ON le.id = m.loser_entry_id
       WHERE m.competition_id = ?
       ORDER BY m.stage_type, COALESCE(g.display_order, r.round_order), m.match_no`,
      [competitionId]
    ),
    query(
      `SELECT q.*, e.country_name, e.country_code, e.flag_url, p.full_name AS player_name,
              g.group_code
       FROM world_cup_qualified_entries q
       JOIN world_cup_entries e ON e.id = q.entry_id
       JOIN players p ON p.id = e.player_id
       JOIN world_cup_groups g ON g.id = q.group_id
       WHERE q.competition_id = ? ORDER BY q.overall_seed`,
      [competitionId]
    ),
    query(
      `SELECT r.*, e.country_name, e.country_code, e.flag_url, p.full_name AS player_name
       FROM world_cup_results r
       JOIN world_cup_entries e ON e.id = r.entry_id
       JOIN players p ON p.id = e.player_id
       WHERE r.competition_id = ? ORDER BY r.placement`,
      [competitionId]
    ),
    query(
      `SELECT ur.*, we.country_name AS winning_country_name, de.country_name AS defeated_country_name
       FROM world_cup_upset_rewards ur
       JOIN world_cup_entries we ON we.id = ur.winning_entry_id
       JOIN world_cup_entries de ON de.id = ur.defeated_entry_id
       WHERE ur.competition_id = ? ORDER BY ur.created_at DESC`,
      [competitionId]
    ),
    query(
      `SELECT pa.*, atp.name AS award_name, atp.category, p.full_name AS player_name
       FROM player_awards pa
       JOIN award_types atp ON atp.id = pa.award_type_id
       JOIN players p ON p.id = pa.player_id
       WHERE pa.competition_id = ? AND pa.award_context_type = 'NATIONAL_TEAM'
       ORDER BY pa.awarded_at DESC`,
      [competitionId]
    ),
    query('SELECT * FROM national_competition_reward_rules WHERE competition_id=? ORDER BY placement_from', [competitionId])
  ]);

  const bestThirds = standings
    .filter((row) => Number(row.group_rank) === 3)
    .sort((a, b) => Number(b.points) - Number(a.points)
      || Number(b.goal_difference) - Number(a.goal_difference)
      || Number(b.goals_for) - Number(a.goals_for)
      || Number(b.wins) - Number(a.wins)
      || Number(a.seed_rank || 9999) - Number(b.seed_rank || 9999));

  return {
    profile,
    entries,
    groups,
    groupMembers,
    standings,
    bestThirds,
    rounds,
    matches,
    qualified,
    results,
    upsetRewards,
    awards,
    rewardRules
  };
}

async function createKnockoutStructure(competitionId, pairs, userId, connection) {
  await query('DELETE FROM world_cup_match_links WHERE source_match_id IN (SELECT id FROM world_cup_matches WHERE competition_id = ?)', [competitionId], connection);
  await query("DELETE FROM world_cup_matches WHERE competition_id = ? AND stage_type = 'KNOCKOUT'", [competitionId], connection);
  await query('DELETE FROM world_cup_rounds WHERE competition_id = ?', [competitionId], connection);

  const roundDefinitions = [
    ['R32', 'Vòng 32 đội', 1, 32, 16],
    ['R16', 'Vòng 16 đội', 2, 16, 8],
    ['QF', 'Tứ kết', 3, 8, 4],
    ['SF', 'Bán kết', 4, 4, 2],
    ['THIRD', 'Tranh hạng ba', 5, 2, 1],
    ['FINAL', 'Chung kết', 6, 2, 1]
  ];
  const rounds = {};
  for (const [code, name, order, teamCount, matchCount] of roundDefinitions) {
    const inserted = await query(
      `INSERT INTO world_cup_rounds(competition_id, round_code, round_name, round_order, team_count, match_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [competitionId, code, name, order, teamCount, matchCount, code === 'R32' ? 'IN_PROGRESS' : 'PENDING'],
      connection
    );
    rounds[code] = { id: inserted.insertId, matchCount };
  }

  const matchIds = {};
  for (const [code] of roundDefinitions) {
    matchIds[code] = [];
    for (let matchNo = 1; matchNo <= rounds[code].matchCount; matchNo += 1) {
      const pair = code === 'R32' ? pairs[matchNo - 1] : null;
      const inserted = await query(
        `INSERT INTO world_cup_matches(
           competition_id, stage_type, round_id, match_no, home_entry_id, away_entry_id, status
         ) VALUES (?, 'KNOCKOUT', ?, ?, ?, ?, 'SCHEDULED')`,
        [competitionId, rounds[code].id, matchNo, pair?.[0]?.entry_id || null, pair?.[1]?.entry_id || null],
        connection
      );
      matchIds[code].push(inserted.insertId);
    }
  }

  const linkWinners = async (sourceCode, targetCode) => {
    for (let index = 0; index < matchIds[sourceCode].length; index += 1) {
      await query(
        `INSERT INTO world_cup_match_links(source_match_id, source_result, target_match_id, target_slot)
         VALUES (?, 'WINNER', ?, ?)`,
        [matchIds[sourceCode][index], matchIds[targetCode][Math.floor(index / 2)], index % 2 === 0 ? 'HOME' : 'AWAY'],
        connection
      );
    }
  };

  await linkWinners('R32', 'R16');
  await linkWinners('R16', 'QF');
  await linkWinners('QF', 'SF');

  for (let index = 0; index < matchIds.SF.length; index += 1) {
    await query(
      `INSERT INTO world_cup_match_links(source_match_id, source_result, target_match_id, target_slot)
       VALUES (?, 'WINNER', ?, ?)`,
      [matchIds.SF[index], matchIds.FINAL[0], index === 0 ? 'HOME' : 'AWAY'],
      connection
    );
    await query(
      `INSERT INTO world_cup_match_links(source_match_id, source_result, target_match_id, target_slot)
       VALUES (?, 'LOSER', ?, ?)`,
      [matchIds.SF[index], matchIds.THIRD[0], index === 0 ? 'HOME' : 'AWAY'],
      connection
    );
  }

  await audit({
    userId,
    actionCode: 'CREATE_WORLD_CUP_KNOCKOUT',
    entityTable: 'competitions',
    entityId: competitionId,
    details: { pairCount: pairs.length }
  }, connection);
}

async function applyWorldCupUpsetReward(match, winnerEntry, loserEntry, userId, connection) {
  const profile = await getWorldCupProfile(match.competition_id, connection);
  const previousCompetition = await first(
    `SELECT prev.id
     FROM world_cup_profiles pwp
     JOIN competitions prev ON prev.id = pwp.competition_id
     JOIN seasons ps ON ps.id = prev.season_id
     WHERE prev.series_id = ?
       AND ps.sequence_no < ?
       AND pwp.tournament_finalized_at IS NOT NULL
     ORDER BY ps.sequence_no DESC LIMIT 1`,
    [profile.series_id, profile.sequence_no],
    connection
  );
  if (!previousCompetition) return;

  const previousResult = await first(
    `SELECT r.placement, e.country_code
     FROM world_cup_results r
     JOIN world_cup_entries e ON e.id = r.entry_id
     WHERE r.competition_id = ? AND r.placement IN (1,2) AND e.country_code = ?`,
    [previousCompetition.id, loserEntry.country_code],
    connection
  );
  if (!previousResult) return;

  const placementType = Number(previousResult.placement) === 1 ? 'CHAMPION' : 'RUNNER_UP';
  const maxRewards = placementType === 'CHAMPION'
    ? Number(profile.max_champion_upsets)
    : Number(profile.max_runnerup_upsets);
  const points = placementType === 'CHAMPION'
    ? String(profile.champion_upset_points)
    : String(profile.runnerup_upset_points);
  const currentCount = await first(
    `SELECT COUNT(*) AS total FROM world_cup_upset_rewards
     WHERE competition_id = ? AND defeated_previous_placement = ?`,
    [match.competition_id, placementType],
    connection
  );
  if (Number(currentCount.total) >= maxRewards || Number(points) <= 0) return;

  const inserted = await query(
    `INSERT INTO world_cup_upset_rewards(
       competition_id, match_id, winning_entry_id, defeated_entry_id,
       defeated_previous_placement, awarded_points
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    [match.competition_id, match.id, winnerEntry.id, loserEntry.id, placementType, points],
    connection
  );
  await query('UPDATE world_cup_matches SET highlighted_upset = TRUE WHERE id = ?', [match.id], connection);
  await query(
    `INSERT INTO player_ranking_points(
       player_id, season_id, competition_id, source_type, source_id, ranking_scope, points, description
     ) VALUES (?, ?, ?, 'BONUS', ?, 'NATIONAL_TEAM', ?, ?)`,
    [winnerEntry.player_id, profile.season_id, match.competition_id, inserted.insertId, points,
      `Thưởng đánh bại ${placementType === 'CHAMPION' ? 'đương kim vô địch' : 'đương kim á quân'} World Cup (${winnerEntry.country_name} thắng ${loserEntry.country_name})`],
    connection
  );
}

/* ========================================================================== */
/* CREATE AND READ                                                            */
/* ========================================================================== */

router.post('/competitions/world-cup-48', authenticate, requireAdmin, async (req, res) => {
  const seriesId = parsePositiveInt(req.body.series_id, 'series_id');
  const seasonId = parsePositiveInt(req.body.season_id, 'season_id');
  const name = parseText(req.body.name, 'name', { max: 180 });
  const logoUrl = parseText(req.body.logo_url, 'logo_url', { required: false, nullable: true, max: 500 });
  const coefficient = parseDecimal(req.body.coefficient || '2.000', 'coefficient', { min: 0.001, max: 99999 });
  const startsOn = parseDate(req.body.starts_on, 'starts_on');
  const endsOn = parseDate(req.body.ends_on, 'ends_on');
  const drawMode = parseEnum(req.body.draw_mode || 'POTS', DRAW_MODES, 'draw_mode');
  const pairingMode = parseEnum(req.body.pairing_mode || 'SEEDED_CONSTRAINED', PAIRING_MODES, 'pairing_mode');
  const theme = parseEnum(req.body.visual_theme || 'COSMIC_GOLD', THEMES, 'visual_theme');
  const goldPrize = parseMoney(req.body.gold_prize_amount || 0, 'gold_prize_amount');
  const silverPrize = parseMoney(req.body.silver_prize_amount || 0, 'silver_prize_amount');
  const bronzePrize = parseMoney(req.body.bronze_prize_amount || 0, 'bronze_prize_amount');
  const championUpsetPoints = parseDecimal(req.body.champion_upset_points || 25, 'champion_upset_points', { min: 0 });
  const runnerupUpsetPoints = parseDecimal(req.body.runnerup_upset_points || 15, 'runnerup_upset_points', { min: 0 });

  const competitionId = await transaction(async (connection) => {
    const inserted = await query(
      `INSERT INTO competitions(
         series_id, season_id, name, logo_url, format_type, coefficient, entry_fee, status,
         group_count, teams_per_group, advance_per_group, best_third_count, group_leg_mode,
         knockout_size, third_place_mode, starts_on, ends_on, created_by_user_id
       ) VALUES (?, ?, ?, ?, 'GROUP_AND_KNOCKOUT', ?, 0, 'DRAFT', 12, 4, 2, 8, 'ONE_LEG', 32, 'PLAYOFF', ?, ?, ?)`,
      [seriesId, seasonId, name, logoUrl, coefficient, startsOn, endsOn, req.user.id],
      connection
    );
    await query(
      `INSERT INTO world_cup_profiles(
         competition_id, draw_mode, pairing_mode, visual_theme,
         gold_prize_amount, silver_prize_amount, bronze_prize_amount,
         champion_upset_points, runnerup_upset_points
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [inserted.insertId, drawMode, pairingMode, theme, goldPrize, silverPrize, bronzePrize,
        championUpsetPoints, runnerupUpsetPoints],
      connection
    );
    const rewardRules = [
      [1, 1, 'Vô địch', goldPrize, 120, 'GOLD'],
      [2, 2, 'Á quân', silverPrize, 80, 'SILVER'],
      [3, 3, 'Hạng ba', bronzePrize, 55, 'BRONZE'],
      [4, 4, 'Hạng tư', '0', 40, 'NONE'],
      [5, 8, 'Tứ kết', '0', 30, 'NONE'],
      [9, 16, 'Vòng 16 đội', '0', 18, 'NONE'],
      [17, 32, 'Vòng 32 đội', '0', 8, 'NONE']
    ];
    for (const rule of rewardRules) {
      await query(
        `INSERT INTO national_competition_reward_rules(
           competition_id,placement_from,placement_to,placement_label,prize_amount,base_ranking_points,medal_type
         ) VALUES(?,?,?,?,?,?,?)`, [inserted.insertId, ...rule], connection
      );
    }
    await audit({
      userId: req.user.id,
      actionCode: 'CREATE_WORLD_CUP_48',
      entityTable: 'competitions',
      entityId: inserted.insertId,
      details: { drawMode, pairingMode, theme }
    }, connection);
    return inserted.insertId;
  });

  return ok(res, await getWorldCupProfile(competitionId), 201);
});

router.get('/competitions/:id/world-cup', async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  return ok(res, await worldCupPayload(competitionId));
});

router.get('/world-cup/countries/search', authenticate, requireAdmin, async (req, res) => {
  const text = parseText(req.query.q, 'q', { max: 160 });
  const limit = req.query.limit ? parsePositiveInt(req.query.limit, 'limit', { max: 50 }) : 20;
  return ok(res, await searchCountryCatalog(text, limit));
});

router.get('/world-cup/national-profiles', authenticate, requireAdmin, async (_req, res) => {
  return ok(res, await query(
    `SELECT p.id AS player_id, p.full_name, p.photo_url, p.position,
            c.name AS current_club_name, np.country_catalog_id,
            CASE WHEN cc.id IS NOT NULL THEN cc.name_vi ELSE np.country_name END AS country_name,
            CASE WHEN cc.id IS NOT NULL THEN cc.fifa_code ELSE np.country_code END AS country_code,
            CASE WHEN cc.id IS NOT NULL THEN cc.flag_url ELSE np.flag_url END AS flag_url,
            CASE WHEN cc.id IS NOT NULL THEN cc.confederation ELSE np.confederation END AS confederation,
            np.world_seed_rank,
            cc.name_vi AS catalog_name_vi, cc.name_en AS catalog_name_en,
            cc.iso2 AS catalog_iso2, cc.fifa_code AS catalog_fifa_code,
            cc.flag_url AS catalog_flag_url, cc.confederation AS catalog_confederation,
            cc.flag_emoji,
            np.is_active, np.created_at AS profile_created_at,
            np.updated_at AS profile_updated_at,
            CASE WHEN np.player_id IS NULL THEN FALSE ELSE TRUE END AS has_national_profile
     FROM players p
     LEFT JOIN clubs c ON c.id = p.club_id
     LEFT JOIN player_national_profiles np ON np.player_id = p.id
     LEFT JOIN country_catalog cc ON cc.id=np.country_catalog_id
     WHERE p.status IN ('ACTIVE','FREE_AGENT','TRANSFER_LISTED')
     ORDER BY np.country_name IS NULL, np.country_name, p.full_name`
  ));
});

router.put('/world-cup/national-profiles/:playerId', authenticate, requireAdmin, async (req, res) => {
  const playerId = parsePositiveInt(req.params.playerId, 'playerId');
  const country = await resolveCountryCatalog(req.body);
  const worldSeedRank = req.body.world_seed_rank
    ? parsePositiveInt(req.body.world_seed_rank, 'world_seed_rank', { max: 999 })
    : null;

  const player = await first(
    `SELECT p.id, p.full_name
     FROM players p
     WHERE p.id = ? AND p.status IN ('ACTIVE','FREE_AGENT','TRANSFER_LISTED')`,
    [playerId]
  );
  if (!player) throw new ApiError(404, 'Không tìm thấy cầu thủ đang hoạt động.');

  await query(
    `INSERT INTO player_national_profiles(
       player_id, country_catalog_id, country_name, country_code,
       flag_url, confederation, world_seed_rank, is_active
     ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
     ON DUPLICATE KEY UPDATE
       country_catalog_id = VALUES(country_catalog_id),
       country_name = VALUES(country_name),
       country_code = VALUES(country_code),
       flag_url = VALUES(flag_url),
       confederation = VALUES(confederation),
       world_seed_rank = VALUES(world_seed_rank),
       is_active = TRUE`,
    [playerId, country.id, country.name_vi, country.fifa_code,
      country.flag_url, country.confederation, worldSeedRank]
  );

  await audit({
    userId: req.user.id,
    actionCode: 'UPSERT_PLAYER_NATIONAL_PROFILE',
    entityTable: 'player_national_profiles',
    entityId: playerId,
    details: {
      countryCatalogId: country.id,
      countryNameVi: country.name_vi,
      countryNameEn: country.name_en,
      countryCode: country.fifa_code,
      confederation: country.confederation,
      worldSeedRank
    }
  });

  const saved = await first(
    `SELECT p.id AS player_id, p.full_name, p.photo_url, p.position,
            c.name AS current_club_name, np.country_catalog_id,
            CASE WHEN cc.id IS NOT NULL THEN cc.name_vi ELSE np.country_name END AS country_name,
            CASE WHEN cc.id IS NOT NULL THEN cc.fifa_code ELSE np.country_code END AS country_code,
            CASE WHEN cc.id IS NOT NULL THEN cc.flag_url ELSE np.flag_url END AS flag_url,
            CASE WHEN cc.id IS NOT NULL THEN cc.confederation ELSE np.confederation END AS confederation,
            np.world_seed_rank,
            cc.name_vi AS catalog_name_vi, cc.name_en AS catalog_name_en,
            cc.iso2 AS catalog_iso2, cc.fifa_code AS catalog_fifa_code,
            cc.flag_url AS catalog_flag_url, cc.confederation AS catalog_confederation,
            cc.flag_emoji,
            np.is_active, np.created_at AS profile_created_at,
            np.updated_at AS profile_updated_at, TRUE AS has_national_profile
     FROM players p
     LEFT JOIN clubs c ON c.id = p.club_id
     JOIN player_national_profiles np ON np.player_id = p.id
     LEFT JOIN country_catalog cc ON cc.id=np.country_catalog_id
     WHERE p.id = ?`,
    [playerId]
  );
  return ok(res, saved);
});

router.delete('/world-cup/national-profiles/:playerId', authenticate, requireAdmin, async (req, res) => {
  const playerId = parsePositiveInt(req.params.playerId, 'playerId');
  const existing = await first(
    `SELECT player_id, country_name, country_code
     FROM player_national_profiles
     WHERE player_id = ?`,
    [playerId]
  );
  if (!existing) throw new ApiError(404, 'Cầu thủ này chưa có hồ sơ quốc gia.');

  await query('DELETE FROM player_national_profiles WHERE player_id = ?', [playerId]);
  await audit({
    userId: req.user.id,
    actionCode: 'DELETE_PLAYER_NATIONAL_PROFILE',
    entityTable: 'player_national_profiles',
    entityId: playerId,
    details: { countryName: existing.country_name, countryCode: existing.country_code }
  });
  return ok(res, { message: 'Đã xóa liên kết quốc gia cố định của cầu thủ.' });
});

/* ========================================================================== */
/* ENTRIES AND DRAW                                                           */
/* ========================================================================== */

router.put('/competitions/:id/world-cup/entries', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  await getWorldCupProfile(competitionId);
  if (!Array.isArray(req.body.entries)) throw new ApiError(400, 'entries phải là một mảng.');
  if (req.body.entries.length > WORLD_CUP_SIZE) throw new ApiError(400, 'World Cup chỉ nhận tối đa 48 quốc gia.');

  const normalized = req.body.entries.map((entry, index) => ({
    playerId: parsePositiveInt(entry.player_id, `entries[${index}].player_id`),
    countryCatalogId: entry.country_catalog_id ? parsePositiveInt(entry.country_catalog_id, `entries[${index}].country_catalog_id`) : null,
    countryName: parseText(entry.country_name, `entries[${index}].country_name`, { max: 120 }),
    countryCode: parseText(entry.country_code, `entries[${index}].country_code`, { max: 8 }).toUpperCase(),
    flagUrl: parseText(entry.flag_url, `entries[${index}].flag_url`, { required: false, nullable: true, max: 500 }),
    confederation: parseEnum(entry.confederation || 'OTHER', CONFEDERATIONS, `entries[${index}].confederation`),
    seedRank: entry.seed_rank ? parsePositiveInt(entry.seed_rank, `entries[${index}].seed_rank`, { max: 999 }) : null
  }));

  if (new Set(normalized.map((item) => item.playerId)).size !== normalized.length) throw new ApiError(400, 'Một cầu thủ không thể đại diện hai quốc gia trong cùng giải.');
  if (new Set(normalized.map((item) => item.countryCode)).size !== normalized.length) throw new ApiError(400, 'Mã quốc gia bị trùng.');
  if (new Set(normalized.map((item) => item.countryName.toLowerCase())).size !== normalized.length) throw new ApiError(400, 'Tên quốc gia bị trùng.');

  await transaction(async (connection) => {
    const matchCount = await first('SELECT COUNT(*) AS total FROM world_cup_matches WHERE competition_id = ?', [competitionId], connection);
    if (Number(matchCount.total) > 0) throw new ApiError(400, 'Giải đã bốc thăm và tạo lịch; không thể thay toàn bộ danh sách. Hãy reset World Cup trước.');
    await query('DELETE FROM world_cup_entries WHERE competition_id = ?', [competitionId], connection);

    for (const item of normalized) {
      const player = await first('SELECT id FROM players WHERE id = ?', [item.playerId], connection);
      if (!player) throw new ApiError(400, `Không tìm thấy cầu thủ ID ${item.playerId}.`);
      await query(
        `INSERT INTO player_national_profiles(
           player_id, country_catalog_id, country_name, country_code, flag_url, confederation, world_seed_rank, is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)
         ON DUPLICATE KEY UPDATE
           country_catalog_id = VALUES(country_catalog_id),
           country_name = VALUES(country_name), country_code = VALUES(country_code),
           flag_url = VALUES(flag_url), confederation = VALUES(confederation),
           world_seed_rank = VALUES(world_seed_rank), is_active = TRUE`,
        [item.playerId, item.countryCatalogId, item.countryName, item.countryCode, item.flagUrl, item.confederation, item.seedRank],
        connection
      );
      await query(
        `INSERT INTO world_cup_entries(
           competition_id, player_id, country_catalog_id, country_name, country_code, flag_url,
           confederation, seed_rank, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'APPROVED')`,
        [competitionId, item.playerId, item.countryCatalogId, item.countryName, item.countryCode, item.flagUrl,
          item.confederation, item.seedRank],
        connection
      );
    }
    await audit({
      userId: req.user.id,
      actionCode: 'SET_WORLD_CUP_ENTRIES',
      entityTable: 'competitions',
      entityId: competitionId,
      details: { entryCount: normalized.length }
    }, connection);
  });

  return ok(res, { message: `Đã lưu ${normalized.length}/48 quốc gia.`, entries: (await worldCupPayload(competitionId)).entries });
});

router.post('/competitions/:id/world-cup/draw', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getWorldCupProfile(competitionId);
  const mode = parseEnum(req.body.mode || profile.draw_mode, DRAW_MODES, 'mode');
  const entries = await query(
    `SELECT * FROM world_cup_entries
     WHERE competition_id = ? AND status = 'APPROVED'
     ORDER BY seed_rank IS NULL, seed_rank, id`,
    [competitionId]
  );
  if (entries.length !== WORLD_CUP_SIZE) throw new ApiError(400, `Cần đúng 48 quốc gia; hiện có ${entries.length}.`);

  const draw = mode === 'POTS' ? drawPots(entries) : drawFullRandom(entries);
  await transaction(async (connection) => {
    const finished = await first("SELECT COUNT(*) AS total FROM world_cup_matches WHERE competition_id = ? AND status = 'FINISHED'", [competitionId], connection);
    if (Number(finished.total) > 0) throw new ApiError(400, 'Đã có kết quả trận đấu; không thể bốc thăm lại.');
    await query('DELETE FROM world_cup_match_links WHERE source_match_id IN (SELECT id FROM world_cup_matches WHERE competition_id = ?)', [competitionId], connection);
    await query('DELETE FROM world_cup_matches WHERE competition_id = ?', [competitionId], connection);
    await query('DELETE FROM world_cup_qualified_entries WHERE competition_id = ?', [competitionId], connection);
    await query('DELETE FROM world_cup_rounds WHERE competition_id = ?', [competitionId], connection);
    await query('DELETE FROM world_cup_groups WHERE competition_id = ?', [competitionId], connection);

    for (let groupIndex = 0; groupIndex < 12; groupIndex += 1) {
      const code = GROUP_CODES[groupIndex];
      const insertedGroup = await query(
        `INSERT INTO world_cup_groups(competition_id, group_code, display_name, display_order)
         VALUES (?, ?, ?, ?)`,
        [competitionId, code, `Bảng ${code}`, groupIndex + 1],
        connection
      );
      const groupEntries = draw.groups[groupIndex];
      for (let slot = 0; slot < groupEntries.length; slot += 1) {
        const entry = groupEntries[slot];
        await query('UPDATE world_cup_entries SET pot_no = ? WHERE id = ?', [entry.pot_no || null, entry.id], connection);
        await query(
          'INSERT INTO world_cup_group_members(group_id, entry_id, slot_no) VALUES (?, ?, ?)',
          [insertedGroup.insertId, entry.id, slot + 1],
          connection
        );
      }
      const pairs = groupRoundRobinPairs(groupEntries.map((item) => item.id));
      for (let matchIndex = 0; matchIndex < pairs.length; matchIndex += 1) {
        await query(
          `INSERT INTO world_cup_matches(
             competition_id, stage_type, group_id, match_no, home_entry_id, away_entry_id, status
           ) VALUES (?, 'GROUP', ?, ?, ?, ?, 'SCHEDULED')`,
          [competitionId, insertedGroup.insertId, matchIndex + 1, pairs[matchIndex][0], pairs[matchIndex][1]],
          connection
        );
      }
    }
    await query(
      `UPDATE world_cup_profiles
       SET draw_mode = ?, entries_locked_at = CURRENT_TIMESTAMP(6),
           groups_drawn_at = CURRENT_TIMESTAMP(6), groups_finalized_at = NULL
       WHERE competition_id = ?`,
      [mode, competitionId],
      connection
    );
    await query("UPDATE competitions SET status = 'GROUP_STAGE' WHERE id = ?", [competitionId], connection);
    await audit({
      userId: req.user.id,
      actionCode: 'DRAW_WORLD_CUP_GROUPS',
      entityTable: 'competitions',
      entityId: competitionId,
      details: { mode, warning: draw.warning }
    }, connection);
  });

  return ok(res, { message: 'Đã bốc thăm 48 quốc gia vào 12 bảng và tạo 72 trận vòng bảng.', warning: draw.warning });
});

router.post('/competitions/:id/world-cup/reset', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getWorldCupProfile(competitionId);
  if (profile.tournament_finalized_at) {
    throw new ApiError(400, 'World Cup đã chi thưởng nên không thể reset để tránh trả tiền trùng. Hãy tạo kỳ giải mới.');
  }
  await transaction(async (connection) => {
    await query("DELETE FROM player_ranking_points WHERE competition_id = ? AND ranking_scope = 'NATIONAL_TEAM'", [competitionId], connection);
    await query("DELETE FROM player_awards WHERE competition_id = ? AND award_context_type = 'NATIONAL_TEAM'", [competitionId], connection);
    await query('DELETE FROM world_cup_upset_rewards WHERE competition_id = ?', [competitionId], connection);
    await query('DELETE FROM world_cup_results WHERE competition_id = ?', [competitionId], connection);
    await query('DELETE FROM world_cup_qualified_entries WHERE competition_id = ?', [competitionId], connection);
    await query('DELETE FROM world_cup_match_links WHERE source_match_id IN (SELECT id FROM world_cup_matches WHERE competition_id = ?)', [competitionId], connection);
    await query('DELETE FROM world_cup_matches WHERE competition_id = ?', [competitionId], connection);
    await query('DELETE FROM world_cup_rounds WHERE competition_id = ?', [competitionId], connection);
    await query('DELETE FROM world_cup_groups WHERE competition_id = ?', [competitionId], connection);
    await query(
      `UPDATE world_cup_profiles
       SET entries_locked_at = NULL, groups_drawn_at = NULL, groups_finalized_at = NULL,
           tournament_finalized_at = NULL
       WHERE competition_id = ?`,
      [competitionId],
      connection
    );
    await query("UPDATE competitions SET status = 'DRAFT', rewards_processed_at = NULL WHERE id = ?", [competitionId], connection);
    await audit({ userId: req.user.id, actionCode: 'RESET_WORLD_CUP', entityTable: 'competitions', entityId: competitionId }, connection);
  });
  return ok(res, { message: 'Đã reset lịch thi đấu, kết quả, huy chương và nhánh World Cup; danh sách 48 quốc gia vẫn được giữ.' });
});

/* ========================================================================== */
/* RESULTS, QUALIFICATION AND KNOCKOUT                                         */
/* ========================================================================== */

router.post('/world-cup/matches/:id/result', authenticate, requireAdmin, async (req, res) => {
  const matchId = parsePositiveInt(req.params.id);
  const homeScore = parsePositiveInt(req.body.home_score, 'home_score', { min: 0, max: 99 });
  const awayScore = parsePositiveInt(req.body.away_score, 'away_score', { min: 0, max: 99 });
  const homePenalty = req.body.home_penalty_score === undefined || req.body.home_penalty_score === null || req.body.home_penalty_score === ''
    ? null : parsePositiveInt(req.body.home_penalty_score, 'home_penalty_score', { min: 0, max: 99 });
  const awayPenalty = req.body.away_penalty_score === undefined || req.body.away_penalty_score === null || req.body.away_penalty_score === ''
    ? null : parsePositiveInt(req.body.away_penalty_score, 'away_penalty_score', { min: 0, max: 99 });
  const note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 500 });

  await transaction(async (connection) => {
    const match = await first('SELECT * FROM world_cup_matches WHERE id = ? FOR UPDATE', [matchId], connection);
    if (!match) throw new ApiError(404, 'Không tìm thấy trận World Cup.');
    const finalized = await first('SELECT tournament_finalized_at FROM world_cup_profiles WHERE competition_id=?', [match.competition_id], connection);
    if (finalized?.tournament_finalized_at) throw new ApiError(400, 'World Cup đã chốt nên không thể sửa tỷ số.');
    if (!match.home_entry_id || !match.away_entry_id) throw new ApiError(400, 'Trận đấu chưa đủ hai quốc gia.');
    if (match.status === 'FINISHED') throw new ApiError(400, 'Trận đã chốt kết quả. Hãy reset giải nếu cần làm lại.');

    let winnerId = null;
    let loserId = null;
    if (homeScore !== awayScore) {
      winnerId = homeScore > awayScore ? match.home_entry_id : match.away_entry_id;
      loserId = homeScore > awayScore ? match.away_entry_id : match.home_entry_id;
    } else if (match.stage_type === 'KNOCKOUT') {
      if (homePenalty === null || awayPenalty === null || homePenalty === awayPenalty) {
        throw new ApiError(400, 'Trận loại trực tiếp hòa phải nhập tỷ số luân lưu khác nhau.');
      }
      winnerId = homePenalty > awayPenalty ? match.home_entry_id : match.away_entry_id;
      loserId = homePenalty > awayPenalty ? match.away_entry_id : match.home_entry_id;
    }

    await query(
      `UPDATE world_cup_matches
       SET home_score = ?, away_score = ?, home_penalty_score = ?, away_penalty_score = ?,
           winner_entry_id = ?, loser_entry_id = ?, status = 'FINISHED', note = ?,
           finished_at = CURRENT_TIMESTAMP(6)
       WHERE id = ?`,
      [homeScore, awayScore, homePenalty, awayPenalty, winnerId, loserId, note, matchId],
      connection
    );

    if (winnerId) {
      const [winnerEntry, loserEntry] = await Promise.all([
        first('SELECT * FROM world_cup_entries WHERE id = ?', [winnerId], connection),
        first('SELECT * FROM world_cup_entries WHERE id = ?', [loserId], connection)
      ]);
      await applyWorldCupUpsetReward(match, winnerEntry, loserEntry, req.user.id, connection);

      const links = await query('SELECT * FROM world_cup_match_links WHERE source_match_id = ?', [matchId], connection);
      for (const link of links) {
        const entryId = link.source_result === 'WINNER' ? winnerId : loserId;
        const column = link.target_slot === 'HOME' ? 'home_entry_id' : 'away_entry_id';
        await query(`UPDATE world_cup_matches SET ${column} = ? WHERE id = ?`, [entryId, link.target_match_id], connection);
        const target = await first('SELECT round_id, home_entry_id, away_entry_id FROM world_cup_matches WHERE id = ?', [link.target_match_id], connection);
        if (target.home_entry_id && target.away_entry_id) {
          await query("UPDATE world_cup_rounds SET status = 'IN_PROGRESS' WHERE id = ? AND status = 'PENDING'", [target.round_id], connection);
        }
      }
    }

    if (match.round_id) {
      const pending = await first("SELECT COUNT(*) AS total FROM world_cup_matches WHERE round_id = ? AND status <> 'FINISHED'", [match.round_id], connection);
      if (Number(pending.total) === 0) await query("UPDATE world_cup_rounds SET status = 'FINISHED' WHERE id = ?", [match.round_id], connection);
    }
    await audit({ userId: req.user.id, actionCode: 'SET_WORLD_CUP_RESULT', entityTable: 'world_cup_matches', entityId: matchId }, connection);
  });

  return ok(res, { message: 'Đã cập nhật kết quả World Cup và tự động đẩy đội thắng sang vòng tiếp theo.' });
});

router.post('/competitions/:id/world-cup/finalize-groups', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getWorldCupProfile(competitionId);
  const pairingMode = parseEnum(req.body.pairing_mode || profile.pairing_mode, PAIRING_MODES, 'pairing_mode');
  const groupMatches = await first("SELECT COUNT(*) AS total, SUM(status = 'FINISHED') AS finished FROM world_cup_matches WHERE competition_id = ? AND stage_type = 'GROUP'", [competitionId]);
  if (Number(groupMatches.total) !== 72 || Number(groupMatches.finished) !== 72) {
    throw new ApiError(400, `Vòng bảng cần đủ 72 trận đã kết thúc; hiện hoàn tất ${Number(groupMatches.finished || 0)}/72.`);
  }

  const standings = await query('SELECT * FROM v_world_cup_group_standings WHERE competition_id = ? ORDER BY display_order, group_rank', [competitionId]);
  const winners = standings.filter((row) => Number(row.group_rank) === 1);
  const runners = standings.filter((row) => Number(row.group_rank) === 2);
  const thirds = standings.filter((row) => Number(row.group_rank) === 3)
    .sort((a, b) => Number(b.points) - Number(a.points)
      || Number(b.goal_difference) - Number(a.goal_difference)
      || Number(b.goals_for) - Number(a.goals_for)
      || Number(b.wins) - Number(a.wins)
      || Number(a.seed_rank || 9999) - Number(b.seed_rank || 9999))
    .slice(0, 8);
  if (winners.length !== 12 || runners.length !== 12 || thirds.length !== 8) throw new ApiError(400, 'Không thể xác định đủ 32 đội đi tiếp.');

  const sortByPerformance = (a, b) => Number(b.points) - Number(a.points)
    || Number(b.goal_difference) - Number(a.goal_difference)
    || Number(b.goals_for) - Number(a.goals_for)
    || Number(b.wins) - Number(a.wins)
    || Number(a.seed_rank || 9999) - Number(b.seed_rank || 9999);
  const sortedWinners = [...winners].sort(sortByPerformance);
  const sortedRunners = [...runners].sort(sortByPerformance);
  const topFourRunners = sortedRunners.slice(0, 4);
  const otherRunners = sortedRunners.slice(4);
  const seeded = [...sortedWinners, ...topFourRunners];
  const unseeded = [...otherRunners, ...thirds];
  const allQualified = [...sortedWinners, ...sortedRunners, ...thirds];
  const pairs = pairingMode === 'SEEDED_CONSTRAINED'
    ? constrainedSeededPairs(seeded, unseeded)
    : constrainedRandomPairs(allQualified);

  await transaction(async (connection) => {
    await query('DELETE FROM world_cup_qualified_entries WHERE competition_id = ?', [competitionId], connection);
    let overallSeed = 1;
    for (const row of allQualified) {
      const type = Number(row.group_rank) === 1 ? 'GROUP_WINNER' : Number(row.group_rank) === 2 ? 'RUNNER_UP' : 'BEST_THIRD';
      await query(
        `INSERT INTO world_cup_qualified_entries(
           competition_id, entry_id, group_id, group_rank, qualification_type,
           overall_seed, points, goal_difference, goals_for
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [competitionId, row.entry_id, row.group_id, row.group_rank, type, overallSeed,
          row.points, row.goal_difference, row.goals_for],
        connection
      );
      overallSeed += 1;
    }
    await createKnockoutStructure(competitionId, pairs, req.user.id, connection);
    await query(
      `UPDATE world_cup_profiles
       SET pairing_mode = ?, groups_finalized_at = CURRENT_TIMESTAMP(6)
       WHERE competition_id = ?`,
      [pairingMode, competitionId],
      connection
    );
    await query("UPDATE competitions SET status = 'KNOCKOUT_STAGE' WHERE id = ?", [competitionId], connection);
  });

  return ok(res, {
    message: 'Đã chọn 12 nhất bảng, 12 nhì bảng và 8 hạng ba tốt nhất; nhánh 32 đội được tạo tự động.',
    pairingMode,
    pairs: pairs.map(([home, away], index) => ({
      match_no: index + 1,
      home: home.country_name,
      away: away.country_name,
      home_group: home.group_code,
      away_group: away.group_code
    }))
  });
});

/* ========================================================================== */
/* AWARDS AND FINALIZATION                                                     */
/* ========================================================================== */

router.post('/competitions/:id/world-cup/individual-awards', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getWorldCupProfile(competitionId);
  const entryId = parsePositiveInt(req.body.entry_id, 'entry_id');
  const awardTypeId = parsePositiveInt(req.body.award_type_id, 'award_type_id');
  const [entry, awardType] = await Promise.all([
    first('SELECT * FROM world_cup_entries WHERE id = ? AND competition_id = ?', [entryId, competitionId]),
    first("SELECT * FROM award_types WHERE id = ? AND is_active = TRUE AND category <> 'TEAM_MEDAL'", [awardTypeId])
  ]);
  if (!entry) throw new ApiError(404, 'Không tìm thấy quốc gia/cầu thủ trong World Cup.');
  if (!awardType) throw new ApiError(400, 'Chỉ được chọn danh hiệu cá nhân đang hoạt động.');
  const points = (Number(awardType.base_ranking_points) * Number(profile.coefficient)).toFixed(3);

  await transaction(async (connection) => {
    const inserted = await query(
      `INSERT INTO player_awards(
         player_id, club_id_at_award, award_context_type,
         country_name_at_award, country_code_at_award,
         competition_id, season_id, award_type_id, display_name,
         awarded_points, assigned_by_user_id, is_locked
       ) VALUES (?, NULL, 'NATIONAL_TEAM', ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [entry.player_id, entry.country_name, entry.country_code, competitionId, profile.season_id,
        awardTypeId, `${awardType.name} – ${profile.competition_name} (${entry.country_name})`,
        points, req.user.id],
      connection
    );
    await query(
      `INSERT INTO player_ranking_points(
         player_id, season_id, competition_id, source_type, source_id, ranking_scope, points, description
       ) VALUES (?, ?, ?, 'AWARD', ?, 'NATIONAL_TEAM', ?, ?)`,
      [entry.player_id, profile.season_id, competitionId, inserted.insertId, points,
        `${awardType.name} World Cup – ${entry.country_name}`],
      connection
    );
  });
  return ok(res, { message: `Đã trao ${awardType.name} cho ${entry.country_name}.`, points }, 201);
});

router.post('/competitions/:id/world-cup/finalize', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getWorldCupProfile(competitionId);
  if (profile.tournament_finalized_at) throw new ApiError(400, 'World Cup đã được kết thúc trước đó.');

  const [finalMatch, thirdMatch] = await Promise.all([
    first(
      `SELECT m.* FROM world_cup_matches m
       JOIN world_cup_rounds r ON r.id = m.round_id
       WHERE m.competition_id = ? AND r.round_code = 'FINAL'`,
      [competitionId]
    ),
    first(
      `SELECT m.* FROM world_cup_matches m
       JOIN world_cup_rounds r ON r.id = m.round_id
       WHERE m.competition_id = ? AND r.round_code = 'THIRD'`,
      [competitionId]
    )
  ]);
  if (!finalMatch || finalMatch.status !== 'FINISHED' || !thirdMatch || thirdMatch.status !== 'FINISHED') {
    throw new ApiError(400, 'Phải hoàn tất trận chung kết và tranh hạng ba trước khi kết thúc World Cup.');
  }

  const placements = [
    { placement: 1, entryId: finalMatch.winner_entry_id, medal: 'GOLD', awardCode: 'WORLD_CUP_GOLD', prize: String(profile.gold_prize_amount) },
    { placement: 2, entryId: finalMatch.loser_entry_id, medal: 'SILVER', awardCode: 'WORLD_CUP_SILVER', prize: String(profile.silver_prize_amount) },
    { placement: 3, entryId: thirdMatch.winner_entry_id, medal: 'BRONZE', awardCode: 'WORLD_CUP_BRONZE', prize: String(profile.bronze_prize_amount) },
    { placement: 4, entryId: thirdMatch.loser_entry_id, medal: 'NONE', awardCode: null, prize: '0' }
  ];
  const eliminated = await query(
    `SELECT r.round_code,m.loser_entry_id AS entry_id,e.seed_rank
     FROM world_cup_matches m JOIN world_cup_rounds r ON r.id=m.round_id
     JOIN world_cup_entries e ON e.id=m.loser_entry_id
     WHERE m.competition_id=? AND m.status='FINISHED' AND r.round_code IN('QF','R16','R32')
     ORDER BY r.round_order DESC,e.seed_rank IS NULL,e.seed_rank,e.id`, [competitionId]
  );
  for (const [roundCode, start] of [['QF', 5], ['R16', 9], ['R32', 17]]) {
    eliminated.filter((entry) => entry.round_code === roundCode)
      .forEach((entry, index) => placements.push({
        placement: start + index, entryId: entry.entry_id, medal: 'NONE', awardCode: null, prize: '0'
      }));
  }
  if (placements.length !== 32 || new Set(placements.map((item) => Number(item.entryId))).size !== 32) {
    throw new ApiError(400, 'Nhánh World Cup chưa có đủ kết quả hợp lệ từ vòng 32 đội đến chung kết.');
  }

  await transaction(async (connection) => {
    const rewardRules = await query(
      'SELECT * FROM national_competition_reward_rules WHERE competition_id=? ORDER BY placement_from',
      [competitionId], connection
    );
    if (rewardRules.length !== 7) throw new ApiError(400, 'Bộ quy tắc điểm World Cup chưa đầy đủ. Hãy chạy migration v2.0.15.');
    const fifaWallet = await first("SELECT * FROM wallets WHERE wallet_type = 'FIFA' FOR UPDATE", [], connection);
    const totalPrize = placements.reduce((sum, item) => sum + BigInt(item.prize || '0'), 0n);
    if (totalPrize > 0n && (!fifaWallet || BigInt(fifaWallet.balance) < totalPrize)) {
      throw new ApiError(400, `Ví FIFA không đủ tiền thưởng World Cup. Cần ${totalPrize.toString()}.`);
    }

    await query('DELETE FROM world_cup_results WHERE competition_id = ?', [competitionId], connection);
    for (const item of placements) {
      const entry = await first('SELECT * FROM world_cup_entries WHERE id = ?', [item.entryId], connection);
      if (!entry) throw new ApiError(500, 'Không tìm thấy quốc gia ở kết quả cuối.');
      const rewardRule = rewardRules.find((rule) => item.placement >= Number(rule.placement_from) && item.placement <= Number(rule.placement_to));
      if (!rewardRule) throw new ApiError(500, `Thiếu quy tắc điểm cho hạng ${item.placement}.`);
      const rankingPoints = (Number(rewardRule.base_ranking_points) * Number(profile.coefficient)).toFixed(3);
      let awardId = null;
      if (item.awardCode) {
        const awardType = await first('SELECT * FROM award_types WHERE code = ?', [item.awardCode], connection);
        const insertedAward = await query(
          `INSERT INTO player_awards(
             player_id, club_id_at_award, award_context_type,
             country_name_at_award, country_code_at_award,
             competition_id, season_id, award_type_id, display_name,
             awarded_points, assigned_by_user_id, is_locked
           ) VALUES (?, NULL, 'NATIONAL_TEAM', ?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
          [entry.player_id, entry.country_name, entry.country_code, competitionId, profile.season_id,
            awardType.id, `${awardType.name} – ${profile.competition_name} (${entry.country_name})`,
            rankingPoints, req.user.id],
          connection
        );
        awardId = insertedAward.insertId;
        await query(
          `INSERT INTO player_ranking_points(
             player_id, season_id, competition_id, source_type, source_id, ranking_scope, points, description
           ) VALUES (?, ?, ?, 'AWARD', ?, 'NATIONAL_TEAM', ?, ?)`,
          [entry.player_id, profile.season_id, competitionId, awardId, rankingPoints,
            `${awardType.name} – ${entry.country_name}`],
          connection
        );
      }

      const insertedResult = await query(
        `INSERT INTO world_cup_results(
           competition_id, entry_id, placement, medal_type, ranking_points, confirmed_by_user_id
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [competitionId, entry.id, item.placement, item.medal, rankingPoints, req.user.id],
        connection
      );
      if (!item.awardCode) {
        await query(
          `INSERT INTO player_ranking_points(
             player_id,season_id,competition_id,source_type,source_id,ranking_scope,points,description
           ) VALUES(?,?,?,'BONUS',?,'NATIONAL_TEAM',?,?)`,
          [entry.player_id, profile.season_id, competitionId, insertedResult.insertId, rankingPoints,
            `${rewardRule.placement_label} – ${profile.competition_name} (${entry.country_name})`], connection
        );
      }

      if (BigInt(item.prize || '0') > 0n) {
        const playerWallet = await first("SELECT * FROM wallets WHERE wallet_type = 'PLAYER' AND player_id = ? FOR UPDATE", [entry.player_id], connection);
        if (!playerWallet) throw new ApiError(500, `Cầu thủ ${entry.player_id} chưa có ví.`);
        await callProcedure(
          'sp_wallet_transfer_core',
          [fifaWallet.id, playerWallet.id, 'PRIZE', item.prize,
            `WC-${competitionId}-P${item.placement}-${crypto.randomBytes(4).toString('hex')}`,
            'world_cup_results', insertedResult.insertId,
            `Tiền thưởng hạng ${item.placement} World Cup – ${entry.country_name}`, req.user.id],
          connection
        );
      }
    }

    await query(
      `UPDATE world_cup_profiles SET tournament_finalized_at = CURRENT_TIMESTAMP(6)
       WHERE competition_id = ?`,
      [competitionId],
      connection
    );
    await query("UPDATE competitions SET status = 'FINISHED', rewards_processed_at = CURRENT_TIMESTAMP(6) WHERE id = ?", [competitionId], connection);
    await audit({ userId: req.user.id, actionCode: 'FINALIZE_WORLD_CUP', entityTable: 'competitions', entityId: competitionId }, connection);
  });

  let automaticAwards = null;
  let automaticAwardWarning = null;
  try {
    automaticAwards = await finalizeCompetitionAwards(competitionId, req.user.id);
  } catch (error) {
    automaticAwardWarning = error.message;
    await audit({
      userId: req.user.id,
      actionCode: 'AUTO_WORLD_CUP_INDIVIDUAL_AWARDS_WARNING',
      entityTable: 'competitions',
      entityId: competitionId,
      details: { message: error.message }
    });
  }

  return ok(res, {
    message: automaticAwardWarning
      ? `Đã kết thúc World Cup và trao huy chương. Danh hiệu cá nhân chưa tự trao: ${automaticAwardWarning}`
      : `Đã kết thúc World Cup, trao huy chương và tự động trao ${automaticAwards?.assigned?.length || 0} danh hiệu cá nhân.`,
    automaticAwards,
    automaticAwardWarning
  });
});

module.exports = router;
