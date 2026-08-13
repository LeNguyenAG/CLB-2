'use strict';

const {
  query, first, transaction, callProcedure, ApiError, audit
} = require('./db');
const { generateStadiumCompetitionOffers } = require('./stadium-sponsorship-engine');

const MATCH_KINDS = ['REGULAR', 'WORLD_CUP', 'NATIONAL_CUP'];

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, number(value))); }
function money(value, unit = 1000) { return Math.round(number(value) / unit) * unit; }
function hashSeed(value) {
  let hash = 2166136261;
  for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0 || 1;
}
function seededRandom(seedValue) {
  let seed = Number(seedValue) >>> 0;
  return () => {
    seed += 0x6D2B79F5;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function normalizeKind(value) {
  const kind = String(value || '').toUpperCase();
  if (!MATCH_KINDS.includes(kind)) throw new ApiError(400, 'Loại trận đấu không hợp lệ.');
  return kind;
}

async function loadMatchContext(kindValue, matchId, connection = undefined) {
  const kind = normalizeKind(kindValue);
  let row;
  if (kind === 'REGULAR') {
    row = await first(
      `SELECT m.id,m.competition_id,m.stage_type,m.scheduled_at,m.status,m.home_club_id,m.away_club_id,
              c.name AS competition_name,c.coefficient,
              cr.round_name AS round_label,cr.round_order,NULL AS round_code,
              hc.name AS home_name,ac.name AS away_name,NULL AS home_player_id,NULL AS away_player_id
       FROM matches m JOIN competitions c ON c.id=m.competition_id
       LEFT JOIN competition_rounds cr ON cr.id=m.round_id
       LEFT JOIN clubs hc ON hc.id=m.home_club_id LEFT JOIN clubs ac ON ac.id=m.away_club_id
       WHERE m.id=?`, [matchId], connection
    );
  } else if (kind === 'WORLD_CUP') {
    row = await first(
      `SELECT m.id,m.competition_id,m.stage_type,m.scheduled_at,m.status,
              hp.club_id AS home_club_id,ap.club_id AS away_club_id,c.name AS competition_name,c.coefficient,
              COALESCE(r.round_name,CONCAT('Bảng ',g.group_code)) AS round_label,r.round_order,r.round_code,
              he.country_name AS home_name,ae.country_name AS away_name,he.player_id AS home_player_id,ae.player_id AS away_player_id
       FROM world_cup_matches m JOIN competitions c ON c.id=m.competition_id
       LEFT JOIN world_cup_rounds r ON r.id=m.round_id LEFT JOIN world_cup_groups g ON g.id=m.group_id
       LEFT JOIN world_cup_entries he ON he.id=m.home_entry_id LEFT JOIN world_cup_entries ae ON ae.id=m.away_entry_id
       LEFT JOIN players hp ON hp.id=he.player_id LEFT JOIN players ap ON ap.id=ae.player_id
       WHERE m.id=?`, [matchId], connection
    );
  } else {
    row = await first(
      `SELECT m.id,m.competition_id,'KNOCKOUT' AS stage_type,m.scheduled_at,m.status,
              hp.club_id AS home_club_id,ap.club_id AS away_club_id,c.name AS competition_name,c.coefficient,
              r.round_name AS round_label,r.round_order,r.round_code,
              he.country_name AS home_name,ae.country_name AS away_name,he.player_id AS home_player_id,ae.player_id AS away_player_id
       FROM national_cup_matches m JOIN competitions c ON c.id=m.competition_id
       JOIN national_cup_rounds r ON r.id=m.round_id
       LEFT JOIN national_cup_entries he ON he.id=m.home_entry_id LEFT JOIN national_cup_entries ae ON ae.id=m.away_entry_id
       LEFT JOIN players hp ON hp.id=he.player_id LEFT JOIN players ap ON ap.id=ae.player_id
       WHERE m.id=?`, [matchId], connection
    );
  }
  if (!row) throw new ApiError(404, 'Không tìm thấy trận đấu để vận hành sân.');
  return { ...row, match_kind: kind, source_match_id: Number(row.id) };
}

function profileCode(match) {
  const code = String(match.round_code || '').toUpperCase();
  if (code === 'FINAL') return 'WORLD_FINAL';
  if (['SF', 'THIRD'].includes(code)) return 'ELITE_KNOCKOUT';
  if (match.match_kind === 'WORLD_CUP') {
    if (match.stage_type === 'GROUP') return 'PROFESSIONAL_B';
    if (['R32', 'R16', 'QF'].includes(code)) return 'CONTINENTAL_A';
    return 'WORLD_CUP_ELITE';
  }
  if (match.match_kind === 'NATIONAL_CUP') return ['R32', 'R16'].includes(code) ? 'PROFESSIONAL_B' : 'CONTINENTAL_A';
  if (match.stage_type === 'KNOCKOUT' && number(match.coefficient, 1) >= 1.35) return 'CONTINENTAL_A';
  return number(match.coefficient, 1) >= 1 ? 'PROFESSIONAL_B' : 'COMMUNITY_C';
}

function evaluateCandidate(stadium, profile) {
  const failures = [];
  const hard = [];
  const soft = [];
  const add = (field, required, actual, isHard) => {
    const item = { field, required, actual, severity: isHard ? 'HARD' : 'SOFT' };
    failures.push(item); (isHard ? hard : soft).push(item);
  };
  if (stadium.status !== 'ACTIVE') add('status', 'ACTIVE', stadium.status, true);
  // Chỉ các ngưỡng vận hành tuyệt đối mới loại sân. Chuẩn theo vòng đấu dùng
  // để xếp ưu tiên và đánh dấu CONDITIONAL, không làm trận đấu bị treo.
  if (number(stadium.condition_pct, 100) < 25) add('condition_pct', 25, number(stadium.condition_pct), true);
  const safetyFloors = { pitch_quality:15, lighting_quality:15, security_quality:20 };
  for (const [field, floor] of Object.entries(safetyFloors)) {
    if (number(stadium[field]) < floor) add(field, floor, number(stadium[field]), true);
  }
  const capacityRequired = number(profile.min_capacity);
  if (number(stadium.capacity_total) < capacityRequired) add('capacity_total', capacityRequired, number(stadium.capacity_total), false);
  const quality = [
    ['rating_score','min_rating_score',false],['level_no','min_level_no',false],['vip_seats','min_vip_seats',false],
    ['pitch_quality','min_pitch_quality',true],['lighting_quality','min_lighting_quality',true],
    ['technology_quality','min_technology_quality',false],['security_quality','min_security_quality',true],
    ['hospitality_quality','min_hospitality_quality',false],['parking_quality','min_parking_quality',false]
  ];
  for (const [field, requiredField] of quality) {
    const required = number(profile[requiredField]);
    const actual = number(stadium[field]);
    if (actual >= required) continue;
    add(field, required, actual, false);
  }
  const features = {
    require_var:'has_var', require_goal_line_technology:'has_goal_line_technology',
    require_led_perimeter:'has_led_perimeter', require_backup_power:'has_backup_power',
    require_media_center:'has_media_center', require_medical_center:'has_medical_center'
  };
  for (const [requiredField, stadiumField] of Object.entries(features)) {
    if (number(profile[requiredField]) > 0 && number(stadium[stadiumField]) <= 0) {
      add(stadiumField, true, false, false);
    }
  }
  return {
    eligibility_status: hard.length ? 'NOT_ELIGIBLE' : soft.length ? 'CONDITIONAL' : 'ELIGIBLE',
    compliance_score: clamp(100 - hard.length * 16 - soft.length * 4, 0, 100),
    hard_fail_count: hard.length, soft_fail_count: soft.length, failures
  };
}

async function findOwner(stadiumId, connection = undefined) {
  return first(
    `SELECT l.club_id,c.name AS club_name,w.id AS wallet_id
     FROM stadium_club_links l JOIN clubs c ON c.id=l.club_id
     LEFT JOIN wallets w ON w.club_id=l.club_id AND w.wallet_type='CLUB'
     WHERE l.stadium_id=? AND l.relationship_type='OWNED' AND l.status='ACTIVE'
     ORDER BY l.id LIMIT 1`, [stadiumId], connection
  );
}

async function chooseAutomaticVenue(match, connection = undefined) {
  const code = profileCode(match);
  const profile = await first(`SELECT * FROM stadium_standard_profiles WHERE code=? AND is_active=TRUE`, [code], connection);
  if (!profile) throw new ApiError(500, `Thiếu bộ tiêu chuẩn sân ${code}.`);
  const scheduledAt = match.scheduled_at || new Date();
  await query(
    `UPDATE stadiums SET
       condition_pct=LEAST(100,condition_pct+GREATEST(2,TIMESTAMPDIFF(HOUR,COALESCE(last_match_at,available_after),?)*0.28)),
       available_after=NULL
     WHERE available_after IS NOT NULL AND available_after<=? AND status='ACTIVE'`,
    [scheduledAt,scheduledAt],connection
  );
  const candidates = await query(
    `SELECT sr.*,COALESCE(s.condition_pct,100) AS condition_pct,s.available_after,
            own.club_id AS owner_club_id,own.club_name AS owner_club_name,
            COALESCE(u.recent_uses,0) AS recent_uses
     FROM v_stadium_ratings sr JOIN stadiums s ON s.id=sr.id
     LEFT JOIN (
       SELECT l.stadium_id,l.club_id,c.name AS club_name
       FROM stadium_club_links l JOIN clubs c ON c.id=l.club_id
       WHERE l.relationship_type='OWNED' AND l.status='ACTIVE'
     ) own ON own.stadium_id=sr.id
     LEFT JOIN (
       SELECT stadium_id,COUNT(*) AS recent_uses FROM stadium_match_operations
       WHERE assigned_at>=DATE_SUB(NOW(),INTERVAL 30 DAY) GROUP BY stadium_id
     ) u ON u.stadium_id=sr.id
     WHERE sr.status='ACTIVE' AND COALESCE(s.condition_pct,100)>=25
       AND (s.available_after IS NULL OR s.available_after<=?)
       AND NOT EXISTS (
         SELECT 1 FROM stadium_match_operations busy
         WHERE busy.stadium_id=sr.id AND busy.scheduled_at IS NOT NULL
           AND ? IS NOT NULL AND ABS(TIMESTAMPDIFF(HOUR,busy.scheduled_at,?))<18
           AND NOT (busy.match_kind=? AND busy.source_match_id=?)
       )
       AND NOT EXISTS (
         SELECT 1 FROM stadium_upgrades su WHERE su.stadium_id=sr.id AND su.status='IN_PROGRESS'
       )
     ORDER BY COALESCE(u.recent_uses,0),sr.rating_score DESC,sr.capacity_total DESC`,
    [scheduledAt,match.scheduled_at,match.scheduled_at,match.match_kind,match.id], connection
  );
  const evaluated = candidates.map((stadium) => ({ stadium, evaluation: evaluateCandidate(stadium, profile) }))
    .filter((item) => item.evaluation.eligibility_status !== 'NOT_ELIGIBLE');
  if (!evaluated.length) throw new ApiError(400, 'Không có sân an toàn đang sẵn sàng: sân có thể đang bảo trì, nâng cấp, trùng lịch hoặc tình trạng dưới 25%.');
  const random = seededRandom(hashSeed(`${match.match_kind}:${match.id}:${match.competition_id}`));
  const eliteMatch = ['WORLD_FINAL','WORLD_CUP_ELITE','ELITE_KNOCKOUT'].includes(profile.code);
  for (const item of evaluated) {
    const capacityScore = clamp(Math.log10(Math.max(1000,number(item.stadium.capacity_total))) / 5 * 100, 0, 100);
    item.fairness_score = item.evaluation.compliance_score * (eliteMatch ? 0.30 : 0.26)
      + number(item.stadium.condition_pct, 100) * 0.20
      + number(item.stadium.rating_score) * (eliteMatch ? 0.25 : 0.17)
      + capacityScore * (eliteMatch ? 0.15 : 0.09)
      + (1 / (1 + number(item.stadium.recent_uses))) * (eliteMatch ? 7 : 18)
      + random() * (eliteMatch ? 3 : 7);
  }
  evaluated.sort((a, b) => b.fairness_score - a.fairness_score);
  // Random có trọng số: sân tốt có xác suất cao hơn, nhưng sân nhỏ vẫn có cơ
  // hội và số lần dùng gần đây tiếp tục kéo điểm xuống để chia đều dài hạn.
  const floor = evaluated[evaluated.length-1].fairness_score;
  const weights = evaluated.map((item) => Math.pow(Math.max(1,item.fairness_score-floor+6),eliteMatch?1.8:1.35));
  let roll = random() * weights.reduce((sum,value) => sum+value,0);
  let selected = evaluated[0];
  for (let index=0;index<evaluated.length;index+=1) {
    roll -= weights[index];
    if (roll<=0) { selected=evaluated[index]; break; }
  }
  return { ...selected, profile };
}

async function persistOperation({ match, stadium, evaluation, profile, method, requestId = null, userId = null, fairnessScore = 0 }, connection) {
  const owner = await findOwner(stadium.id, connection);
  await query(
    `INSERT INTO stadium_match_operations(
       match_kind,source_match_id,competition_id,competition_name,stage_type,round_label,home_name,away_name,
       home_club_id,away_club_id,stadium_id,owner_club_id,request_id,assignment_method,profile_code,
       eligibility_status,compliance_score,fairness_score,scheduled_at,evaluation_json,assigned_by_user_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON DUPLICATE KEY UPDATE competition_name=VALUES(competition_name),stage_type=VALUES(stage_type),round_label=VALUES(round_label),
       home_name=VALUES(home_name),away_name=VALUES(away_name),home_club_id=VALUES(home_club_id),away_club_id=VALUES(away_club_id),
       stadium_id=VALUES(stadium_id),owner_club_id=VALUES(owner_club_id),request_id=VALUES(request_id),
       assignment_method=VALUES(assignment_method),profile_code=VALUES(profile_code),eligibility_status=VALUES(eligibility_status),
       compliance_score=VALUES(compliance_score),fairness_score=VALUES(fairness_score),scheduled_at=VALUES(scheduled_at),
       evaluation_json=VALUES(evaluation_json),assigned_by_user_id=VALUES(assigned_by_user_id),assigned_at=NOW(6)`,
    [match.match_kind,match.id,match.competition_id,match.competition_name,match.stage_type,match.round_label,
      match.home_name,match.away_name,match.home_club_id,match.away_club_id,stadium.id,owner?.club_id||null,requestId,
      method,profile.code,evaluation.eligibility_status,evaluation.compliance_score,fairnessScore,match.scheduled_at,
      JSON.stringify({ formula_version:'2.0.23.1', profile:profile.code, failures:evaluation.failures,
        policy:'SAFETY_BLOCKS; STANDARDS_PRIORITIZE; WEIGHTED_FAIR_RANDOM' }),userId], connection
  );
  const operation = await first(
    `SELECT o.*,s.name AS stadium_name,s.city,s.condition_pct,s.available_after,c.name AS owner_club_name
     FROM stadium_match_operations o JOIN stadiums s ON s.id=o.stadium_id
     LEFT JOIN clubs c ON c.id=o.owner_club_id WHERE o.match_kind=? AND o.source_match_id=?`,
    [match.match_kind, match.id], connection
  );
  await generateStadiumCompetitionOffers(operation.id,userId,connection);
  return operation;
}

async function autoAssignMatch(kind, matchId, userId = null, { force = false } = {}) {
  return transaction(async (connection) => {
    const match = await loadMatchContext(kind, matchId, connection);
    const existing = await first(`SELECT * FROM stadium_match_operations WHERE match_kind=? AND source_match_id=? FOR UPDATE`, [match.match_kind, match.id], connection);
    if (existing && !force) {
      await generateStadiumCompetitionOffers(existing.id,userId,connection);
      return existing;
    }
    if (existing && ['FIFA','CLUB_REQUEST'].includes(existing.assignment_method) && force !== true) return existing;
    const selected = await chooseAutomaticVenue(match, connection);
    const operation = await persistOperation({ match, ...selected, method:'AUTOMATIC', userId, fairnessScore:selected.fairness_score }, connection);
    await audit({ userId, actionCode:'AUTO_ASSIGN_MATCH_STADIUM', entityTable:'stadium_match_operations', entityId:operation.id, details:{ kind:match.match_kind, matchId:match.id, stadiumId:operation.stadium_id } }, connection);
    return operation;
  });
}

async function forceAssignMatch({ kind, matchId, stadiumId, userId, requestId = null, method = 'FIFA', overrideReason = null }) {
  return transaction(async (connection) => {
    const match = await loadMatchContext(kind, matchId, connection);
    const stadium = await first(`SELECT sr.*,s.condition_pct,s.available_after FROM v_stadium_ratings sr JOIN stadiums s ON s.id=sr.id WHERE sr.id=?`, [stadiumId], connection);
    if (!stadium) throw new ApiError(404, 'Không tìm thấy sân vận động.');
    const code = profileCode(match);
    const profile = await first(`SELECT * FROM stadium_standard_profiles WHERE code=? AND is_active=TRUE`, [code], connection);
    const evaluation = evaluateCandidate(stadium, profile);
    if (method !== 'FIFA' && evaluation.eligibility_status === 'NOT_ELIGIBLE') throw new ApiError(400, 'Sân yêu cầu chưa đạt tiêu chuẩn an toàn bắt buộc.');
    if (method !== 'FIFA' && stadium.available_after && new Date(stadium.available_after) > new Date(match.scheduled_at || Date.now())) {
      throw new ApiError(400, 'Sân chưa hồi phục xong trước giờ thi đấu.');
    }
    if (evaluation.eligibility_status === 'NOT_ELIGIBLE') evaluation.eligibility_status = 'OVERRIDDEN';
    evaluation.override_reason = overrideReason;
    const operation = await persistOperation({ match, stadium, evaluation, profile, method, requestId, userId }, connection);
    await audit({ userId, actionCode:`${method}_ASSIGN_MATCH_STADIUM`, entityTable:'stadium_match_operations', entityId:operation.id, details:{ kind:match.match_kind, matchId:match.id, stadiumId, overrideReason } }, connection);
    return operation;
  });
}

async function appealForClub(clubId, connection) {
  if (!clubId) return { clubFans:0, playerFans:0, popularity:20, reputation:30, momentum:50 };
  const row = await first(
    `SELECT COALESCE(cip.fan_count,50000) AS club_fans,COALESCE(cip.reputation_score,30) AS reputation,
            COALESCE(cip.momentum_score,50) AS momentum,
            COALESCE(SUM(pfp.fan_count),0) AS player_fans,COALESCE(MAX(pip.popularity_score),20) AS popularity
     FROM clubs c LEFT JOIN club_influence_profiles cip ON cip.club_id=c.id
     LEFT JOIN players p ON p.club_id=c.id AND p.status IN('ACTIVE','TRANSFER_LISTED')
     LEFT JOIN player_fan_profiles pfp ON pfp.player_id=p.id LEFT JOIN player_influence_profiles pip ON pip.player_id=p.id
     WHERE c.id=? GROUP BY c.id,cip.fan_count,cip.reputation_score,cip.momentum_score`, [clubId], connection
  );
  return { clubFans:number(row?.club_fans),playerFans:number(row?.player_fans),popularity:number(row?.popularity,20),reputation:number(row?.reputation,30),momentum:number(row?.momentum,50) };
}

async function appealForNationalPlayer(playerId, connection) {
  if (!playerId) return { clubFans:100000, playerFans:25000, popularity:20, reputation:35, momentum:50 };
  const row = await first(
    `SELECT COALESCE(pfp.fan_count,1000) AS player_fans,COALESCE(pip.popularity_score,20) AS popularity,
            COALESCE(pip.endorsement_score,15) AS reputation
     FROM players p LEFT JOIN player_fan_profiles pfp ON pfp.player_id=p.id
     LEFT JOIN player_influence_profiles pip ON pip.player_id=p.id WHERE p.id=?`, [playerId], connection
  );
  return { clubFans:100000,playerFans:number(row?.player_fans,1000),popularity:number(row?.popularity,20),reputation:number(row?.reputation,15),momentum:55 };
}

async function buildSettlement(operation, stadium, match, connection) {
  const seed = hashSeed(`FIN:${operation.match_kind}:${operation.source_match_id}:${operation.stadium_id}`);
  const random = seededRandom(seed);
  const [home, away] = match.match_kind === 'REGULAR'
    ? await Promise.all([appealForClub(match.home_club_id, connection),appealForClub(match.away_club_id, connection)])
    : await Promise.all([appealForNationalPlayer(match.home_player_id, connection),appealForNationalPlayer(match.away_player_id, connection)]);
  const fanDemand = (home.clubFans + away.clubFans) * 0.0028 + (home.playerFans + away.playerFans) * 0.0018;
  const stageBoost = match.stage_type === 'KNOCKOUT' ? 12 + number(match.round_order) * 2.2 : 0;
  const rivalry = Math.abs(home.reputation-away.reputation) <= 8 ? 5 : 0;
  const attraction = clamp(18 + Math.log10(Math.max(10,fanDemand))*10 + stageBoost + rivalry
    + (home.popularity+away.popularity)*0.12 + number(stadium.rating_score)*0.16 + number(match.coefficient,1)*4, 10, 100);
  const capacity = Math.max(1,number(stadium.capacity_total));
  const demandOccupancy = fanDemand / capacity * 100;
  const qualityBoost = (number(stadium.atmosphere_quality)+number(stadium.seating_quality)+number(stadium.technology_quality))/300*10;
  const occupancy = clamp(18 + demandOccupancy*0.58 + attraction*0.38 + qualityBoost + (random()-.5)*12, 12, 100);
  const vipOccupancy = clamp(occupancy + number(stadium.hospitality_quality)/18 + attraction/25 + (random()-.5)*7, 10, 100);
  const attendanceStandard = Math.round(number(stadium.standard_seats)*occupancy/100);
  const attendanceVip = Math.round(number(stadium.vip_seats)*vipOccupancy/100);
  const attendanceTotal = Math.min(capacity,attendanceStandard+attendanceVip);
  const dynamicPrice = 0.72 + attraction/180 + occupancy/500;
  const standardPrice = money(number(stadium.default_standard_ticket)*dynamicPrice,10000);
  const vipPrice = money(number(stadium.default_vip_ticket)*(dynamicPrice+number(stadium.hospitality_quality)/350),50000);
  const standardRevenue = attendanceStandard*standardPrice;
  const vipRevenue = attendanceVip*vipPrice;
  const concessionMultiplier = 0.65+number(stadium.commercial_quality)/180+random()*0.18;
  const concessionRevenue = money(attendanceTotal*number(stadium.concession_per_head)*concessionMultiplier,1000);
  const parkingRevenue = money(attendanceTotal*number(stadium.parking_per_head)*(0.45+number(stadium.parking_quality)/150),1000);
  const gross = standardRevenue+vipRevenue+concessionRevenue+parkingRevenue;
  const operating = money(7000000+capacity*(800+number(stadium.security_quality)*5)+number(stadium.rating_score)*260000+(match.stage_type==='KNOCKOUT'?24000000:9000000),1000000);
  const intensity = clamp(attendanceTotal/capacity*0.55 + attraction/100*0.3 + (match.stage_type==='KNOCKOUT'?0.15:0),0.12,1);
  const damagePct = clamp(0.35+intensity*1.9+(random()-.5)*0.45-number(stadium.pitch_quality)/220,0.15,2.8);
  const conditionBefore = number(stadium.condition_pct,100);
  const conditionAfter = clamp(conditionBefore-damagePct,35,100);
  const damageCost = money(capacity*(180+intensity*410)+(100-number(stadium.pitch_quality))*180000+(100-number(stadium.stands_quality))*110000,100000);
  const ownerPayout = Math.max(0,gross-operating-damageCost);
  const recoveryHours = Math.round(clamp(10+intensity*34+(100-conditionAfter)*0.42-number(stadium.technology_quality)/12,8,72));
  return { seed,attraction,occupancy,attendanceStandard,attendanceVip,attendanceTotal,standardPrice,vipPrice,
    standardRevenue,vipRevenue,concessionRevenue,parkingRevenue,gross,operating,damageCost,ownerPayout,
    conditionBefore,conditionAfter,recoveryHours,snapshot:{formula_version:'2.0.23',fan_demand:fanDemand,home,away,quality_boost:qualityBoost,intensity,damage_pct:damagePct} };
}

async function settleFinishedMatch(kind, matchId, userId = null) {
  let existing = await first(
    `SELECT f.*,o.id AS operation_id FROM stadium_match_finances_v2 f
     JOIN stadium_match_operations o ON o.id=f.operation_id WHERE o.match_kind=? AND o.source_match_id=?`,
    [normalizeKind(kind),matchId]
  );
  if (existing?.status === 'SETTLED') return existing;
  let operation = await first(`SELECT * FROM stadium_match_operations WHERE match_kind=? AND source_match_id=?`, [normalizeKind(kind),matchId]);
  if (!operation) operation = await autoAssignMatch(kind,matchId,userId);
  return transaction(async (connection) => {
    operation = await first(`SELECT * FROM stadium_match_operations WHERE id=? FOR UPDATE`, [operation.id], connection);
    existing = await first(`SELECT * FROM stadium_match_finances_v2 WHERE operation_id=? FOR UPDATE`, [operation.id], connection);
    if (existing?.status === 'SETTLED') return existing;
    const match = await loadMatchContext(kind,matchId,connection);
    if (match.status !== 'FINISHED') throw new ApiError(400, 'Chỉ quyết toán sân sau khi trận đấu kết thúc.');
    const stadium = await first(`SELECT sr.*,s.condition_pct,s.available_after FROM v_stadium_ratings sr JOIN stadiums s ON s.id=sr.id WHERE sr.id=? FOR UPDATE`, [operation.stadium_id], connection);
    const calc = await buildSettlement(operation,stadium,match,connection);
    await query(
      `INSERT INTO stadium_match_finances_v2(operation_id,random_seed,attractiveness_score,occupancy_pct,attendance_standard,
       attendance_vip,attendance_total,standard_ticket_price,vip_ticket_price,standard_ticket_revenue,vip_ticket_revenue,
       concessions_revenue,parking_revenue,gross_revenue,operating_cost,damage_cost,owner_payout,condition_before,
       condition_after,recovery_hours,calculation_snapshot,status,settled_by_user_id,settled_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SETTLED',?,NOW(6))
       ON DUPLICATE KEY UPDATE attractiveness_score=VALUES(attractiveness_score),occupancy_pct=VALUES(occupancy_pct),
       attendance_standard=VALUES(attendance_standard),attendance_vip=VALUES(attendance_vip),attendance_total=VALUES(attendance_total),
       standard_ticket_price=VALUES(standard_ticket_price),vip_ticket_price=VALUES(vip_ticket_price),
       standard_ticket_revenue=VALUES(standard_ticket_revenue),vip_ticket_revenue=VALUES(vip_ticket_revenue),
       concessions_revenue=VALUES(concessions_revenue),parking_revenue=VALUES(parking_revenue),gross_revenue=VALUES(gross_revenue),
       operating_cost=VALUES(operating_cost),damage_cost=VALUES(damage_cost),owner_payout=VALUES(owner_payout),
       condition_before=VALUES(condition_before),condition_after=VALUES(condition_after),recovery_hours=VALUES(recovery_hours),
       calculation_snapshot=VALUES(calculation_snapshot),status='SETTLED',settled_by_user_id=VALUES(settled_by_user_id),settled_at=NOW(6)`,
      [operation.id,calc.seed,calc.attraction,calc.occupancy,calc.attendanceStandard,calc.attendanceVip,calc.attendanceTotal,
        calc.standardPrice,calc.vipPrice,calc.standardRevenue,calc.vipRevenue,calc.concessionRevenue,calc.parkingRevenue,
        calc.gross,calc.operating,calc.damageCost,calc.ownerPayout,calc.conditionBefore,calc.conditionAfter,calc.recoveryHours,
        JSON.stringify(calc.snapshot),userId], connection
    );
    const finance = await first(`SELECT * FROM stadium_match_finances_v2 WHERE operation_id=?`, [operation.id], connection);
    const lines = [
      ['REVENUE','STANDARD_TICKETS','Vé thường',calc.attendanceStandard,calc.standardPrice,calc.standardRevenue,'Số vé thường × giá vé động'],
      ['REVENUE','VIP_TICKETS','Vé VIP',calc.attendanceVip,calc.vipPrice,calc.vipRevenue,'Ghế VIP chịu ảnh hưởng chất lượng hospitality'],
      ['REVENUE','CONCESSIONS','Ẩm thực và vật phẩm tại sân',calc.attendanceTotal,null,calc.concessionRevenue,'Phụ thuộc thương mại và lượng khán giả'],
      ['REVENUE','PARKING','Dịch vụ bãi xe',calc.attendanceTotal,null,calc.parkingRevenue,'Phụ thuộc chất lượng bãi xe'],
      ['COST','OPERATIONS','Tổ chức, an ninh và vận hành',null,null,-calc.operating,'Phụ thuộc sức chứa, cấp trận và chất lượng sân'],
      ['DAMAGE','MATCH_DAMAGE','Thiệt hại và quỹ sửa chữa sau trận',null,null,-calc.damageCost,`Tình trạng sân ${calc.conditionBefore.toFixed(1)}% → ${calc.conditionAfter.toFixed(1)}%`],
      ['PAYOUT','OWNER_PAYOUT','Thực nhận của CLB chủ sân',null,null,calc.ownerPayout,'Doanh thu gộp trừ vận hành và thiệt hại']
    ];
    for (let index=0; index<lines.length; index+=1) {
      const [type,code,label,quantity,unitAmount,amount,explanation]=lines[index];
      await query(
        `INSERT INTO stadium_finance_statement_lines(finance_id,line_order,line_type,line_code,label,quantity,unit_amount,amount,explanation)
         VALUES(?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE quantity=VALUES(quantity),unit_amount=VALUES(unit_amount),amount=VALUES(amount),explanation=VALUES(explanation)`,
        [finance.id,index+1,type,code,label,quantity,unitAmount,amount,explanation],connection
      );
    }
    let walletTransactionId = null;
    if (operation.owner_club_id && calc.ownerPayout>0) {
      const wallet = await first(`SELECT id,status FROM wallets WHERE wallet_type='CLUB' AND club_id=? FOR UPDATE`, [operation.owner_club_id], connection);
      if (wallet?.status === 'ACTIVE') {
        await callProcedure('sp_post_wallet_entry_core',[wallet.id,'CREDIT','MATCHDAY_REVENUE',String(calc.ownerPayout),null,null,
          'stadium_match_finances_v2',finance.id,`Quyết toán sân ${stadium.name}: ${match.home_name} - ${match.away_name}`,userId,null],connection);
        const tx = await first(`SELECT id FROM wallet_transactions WHERE reference_table='stadium_match_finances_v2' AND reference_id=? ORDER BY id DESC LIMIT 1`,[finance.id],connection);
        walletTransactionId=tx?.id||null;
        await query(`UPDATE stadium_match_finances_v2 SET owner_wallet_transaction_id=? WHERE id=?`,[walletTransactionId,finance.id],connection);
      }
    }
    const baseTime = match.scheduled_at ? new Date(match.scheduled_at) : new Date();
    const availableAfter = new Date(Math.max(Date.now(),baseTime.getTime())+calc.recoveryHours*3600000);
    await query(
      `UPDATE stadiums SET condition_pct=?,available_after=?,last_match_at=COALESCE(?,NOW(6)),matches_hosted=matches_hosted+1,
       maintenance_reserve=maintenance_reserve+? WHERE id=?`,
      [calc.conditionAfter,availableAfter,match.scheduled_at,calc.damageCost,stadium.id],connection
    );
    await audit({userId,actionCode:'SETTLE_STADIUM_OWNER_STATEMENT',entityTable:'stadium_match_finances_v2',entityId:finance.id,
      details:{kind:match.match_kind,matchId,stadiumId:stadium.id,ownerClubId:operation.owner_club_id,payout:calc.ownerPayout,damage:calc.damageCost}},connection);
    return { ...finance,owner_wallet_transaction_id:walletTransactionId,lines:await query(`SELECT * FROM stadium_finance_statement_lines WHERE finance_id=? ORDER BY line_order`,[finance.id],connection) };
  });
}

async function reconcileTransferFans(transferOfferId, userId = null) {
  return transaction(async (connection) => {
    const transferRow = await first(
      `SELECT pt.*,pip.popularity_score,pfp.fan_count AS player_fans,pfp.loyalty_score,pfp.mobility_score,
              oldp.loyalty_score AS old_club_loyalty
       FROM player_transfers pt
       LEFT JOIN player_influence_profiles pip ON pip.player_id=pt.player_id
       LEFT JOIN player_fan_profiles pfp ON pfp.player_id=pt.player_id
       LEFT JOIN club_influence_profiles oldp ON oldp.club_id=pt.from_club_id
       WHERE pt.transfer_offer_id=? FOR UPDATE`, [transferOfferId], connection
    );
    if (!transferRow) throw new ApiError(404, 'Chưa tìm thấy giao dịch chuyển nhượng đã hoàn tất.');
    const existing = await first(`SELECT * FROM player_fan_transfer_events WHERE player_transfer_id=?`, [transferRow.id], connection);
    if (existing) return existing;
    const playerFans = Math.max(1000,number(transferRow.player_fans,1000));
    const popularity = number(transferRow.popularity_score,20);
    const playerLoyalty = number(transferRow.loyalty_score,55);
    const mobility = number(transferRow.mobility_score,35);
    const oldClubLoyalty = number(transferRow.old_club_loyalty,55);
    const followRate = clamp(10+popularity*0.22+mobility*0.18-playerLoyalty*0.08-oldClubLoyalty*0.05,8,55);
    const fansFollowed = Math.round(playerFans*followRate/100);
    const fansStayed = playerFans-fansFollowed;
    const oldLoss = transferRow.from_club_id ? Math.round(fansFollowed*(0.72+mobility/500)) : 0;
    const newGain = Math.round(fansFollowed*(0.78+popularity/500));
    await query(`INSERT IGNORE INTO club_influence_profiles(club_id) VALUES(?)`,[transferRow.to_club_id],connection);
    await query(`UPDATE club_influence_profiles SET fan_count=fan_count+? WHERE club_id=?`,[newGain,transferRow.to_club_id],connection);
    if (transferRow.from_club_id) await query(`UPDATE club_influence_profiles SET fan_count=GREATEST(1000,fan_count-?) WHERE club_id=?`,[oldLoss,transferRow.from_club_id],connection);
    const snapshot={formula_version:'2.0.23',popularity,player_loyalty:playerLoyalty,mobility,old_club_loyalty:oldClubLoyalty};
    const insert=await query(
      `INSERT INTO player_fan_transfer_events(player_transfer_id,player_id,from_club_id,to_club_id,player_fans_before,
       follow_rate_pct,fans_followed,fans_stayed,old_club_fan_delta,new_club_fan_delta,formula_snapshot)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [transferRow.id,transferRow.player_id,transferRow.from_club_id,transferRow.to_club_id,playerFans,followRate,
        fansFollowed,fansStayed,-oldLoss,newGain,JSON.stringify(snapshot)],connection
    );
    await audit({userId,actionCode:'MOVE_PLAYER_FANS_AFTER_TRANSFER',entityTable:'player_fan_transfer_events',entityId:insert.insertId,
      details:{playerId:transferRow.player_id,fromClubId:transferRow.from_club_id,toClubId:transferRow.to_club_id,fansFollowed,fansStayed}},connection);
    return first(`SELECT * FROM player_fan_transfer_events WHERE id=?`,[insert.insertId],connection);
  });
}

module.exports = {
  MATCH_KINDS, loadMatchContext, autoAssignMatch, forceAssignMatch, settleFinishedMatch,
  reconcileTransferFans, profileCode, evaluateCandidate
};
