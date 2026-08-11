'use strict';

const {
  query,
  first,
  transaction,
  ApiError,
  audit
} = require('./db');
const { calculateRating } = require('./performance-rating-formula');

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

async function getSettings(connection) {
  const rows = await query(
    `SELECT setting_key,setting_value
     FROM system_settings
     WHERE setting_key IN ('TEAM_MVP_BASE_POINTS','MATCH_MVP_BASE_POINTS','PLAYER_RATING_POINT_MULTIPLIER')`,
    [],
    connection
  );
  const map = Object.fromEntries(rows.map((row) => [row.setting_key, number(row.setting_value)]));
  return {
    teamMvpBase: map.TEAM_MVP_BASE_POINTS || 1.5,
    matchMvpBase: map.MATCH_MVP_BASE_POINTS || 2.5,
    ratingMultiplier: map.PLAYER_RATING_POINT_MULTIPLIER || 0.6
  };
}

function comparePlayers(a, b) {
  if (b.rating !== a.rating) return b.rating - a.rating;
  if (number(b.stat.goals) !== number(a.stat.goals)) return number(b.stat.goals) - number(a.stat.goals);
  if (number(b.stat.assists) !== number(a.stat.assists)) return number(b.stat.assists) - number(a.stat.assists);
  const cardsA = number(a.stat.yellow_cards) + number(a.stat.red_cards) * 3;
  const cardsB = number(b.stat.yellow_cards) + number(b.stat.red_cards) * 3;
  if (cardsA !== cardsB) return cardsA - cardsB;
  if (number(b.stat.minutes_played) !== number(a.stat.minutes_played)) return number(b.stat.minutes_played) - number(a.stat.minutes_played);
  return number(a.stat.player_id) - number(b.stat.player_id);
}

async function getMatchContext(matchId, connection) {
  const match = await first(
    `SELECT m.*,comp.season_id,comp.coefficient,comp.name AS competition_name,
            hc.name AS home_club_name,ac.name AS away_club_name
     FROM matches m
     JOIN competitions comp ON comp.id=m.competition_id
     LEFT JOIN clubs hc ON hc.id=m.home_club_id
     LEFT JOIN clubs ac ON ac.id=m.away_club_id
     WHERE m.id=? LIMIT 1`,
    [matchId],
    connection
  );
  if (!match) throw new ApiError(404, 'Không tìm thấy trận đấu.');
  return match;
}

async function previewMatchRatings(matchId, connection = undefined) {
  const match = await getMatchContext(matchId, connection);
  const stats = await query(
    `SELECT pms.*,p.full_name,p.position,p.photo_url,p.shirt_number,c.name AS club_name,c.logo_url
     FROM player_match_stats pms
     JOIN players p ON p.id=pms.player_id
     JOIN clubs c ON c.id=pms.club_id
     WHERE pms.match_id=?
     ORDER BY pms.club_id,p.shirt_number,p.full_name`,
    [matchId],
    connection
  );

  const clubIds = [match.home_club_id, match.away_club_id].filter(Boolean).map(Number);
  const rosterRows = clubIds.length
    ? await query(
      `SELECT club_id,COUNT(*) AS total
       FROM competition_rosters
       WHERE competition_id=? AND status='ACTIVE' AND club_id IN (${clubIds.map(() => '?').join(',')})
       GROUP BY club_id`,
      [match.competition_id, ...clubIds],
      connection
    )
    : [];
  const expectedByClub = new Map(rosterRows.map((row) => [Number(row.club_id), number(row.total)]));
  const statsByClub = new Map();
  const verifiedByClub = new Map();
  const goalsByClub = new Map();
  for (const stat of stats) {
    const clubId = Number(stat.club_id);
    statsByClub.set(clubId, (statsByClub.get(clubId) || 0) + 1);
    if (['VERIFIED', 'LOCKED'].includes(stat.verification_status)) {
      verifiedByClub.set(clubId, (verifiedByClub.get(clubId) || 0) + 1);
      goalsByClub.set(clubId, (goalsByClub.get(clubId) || 0) + number(stat.goals));
    }
  }

  const reasons = [];
  if (match.status !== 'FINISHED') reasons.push('Trận đấu chưa kết thúc.');
  for (const clubId of clubIds) {
    const expected = expectedByClub.get(clubId) || 0;
    const actual = statsByClub.get(clubId) || 0;
    const verified = verifiedByClub.get(clubId) || 0;
    if (!actual) reasons.push(`CLB #${clubId} chưa nhập thống kê.`);
    if (expected && actual < expected) reasons.push(`CLB #${clubId} mới nhập ${actual}/${expected} cầu thủ trong danh sách giải.`);
    if (actual && verified < actual) reasons.push(`CLB #${clubId} còn ${actual - verified} dòng thống kê chưa được FIFA xác nhận.`);
  }
  if (match.status === 'FINISHED') {
    const homeGoals = goalsByClub.get(Number(match.home_club_id)) || 0;
    const awayGoals = goalsByClub.get(Number(match.away_club_id)) || 0;
    if (homeGoals !== number(match.home_score)) reasons.push(`Tổng bàn cầu thủ đội nhà là ${homeGoals}, tỷ số chính thức là ${number(match.home_score)}.`);
    if (awayGoals !== number(match.away_score)) reasons.push(`Tổng bàn cầu thủ đội khách là ${awayGoals}, tỷ số chính thức là ${number(match.away_score)}.`);
  }

  const players = stats
    .filter((stat) => ['VERIFIED', 'LOCKED'].includes(stat.verification_status))
    .map((stat) => {
      const calculated = calculateRating(stat, match);
      return { ...stat, rating: calculated.rating, breakdown: calculated.breakdown, stat };
    });

  const teamGroups = new Map();
  for (const player of players.filter((item) => item.appeared)) {
    const clubId = Number(player.club_id);
    if (!teamGroups.has(clubId)) teamGroups.set(clubId, []);
    teamGroups.get(clubId).push(player);
  }
  for (const group of teamGroups.values()) group.sort(comparePlayers);
  const allAppeared = players.filter((item) => item.appeared).sort(comparePlayers);
  const matchMvp = allAppeared[0] || null;
  const decorated = players.map((player) => {
    const group = teamGroups.get(Number(player.club_id)) || [];
    const teamRank = player.appeared ? group.findIndex((item) => Number(item.player_id) === Number(player.player_id)) + 1 : 0;
    return {
      ...player,
      team_rank: teamRank,
      is_team_mvp: teamRank === 1,
      is_match_mvp: Boolean(matchMvp && Number(matchMvp.player_id) === Number(player.player_id))
    };
  }).sort((a, b) => Number(a.club_id) - Number(b.club_id) || comparePlayers(a, b));

  return {
    match,
    ready: reasons.length === 0 && allAppeared.length > 0,
    reasons,
    players: decorated,
    team_mvps: decorated.filter((item) => item.is_team_mvp),
    match_mvp: decorated.find((item) => item.is_match_mvp) || null
  };
}

async function finalizeMatchRatingsInConnection(matchId, userId, options, connection) {
  const preview = await previewMatchRatings(matchId, connection);
  if (!preview.ready && !options.allowIncomplete) {
    throw new ApiError(400, `Chưa thể chốt điểm cầu thủ: ${preview.reasons.join(' ')}`, { reasons: preview.reasons });
  }
  const settings = await getSettings(connection);
  const coefficient = number(preview.match.coefficient, 1);
  const oldRows = await query(`SELECT id FROM match_player_ratings WHERE match_id=?`, [matchId], connection);
  if (oldRows.length) {
    const ids = oldRows.map((row) => Number(row.id));
    await query(
      `DELETE FROM player_ranking_points WHERE source_type='MATCH_RATING' AND source_id IN (${ids.map(() => '?').join(',')})`,
      ids,
      connection
    );
  }

  const finalized = [];
  for (const player of preview.players.filter((item) => item.appeared)) {
    const ratingPoints = Math.max(0, player.rating - 6) * settings.ratingMultiplier;
    const mvpPoints = (player.is_team_mvp ? settings.teamMvpBase : 0) + (player.is_match_mvp ? settings.matchMvpBase : 0);
    const points = round((ratingPoints + mvpPoints) * coefficient, 3);
    await query(
      `INSERT INTO match_player_ratings(
         match_id,competition_id,season_id,player_id,club_id,position,rating_score,team_rank,
         is_team_mvp,is_match_mvp,ranking_points_awarded,calculation_breakdown,finalized_by_user_id,finalized_at
       ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(6))
       ON DUPLICATE KEY UPDATE competition_id=VALUES(competition_id),season_id=VALUES(season_id),club_id=VALUES(club_id),
         position=VALUES(position),rating_score=VALUES(rating_score),team_rank=VALUES(team_rank),
         is_team_mvp=VALUES(is_team_mvp),is_match_mvp=VALUES(is_match_mvp),ranking_points_awarded=VALUES(ranking_points_awarded),
         calculation_breakdown=VALUES(calculation_breakdown),finalized_by_user_id=VALUES(finalized_by_user_id),finalized_at=NOW(6)`,
      [matchId, preview.match.competition_id, preview.match.season_id, player.player_id, player.club_id, player.position,
        player.rating, player.team_rank, player.is_team_mvp, player.is_match_mvp, points,
        JSON.stringify(player.breakdown), userId || null],
      connection
    );
    const ratingRow = await first(
      `SELECT id FROM match_player_ratings WHERE match_id=? AND player_id=?`,
      [matchId, player.player_id],
      connection
    );
    await query(`DELETE FROM player_ranking_points WHERE source_type='MATCH_RATING' AND source_id=?`, [ratingRow.id], connection);
    if (points > 0) {
      await query(
        `INSERT INTO player_ranking_points(player_id,season_id,competition_id,source_type,source_id,points,description)
         VALUES(?,?,?,'MATCH_RATING',?,?,?)`,
        [player.player_id, preview.match.season_id, preview.match.competition_id, ratingRow.id, points,
          `${player.is_match_mvp ? 'Cầu thủ hay nhất trận; ' : ''}${player.is_team_mvp ? 'hay nhất đội; ' : ''}điểm trận ${player.rating.toFixed(2)} × hệ số ${coefficient}`],
        connection
      );
    }
    finalized.push({
      rating_id: Number(ratingRow.id),
      player_id: Number(player.player_id),
      full_name: player.full_name,
      club_id: Number(player.club_id),
      rating: player.rating,
      team_rank: player.team_rank,
      is_team_mvp: player.is_team_mvp,
      is_match_mvp: player.is_match_mvp,
      ranking_points: points
    });
  }

  await audit({
    userId: userId || null,
    actionCode: 'FINALIZE_MATCH_PLAYER_RATINGS',
    entityTable: 'matches',
    entityId: matchId,
    details: { players: finalized.length, ready: preview.ready, coefficient }
  }, connection);
  return { ...preview, finalized };
}

async function finalizeMatchRatings(matchId, userId, options = {}) {
  return transaction((connection) => finalizeMatchRatingsInConnection(matchId, userId, options, connection));
}

async function finalizeAllCompetitionMatchRatings(competitionId, userId, { skipIncomplete = true } = {}) {
  const matches = await query(
    `SELECT id FROM matches WHERE competition_id=? AND status='FINISHED' ORDER BY id`,
    [competitionId]
  );
  const finalized = [];
  const skipped = [];
  for (const match of matches) {
    try {
      const result = await finalizeMatchRatings(Number(match.id), userId, { allowIncomplete: false });
      finalized.push({ match_id: Number(match.id), players: result.finalized.length });
    } catch (error) {
      if (!skipIncomplete) throw error;
      skipped.push({ match_id: Number(match.id), reason: error.message });
    }
  }
  return { total_matches: matches.length, finalized, skipped };
}

async function getCompetitionPerformance(competitionId, connection = undefined) {
  const competition = await first(
    `SELECT c.*,s.name AS season_name FROM competitions c JOIN seasons s ON s.id=c.season_id WHERE c.id=?`,
    [competitionId],
    connection
  );
  if (!competition) throw new ApiError(404, 'Không tìm thấy giải đấu.');
  const [rows, clubMatches, bonusRows] = await Promise.all([
    query(
      `SELECT * FROM v_competition_performance_leaderboard
       WHERE competition_id=? ORDER BY rank_position,player_id`,
      [competitionId],
      connection
    ),
    query(
      `SELECT club_id,COUNT(DISTINCT match_id) AS team_matches
       FROM (
         SELECT id AS match_id,home_club_id AS club_id FROM matches WHERE competition_id=? AND status='FINISHED' AND home_club_id IS NOT NULL
         UNION ALL
         SELECT id AS match_id,away_club_id AS club_id FROM matches WHERE competition_id=? AND status='FINISHED' AND away_club_id IS NOT NULL
       ) x GROUP BY club_id`,
      [competitionId, competitionId],
      connection
    ),
    query(`SELECT player_id,rank_position,awarded_points FROM competition_performance_bonuses WHERE competition_id=?`, [competitionId], connection)
  ]);
  const matchMap = new Map(clubMatches.map((row) => [Number(row.club_id), number(row.team_matches)]));
  const bonusMap = new Map(bonusRows.map((row) => [Number(row.player_id), row]));
  const leaderboard = rows.map((row) => {
    const teamMatches = matchMap.get(Number(row.club_id)) || number(row.appearances);
    const requiredAppearances = Math.max(2, Math.ceil(teamMatches * 0.5));
    return {
      ...row,
      team_matches: teamMatches,
      required_appearances: requiredAppearances,
      eligible: number(row.appearances) >= requiredAppearances,
      performance_bonus_rank: bonusMap.get(Number(row.player_id))?.rank_position || null,
      awarded_points: number(bonusMap.get(Number(row.player_id))?.awarded_points)
    };
  });
  const missing = await first(
    `SELECT COUNT(*) AS total
     FROM matches m
     WHERE m.competition_id=? AND m.status='FINISHED'
       AND NOT EXISTS(SELECT 1 FROM match_player_ratings r WHERE r.match_id=m.id)`,
    [competitionId],
    connection
  );
  return {
    competition,
    leaderboard,
    missing_rating_matches: number(missing?.total),
    ready: number(missing?.total) === 0 && leaderboard.some((row) => row.eligible)
  };
}

async function finalizeCompetitionPerformance(competitionId, userId, { allowIncomplete = false } = {}) {
  return transaction(async (connection) => {
    const performance = await getCompetitionPerformance(competitionId, connection);
    if (performance.competition.status !== 'FINISHED') throw new ApiError(400, 'Hãy kết thúc giải trước khi chốt thưởng hiệu suất.');
    if (!performance.ready && !allowIncomplete) {
      throw new ApiError(400, `Còn ${performance.missing_rating_matches} trận chưa có điểm cầu thủ hoặc chưa có cầu thủ đủ số trận tối thiểu.`);
    }

    const rules = await query(`SELECT * FROM performance_bonus_rules WHERE is_active=TRUE ORDER BY rank_from`, [], connection);
    const old = await query(`SELECT id,ranking_point_id FROM competition_performance_bonuses WHERE competition_id=?`, [competitionId], connection);
    const pointIds = old.map((row) => Number(row.ranking_point_id)).filter(Boolean);
    if (pointIds.length) {
      await query(`DELETE FROM player_ranking_points WHERE id IN (${pointIds.map(() => '?').join(',')})`, pointIds, connection);
    }
    await query(`DELETE FROM competition_performance_bonuses WHERE competition_id=?`, [competitionId], connection);

    const eligible = performance.leaderboard.filter((row) => row.eligible).slice(0, 10);
    const awarded = [];
    let actualRank = 0;
    for (const row of eligible) {
      actualRank += 1;
      const rule = rules.find((item) => actualRank >= number(item.rank_from) && actualRank <= number(item.rank_to));
      if (!rule) continue;
      const base = number(rule.base_points);
      const coefficient = number(performance.competition.coefficient, 1);
      const points = round(base * coefficient, 3);
      const inserted = await query(
        `INSERT INTO competition_performance_bonuses(
           competition_id,season_id,player_id,club_id,rank_position,average_rating,appearances,
           base_points,coefficient,awarded_points,awarded_by_user_id
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        [competitionId, performance.competition.season_id, row.player_id, row.club_id, actualRank,
          row.average_rating, row.appearances, base, coefficient, points, userId || null],
        connection
      );
      const point = await query(
        `INSERT INTO player_ranking_points(player_id,season_id,competition_id,source_type,source_id,points,description)
         VALUES(?,?,?,'PERFORMANCE_BONUS',?,?,?)`,
        [row.player_id, performance.competition.season_id, competitionId, inserted.insertId, points,
          `${rule.label}: hạng ${actualRank}, điểm trung bình ${number(row.average_rating).toFixed(2)} × hệ số ${coefficient}`],
        connection
      );
      await query(`UPDATE competition_performance_bonuses SET ranking_point_id=? WHERE id=?`, [point.insertId, inserted.insertId], connection);
      awarded.push({ player_id: Number(row.player_id), full_name: row.full_name, rank_position: actualRank, average_rating: number(row.average_rating), points });
    }
    await audit({
      userId: userId || null,
      actionCode: 'FINALIZE_COMPETITION_PERFORMANCE',
      entityTable: 'competitions',
      entityId: competitionId,
      details: { awarded }
    }, connection);
    return { ...performance, awarded };
  });
}

module.exports = {
  calculateRating,
  previewMatchRatings,
  finalizeMatchRatings,
  finalizeAllCompetitionMatchRatings,
  getCompetitionPerformance,
  finalizeCompetitionPerformance
};
