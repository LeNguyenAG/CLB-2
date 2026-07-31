'use strict';

const {
  query,
  first,
  transaction,
  ApiError,
  audit
} = require('./db');

const METRIC_LABELS = {
  OVERALL: 'Điểm hiệu suất',
  GOALS: 'Bàn thắng',
  ASSISTS: 'Kiến tạo',
  CLEAN_SHEETS: 'Trận sạch lưới',
  GOALKEEPER: 'Chỉ số thủ môn'
};

function number(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function primaryValue(row, metricCode) {
  switch (metricCode) {
    case 'GOALS': return number(row.goals);
    case 'ASSISTS': return number(row.assists);
    case 'CLEAN_SHEETS': return number(row.clean_sheets);
    case 'GOALKEEPER': return number(row.goalkeeper_score);
    case 'OVERALL':
    default: return number(row.performance_score);
  }
}

function compareCandidates(metricCode) {
  return (left, right) => {
    const desc = (field) => number(right[field]) - number(left[field]);
    const asc = (field) => number(left[field]) - number(right[field]);
    let result = 0;
    if (metricCode === 'GOALS') {
      result = desc('goals') || desc('assists') || asc('appearances');
    } else if (metricCode === 'ASSISTS') {
      result = desc('assists') || desc('goals') || asc('appearances');
    } else if (metricCode === 'CLEAN_SHEETS') {
      result = desc('clean_sheets') || asc('goals_conceded') || desc('appearances');
    } else if (metricCode === 'GOALKEEPER') {
      result = desc('clean_sheets')
        || (number(left.goals_conceded) / Math.max(1, number(left.appearances))
          - number(right.goals_conceded) / Math.max(1, number(right.appearances)))
        || desc('goalkeeper_score')
        || desc('appearances');
    } else {
      result = desc('performance_score') || desc('goals') || desc('assists') || desc('clean_sheets');
    }
    return result || number(left.player_id) - number(right.player_id);
  };
}

async function competitionMeta(competitionId, connection = undefined) {
  const row = await first(
    `SELECT c.id, c.name, c.season_id, c.coefficient, c.status,
            s.name AS season_name,
            CASE WHEN wcp.competition_id IS NULL THEN FALSE ELSE TRUE END AS is_world_cup
     FROM competitions c
     JOIN seasons s ON s.id = c.season_id
     LEFT JOIN world_cup_profiles wcp ON wcp.competition_id = c.id
     WHERE c.id = ?`,
    [competitionId],
    connection
  );
  if (!row) throw new ApiError(404, 'Không tìm thấy giải đấu.');
  return row;
}

async function statisticsCoverage(meta, connection = undefined) {
  if (meta.is_world_cup) {
    const totals = await first(
      `SELECT COUNT(*) AS total_matches,
              SUM(status='FINISHED') AS finished_matches
       FROM world_cup_matches WHERE competition_id = ? AND status <> 'CANCELLED'`,
      [meta.id],
      connection
    );
    const total = number(totals?.total_matches);
    const finished = number(totals?.finished_matches);
    return {
      mode: 'WORLD_CUP_DERIVED',
      total_matches: total,
      finished_matches: finished,
      matches_with_statistics: finished,
      pending_stat_rows: 0,
      ready: total > 0 && total === finished,
      message: total > 0 && total === finished
        ? 'Thống kê World Cup được tính trực tiếp từ tỷ số toàn bộ trận đấu.'
        : `World Cup mới hoàn tất ${finished}/${total} trận.`
    };
  }

  const [matches, stats, mismatch] = await Promise.all([
    first(
      `SELECT COUNT(*) AS total_matches,
              SUM(status='FINISHED') AS finished_matches
       FROM matches WHERE competition_id = ? AND status <> 'CANCELLED'`,
      [meta.id],
      connection
    ),
    first(
      `SELECT
         COUNT(DISTINCT CASE WHEN pms.verification_status IN ('VERIFIED','LOCKED')
           THEN CONCAT(pms.match_id,'-',pms.club_id) END) AS verified_team_sheets,
         COUNT(DISTINCT CASE WHEN pms.verification_status IN ('VERIFIED','LOCKED')
           THEN pms.match_id END) AS matches_with_statistics,
         SUM(pms.verification_status='PENDING') AS pending_stat_rows
       FROM player_match_stats pms
       JOIN matches m ON m.id=pms.match_id
       WHERE m.competition_id = ? AND m.status='FINISHED'`,
      [meta.id],
      connection
    ),
    first(
      `SELECT COUNT(*) AS goal_mismatch_count
       FROM (
         SELECT expected.match_id, expected.club_id, expected.official_goals,
                COALESCE(SUM(CASE WHEN pms.verification_status IN ('VERIFIED','LOCKED') THEN pms.goals ELSE 0 END),0) AS entered_goals
         FROM (
           SELECT id AS match_id, home_club_id AS club_id, home_score AS official_goals
           FROM matches WHERE competition_id=? AND status='FINISHED'
           UNION ALL
           SELECT id AS match_id, away_club_id AS club_id, away_score AS official_goals
           FROM matches WHERE competition_id=? AND status='FINISHED'
         ) expected
         LEFT JOIN player_match_stats pms ON pms.match_id=expected.match_id AND pms.club_id=expected.club_id
         GROUP BY expected.match_id, expected.club_id, expected.official_goals
         HAVING entered_goals <> expected.official_goals
       ) mismatches`,
      [meta.id, meta.id],
      connection
    )
  ]);
  const total = number(matches?.total_matches);
  const finished = number(matches?.finished_matches);
  const withStats = number(stats?.matches_with_statistics);
  const pending = number(stats?.pending_stat_rows);
  const verifiedTeamSheets = number(stats?.verified_team_sheets);
  const expectedTeamSheets = finished * 2;
  const goalMismatchCount = number(mismatch?.goal_mismatch_count);
  const ready = total > 0 && total === finished
    && verifiedTeamSheets === expectedTeamSheets
    && pending === 0 && goalMismatchCount === 0;
  return {
    mode: 'VERIFIED_MATCH_STATS',
    total_matches: total,
    finished_matches: finished,
    matches_with_statistics: withStats,
    verified_team_sheets: verifiedTeamSheets,
    expected_team_sheets: expectedTeamSheets,
    pending_stat_rows: pending,
    goal_mismatch_count: goalMismatchCount,
    ready,
    message: ready
      ? 'Toàn bộ trận đã kết thúc; thống kê hai đội đã được FIFA xác nhận và tổng bàn thắng khớp tỷ số.'
      : `Hoàn tất ${finished}/${total} trận; ${verifiedTeamSheets}/${expectedTeamSheets} bảng thống kê đội đã duyệt; ${goalMismatchCount} bảng không khớp tỷ số; còn ${pending} dòng chờ duyệt.`
  };
}

async function previewCompetitionAwards(competitionId, connection = undefined) {
  const meta = await competitionMeta(competitionId, connection);
  const [coverage, rules, candidates, assigned] = await Promise.all([
    statisticsCoverage(meta, connection),
    query(
      `SELECT ar.*, atp.code AS award_code, atp.name AS award_name,
              atp.base_ranking_points, atp.category
       FROM award_auto_rules ar
       JOIN award_types atp ON atp.id=ar.award_type_id
       WHERE ar.auto_enabled=TRUE AND atp.is_active=TRUE
       ORDER BY FIELD(ar.metric_code,'OVERALL','GOALS','ASSISTS','GOALKEEPER','CLEAN_SHEETS'), atp.id`,
      [],
      connection
    ),
    query(
      `SELECT * FROM v_competition_player_stat_totals
       WHERE competition_id = ?`,
      [competitionId],
      connection
    ),
    query(
      `SELECT pa.id, pa.player_id, pa.award_type_id, pa.assignment_mode, pa.is_locked,
              p.full_name
       FROM player_awards pa JOIN players p ON p.id=pa.player_id
       WHERE pa.competition_id = ? AND pa.award_type_id IN
         (SELECT award_type_id FROM award_auto_rules WHERE auto_enabled=TRUE)`,
      [competitionId],
      connection
    )
  ]);

  const coefficient = number(meta.coefficient || 1);
  const awards = rules.map((rule) => {
    let eligible = candidates.filter((candidate) => number(candidate.appearances) >= number(rule.min_appearances));
    if (rule.position_filter !== 'ANY') {
      eligible = eligible.filter((candidate) => candidate.position === rule.position_filter);
    }
    eligible.sort(compareCandidates(rule.metric_code));
    const winner = eligible[0] || null;
    const score = winner ? primaryValue(winner, rule.metric_code) : 0;
    const meaningful = winner && (rule.metric_code === 'OVERALL' || rule.metric_code === 'GOALKEEPER' || score > 0);
    const existing = assigned.filter((item) => number(item.award_type_id) === number(rule.award_type_id));
    return {
      award_type_id: number(rule.award_type_id),
      award_code: rule.award_code,
      award_name: rule.award_name,
      metric_code: rule.metric_code,
      metric_label: METRIC_LABELS[rule.metric_code] || rule.metric_code,
      explanation: rule.explanation,
      min_appearances: number(rule.min_appearances),
      position_filter: rule.position_filter,
      awarded_points: (number(rule.base_ranking_points) * coefficient).toFixed(3),
      winner: meaningful ? {
        player_id: number(winner.player_id),
        full_name: winner.full_name,
        photo_url: winner.photo_url,
        position: winner.position,
        club_id_at_award: winner.club_id_at_award ? number(winner.club_id_at_award) : null,
        award_context_type: winner.award_context_type,
        country_name_at_award: winner.country_name_at_award,
        country_code_at_award: winner.country_code_at_award,
        appearances: number(winner.appearances),
        goals: number(winner.goals),
        assists: number(winner.assists),
        clean_sheets: number(winner.clean_sheets),
        goals_conceded: number(winner.goals_conceded),
        yellow_cards: number(winner.yellow_cards),
        red_cards: number(winner.red_cards),
        performance_score: number(winner.performance_score),
        goalkeeper_score: number(winner.goalkeeper_score),
        metric_value: score
      } : null,
      no_winner_reason: meaningful ? null : (
        eligible.length
          ? `Chưa có chỉ số ${METRIC_LABELS[rule.metric_code] || rule.metric_code} lớn hơn 0.`
          : `Không có cầu thủ đạt tối thiểu ${rule.min_appearances} trận${rule.position_filter !== 'ANY' ? ` ở vị trí ${rule.position_filter}` : ''}.`
      ),
      existing_awards: existing
    };
  });

  return {
    competition: meta,
    coverage,
    candidate_count: candidates.length,
    awards
  };
}

async function finalizeCompetitionAwards(competitionId, userId, { allowIncomplete = false } = {}) {
  return transaction(async (connection) => {
    const preview = await previewCompetitionAwards(competitionId, connection);
    if (preview.competition.status !== 'FINISHED') {
      throw new ApiError(400, 'Hãy kết thúc giải đấu trước khi chốt danh hiệu cá nhân. Bạn vẫn có thể xem đề cử trong lúc giải đang diễn ra.');
    }
    if (!preview.coverage.ready && !allowIncomplete) {
      throw new ApiError(400, `Chưa thể trao danh hiệu tự động: ${preview.coverage.message}`);
    }

    const assigned = [];
    const skipped = [];
    for (const award of preview.awards) {
      if (!award.winner) {
        skipped.push({ award_code: award.award_code, reason: award.no_winner_reason });
        continue;
      }

      const protectedAward = await first(
        `SELECT pa.id, pa.assignment_mode, pa.is_locked, p.full_name
         FROM player_awards pa JOIN players p ON p.id=pa.player_id
         WHERE pa.competition_id=? AND pa.award_type_id=?
           AND (pa.assignment_mode='MANUAL' OR pa.is_locked=TRUE)
         ORDER BY pa.id LIMIT 1`,
        [competitionId, award.award_type_id],
        connection
      );
      if (protectedAward) {
        skipped.push({
          award_code: award.award_code,
          reason: `Danh hiệu đã được khóa/trao thủ công cho ${protectedAward.full_name}.`
        });
        continue;
      }

      const oldAutomatic = await query(
        `SELECT id FROM player_awards
         WHERE competition_id=? AND award_type_id=? AND assignment_mode='AUTOMATIC'`,
        [competitionId, award.award_type_id],
        connection
      );
      if (oldAutomatic.length) {
        const ids = oldAutomatic.map((item) => number(item.id));
        await query(`DELETE FROM player_ranking_points WHERE source_type='AWARD' AND source_id IN (${ids.map(() => '?').join(',')})`, ids, connection);
        await query(`DELETE FROM player_awards WHERE id IN (${ids.map(() => '?').join(',')})`, ids, connection);
      }

      const winner = award.winner;
      const displayContext = winner.award_context_type === 'NATIONAL_TEAM'
        ? winner.country_name_at_award
        : null;
      const snapshot = JSON.stringify({
        metric_code: award.metric_code,
        metric_value: winner.metric_value,
        appearances: winner.appearances,
        goals: winner.goals,
        assists: winner.assists,
        clean_sheets: winner.clean_sheets,
        goals_conceded: winner.goals_conceded,
        yellow_cards: winner.yellow_cards,
        red_cards: winner.red_cards,
        performance_score: winner.performance_score,
        goalkeeper_score: winner.goalkeeper_score,
        coverage: preview.coverage
      });
      const inserted = await query(
        `INSERT INTO player_awards(
           player_id, club_id_at_award, award_context_type,
           country_name_at_award, country_code_at_award,
           competition_id, season_id, award_type_id, display_name,
           awarded_points, assigned_by_user_id, assignment_mode,
           calculation_snapshot, is_locked
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'AUTOMATIC', ?, TRUE)`,
        [winner.player_id, winner.club_id_at_award, winner.award_context_type,
          winner.country_name_at_award, winner.country_code_at_award,
          competitionId, preview.competition.season_id, award.award_type_id,
          `${award.award_name} – ${preview.competition.name}${displayContext ? ` (${displayContext})` : ''}`,
          award.awarded_points, userId, snapshot],
        connection
      );
      await query(
        `INSERT INTO player_ranking_points(
           player_id, season_id, competition_id, source_type, source_id, points, description
         ) VALUES (?, ?, ?, 'AWARD', ?, ?, ?)`,
        [winner.player_id, preview.competition.season_id, competitionId, inserted.insertId,
          award.awarded_points, `${award.award_name} tự động – ${preview.competition.name}`],
        connection
      );
      assigned.push({
        award_code: award.award_code,
        award_name: award.award_name,
        player_id: winner.player_id,
        full_name: winner.full_name,
        points: award.awarded_points
      });
    }

    await query(
      `INSERT INTO competition_award_runs(
         competition_id, run_status, statistics_coverage, awards_snapshot, executed_by_user_id
       ) VALUES (?, ?, ?, ?, ?)`,
      [competitionId, assigned.length ? (skipped.length ? 'PARTIAL' : 'COMPLETED') : 'PARTIAL',
        JSON.stringify(preview.coverage), JSON.stringify({ assigned, skipped }), userId],
      connection
    );
    await audit({
      userId,
      actionCode: 'AUTO_ASSIGN_INDIVIDUAL_AWARDS',
      entityTable: 'competitions',
      entityId: competitionId,
      details: { assigned, skipped, coverage: preview.coverage }
    }, connection);

    return { preview, assigned, skipped };
  });
}

module.exports = {
  previewCompetitionAwards,
  finalizeCompetitionAwards
};
