/* v2.0.20 không thêm bảng mới. File này chỉ chuẩn hóa dữ liệu hiện có;
   từ sau cập nhật, backend sẽ tự tính lại khi danh sách đội thay đổi. */
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;
SET @OLD_SQL_SAFE_UPDATES_V220 = @@SESSION.SQL_SAFE_UPDATES;
SET SESSION SQL_SAFE_UPDATES = 0;

DROP TEMPORARY TABLE IF EXISTS tmp_national_performance_rank;
CREATE TEMPORARY TABLE tmp_national_performance_rank AS
SELECT ranked.country_catalog_id,
       ROW_NUMBER() OVER(
         ORDER BY ranked.gold_count DESC,ranked.silver_count DESC,ranked.bronze_count DESC,
                  ranked.performance_points DESC,ranked.individual_award_count DESC,ranked.country_catalog_id
       ) AS performance_rank
FROM (
  SELECT np.country_catalog_id,
         COALESCE(points.total_points,0) AS performance_points,
         COALESCE(awards.gold_count,0) AS gold_count,
         COALESCE(awards.silver_count,0) AS silver_count,
         COALESCE(awards.bronze_count,0) AS bronze_count,
         COALESCE(awards.individual_award_count,0) AS individual_award_count
  FROM player_national_profiles np
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
) ranked;

UPDATE player_national_profiles np
LEFT JOIN tmp_national_performance_rank ranked ON ranked.country_catalog_id=np.country_catalog_id
SET np.world_seed_rank=ranked.performance_rank
WHERE np.is_active=TRUE;

DROP TEMPORARY TABLE IF EXISTS tmp_national_entry_seeds;
CREATE TEMPORARY TABLE tmp_national_entry_seeds AS
SELECT e.id,
       ROW_NUMBER() OVER(PARTITION BY e.competition_id ORDER BY np.world_seed_rank IS NULL,np.world_seed_rank,e.country_catalog_id) AS seed_no
FROM national_cup_entries e
JOIN national_cup_profiles ncp ON ncp.competition_id=e.competition_id AND ncp.entries_locked_at IS NULL
LEFT JOIN player_national_profiles np ON np.player_id=e.player_id;
UPDATE national_cup_entries e
JOIN tmp_national_entry_seeds seeds ON seeds.id=e.id
SET e.seed_rank=IF(seeds.seed_no<=8,seeds.seed_no,NULL);

DROP TEMPORARY TABLE IF EXISTS tmp_world_entry_seeds;
CREATE TEMPORARY TABLE tmp_world_entry_seeds AS
SELECT e.id,
       ROW_NUMBER() OVER(PARTITION BY e.competition_id ORDER BY np.world_seed_rank IS NULL,np.world_seed_rank,e.country_catalog_id) AS seed_no
FROM world_cup_entries e
LEFT JOIN player_national_profiles np ON np.player_id=e.player_id
WHERE NOT EXISTS(SELECT 1 FROM world_cup_matches m WHERE m.competition_id=e.competition_id);
UPDATE world_cup_entries e
JOIN tmp_world_entry_seeds seeds ON seeds.id=e.id
SET e.seed_rank=IF(seeds.seed_no<=8,seeds.seed_no,NULL);

UPDATE competition_participants cp
JOIN competitions c ON c.id=cp.competition_id AND c.status IN('DRAFT','REGISTRATION')
SET cp.seed_no=NULL;

DROP TEMPORARY TABLE IF EXISTS tmp_club_entry_seeds;
CREATE TEMPORARY TABLE tmp_club_entry_seeds AS
SELECT cp.id,
       ROW_NUMBER() OVER(
         PARTITION BY cp.competition_id
         ORDER BY COALESCE(points.total_points,0) DESC,COALESCE(ach.gold_count,0) DESC,
                  COALESCE(ach.silver_count,0) DESC,COALESCE(ach.bronze_count,0) DESC,cp.club_id
       ) AS seed_no
FROM competition_participants cp
JOIN competitions c ON c.id=cp.competition_id AND c.status IN('DRAFT','REGISTRATION')
LEFT JOIN (SELECT club_id,SUM(points) AS total_points FROM club_ranking_points GROUP BY club_id) points ON points.club_id=cp.club_id
LEFT JOIN (
  SELECT club_id,SUM(medal_type='GOLD') AS gold_count,SUM(medal_type='SILVER') AS silver_count,
         SUM(medal_type='BRONZE') AS bronze_count
  FROM club_achievements GROUP BY club_id
) ach ON ach.club_id=cp.club_id
WHERE cp.registration_status='APPROVED';
UPDATE competition_participants cp
JOIN tmp_club_entry_seeds seeds ON seeds.id=cp.id
SET cp.seed_no=IF(seeds.seed_no<=4,seeds.seed_no,NULL);

DROP TEMPORARY TABLE IF EXISTS tmp_national_performance_rank;
DROP TEMPORARY TABLE IF EXISTS tmp_national_entry_seeds;
DROP TEMPORARY TABLE IF EXISTS tmp_world_entry_seeds;
DROP TEMPORARY TABLE IF EXISTS tmp_club_entry_seeds;

SET SESSION SQL_SAFE_UPDATES = @OLD_SQL_SAFE_UPDATES_V220;
SELECT 'SMART_CREATION_AUTO_SEEDS_V2_0_20_READY' AS update_status;
