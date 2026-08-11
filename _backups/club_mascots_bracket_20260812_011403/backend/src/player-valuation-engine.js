'use strict';

const crypto = require('node:crypto');
const { query, first, transaction, ApiError, audit } = require('./db');
const {
  FORMULA_VERSION,
  DEFAULT_VALUATION_CONFIG,
  calculatePlayerValuation
} = require('./player-valuation-formula');

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJson(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return null; }
}

function mapByPlayer(rows) {
  return new Map(rows.map((row) => [Number(row.player_id), row]));
}

async function loadValuationInputs(connection, playerId = null) {
  const where = playerId ? 'WHERE p.id=?' : "WHERE p.status<>'RETIRED'";
  const players = await query(
    `SELECT p.id AS player_id,p.full_name,p.position,p.club_id,p.status,p.market_value,
            pc.id AS active_contract_id,COALESCE(pc.salary_per_season,0) AS active_salary
     FROM players p
     LEFT JOIN player_contracts pc ON pc.id=(
       SELECT MAX(pc2.id) FROM player_contracts pc2
       WHERE pc2.player_id=p.id AND pc2.status='ACTIVE'
     )
     ${where}
     ORDER BY p.id`,
    playerId ? [playerId] : [],
    connection
  );
  if (playerId && !players.length) throw new ApiError(404, 'Không tìm thấy cầu thủ.');
  if (!players.length) return [];

  const ids = players.map((row) => Number(row.player_id));
  const placeholders = ids.map(() => '?').join(',');
  const [stats, ratings, recentRatings, points, awards, nationalStats] = await Promise.all([
    query(
      `SELECT pms.player_id,
              SUM(pms.appeared=TRUE) AS appearances,
              COALESCE(SUM(pms.goals),0) AS goals,COALESCE(SUM(pms.assists),0) AS assists,
              COALESCE(SUM(pms.clean_sheet=TRUE),0) AS clean_sheets,
              COALESCE(SUM(pms.goals_conceded),0) AS goals_conceded,
              COALESCE(SUM(pms.shots_on_target),0) AS shots_on_target,
              COALESCE(SUM(pms.key_passes),0) AS key_passes,
              COALESCE(SUM(pms.tackles_won),0) AS tackles_won,
              COALESCE(SUM(pms.interceptions),0) AS interceptions,
              COALESCE(SUM(pms.saves),0) AS saves,
              COALESCE(SUM(pms.penalties_saved),0) AS penalties_saved,
              COALESCE(SUM(pms.yellow_cards),0) AS yellow_cards,
              COALESCE(SUM(pms.red_cards),0) AS red_cards,
              COALESCE(SUM(pms.own_goals),0) AS own_goals
       FROM player_match_stats pms
       WHERE pms.player_id IN (${placeholders})
         AND pms.verification_status IN ('VERIFIED','LOCKED')
       GROUP BY pms.player_id`,
      ids, connection
    ),
    query(
      `SELECT player_id,COUNT(*) AS rating_appearances,ROUND(AVG(rating_score),3) AS average_rating,
              COALESCE(SUM(is_team_mvp),0) AS team_mvp_count,
              COALESCE(SUM(is_match_mvp),0) AS match_mvp_count
       FROM match_player_ratings
       WHERE player_id IN (${placeholders})
       GROUP BY player_id`,
      ids, connection
    ),
    query(
      `SELECT player_id,ROUND(AVG(rating_score),3) AS recent_average_rating
       FROM (
         SELECT player_id,rating_score,
                ROW_NUMBER() OVER(PARTITION BY player_id ORDER BY finalized_at DESC,id DESC) AS recent_no
         FROM match_player_ratings WHERE player_id IN (${placeholders})
       ) recent
       WHERE recent_no<=5 GROUP BY player_id`,
      ids, connection
    ),
    query(
      `SELECT player_id,COUNT(*) AS ranking_rows,
              COALESCE(SUM(CASE WHEN ranking_scope='CLUB' THEN points ELSE 0 END),0) AS club_ranking_points,
              COALESCE(SUM(CASE WHEN ranking_scope='NATIONAL_TEAM' THEN points ELSE 0 END),0) AS national_ranking_points
       FROM player_ranking_points WHERE player_id IN (${placeholders}) GROUP BY player_id`,
      ids, connection
    ),
    query(
      `SELECT pa.player_id,
              COALESCE(SUM(atp.category<>'TEAM_MEDAL'),0) AS individual_award_count,
              COALESCE(SUM(CASE WHEN atp.category<>'TEAM_MEDAL' THEN pa.awarded_points ELSE 0 END),0) AS individual_award_points,
              COALESCE(SUM(atp.required_medal_type='GOLD'),0) AS gold_count,
              COALESCE(SUM(atp.required_medal_type='SILVER'),0) AS silver_count,
              COALESCE(SUM(atp.required_medal_type='BRONZE'),0) AS bronze_count,
              COALESCE(SUM(pa.award_context_type='NATIONAL_TEAM' AND atp.required_medal_type='GOLD'),0) AS national_gold_count,
              COALESCE(SUM(pa.award_context_type='NATIONAL_TEAM' AND atp.required_medal_type='SILVER'),0) AS national_silver_count,
              COALESCE(SUM(pa.award_context_type='NATIONAL_TEAM' AND atp.required_medal_type='BRONZE'),0) AS national_bronze_count
       FROM player_awards pa JOIN award_types atp ON atp.id=pa.award_type_id
       WHERE pa.player_id IN (${placeholders}) GROUP BY pa.player_id`,
      ids, connection
    ),
    query(
      `SELECT player_id,COUNT(*) AS national_appearances,
              COALESCE(SUM(goals_for),0) AS national_goals,
              COALESCE(SUM(goals_against=0),0) AS national_clean_sheets,
              COALESCE(SUM(goals_for>goals_against),0) AS national_wins,
              COALESCE(SUM(goals_against),0) AS national_goals_conceded
       FROM (
         SELECT e.player_id,m.home_score AS goals_for,m.away_score AS goals_against
         FROM world_cup_matches m JOIN world_cup_entries e ON e.id=m.home_entry_id
         WHERE m.status='FINISHED' AND m.home_entry_id IS NOT NULL
         UNION ALL
         SELECT e.player_id,m.away_score,m.home_score
         FROM world_cup_matches m JOIN world_cup_entries e ON e.id=m.away_entry_id
         WHERE m.status='FINISHED' AND m.away_entry_id IS NOT NULL
         UNION ALL
         SELECT e.player_id,m.home_score,m.away_score
         FROM national_cup_matches m JOIN national_cup_entries e ON e.id=m.home_entry_id
         WHERE m.status='FINISHED' AND m.home_entry_id IS NOT NULL
         UNION ALL
         SELECT e.player_id,m.away_score,m.home_score
         FROM national_cup_matches m JOIN national_cup_entries e ON e.id=m.away_entry_id
         WHERE m.status='FINISHED' AND m.away_entry_id IS NOT NULL
       ) national_games
       WHERE player_id IN (${placeholders}) GROUP BY player_id`,
      ids, connection
    )
  ]);

  const maps = [stats, ratings, recentRatings, points, awards, nationalStats].map(mapByPlayer);
  return players.map((player) => Object.assign({}, player, ...maps.map((map) => map.get(Number(player.player_id)) || {})));
}

async function recalculatePlayerValues({ userId, playerId = null, note = null }) {
  return transaction(async (connection) => {
    let lockAcquired = false;
    try {
    const valuationLock = await first("SELECT GET_LOCK('frm_player_valuation_recalculate',0) AS acquired", [], connection);
    lockAcquired = Number(valuationLock?.acquired || 0) === 1;
    if (!lockAcquired) throw new ApiError(409, 'Một kỳ định giá khác đang chạy. Hãy đợi kỳ đó hoàn tất rồi thử lại.');
    const season = await first(
      "SELECT id,name FROM seasons ORDER BY status='ACTIVE' DESC,sequence_no DESC,id DESC LIMIT 1",
      [], connection
    );
    const seed = crypto.randomInt(1, 2_147_483_647);
    const scope = playerId ? 'SINGLE' : 'ALL_ACTIVE';
    const batchInsert = await query(
      `INSERT INTO player_valuation_batches(
         scope,season_id,formula_version,random_seed,status,note,config_snapshot,created_by_user_id
       ) VALUES(?,?,?,?,?,?,?,?)`,
      [scope, season?.id || null, FORMULA_VERSION, seed, 'RUNNING', note || null,
        JSON.stringify(DEFAULT_VALUATION_CONFIG), userId],
      connection
    );
    const batchId = Number(batchInsert.insertId);
    const inputs = await loadValuationInputs(connection, playerId);
    const results = [];
    let increased = 0;
    let decreased = 0;
    let unchanged = 0;
    let salariesAdjusted = 0;
    let totalOldValue = 0;
    let totalNewValue = 0;

    for (const input of inputs) {
      const calculated = calculatePlayerValuation(input, { seed });
      const oldValue = Math.max(0, number(input.market_value));
      const newValue = Math.max(0, number(calculated.marketValue));
      const salaryBefore = Math.max(0, number(input.active_salary));
      const salaryAfter = input.active_contract_id && salaryBefore < newValue ? newValue : salaryBefore;
      const reason = `Định giá tự động ${FORMULA_VERSION} · kỳ #${batchId}`;
      const breakdown = {
        ...calculated,
        salaryFloorApplied: salaryAfter > salaryBefore,
        activeSalaryBefore: salaryBefore,
        activeSalaryAfter: salaryAfter
      };

      await query(
        `SET @app_user_id=?,@app_change_reason=?,@app_valuation_batch_id=?,
             @app_valuation_score=?,@app_fair_value=?,@app_market_pulse_pct=?,
             @app_valuation_breakdown=?,@app_valuation_source='AUTOMATIC'`,
        [userId, reason, batchId, calculated.score, calculated.fairValue, calculated.marketPulsePct,
          JSON.stringify(breakdown)],
        connection
      );
      await query(
        `UPDATE players
         SET market_value=?,valuation_score=?,valuation_method_version=?,valuation_updated_at=NOW(6),valuation_breakdown=?
         WHERE id=?`,
        [String(Math.round(newValue)), calculated.score, FORMULA_VERSION, JSON.stringify(breakdown), input.player_id],
        connection
      );

      if (input.active_contract_id && salaryAfter > salaryBefore) {
        await query(
          `UPDATE player_contracts
           SET salary_per_season=?,note=CONCAT_WS(' | ',NULLIF(note,''),?)
           WHERE id=?`,
          [String(Math.round(salaryAfter)), `Tự động áp sàn lương theo kỳ định giá #${batchId}`, input.active_contract_id],
          connection
        );
        salariesAdjusted += 1;
      }

      await query(
        `INSERT INTO player_valuation_results(
           batch_id,player_id,old_value,new_value,value_change,score,fair_value,market_pulse_pct,
           evidence_count,active_salary_before,active_salary_after,breakdown
         ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
        [batchId, input.player_id, String(Math.round(oldValue)), String(Math.round(newValue)),
          String(Math.round(newValue - oldValue)), calculated.score, String(Math.round(calculated.fairValue)),
          calculated.marketPulsePct, calculated.evidenceCount, String(Math.round(salaryBefore)),
          String(Math.round(salaryAfter)), JSON.stringify(breakdown)],
        connection
      );

      if (newValue > oldValue) increased += 1;
      else if (newValue < oldValue) decreased += 1;
      else unchanged += 1;
      totalOldValue += oldValue;
      totalNewValue += newValue;
      results.push({
        player_id: Number(input.player_id), full_name: input.full_name,
        old_value: oldValue, new_value: newValue, value_change: newValue - oldValue,
        salary_before: salaryBefore, salary_after: salaryAfter, ...calculated
      });
    }

    await query(
      `UPDATE player_valuation_batches
       SET status='COMPLETED',total_players=?,increased_count=?,decreased_count=?,unchanged_count=?,
           salaries_adjusted_count=?,total_old_value=?,total_new_value=?,completed_at=NOW(6)
       WHERE id=?`,
      [inputs.length, increased, decreased, unchanged, salariesAdjusted,
        String(Math.round(totalOldValue)), String(Math.round(totalNewValue)), batchId],
      connection
    );
    await audit({
      userId,
      actionCode: 'RECALCULATE_PLAYER_MARKET_VALUES',
      entityTable: 'player_valuation_batches',
      entityId: batchId,
      details: { scope, player_id: playerId, total: inputs.length, increased, decreased, unchanged, salariesAdjusted }
    }, connection);

    return {
      batch: {
        id: batchId, scope, season_id: season?.id || null, season_name: season?.name || null,
        formula_version: FORMULA_VERSION, total_players: inputs.length,
        increased_count: increased, decreased_count: decreased, unchanged_count: unchanged,
        salaries_adjusted_count: salariesAdjusted,
        total_old_value: totalOldValue, total_new_value: totalNewValue
      },
      results
    };
    } finally {
      // Biến phiên thuộc về connection trong pool, nên phải dọn cả khi một kỳ định giá rollback.
      await query(
        'SET @app_user_id=NULL,@app_change_reason=NULL,@app_valuation_batch_id=NULL,@app_valuation_score=NULL,@app_fair_value=NULL,@app_market_pulse_pct=NULL,@app_valuation_breakdown=NULL,@app_valuation_source=NULL',
        [],
        connection
      ).catch(() => {});
      if (lockAcquired) {
        await query("DO RELEASE_LOCK('frm_player_valuation_recalculate')", [], connection).catch(() => {});
      }
    }
  });
}

async function getValuationSummary() {
  const latestBatch = await first(
    `SELECT b.*,s.name AS season_name,u.username AS created_by_username
     FROM player_valuation_batches b
     LEFT JOIN seasons s ON s.id=b.season_id LEFT JOIN users u ON u.id=b.created_by_user_id
     WHERE b.status='COMPLETED' AND b.scope='ALL_ACTIVE' ORDER BY b.id DESC LIMIT 1`
  );
  const totals = await first(
    `SELECT COUNT(*) AS total_players,
            COALESCE(SUM(status<>'RETIRED'),0) AS active_players,
            COALESCE(SUM(market_value>0 AND status<>'RETIRED'),0) AS valued_players,
            COALESCE(AVG(CASE WHEN market_value>0 AND status<>'RETIRED' THEN market_value END),0) AS average_value,
            COALESCE(MAX(CASE WHEN status<>'RETIRED' THEN market_value END),0) AS highest_value,
            COALESCE(SUM(CASE WHEN status<>'RETIRED' THEN market_value ELSE 0 END),0) AS total_market_value
     FROM players`
  );
  const topPlayers = await query(
    `SELECT p.id AS player_id,p.full_name,p.position,p.market_value,p.valuation_score,c.name AS club_name
     FROM players p LEFT JOIN clubs c ON c.id=p.club_id
     WHERE p.status<>'RETIRED' ORDER BY p.market_value DESC,p.valuation_score DESC,p.id LIMIT 5`
  );
  return { latestBatch, totals, topPlayers, config: DEFAULT_VALUATION_CONFIG, formulaVersion: FORMULA_VERSION };
}

async function getPlayerValuation(playerId) {
  const player = await first(
    `SELECT p.id AS player_id,p.full_name,p.position,p.club_id,p.market_value,p.valuation_score,
            p.valuation_method_version,p.valuation_updated_at,p.valuation_breakdown,
            c.name AS club_name,COALESCE(pc.salary_per_season,0) AS salary_per_season
     FROM players p LEFT JOIN clubs c ON c.id=p.club_id
     LEFT JOIN player_contracts pc ON pc.id=(
       SELECT MAX(pc2.id) FROM player_contracts pc2
       WHERE pc2.player_id=p.id AND pc2.status='ACTIVE'
     )
     WHERE p.id=?`, [playerId]
  );
  if (!player) throw new ApiError(404, 'Không tìm thấy cầu thủ.');
  const [latestResult, history] = await Promise.all([
    first(
      `SELECT r.*,b.formula_version,b.scope,b.completed_at AS batch_completed_at
       FROM player_valuation_results r JOIN player_valuation_batches b ON b.id=r.batch_id
       WHERE r.player_id=? ORDER BY r.id DESC LIMIT 1`, [playerId]
    ),
    query(
      `SELECT h.*,b.formula_version,b.scope
       FROM player_market_value_history h
       LEFT JOIN player_valuation_batches b ON b.id=h.valuation_batch_id
       WHERE h.player_id=? ORDER BY h.changed_at DESC,h.id DESC LIMIT 30`, [playerId]
    )
  ]);
  player.valuation_breakdown = parseJson(player.valuation_breakdown);
  if (latestResult) latestResult.breakdown = parseJson(latestResult.breakdown);
  for (const item of history) item.calculation_breakdown = parseJson(item.calculation_breakdown);
  return { player, latestResult, history, minimumSalary: player.market_value, minimumTransferFee: player.market_value };
}

async function getValuationBatches(limit = 20) {
  return query(
    `SELECT b.*,s.name AS season_name,u.username AS created_by_username
     FROM player_valuation_batches b
     LEFT JOIN seasons s ON s.id=b.season_id LEFT JOIN users u ON u.id=b.created_by_user_id
     ORDER BY b.id DESC LIMIT ${Math.min(100, Math.max(1, Number(limit) || 20))}`
  );
}

module.exports = {
  loadValuationInputs,
  recalculatePlayerValues,
  getValuationSummary,
  getPlayerValuation,
  getValuationBatches
};
