'use strict';

const { query, first } = require('./db');

async function syncTable({
  table,
  profileTable,
  playerId,
  country,
  connection
}) {
  const entries = await query(
    `SELECT e.id,e.competition_id,p.entries_locked_at,p.tournament_finalized_at
     FROM ${table} e
     JOIN ${profileTable} p ON p.competition_id=e.competition_id
     WHERE e.player_id=?`,
    [playerId], connection
  );
  const summary = { updated: 0, finalized: 0, conflicts: [] };

  for (const entry of entries) {
    if (entry.tournament_finalized_at) {
      summary.finalized += 1;
      continue;
    }
    const conflict = await first(
      `SELECT id FROM ${table}
       WHERE competition_id=? AND id<>?
         AND (country_catalog_id=? OR country_code=? OR LOWER(country_name)=LOWER(?))
       LIMIT 1`,
      [entry.competition_id, entry.id, country.id, country.fifa_code, country.name_vi],
      connection
    );
    if (conflict) {
      summary.conflicts.push(Number(entry.competition_id));
      continue;
    }
    await query(
      `UPDATE ${table}
       SET country_catalog_id=?,country_name=?,country_code=?,flag_url=?,confederation=?
       WHERE id=?`,
      [country.id, country.name_vi, country.fifa_code, country.flag_url,
        country.confederation, entry.id],
      connection
    );
    summary.updated += 1;
  }
  return summary;
}

async function synchronizeNationalProfile(playerId, country, connection) {
  const worldCup = await syncTable({
      table: 'world_cup_entries',
      profileTable: 'world_cup_profiles',
      playerId,
      country,
      connection
    });
  const nationalCup = await syncTable({
      table: 'national_cup_entries',
      profileTable: 'national_cup_profiles',
      playerId,
      country,
      connection
    });
  return { world_cup_48: worldCup, knockout_32: nationalCup };
}

module.exports = { synchronizeNationalProfile };
