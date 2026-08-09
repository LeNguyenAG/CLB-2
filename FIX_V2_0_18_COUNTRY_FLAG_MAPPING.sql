/*
  FOOTBALL RANK MANAGER v2.0.18 - COUNTRY / FLAG MAPPING HOTFIX

  Chọn đúng database local trong MySQL Workbench trước khi Execute All.
  File này không ghi cứng tên database và không xóa dữ liệu.
*/

SET NAMES utf8mb4;

/* Khôi phục bản ghi chuẩn của Andorra trong trường hợp dữ liệu cũ bị lệch. */
UPDATE country_catalog
SET iso2 = 'AD',
    iso3 = 'AND',
    fifa_code = 'AND',
    name_en = 'Andorra',
    name_vi = 'Andorra',
    confederation = 'UEFA',
    flag_url = 'https://flagcdn.com/w160/ad.png',
    flag_emoji = '🇦🇩',
    is_active = TRUE
WHERE iso3 = 'AND';

/* Đồng bộ mọi hồ sơ cầu thủ theo khóa country_catalog_id chuẩn. */
UPDATE player_national_profiles np
JOIN country_catalog cc ON cc.id = np.country_catalog_id
SET np.country_name = cc.name_vi,
    np.country_code = cc.fifa_code,
    np.flag_url = cc.flag_url,
    np.confederation = cc.confederation
WHERE NOT (
  CONVERT(COALESCE(np.country_name, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci
    <=> CONVERT(COALESCE(cc.name_vi, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci
  AND CONVERT(COALESCE(np.country_code, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci
    <=> CONVERT(COALESCE(cc.fifa_code, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci
  AND CONVERT(COALESCE(np.flag_url, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci
    <=> CONVERT(COALESCE(cc.flag_url, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci
  AND CONVERT(COALESCE(np.confederation, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci
    <=> CONVERT(COALESCE(cc.confederation, '') USING utf8mb4) COLLATE utf8mb4_unicode_ci
);

/* Đồng bộ cờ/liên đoàn của các giải cũ; không đổi khóa tên/mã lịch sử. */
UPDATE world_cup_entries e
JOIN country_catalog cc ON cc.id = e.country_catalog_id
SET e.flag_url = cc.flag_url,
    e.confederation = cc.confederation;

UPDATE national_cup_entries e
JOIN country_catalog cc ON cc.id = e.country_catalog_id
SET e.flag_url = cc.flag_url,
    e.confederation = cc.confederation;

SELECT cc.name_vi AS country_name,
       cc.fifa_code AS country_code,
       cc.confederation,
       cc.flag_url,
       COUNT(np.player_id) AS linked_players
FROM country_catalog cc
LEFT JOIN player_national_profiles np ON np.country_catalog_id = cc.id
WHERE cc.iso3 = 'AND'
GROUP BY cc.id, cc.name_vi, cc.fifa_code, cc.confederation, cc.flag_url;

SELECT 'COUNTRY_FLAG_MAPPING_V2_0_18_READY' AS status;
