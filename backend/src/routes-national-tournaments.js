'use strict';

const crypto = require('crypto');
const express = require('express');
const {
  query, first, transaction, callProcedure, ApiError,
  parsePositiveInt, parseMoney, parseDecimal, parseEnum, parseText, parseDate,
  ok, audit
} = require('./db');
const { authenticate, requireAdmin } = require('./auth');
const { allocateConfederationQuotas, drawNationalKnockout } = require('./national-tournament-algorithms');

const router = express.Router();
const DRAW_MODES = ['SEEDED_CONSTRAINED', 'FULL_RANDOM'];
const THEMES = ['CONTINENTAL_GOLD', 'OCEAN_BLUE', 'EMERALD_NIGHT'];
const ROUND_DEFINITIONS = [
  ['R32', 'Vòng 32 đội', 1, 32, 16],
  ['R16', 'Vòng 16 đội', 2, 16, 8],
  ['QF', 'Tứ kết', 3, 8, 4],
  ['SF', 'Bán kết', 4, 4, 2],
  ['THIRD', 'Tranh hạng ba', 5, 2, 1],
  ['FINAL', 'Chung kết', 6, 2, 1]
];

async function getProfile(competitionId, connection = undefined) {
  const profile = await first(
    `SELECT ncp.*,c.series_id,c.season_id,c.name AS competition_name,c.logo_url,c.coefficient,
            c.status AS competition_status,c.starts_on,c.ends_on,c.created_by_user_id,
            cs.name AS series_name,s.name AS season_name,s.sequence_no
     FROM national_cup_profiles ncp
     JOIN competitions c ON c.id=ncp.competition_id
     JOIN competition_series cs ON cs.id=c.series_id
     JOIN seasons s ON s.id=c.season_id
     WHERE ncp.competition_id=?`,
    [competitionId], connection
  );
  if (!profile) throw new ApiError(404, 'Không tìm thấy giải quốc gia đặc biệt 32 đội.');
  return profile;
}

async function calculateQuotas() {
  const rows = await query(
    `SELECT confederation,COUNT(*) AS available_country_count
     FROM country_catalog WHERE is_active=TRUE GROUP BY confederation`
  );
  return allocateConfederationQuotas(rows, 32);
}

async function saveQuotas(competitionId, quotas, connection) {
  await query('DELETE FROM national_cup_confederation_quotas WHERE competition_id=?', [competitionId], connection);
  for (const quota of quotas) {
    await query(
      `INSERT INTO national_cup_confederation_quotas(
         competition_id,confederation,available_country_count,slot_count
       ) VALUES(?,?,?,?)`,
      [competitionId, quota.confederation, quota.available_country_count, quota.slot_count], connection
    );
  }
}

async function tournamentPayload(competitionId) {
  const profile = await getProfile(competitionId);
  const [quotas, entries, rounds, matches, results, rewardRules, awards] = await Promise.all([
    query(
      `SELECT q.*,COUNT(e.id) AS selected_count
       FROM national_cup_confederation_quotas q
       LEFT JOIN national_cup_entries e ON e.competition_id=q.competition_id
         AND e.confederation=q.confederation AND e.status='APPROVED'
       WHERE q.competition_id=? GROUP BY q.id ORDER BY q.slot_count DESC,q.confederation`, [competitionId]
    ),
    query(
      `SELECT e.*,p.full_name AS player_name,p.photo_url,p.position,c.name AS current_club_name,
              cc.name_en AS country_name_en,cc.flag_emoji
       FROM national_cup_entries e JOIN players p ON p.id=e.player_id
       LEFT JOIN clubs c ON c.id=p.club_id JOIN country_catalog cc ON cc.id=e.country_catalog_id
       WHERE e.competition_id=? ORDER BY e.seed_rank IS NULL,e.seed_rank,e.country_name`, [competitionId]
    ),
    query('SELECT * FROM national_cup_rounds WHERE competition_id=? ORDER BY round_order', [competitionId]),
    query(
      `SELECT m.*,r.round_code,r.round_name,r.round_order,
              he.country_name AS home_country_name,he.country_code AS home_country_code,he.flag_url AS home_flag_url,
              hp.full_name AS home_player_name,
              ae.country_name AS away_country_name,ae.country_code AS away_country_code,ae.flag_url AS away_flag_url,
              ap.full_name AS away_player_name,
              we.country_name AS winner_country_name,wp.full_name AS winner_player_name
       FROM national_cup_matches m JOIN national_cup_rounds r ON r.id=m.round_id
       LEFT JOIN national_cup_entries he ON he.id=m.home_entry_id LEFT JOIN players hp ON hp.id=he.player_id
       LEFT JOIN national_cup_entries ae ON ae.id=m.away_entry_id LEFT JOIN players ap ON ap.id=ae.player_id
       LEFT JOIN national_cup_entries we ON we.id=m.winner_entry_id LEFT JOIN players wp ON wp.id=we.player_id
       WHERE m.competition_id=? ORDER BY r.round_order,m.match_no`, [competitionId]
    ),
    query(
      `SELECT r.*,e.country_name,e.country_code,e.flag_url,p.full_name AS player_name,p.photo_url
       FROM national_cup_results r JOIN national_cup_entries e ON e.id=r.entry_id
       JOIN players p ON p.id=e.player_id WHERE r.competition_id=? ORDER BY r.placement`, [competitionId]
    ),
    query('SELECT * FROM national_competition_reward_rules WHERE competition_id=? ORDER BY placement_from', [competitionId]),
    query(
      `SELECT pa.*,atp.code AS award_code,atp.name AS award_name,atp.category,p.full_name AS player_name
       FROM player_awards pa JOIN award_types atp ON atp.id=pa.award_type_id
       JOIN players p ON p.id=pa.player_id
       WHERE pa.competition_id=? AND pa.award_context_type='NATIONAL_TEAM' ORDER BY pa.awarded_at`, [competitionId]
    )
  ]);
  return { profile, quotas, entries, rounds, matches, results, rewardRules, awards };
}

async function createBracket(competitionId, draw, userId, connection) {
  await query('DELETE FROM national_cup_match_links WHERE source_match_id IN (SELECT id FROM national_cup_matches WHERE competition_id=?)', [competitionId], connection);
  await query('DELETE FROM national_cup_matches WHERE competition_id=?', [competitionId], connection);
  await query('DELETE FROM national_cup_rounds WHERE competition_id=?', [competitionId], connection);

  const rounds = {};
  for (const [code, name, order, teamCount, matchCount] of ROUND_DEFINITIONS) {
    const inserted = await query(
      `INSERT INTO national_cup_rounds(competition_id,round_code,round_name,round_order,team_count,match_count,status)
       VALUES(?,?,?,?,?,?,?)`,
      [competitionId, code, name, order, teamCount, matchCount, code === 'R32' ? 'IN_PROGRESS' : 'PENDING'], connection
    );
    rounds[code] = { id: inserted.insertId, matchCount };
  }

  const matchIds = {};
  for (const [code] of ROUND_DEFINITIONS) {
    matchIds[code] = [];
    for (let index = 0; index < rounds[code].matchCount; index += 1) {
      const pair = code === 'R32' ? draw.pairs[index] : null;
      const sameConfederation = pair ? pair[0].confederation === pair[1].confederation : false;
      const inserted = await query(
        `INSERT INTO national_cup_matches(
           competition_id,round_id,match_no,home_entry_id,away_entry_id,same_confederation_pair,status
         ) VALUES(?,?,?,?,?,?,'SCHEDULED')`,
        [competitionId, rounds[code].id, index + 1, pair?.[0]?.id || null, pair?.[1]?.id || null, sameConfederation], connection
      );
      matchIds[code].push(inserted.insertId);
      if (pair) {
        await query('UPDATE national_cup_entries SET pot_no=? WHERE id=?', [draw.used_seeding ? 1 : null, pair[0].id], connection);
        await query('UPDATE national_cup_entries SET pot_no=? WHERE id=?', [draw.used_seeding ? 2 : null, pair[1].id], connection);
      }
    }
  }

  const linkWinners = async (sourceCode, targetCode) => {
    for (let index = 0; index < matchIds[sourceCode].length; index += 1) {
      await query(
        `INSERT INTO national_cup_match_links(source_match_id,source_result,target_match_id,target_slot)
         VALUES(?,'WINNER',?,?)`,
        [matchIds[sourceCode][index], matchIds[targetCode][Math.floor(index / 2)], index % 2 ? 'AWAY' : 'HOME'], connection
      );
    }
  };
  await linkWinners('R32', 'R16');
  await linkWinners('R16', 'QF');
  await linkWinners('QF', 'SF');
  for (let index = 0; index < matchIds.SF.length; index += 1) {
    const slot = index ? 'AWAY' : 'HOME';
    await query(
      `INSERT INTO national_cup_match_links(source_match_id,source_result,target_match_id,target_slot)
       VALUES(?,'WINNER',?,?)`, [matchIds.SF[index], matchIds.FINAL[0], slot], connection
    );
    await query(
      `INSERT INTO national_cup_match_links(source_match_id,source_result,target_match_id,target_slot)
       VALUES(?,'LOSER',?,?)`, [matchIds.SF[index], matchIds.THIRD[0], slot], connection
    );
  }
  await audit({
    userId, actionCode: 'DRAW_NATIONAL_SPECIAL_32', entityTable: 'competitions', entityId: competitionId,
    details: { usedSeeding: draw.used_seeding, explicitSeeds: draw.explicit_seed_count, sameConfederationMatches: draw.same_confederation_matches }
  }, connection);
}

function sortEliminated(entries) {
  return [...entries].sort((a, b) => Number(a.seed_rank || 9999) - Number(b.seed_rank || 9999)
    || Number(a.id) - Number(b.id));
}

async function buildPlacements(competitionId, connection) {
  const matches = await query(
    `SELECT m.*,r.round_code,e.seed_rank AS loser_seed_rank
     FROM national_cup_matches m JOIN national_cup_rounds r ON r.id=m.round_id
     LEFT JOIN national_cup_entries e ON e.id=m.loser_entry_id
     WHERE m.competition_id=?`, [competitionId], connection
  );
  const findOne = (code) => matches.find((match) => match.round_code === code);
  const finalMatch = findOne('FINAL');
  const thirdMatch = findOne('THIRD');
  if (!finalMatch || !thirdMatch || finalMatch.status !== 'FINISHED' || thirdMatch.status !== 'FINISHED') {
    throw new ApiError(400, 'Phải hoàn tất chung kết và trận tranh hạng ba trước khi kết thúc giải.');
  }
  const placements = [
    { placement: 1, entryId: finalMatch.winner_entry_id },
    { placement: 2, entryId: finalMatch.loser_entry_id },
    { placement: 3, entryId: thirdMatch.winner_entry_id },
    { placement: 4, entryId: thirdMatch.loser_entry_id }
  ];
  for (const [code, start] of [['QF', 5], ['R16', 9], ['R32', 17]]) {
    const eliminated = sortEliminated(matches.filter((match) => match.round_code === code && match.loser_entry_id)
      .map((match) => ({ id: match.loser_entry_id, seed_rank: match.loser_seed_rank })));
    eliminated.forEach((entry, index) => placements.push({ placement: start + index, entryId: entry.id }));
  }
  if (placements.length !== 32 || new Set(placements.map((item) => Number(item.entryId))).size !== 32) {
    throw new ApiError(400, 'Nhánh đấu chưa có đủ kết quả hợp lệ cho 32 quốc gia.');
  }
  return placements;
}

async function automaticAwardWinners(competitionId, placements, connection) {
  const placementMap = new Map(placements.map((item) => [Number(item.entryId), item.placement]));
  const rows = await query(
    `SELECT e.id AS entry_id,e.player_id,e.country_name,e.country_code,e.seed_rank,p.full_name,p.position,
            COUNT(x.match_id) AS appearances,COALESCE(SUM(x.goals_for),0) AS goals_for,
            COALESCE(SUM(x.goals_against),0) AS goals_against,
            COALESCE(SUM(x.goals_against=0),0) AS clean_sheets,
            COALESCE(SUM(x.won),0) AS wins
     FROM national_cup_entries e JOIN players p ON p.id=e.player_id
     LEFT JOIN (
       SELECT id AS match_id,home_entry_id AS entry_id,home_score AS goals_for,away_score AS goals_against,
              winner_entry_id=home_entry_id AS won FROM national_cup_matches WHERE competition_id=? AND status='FINISHED'
       UNION ALL
       SELECT id,away_entry_id,away_score,home_score,winner_entry_id=away_entry_id FROM national_cup_matches
       WHERE competition_id=? AND status='FINISHED'
     ) x ON x.entry_id=e.id
     WHERE e.competition_id=? GROUP BY e.id,e.player_id,e.country_name,e.country_code,e.seed_rank,p.full_name,p.position`,
    [competitionId, competitionId, competitionId], connection
  );
  rows.forEach((row) => {
    row.placement = placementMap.get(Number(row.entry_id)) || 99;
    row.performance = Number(row.wins) * 9 + Number(row.goals_for) * 3 + Number(row.clean_sheets) * 2
      - Number(row.goals_against) + Math.max(0, 12 - row.placement);
  });
  const baseTie = (a, b) => a.placement - b.placement || Number(a.seed_rank || 9999) - Number(b.seed_rank || 9999) || Number(a.entry_id) - Number(b.entry_id);
  const bestPlayer = [...rows].sort((a, b) => b.performance - a.performance || baseTie(a, b))[0];
  const topScorer = [...rows].sort((a, b) => Number(b.goals_for) - Number(a.goals_for) || b.performance - a.performance || baseTie(a, b))[0];
  const keepers = rows.filter((row) => row.position === 'GK');
  const bestGoalkeeper = [...keepers].sort((a, b) => Number(b.clean_sheets) - Number(a.clean_sheets)
    || Number(a.goals_against) - Number(b.goals_against) || baseTie(a, b))[0] || null;
  return [
    ['NATIONAL_SPECIAL_BEST_PLAYER', bestPlayer],
    ['NATIONAL_SPECIAL_TOP_SCORER', topScorer],
    ['NATIONAL_SPECIAL_BEST_GOALKEEPER', bestGoalkeeper]
  ].filter((item) => item[1]);
}

/* ========================================================================== */
/* CREATE, READ, ENTRIES AND QUOTAS                                           */
/* ========================================================================== */

router.post('/competitions/national-special-32', authenticate, requireAdmin, async (req, res) => {
  const seriesId = parsePositiveInt(req.body.series_id, 'series_id');
  const seasonId = parsePositiveInt(req.body.season_id, 'season_id');
  const name = parseText(req.body.name, 'name', { max: 180 });
  const logoUrl = parseText(req.body.logo_url, 'logo_url', { required: false, nullable: true, max: 500 });
  const coefficient = parseDecimal(req.body.coefficient || '1.500', 'coefficient', { min: 0.001, max: 99999 });
  const startsOn = parseDate(req.body.starts_on, 'starts_on');
  const endsOn = parseDate(req.body.ends_on, 'ends_on');
  const drawMode = parseEnum(req.body.draw_mode || 'SEEDED_CONSTRAINED', DRAW_MODES, 'draw_mode');
  const visualTheme = parseEnum(req.body.visual_theme || 'CONTINENTAL_GOLD', THEMES, 'visual_theme');
  const prizeFields = {
    champion: parseMoney(req.body.gold_prize_amount || 0, 'gold_prize_amount'),
    runnerUp: parseMoney(req.body.silver_prize_amount || 0, 'silver_prize_amount'),
    third: parseMoney(req.body.bronze_prize_amount || 0, 'bronze_prize_amount'),
    fourth: parseMoney(req.body.fourth_prize_amount || 0, 'fourth_prize_amount'),
    quarterfinal: parseMoney(req.body.quarterfinal_prize_amount || 0, 'quarterfinal_prize_amount'),
    round16: parseMoney(req.body.round16_prize_amount || 0, 'round16_prize_amount'),
    round32: parseMoney(req.body.round32_prize_amount || 0, 'round32_prize_amount')
  };
  const quotas = await calculateQuotas();
  const competitionId = await transaction(async (connection) => {
    const inserted = await query(
      `INSERT INTO competitions(
         series_id,season_id,name,logo_url,format_type,coefficient,entry_fee,status,
         group_count,teams_per_group,advance_per_group,best_third_count,group_leg_mode,
         knockout_size,third_place_mode,starts_on,ends_on,created_by_user_id
       ) VALUES(?,?,?,?,'KNOCKOUT_ONLY',?,0,'DRAFT',0,0,0,0,'ONE_LEG',32,'PLAYOFF',?,?,?)`,
      [seriesId, seasonId, name, logoUrl, coefficient, startsOn, endsOn, req.user.id], connection
    );
    await query(
      'INSERT INTO national_cup_profiles(competition_id,draw_mode,visual_theme) VALUES(?,?,?)',
      [inserted.insertId, drawMode, visualTheme], connection
    );
    await saveQuotas(inserted.insertId, quotas, connection);
    const rules = [
      [1, 1, 'Vô địch', prizeFields.champion, 100, 'GOLD'],
      [2, 2, 'Á quân', prizeFields.runnerUp, 70, 'SILVER'],
      [3, 3, 'Hạng ba', prizeFields.third, 50, 'BRONZE'],
      [4, 4, 'Hạng tư', prizeFields.fourth, 38, 'NONE'],
      [5, 8, 'Tứ kết', prizeFields.quarterfinal, 28, 'NONE'],
      [9, 16, 'Vòng 16 đội', prizeFields.round16, 16, 'NONE'],
      [17, 32, 'Vòng 32 đội', prizeFields.round32, 6, 'NONE']
    ];
    for (const rule of rules) {
      await query(
        `INSERT INTO national_competition_reward_rules(
           competition_id,placement_from,placement_to,placement_label,prize_amount,base_ranking_points,medal_type
         ) VALUES(?,?,?,?,?,?,?)`, [inserted.insertId, ...rule], connection
      );
    }
    await audit({
      userId: req.user.id, actionCode: 'CREATE_NATIONAL_SPECIAL_32', entityTable: 'competitions',
      entityId: inserted.insertId, details: { coefficient, drawMode, quotas }
    }, connection);
    return inserted.insertId;
  });
  return ok(res, await tournamentPayload(competitionId), 201);
});

router.get('/competitions/:id/national-tournament', async (req, res) => {
  return ok(res, await tournamentPayload(parsePositiveInt(req.params.id)));
});

router.post('/competitions/:id/national-tournament/recalculate-quotas', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getProfile(competitionId);
  if (profile.entries_locked_at) throw new ApiError(400, 'Nhánh đã được bốc thăm; không thể tính lại suất châu lục.');
  const quotas = await calculateQuotas();
  await transaction(async (connection) => {
    const existing = await query(
      `SELECT confederation,COUNT(*) AS total FROM national_cup_entries
       WHERE competition_id=? AND status='APPROVED' GROUP BY confederation`, [competitionId], connection
    );
    for (const row of existing) {
      const quota = quotas.find((item) => item.confederation === row.confederation);
      if (!quota || Number(row.total) > quota.slot_count) {
        throw new ApiError(400, `Danh sách hiện có vượt suất mới của ${row.confederation}. Hãy giảm số đội trước.`);
      }
    }
    await saveQuotas(competitionId, quotas, connection);
    await audit({ userId: req.user.id, actionCode: 'RECALCULATE_NATIONAL_QUOTAS', entityTable: 'competitions', entityId: competitionId, details: { quotas } }, connection);
  });
  return ok(res, { message: 'Đã tính lại 32 suất theo thư viện quốc gia hiện tại.', quotas });
});

router.put('/competitions/:id/national-tournament/entries', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getProfile(competitionId);
  if (profile.entries_locked_at) throw new ApiError(400, 'Danh sách đã khóa sau khi bốc thăm.');
  if (!Array.isArray(req.body.entries)) throw new ApiError(400, 'entries phải là một danh sách.');
  if (req.body.entries.length > 32) throw new ApiError(400, 'Giải chỉ nhận tối đa 32 quốc gia.');
  const normalized = req.body.entries.map((entry, index) => ({
    playerId: parsePositiveInt(entry.player_id, `entries[${index}].player_id`),
    seedRank: entry.seed_rank ? parsePositiveInt(entry.seed_rank, `entries[${index}].seed_rank`, { max: 999 }) : null
  }));
  if (new Set(normalized.map((item) => item.playerId)).size !== normalized.length) throw new ApiError(400, 'Một cầu thủ bị chọn nhiều lần.');
  const seeds = normalized.map((item) => item.seedRank).filter(Boolean);
  if (new Set(seeds).size !== seeds.length) throw new ApiError(400, 'Thứ hạng hạt giống không được trùng nhau.');

  await transaction(async (connection) => {
    const entries = [];
    for (const item of normalized) {
      const nationalProfile = await first(
        `SELECT np.*,cc.id AS catalog_id,cc.name_vi AS catalog_name_vi,cc.fifa_code,cc.confederation AS catalog_confederation,
                cc.flag_url AS catalog_flag_url,cc.is_active AS catalog_active
         FROM player_national_profiles np LEFT JOIN country_catalog cc ON cc.id=np.country_catalog_id
         WHERE np.player_id=? AND np.is_active=TRUE`, [item.playerId], connection
      );
      if (!nationalProfile?.catalog_id || !nationalProfile.catalog_active) {
        throw new ApiError(400, `Cầu thủ ${item.playerId} chưa có hồ sơ quốc gia hợp lệ trong thư viện.`);
      }
      entries.push({
        ...item, countryCatalogId: nationalProfile.catalog_id,
        countryName: nationalProfile.catalog_name_vi || nationalProfile.country_name,
        countryCode: nationalProfile.fifa_code || nationalProfile.country_code,
        flagUrl: nationalProfile.catalog_flag_url || nationalProfile.flag_url,
        confederation: nationalProfile.catalog_confederation || nationalProfile.confederation
      });
    }
    if (new Set(entries.map((item) => Number(item.countryCatalogId))).size !== entries.length) {
      throw new ApiError(400, 'Mỗi quốc gia chỉ được có một cầu thủ đại diện trong giải.');
    }
    const quotas = await query('SELECT * FROM national_cup_confederation_quotas WHERE competition_id=?', [competitionId], connection);
    for (const quota of quotas) {
      const selected = entries.filter((item) => item.confederation === quota.confederation).length;
      if (selected > Number(quota.slot_count)) throw new ApiError(400, `${quota.confederation} chỉ có ${quota.slot_count} suất.`);
    }
    await query('DELETE FROM national_cup_entries WHERE competition_id=?', [competitionId], connection);
    for (const entry of entries) {
      await query(
        `INSERT INTO national_cup_entries(
           competition_id,player_id,country_catalog_id,country_name,country_code,flag_url,confederation,seed_rank
         ) VALUES(?,?,?,?,?,?,?,?)`,
        [competitionId, entry.playerId, entry.countryCatalogId, entry.countryName, entry.countryCode,
          entry.flagUrl, entry.confederation, entry.seedRank], connection
      );
    }
    await audit({
      userId: req.user.id, actionCode: 'SAVE_NATIONAL_SPECIAL_ENTRIES', entityTable: 'competitions',
      entityId: competitionId, details: { entryCount: entries.length }
    }, connection);
  });
  return ok(res, { message: `Đã lưu ${normalized.length}/32 quốc gia.`, entries: (await tournamentPayload(competitionId)).entries });
});

/* ========================================================================== */
/* DRAW, MATCH RESULTS, REWARDS AND FINALIZATION                              */
/* ========================================================================== */

router.post('/competitions/:id/national-tournament/draw', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getProfile(competitionId);
  const mode = parseEnum(req.body.mode || profile.draw_mode, DRAW_MODES, 'mode');
  const [entries, quotas] = await Promise.all([
    query("SELECT * FROM national_cup_entries WHERE competition_id=? AND status='APPROVED' ORDER BY seed_rank IS NULL,seed_rank,id", [competitionId]),
    query('SELECT * FROM national_cup_confederation_quotas WHERE competition_id=?', [competitionId])
  ]);
  if (entries.length !== 32) throw new ApiError(400, `Cần đúng 32 quốc gia; hiện có ${entries.length}.`);
  for (const quota of quotas) {
    const actual = entries.filter((entry) => entry.confederation === quota.confederation).length;
    if (actual !== Number(quota.slot_count)) throw new ApiError(400, `${quota.confederation} cần đúng ${quota.slot_count} suất; hiện có ${actual}.`);
  }
  const draw = drawNationalKnockout(entries, mode);
  await transaction(async (connection) => {
    const finished = await first("SELECT COUNT(*) AS total FROM national_cup_matches WHERE competition_id=? AND status='FINISHED'", [competitionId], connection);
    if (Number(finished.total)) throw new ApiError(400, 'Đã có tỷ số nên không thể bốc thăm lại.');
    await createBracket(competitionId, draw, req.user.id, connection);
    await query(
      `UPDATE national_cup_profiles SET draw_mode=?,entries_locked_at=CURRENT_TIMESTAMP(6),bracket_drawn_at=CURRENT_TIMESTAMP(6)
       WHERE competition_id=?`, [mode, competitionId], connection
    );
    await query("UPDATE competitions SET status='KNOCKOUT_STAGE' WHERE id=?", [competitionId], connection);
  });
  return ok(res, {
    message: `Đã tạo nhánh 32 đội${draw.used_seeding ? ` với ${draw.explicit_seed_count} hạt giống khai báo` : ' theo chế độ ngẫu nhiên'}.`,
    warning: draw.warning, sameConfederationMatches: draw.same_confederation_matches
  });
});

router.post('/national-tournament/matches/:id/result', authenticate, requireAdmin, async (req, res) => {
  const matchId = parsePositiveInt(req.params.id);
  const homeScore = parsePositiveInt(req.body.home_score, 'home_score', { min: 0, max: 99 });
  const awayScore = parsePositiveInt(req.body.away_score, 'away_score', { min: 0, max: 99 });
  const homePenalty = req.body.home_penalty_score === '' || req.body.home_penalty_score == null
    ? null : parsePositiveInt(req.body.home_penalty_score, 'home_penalty_score', { min: 0, max: 99 });
  const awayPenalty = req.body.away_penalty_score === '' || req.body.away_penalty_score == null
    ? null : parsePositiveInt(req.body.away_penalty_score, 'away_penalty_score', { min: 0, max: 99 });
  const note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 500 });
  await transaction(async (connection) => {
    const match = await first('SELECT * FROM national_cup_matches WHERE id=? FOR UPDATE', [matchId], connection);
    if (!match) throw new ApiError(404, 'Không tìm thấy trận đấu.');
    const finalized = await first('SELECT tournament_finalized_at FROM national_cup_profiles WHERE competition_id=?', [match.competition_id], connection);
    if (finalized?.tournament_finalized_at) throw new ApiError(400, 'Giải đã chốt nên không thể sửa tỷ số.');
    if (!match.home_entry_id || !match.away_entry_id) throw new ApiError(400, 'Trận đấu chưa đủ hai quốc gia.');
    let winnerId;
    let loserId;
    if (homeScore !== awayScore) {
      winnerId = homeScore > awayScore ? match.home_entry_id : match.away_entry_id;
      loserId = homeScore > awayScore ? match.away_entry_id : match.home_entry_id;
    } else {
      if (homePenalty == null || awayPenalty == null || homePenalty === awayPenalty) {
        throw new ApiError(400, 'Trận loại trực tiếp hòa phải nhập tỷ số luân lưu khác nhau.');
      }
      winnerId = homePenalty > awayPenalty ? match.home_entry_id : match.away_entry_id;
      loserId = homePenalty > awayPenalty ? match.away_entry_id : match.home_entry_id;
    }
    await query(
      `UPDATE national_cup_matches SET home_score=?,away_score=?,home_penalty_score=?,away_penalty_score=?,
       winner_entry_id=?,loser_entry_id=?,status='FINISHED',note=?,finished_at=CURRENT_TIMESTAMP(6) WHERE id=?`,
      [homeScore, awayScore, homePenalty, awayPenalty, winnerId, loserId, note, matchId], connection
    );
    const links = await query('SELECT * FROM national_cup_match_links WHERE source_match_id=?', [matchId], connection);
    for (const link of links) {
      const entryId = link.source_result === 'WINNER' ? winnerId : loserId;
      const column = link.target_slot === 'HOME' ? 'home_entry_id' : 'away_entry_id';
      await query(`UPDATE national_cup_matches SET ${column}=? WHERE id=?`, [entryId, link.target_match_id], connection);
      const target = await first('SELECT round_id,home_entry_id,away_entry_id FROM national_cup_matches WHERE id=?', [link.target_match_id], connection);
      if (target.home_entry_id && target.away_entry_id) {
        await query("UPDATE national_cup_rounds SET status='IN_PROGRESS' WHERE id=? AND status='PENDING'", [target.round_id], connection);
      }
    }
    const remaining = await first("SELECT COUNT(*) AS total FROM national_cup_matches WHERE round_id=? AND status<>'FINISHED'", [match.round_id], connection);
    if (!Number(remaining.total)) await query("UPDATE national_cup_rounds SET status='FINISHED' WHERE id=?", [match.round_id], connection);
    const lastPending = await first("SELECT COUNT(*) AS total FROM national_cup_matches WHERE competition_id=? AND status<>'FINISHED'", [match.competition_id], connection);
    if (!Number(lastPending.total)) await query("UPDATE competitions SET status='COMPLETED_PENDING_CLOSE' WHERE id=?", [match.competition_id], connection);
    await audit({ userId: req.user.id, actionCode: 'SET_NATIONAL_SPECIAL_RESULT', entityTable: 'national_cup_matches', entityId: matchId, details: { homeScore, awayScore, homePenalty, awayPenalty } }, connection);
  });
  return ok(res, { message: 'Đã lưu tỷ số và tự động đẩy đội thắng sang vòng kế tiếp.' });
});

router.put('/competitions/:id/national-tournament/reward-rules', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getProfile(competitionId);
  if (profile.tournament_finalized_at) throw new ApiError(400, 'Giải đã chốt nên không thể sửa tiền thưởng.');
  if (!Array.isArray(req.body.rules)) throw new ApiError(400, 'rules phải là một danh sách.');
  await transaction(async (connection) => {
    for (const [index, rule] of req.body.rules.entries()) {
      const id = parsePositiveInt(rule.id, `rules[${index}].id`);
      const prize = parseMoney(rule.prize_amount || 0, `rules[${index}].prize_amount`);
      const result = await query(
        'UPDATE national_competition_reward_rules SET prize_amount=? WHERE id=? AND competition_id=?',
        [prize, id, competitionId], connection
      );
      if (!result.affectedRows) throw new ApiError(404, 'Không tìm thấy quy tắc tiền thưởng của giải.');
    }
    await audit({ userId: req.user.id, actionCode: 'UPDATE_NATIONAL_SPECIAL_PRIZES', entityTable: 'competitions', entityId: competitionId }, connection);
  });
  return ok(res, { message: 'Đã lưu tiền thưởng. Điểm cơ bản vẫn được khóa để giữ cân bằng.' });
});

router.post('/competitions/:id/national-tournament/finalize', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getProfile(competitionId);
  if (profile.tournament_finalized_at) throw new ApiError(400, 'Giải đã được kết thúc trước đó.');
  await transaction(async (connection) => {
    const placements = await buildPlacements(competitionId, connection);
    const rules = await query('SELECT * FROM national_competition_reward_rules WHERE competition_id=? ORDER BY placement_from', [competitionId], connection);
    if (rules.length !== 7) throw new ApiError(400, 'Bộ quy tắc điểm/thưởng của giải chưa đầy đủ.');
    const enriched = [];
    for (const item of placements) {
      const entry = await first('SELECT * FROM national_cup_entries WHERE id=?', [item.entryId], connection);
      const rule = rules.find((candidate) => item.placement >= Number(candidate.placement_from) && item.placement <= Number(candidate.placement_to));
      if (!entry || !rule) throw new ApiError(500, 'Không xác định được quốc gia hoặc quy tắc thứ hạng.');
      enriched.push({
        ...item, entry, rule,
        rankingPoints: (Number(rule.base_ranking_points) * Number(profile.coefficient)).toFixed(3),
        prize: String(rule.prize_amount || '0')
      });
    }
    const fifaWallet = await first("SELECT * FROM wallets WHERE wallet_type='FIFA' FOR UPDATE", [], connection);
    const totalPrize = enriched.reduce((sum, item) => sum + BigInt(item.prize), 0n);
    if (totalPrize > 0n && (!fifaWallet || BigInt(fifaWallet.balance) < totalPrize)) {
      throw new ApiError(400, `Ví FIFA không đủ tiền thưởng. Cần ${totalPrize.toString()}.`);
    }
    await query("DELETE FROM player_ranking_points WHERE competition_id=? AND ranking_scope='NATIONAL_TEAM'", [competitionId], connection);
    await query("DELETE FROM player_awards WHERE competition_id=? AND award_context_type='NATIONAL_TEAM'", [competitionId], connection);
    await query('DELETE FROM national_cup_results WHERE competition_id=?', [competitionId], connection);

    const medalCodes = { GOLD: 'NATIONAL_SPECIAL_GOLD', SILVER: 'NATIONAL_SPECIAL_SILVER', BRONZE: 'NATIONAL_SPECIAL_BRONZE' };
    for (const item of enriched) {
      const insertedResult = await query(
        `INSERT INTO national_cup_results(
           competition_id,entry_id,placement,medal_type,ranking_points,prize_amount,confirmed_by_user_id
         ) VALUES(?,?,?,?,?,?,?)`,
        [competitionId, item.entry.id, item.placement, item.rule.medal_type, item.rankingPoints, item.prize, req.user.id], connection
      );
      if (item.rule.medal_type !== 'NONE') {
        const awardType = await first('SELECT * FROM award_types WHERE code=?', [medalCodes[item.rule.medal_type]], connection);
        const award = await query(
          `INSERT INTO player_awards(
             player_id,club_id_at_award,award_context_type,country_name_at_award,country_code_at_award,
             competition_id,season_id,award_type_id,display_name,awarded_points,assigned_by_user_id,is_locked
           ) VALUES(?,NULL,'NATIONAL_TEAM',?,?,?,?,?,?,?,?,TRUE)`,
          [item.entry.player_id, item.entry.country_name, item.entry.country_code, competitionId, profile.season_id,
            awardType.id, `${awardType.name} – ${profile.competition_name} (${item.entry.country_name})`,
            item.rankingPoints, req.user.id], connection
        );
        await query(
          `INSERT INTO player_ranking_points(
             player_id,season_id,competition_id,source_type,source_id,ranking_scope,points,description
           ) VALUES(?,?,?,'AWARD',?,'NATIONAL_TEAM',?,?)`,
          [item.entry.player_id, profile.season_id, competitionId, award.insertId, item.rankingPoints,
            `${awardType.name} – ${item.entry.country_name}`], connection
        );
      } else {
        await query(
          `INSERT INTO player_ranking_points(
             player_id,season_id,competition_id,source_type,source_id,ranking_scope,points,description
           ) VALUES(?,?,?,'BONUS',?,'NATIONAL_TEAM',?,?)`,
          [item.entry.player_id, profile.season_id, competitionId, insertedResult.insertId, item.rankingPoints,
            `${item.rule.placement_label} – ${profile.competition_name} (${item.entry.country_name})`], connection
        );
      }
      if (BigInt(item.prize) > 0n) {
        const playerWallet = await first("SELECT * FROM wallets WHERE wallet_type='PLAYER' AND player_id=? FOR UPDATE", [item.entry.player_id], connection);
        if (!playerWallet) throw new ApiError(500, `Cầu thủ ${item.entry.player_id} chưa có ví.`);
        await callProcedure('sp_wallet_transfer_core', [
          fifaWallet.id, playerWallet.id, 'PRIZE', item.prize,
          `NS32-${competitionId}-P${item.placement}-${crypto.randomBytes(4).toString('hex')}`,
          'national_cup_results', insertedResult.insertId,
          `Tiền thưởng ${item.rule.placement_label} – ${item.entry.country_name}`, req.user.id
        ], connection);
      }
    }

    const winners = await automaticAwardWinners(competitionId, placements, connection);
    for (const [awardCode, winner] of winners) {
      const awardType = await first('SELECT * FROM award_types WHERE code=? AND is_active=TRUE', [awardCode], connection);
      const points = (Number(awardType.base_ranking_points) * Number(profile.coefficient)).toFixed(3);
      const award = await query(
        `INSERT INTO player_awards(
           player_id,club_id_at_award,award_context_type,country_name_at_award,country_code_at_award,
           competition_id,season_id,award_type_id,display_name,awarded_points,assigned_by_user_id,is_locked
         ) VALUES(?,NULL,'NATIONAL_TEAM',?,?,?,?,?,?,?,?,TRUE)`,
        [winner.player_id, winner.country_name, winner.country_code, competitionId, profile.season_id,
          awardType.id, `${awardType.name} – ${profile.competition_name} (${winner.country_name})`, points, req.user.id], connection
      );
      await query(
        `INSERT INTO player_ranking_points(
           player_id,season_id,competition_id,source_type,source_id,ranking_scope,points,description
         ) VALUES(?,?,?,'AWARD',?,'NATIONAL_TEAM',?,?)`,
        [winner.player_id, profile.season_id, competitionId, award.insertId, points,
          `${awardType.name} – ${winner.country_name}`], connection
      );
    }
    await query('UPDATE national_cup_profiles SET tournament_finalized_at=CURRENT_TIMESTAMP(6) WHERE competition_id=?', [competitionId], connection);
    await query("UPDATE competitions SET status='FINISHED',rewards_processed_at=CURRENT_TIMESTAMP(6) WHERE id=?", [competitionId], connection);
    await audit({
      userId: req.user.id, actionCode: 'FINALIZE_NATIONAL_SPECIAL_32', entityTable: 'competitions', entityId: competitionId,
      details: { resultCount: enriched.length, automaticAwards: winners.map((item) => item[0]), totalPrize: totalPrize.toString() }
    }, connection);
  });
  return ok(res, { message: 'Đã chốt đủ hạng 1–32, trao huy chương, danh hiệu cá nhân, tiền thưởng và điểm quốc gia/tổng thể.' });
});

router.post('/competitions/:id/national-tournament/reset', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id);
  const profile = await getProfile(competitionId);
  if (profile.tournament_finalized_at) {
    throw new ApiError(400, 'Giải đã chi thưởng nên không thể reset để tránh trả tiền trùng. Hãy tạo kỳ giải mới.');
  }
  await transaction(async (connection) => {
    await query("DELETE FROM player_ranking_points WHERE competition_id=? AND ranking_scope='NATIONAL_TEAM'", [competitionId], connection);
    await query("DELETE FROM player_awards WHERE competition_id=? AND award_context_type='NATIONAL_TEAM'", [competitionId], connection);
    await query('DELETE FROM national_cup_results WHERE competition_id=?', [competitionId], connection);
    await query('DELETE FROM national_cup_match_links WHERE source_match_id IN (SELECT id FROM national_cup_matches WHERE competition_id=?)', [competitionId], connection);
    await query('DELETE FROM national_cup_matches WHERE competition_id=?', [competitionId], connection);
    await query('DELETE FROM national_cup_rounds WHERE competition_id=?', [competitionId], connection);
    await query('UPDATE national_cup_entries SET pot_no=NULL WHERE competition_id=?', [competitionId], connection);
    await query('UPDATE national_cup_profiles SET entries_locked_at=NULL,bracket_drawn_at=NULL,tournament_finalized_at=NULL WHERE competition_id=?', [competitionId], connection);
    await query("UPDATE competitions SET status='DRAFT',rewards_processed_at=NULL WHERE id=?", [competitionId], connection);
    await audit({ userId: req.user.id, actionCode: 'RESET_NATIONAL_SPECIAL_32', entityTable: 'competitions', entityId: competitionId }, connection);
  });
  return ok(res, { message: 'Đã xóa nhánh, tỷ số, hạng, điểm và giải thưởng; giữ nguyên 32 quốc gia và cấu hình tiền thưởng.' });
});

module.exports = router;
