'use strict';

const { query } = require('./db');

const CLUB_SEED_LIMIT = 4;
const NATIONAL_SEED_LIMIT = 8;

async function recalculateClubSeeds(competitionId, connection = undefined) {
  const rows = await query(
    `SELECT cp.id,cp.club_id,
            COALESCE(points.total_points,0) AS performance_points,
            COALESCE(ach.gold_count,0) AS gold_count,
            COALESCE(ach.silver_count,0) AS silver_count,
            COALESCE(ach.bronze_count,0) AS bronze_count
     FROM competition_participants cp
     LEFT JOIN (
       SELECT club_id,SUM(points) AS total_points
       FROM club_ranking_points GROUP BY club_id
     ) points ON points.club_id=cp.club_id
     LEFT JOIN (
       SELECT club_id,
              SUM(medal_type='GOLD') AS gold_count,
              SUM(medal_type='SILVER') AS silver_count,
              SUM(medal_type='BRONZE') AS bronze_count
       FROM club_achievements GROUP BY club_id
     ) ach ON ach.club_id=cp.club_id
     WHERE cp.competition_id=? AND cp.registration_status='APPROVED'
     ORDER BY performance_points DESC,gold_count DESC,silver_count DESC,bronze_count DESC,cp.club_id`,
    [competitionId], connection
  );
  await query('UPDATE competition_participants SET seed_no=NULL WHERE competition_id=?', [competitionId], connection);
  for (let index = 0; index < Math.min(CLUB_SEED_LIMIT, rows.length); index += 1) {
    await query('UPDATE competition_participants SET seed_no=? WHERE id=?', [index + 1, rows[index].id], connection);
  }
  return rows.slice(0, CLUB_SEED_LIMIT).map((row, index) => ({ ...row, seed_no: index + 1 }));
}

async function nationalPerformanceRows(connection = undefined) {
  return query(
    `SELECT np.country_catalog_id,
            COALESCE(points.total_points,0) AS performance_points,
            COALESCE(awards.gold_count,0) AS gold_count,
            COALESCE(awards.silver_count,0) AS silver_count,
            COALESCE(awards.bronze_count,0) AS bronze_count,
            COALESCE(awards.individual_award_count,0) AS individual_award_count
     FROM player_national_profiles np
     JOIN country_catalog cc ON cc.id=np.country_catalog_id AND cc.is_active=TRUE
     LEFT JOIN (
       SELECT profile.country_catalog_id,SUM(prp.points) AS total_points
       FROM player_national_profiles profile
       JOIN player_ranking_points prp ON prp.player_id=profile.player_id AND prp.ranking_scope='NATIONAL_TEAM'
       WHERE profile.is_active=TRUE GROUP BY profile.country_catalog_id
     ) points ON points.country_catalog_id=np.country_catalog_id
     LEFT JOIN (
       SELECT profile.country_catalog_id,
              SUM(atp.required_medal_type='GOLD') AS gold_count,
              SUM(atp.required_medal_type='SILVER') AS silver_count,
              SUM(atp.required_medal_type='BRONZE') AS bronze_count,
              SUM(atp.category<>'TEAM_MEDAL') AS individual_award_count
       FROM player_national_profiles profile
       JOIN player_awards pa ON pa.player_id=profile.player_id AND pa.award_context_type='NATIONAL_TEAM'
       JOIN award_types atp ON atp.id=pa.award_type_id
       WHERE profile.is_active=TRUE GROUP BY profile.country_catalog_id
     ) awards ON awards.country_catalog_id=np.country_catalog_id
     WHERE np.is_active=TRUE AND np.country_catalog_id IS NOT NULL
     GROUP BY np.country_catalog_id,points.total_points,awards.gold_count,awards.silver_count,
              awards.bronze_count,awards.individual_award_count
     ORDER BY gold_count DESC,silver_count DESC,bronze_count DESC,performance_points DESC,
              individual_award_count DESC,np.country_catalog_id`,
    [], connection
  );
}

async function refreshNationalPerformanceRanks(connection = undefined) {
  const rows = await nationalPerformanceRows(connection);
  await query('UPDATE player_national_profiles SET world_seed_rank=NULL WHERE is_active=TRUE', [], connection);
  for (let index = 0; index < rows.length; index += 1) {
    rows[index].performance_rank = index + 1;
    await query(
      'UPDATE player_national_profiles SET world_seed_rank=? WHERE country_catalog_id=? AND is_active=TRUE',
      [index + 1, rows[index].country_catalog_id], connection
    );
  }
  return rows;
}

function assignNationalTournamentSeeds(entries, performanceRows) {
  const performanceByCountry = new Map(
    performanceRows.map((row) => [Number(row.country_catalog_id), row])
  );
  const sorted = [...entries].sort((a, b) => {
    const left = performanceByCountry.get(Number(a.countryCatalogId || a.country_catalog_id)) || {};
    const right = performanceByCountry.get(Number(b.countryCatalogId || b.country_catalog_id)) || {};
    return Number(right.gold_count || 0) - Number(left.gold_count || 0)
      || Number(right.silver_count || 0) - Number(left.silver_count || 0)
      || Number(right.bronze_count || 0) - Number(left.bronze_count || 0)
      || Number(right.performance_points || 0) - Number(left.performance_points || 0)
      || Number(right.individual_award_count || 0) - Number(left.individual_award_count || 0)
      || Number(a.countryCatalogId || a.country_catalog_id) - Number(b.countryCatalogId || b.country_catalog_id);
  });
  const seedByCountry = new Map(
    sorted.slice(0, NATIONAL_SEED_LIMIT).map((entry, index) => [
      Number(entry.countryCatalogId || entry.country_catalog_id), index + 1
    ])
  );
  return entries.map((entry) => ({
    ...entry,
    seedRank: seedByCountry.get(Number(entry.countryCatalogId || entry.country_catalog_id)) || null
  }));
}

module.exports = {
  CLUB_SEED_LIMIT,
  NATIONAL_SEED_LIMIT,
  recalculateClubSeeds,
  refreshNationalPerformanceRanks,
  assignNationalTournamentSeeds
};
