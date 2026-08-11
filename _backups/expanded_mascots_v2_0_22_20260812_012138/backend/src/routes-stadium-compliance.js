'use strict';

const express = require('express');
const {
  query,
  first,
  transaction,
  ApiError,
  parsePositiveInt,
  parseEnum,
  parseText,
  parseBoolean,
  ok,
  audit
} = require('./db');
const {
  authenticate,
  requireAdmin,
  requireClubOrAdmin,
  assertClubScope
} = require('./auth');

const router = express.Router();

const STAGES = ['ANY', 'GROUP', 'KNOCKOUT'];
const ENFORCEMENT = ['WARN', 'BLOCK'];
const FEATURE_LABELS = {
  has_var: 'Hệ thống VAR',
  has_goal_line_technology: 'Goal-line Technology',
  has_led_perimeter: 'Biển LED quanh sân',
  has_backup_power: 'Nguồn điện dự phòng',
  has_media_center: 'Trung tâm truyền thông',
  has_medical_center: 'Trung tâm y tế'
};
const FEATURE_REQUIREMENT_FIELDS = {
  require_var: 'has_var',
  require_goal_line_technology: 'has_goal_line_technology',
  require_led_perimeter: 'has_led_perimeter',
  require_backup_power: 'has_backup_power',
  require_media_center: 'has_media_center',
  require_medical_center: 'has_medical_center'
};
const UPGRADE_MAP = {
  capacity_total: ['EXPAND_5K'],
  vip_seats: ['VIP_LOUNGE'],
  pitch_quality: ['HYBRID_PITCH'],
  lighting_quality: ['ELITE_LIGHTS'],
  technology_quality: ['SMART_STADIUM', 'VAR_GOAL_LINE', 'MEDIA_BACKUP_POWER'],
  security_quality: ['SAFE_STANDS', 'MEDICAL_COMMAND_CENTER'],
  hospitality_quality: ['VIP_LOUNGE'],
  parking_quality: ['PARKING_HUB'],
  rating_score: ['SMART_STADIUM', 'SAFE_STANDS', 'FAN_ZONE'],
  level_no: ['SMART_STADIUM', 'SAFE_STANDS', 'VIP_LOUNGE'],
  has_var: ['VAR_GOAL_LINE'],
  has_goal_line_technology: ['VAR_GOAL_LINE'],
  has_led_perimeter: ['LED_360_COMPLIANCE', 'LED_PERIMETER'],
  has_backup_power: ['MEDIA_BACKUP_POWER'],
  has_media_center: ['MEDIA_BACKUP_POWER'],
  has_medical_center: ['MEDICAL_COMMAND_CENTER']
};

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function normalizeText(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

async function getMatch(matchId, connection = undefined) {
  const row = await first(
    `SELECT m.*, comp.name AS competition_name, comp.coefficient, comp.format_type,
            cr.round_name, cr.round_order, hc.name AS home_club_name, ac.name AS away_club_name,
            EXISTS(SELECT 1 FROM world_cup_profiles wcp WHERE wcp.competition_id=comp.id) AS is_world_cup
     FROM matches m
     JOIN competitions comp ON comp.id=m.competition_id
     LEFT JOIN competition_rounds cr ON cr.id=m.round_id
     LEFT JOIN clubs hc ON hc.id=m.home_club_id
     LEFT JOIN clubs ac ON ac.id=m.away_club_id
     WHERE m.id=? LIMIT 1`,
    [matchId],
    connection
  );
  if (!row) throw new ApiError(404, 'Không tìm thấy trận đấu.');
  if (!row.home_club_id) throw new ApiError(400, 'Trận đấu chưa xác định đội chủ nhà.');
  return row;
}

async function getProfileByCode(code, connection = undefined) {
  return first(`SELECT * FROM stadium_standard_profiles WHERE code=? AND is_active=TRUE LIMIT 1`, [code], connection);
}

function automaticProfileCode(match) {
  if (Number(match.is_world_cup)) return 'WORLD_CUP_ELITE';
  const round = normalizeText(match.round_name);
  const coefficient = toNumber(match.coefficient || 1);
  const isSemi = round.includes('ban ket') || round.includes('semi');
  const isFinal = !isSemi && (round.includes('chung ket') || round === 'final' || round.includes('grand final'));
  if (isFinal) return 'WORLD_FINAL';
  if (isSemi) return 'ELITE_KNOCKOUT';
  if (match.stage_type === 'KNOCKOUT' && coefficient >= 1.35) return 'CONTINENTAL_A';
  if (coefficient >= 1.75) return 'CONTINENTAL_A';
  if (coefficient >= 1.0) return 'PROFESSIONAL_B';
  return 'COMMUNITY_C';
}

async function resolveMatchRequirement(match, connection = undefined) {
  const custom = await first(
    `SELECT csr.*, sp.*,
            csr.id AS requirement_id, csr.profile_id AS resolved_profile_id,
            csr.enforcement_mode AS resolved_enforcement_mode,
            csr.allow_conditional AS resolved_allow_conditional,
            csr.note AS requirement_note
     FROM competition_stadium_requirements csr
     JOIN stadium_standard_profiles sp ON sp.id=csr.profile_id AND sp.is_active=TRUE
     WHERE csr.competition_id=? AND csr.is_active=TRUE
       AND (
         (csr.round_id IS NOT NULL AND csr.round_id=?) OR
         (csr.round_id IS NULL AND csr.stage_type=?) OR
         (csr.round_id IS NULL AND csr.stage_type='ANY')
       )
     ORDER BY
       CASE
         WHEN csr.round_id IS NOT NULL AND csr.round_id=? THEN 1
         WHEN csr.round_id IS NULL AND csr.stage_type=? THEN 2
         ELSE 3
       END,
       csr.id DESC
     LIMIT 1`,
    [match.competition_id, match.round_id || 0, match.stage_type, match.round_id || 0, match.stage_type],
    connection
  );
  if (custom) {
    return {
      ...custom,
      id: custom.resolved_profile_id,
      profile_id: custom.resolved_profile_id,
      source: 'CUSTOM',
      requirement_id: custom.requirement_id,
      enforcement_mode: custom.resolved_enforcement_mode,
      allow_conditional: Boolean(custom.resolved_allow_conditional),
      note: custom.requirement_note
    };
  }
  const profile = await getProfileByCode(automaticProfileCode(match), connection);
  if (!profile) throw new ApiError(500, 'Chưa cài danh mục tiêu chuẩn sân v2.0.10.');
  return {
    ...profile,
    profile_id: profile.id,
    source: 'AUTOMATIC',
    requirement_id: null,
    enforcement_mode: 'BLOCK',
    allow_conditional: true,
    note: 'Hệ thống tự chọn tiêu chuẩn theo hệ số giải và vòng đấu.'
  };
}

function addFailure(failures, { field, label, required, actual, severity, upgradeCodes = [] }) {
  failures.push({
    field,
    label,
    required,
    actual,
    severity,
    gap: typeof required === 'number' && typeof actual === 'number' ? Math.max(0, required - actual) : null,
    upgrade_codes: upgradeCodes
  });
}

function evaluateStadium(stadium, requirement) {
  const failures = [];
  const softTolerance = toNumber(requirement.soft_quality_tolerance || 0);
  const capacityTolerance = toNumber(requirement.capacity_tolerance_pct || 0);

  if (stadium.status !== 'ACTIVE') {
    addFailure(failures, {
      field: 'status', label: 'Trạng thái sân', required: 'ACTIVE', actual: stadium.status,
      severity: 'HARD', upgradeCodes: []
    });
  }

  const capacityRequired = toNumber(requirement.min_capacity);
  const capacityActual = toNumber(stadium.capacity_total);
  if (capacityActual < capacityRequired) {
    const shortfallPct = capacityRequired ? ((capacityRequired - capacityActual) / capacityRequired) * 100 : 0;
    addFailure(failures, {
      field: 'capacity_total', label: 'Sức chứa', required: capacityRequired, actual: capacityActual,
      severity: shortfallPct <= capacityTolerance ? 'SOFT' : 'HARD', upgradeCodes: UPGRADE_MAP.capacity_total
    });
  }

  const numericCriteria = [
    ['level_no', 'Cấp sân tối thiểu', 'min_level_no', false, 0],
    ['rating_score', 'Stadium Rating', 'min_rating_score', false, softTolerance],
    ['vip_seats', 'Ghế VIP', 'min_vip_seats', false, Math.max(25, Math.round(toNumber(requirement.min_vip_seats) * 0.08))],
    ['pitch_quality', 'Chất lượng mặt cỏ', 'min_pitch_quality', true, softTolerance],
    ['lighting_quality', 'Chất lượng ánh sáng', 'min_lighting_quality', true, softTolerance],
    ['technology_quality', 'Công nghệ sân', 'min_technology_quality', false, softTolerance],
    ['security_quality', 'An ninh', 'min_security_quality', true, softTolerance],
    ['hospitality_quality', 'Khu VIP và dịch vụ', 'min_hospitality_quality', false, softTolerance],
    ['parking_quality', 'Bãi đỗ xe', 'min_parking_quality', false, softTolerance]
  ];

  for (const [field, label, requirementField, hardByDefault, tolerance] of numericCriteria) {
    const required = toNumber(requirement[requirementField]);
    const actual = toNumber(stadium[field]);
    if (actual >= required) continue;
    const gap = required - actual;
    const severity = hardByDefault && gap > tolerance ? 'HARD' : 'SOFT';
    addFailure(failures, {
      field, label, required, actual, severity, upgradeCodes: UPGRADE_MAP[field] || []
    });
  }

  for (const [requirementField, stadiumField] of Object.entries(FEATURE_REQUIREMENT_FIELDS)) {
    if (!Boolean(requirement[requirementField])) continue;
    if (Boolean(stadium[stadiumField])) continue;
    addFailure(failures, {
      field: stadiumField,
      label: FEATURE_LABELS[stadiumField],
      required: true,
      actual: false,
      severity: 'HARD',
      upgradeCodes: UPGRADE_MAP[stadiumField] || []
    });
  }

  const hardFailures = failures.filter((item) => item.severity === 'HARD');
  const softFailures = failures.filter((item) => item.severity === 'SOFT');
  const status = hardFailures.length ? 'NOT_ELIGIBLE' : softFailures.length ? 'CONDITIONAL' : 'ELIGIBLE';
  const complianceScore = clamp(100 - hardFailures.length * 17 - softFailures.length * 5, 0, 100);
  const upgradeCodes = [...new Set(failures.flatMap((item) => item.upgrade_codes || []))];

  return {
    eligibility_status: status,
    compliance_score: Number(complianceScore.toFixed(2)),
    hard_fail_count: hardFailures.length,
    soft_fail_count: softFailures.length,
    failures,
    passed_count: 17 - failures.length,
    recommended_upgrade_codes: upgradeCodes
  };
}

async function loadUpgradeRecommendations(codes, connection = undefined) {
  if (!codes.length) return [];
  return query(
    `SELECT id,code,name,category,description,base_cost,duration_days,min_level,feature_unlocks
     FROM stadium_upgrade_catalog
     WHERE is_active=TRUE AND code IN (${codes.map(() => '?').join(',')})
     ORDER BY base_cost`,
    codes,
    connection
  );
}

async function evaluateStadiumForMatch(matchId, stadiumId, connection = undefined) {
  const match = await getMatch(matchId, connection);
  const stadium = await first(`SELECT * FROM v_stadium_ratings WHERE id=? LIMIT 1`, [stadiumId], connection);
  if (!stadium) throw new ApiError(404, 'Không tìm thấy sân vận động.');
  const requirement = await resolveMatchRequirement(match, connection);
  const evaluation = evaluateStadium(stadium, requirement);
  const upgrades = await loadUpgradeRecommendations(evaluation.recommended_upgrade_codes, connection);
  return { match, stadium, requirement, evaluation, upgrades };
}

function projectedVenueEconomy(match, stadium, evaluation) {
  const coefficient = clamp(toNumber(match.coefficient || 1), 0.4, 3);
  const stageBoost = match.stage_type === 'KNOCKOUT' ? 0.13 : 0;
  const complianceBoost = evaluation.eligibility_status === 'ELIGIBLE' ? 0.08 : evaluation.eligibility_status === 'CONDITIONAL' ? -0.02 : -0.18;
  const occupancy = clamp(38 + coefficient * 14 + toNumber(stadium.rating_score) * 0.28 + stageBoost * 100 + complianceBoost * 100, 15, 98);
  const standardAttendance = Math.round(toNumber(stadium.standard_seats) * occupancy / 100);
  const vipAttendance = Math.round(toNumber(stadium.vip_seats) * clamp(occupancy + 5, 10, 100) / 100);
  const gross = standardAttendance * toNumber(stadium.default_standard_ticket)
    + vipAttendance * toNumber(stadium.default_vip_ticket)
    + (standardAttendance + vipAttendance) * (toNumber(stadium.concession_per_head) + toNumber(stadium.parking_per_head));
  const cost = toNumber(stadium.capacity_total) * 1500 + toNumber(stadium.rating_score) * 400000 + 15000000;
  const rent = toNumber(stadium.lease_fee_per_match || 0);
  const net = Math.max(0, gross - cost - rent);
  return {
    occupancy_pct: Number(occupancy.toFixed(1)),
    attendance: standardAttendance + vipAttendance,
    gross_revenue: Math.round(gross),
    estimated_net_revenue: Math.round(net)
  };
}

async function getVenueOptions(matchId, clubId, connection = undefined) {
  const match = await getMatch(matchId, connection);
  if (Number(match.home_club_id) !== Number(clubId)) throw new ApiError(403, 'CLB này không phải đội chủ nhà của trận đấu.');
  const requirement = await resolveMatchRequirement(match, connection);
  const stadiumRows = await query(
    `SELECT sr.*,
            own.club_id AS owner_club_id, own.club_name AS owner_club_name,
            access.id AS link_id, access.relationship_type, access.is_primary,
            access.lease_fee_per_match, access.owner_revenue_share_pct,
            CASE WHEN access.id IS NULL THEN FALSE ELSE TRUE END AS has_access
     FROM v_stadium_ratings sr
     LEFT JOIN stadium_club_links access
       ON access.stadium_id=sr.id AND access.club_id=? AND access.status='ACTIVE'
       AND (access.starts_on IS NULL OR access.starts_on<=CURRENT_DATE)
       AND (access.ends_on IS NULL OR access.ends_on>=CURRENT_DATE)
     LEFT JOIN (
       SELECT l.stadium_id,l.club_id,c.name AS club_name
       FROM stadium_club_links l JOIN clubs c ON c.id=l.club_id
       WHERE l.relationship_type='OWNED' AND l.status='ACTIVE'
     ) own ON own.stadium_id=sr.id
     WHERE sr.status<>'INACTIVE'
     ORDER BY (access.id IS NOT NULL) DESC, access.is_primary DESC, sr.rating_score DESC, sr.capacity_total DESC
     LIMIT 100`,
    [clubId],
    connection
  );
  const options = stadiumRows.map((stadium) => {
    const evaluation = evaluateStadium(stadium, requirement);
    return {
      ...stadium,
      evaluation,
      projected_economy: projectedVenueEconomy(match, stadium, evaluation),
      requires_lease: !Boolean(stadium.has_access) && Number(stadium.owner_club_id || 0) !== Number(clubId)
    };
  });
  options.sort((a, b) => {
    const statusOrder = { ELIGIBLE: 0, CONDITIONAL: 1, NOT_ELIGIBLE: 2 };
    return statusOrder[a.evaluation.eligibility_status] - statusOrder[b.evaluation.eligibility_status]
      || Number(b.has_access) - Number(a.has_access)
      || b.evaluation.compliance_score - a.evaluation.compliance_score
      || b.projected_economy.estimated_net_revenue - a.projected_economy.estimated_net_revenue;
  });
  const assignment = await first(`SELECT * FROM match_stadium_assignments WHERE match_id=?`, [matchId], connection);
  return {
    match,
    requirement,
    assignment,
    options,
    best_accessible: options.find((item) => item.has_access && item.evaluation.eligibility_status !== 'NOT_ELIGIBLE') || null,
    best_alternative: options.find((item) => !item.has_access && item.evaluation.eligibility_status !== 'NOT_ELIGIBLE') || null
  };
}

async function saveAssignment({ matchId, stadiumId, userId, overrideReason = null }, connection = undefined) {
  const result = await evaluateStadiumForMatch(matchId, stadiumId, connection);
  const { match, stadium, requirement, evaluation } = result;
  const existing = await first(`SELECT * FROM match_stadium_assignments WHERE match_id=?`, [matchId], connection);
  const override = Boolean(overrideReason);
  const finalStatus = override ? 'OVERRIDDEN' : evaluation.eligibility_status;
  const payload = JSON.stringify({
    formula_version: '2.0.10',
    evaluated_at: new Date().toISOString(),
    requirement_source: requirement.source,
    requirement_code: requirement.code,
    failures: evaluation.failures,
    recommended_upgrade_codes: evaluation.recommended_upgrade_codes
  });
  await query(
    `INSERT INTO match_stadium_assignments(
       match_id,stadium_id,requirement_id,profile_id,eligibility_status,compliance_score,
       hard_fail_count,soft_fail_count,evaluation_json,assigned_by_user_id,override_reason,
       overridden_by_user_id,overridden_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?, ?, CASE WHEN ? IS NULL THEN NULL ELSE NOW(6) END)
     ON DUPLICATE KEY UPDATE stadium_id=VALUES(stadium_id),requirement_id=VALUES(requirement_id),
       profile_id=VALUES(profile_id),eligibility_status=VALUES(eligibility_status),
       compliance_score=VALUES(compliance_score),hard_fail_count=VALUES(hard_fail_count),
       soft_fail_count=VALUES(soft_fail_count),evaluation_json=VALUES(evaluation_json),
       assigned_by_user_id=VALUES(assigned_by_user_id),assigned_at=NOW(6),
       override_reason=VALUES(override_reason),overridden_by_user_id=VALUES(overridden_by_user_id),
       overridden_at=VALUES(overridden_at)`,
    [
      matchId, stadiumId, requirement.requirement_id, requirement.profile_id,
      finalStatus, evaluation.compliance_score, evaluation.hard_fail_count,
      evaluation.soft_fail_count, payload, userId, overrideReason,
      override ? userId : null, override ? overrideReason : null
    ],
    connection
  );
  return {
    ...result,
    previous_assignment: existing,
    assignment: await first(`SELECT * FROM match_stadium_assignments WHERE match_id=?`, [matchId], connection)
  };
}

async function ensureVenueCanHost({ matchId, stadiumId, user, connection = undefined }) {
  const result = await evaluateStadiumForMatch(matchId, stadiumId, connection);
  const assignment = await first(`SELECT * FROM match_stadium_assignments WHERE match_id=?`, [matchId], connection);
  const sameOverride = assignment
    && Number(assignment.stadium_id) === Number(stadiumId)
    && assignment.eligibility_status === 'OVERRIDDEN';
  const conditionalAllowed = result.requirement.allow_conditional || result.requirement.enforcement_mode === 'WARN';

  if (result.evaluation.eligibility_status === 'NOT_ELIGIBLE' && !sameOverride) {
    throw new ApiError(400, 'Sân không đạt tiêu chuẩn bắt buộc cho trận này. Hãy chọn sân khác, nâng cấp sân hoặc để FIFA Admin cấp ngoại lệ.');
  }
  if (result.evaluation.eligibility_status === 'CONDITIONAL' && !conditionalAllowed && !sameOverride) {
    throw new ApiError(400, 'Sân chỉ đạt chuẩn có điều kiện nhưng giải đang khóa tiêu chí. FIFA Admin cần cấp ngoại lệ.');
  }
  if (!sameOverride) {
    await saveAssignment({ matchId, stadiumId, userId: user.id }, connection);
  }
  return result;
}

/* ========================================================================== */
/* API                                                                        */
/* ========================================================================== */

router.get('/stadium-compliance/profiles', authenticate, requireClubOrAdmin, async (_req, res) => {
  return ok(res, await query(`SELECT * FROM stadium_standard_profiles WHERE is_active=TRUE ORDER BY min_level_no,min_capacity`));
});

router.get('/stadium-compliance/requirements', authenticate, requireClubOrAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.query.competition_id, 'competition_id');
  const rows = await query(
    `SELECT csr.*,sp.code AS profile_code,sp.name AS profile_name,sp.min_capacity,sp.min_rating_score,
            cr.round_name,comp.name AS competition_name
     FROM competition_stadium_requirements csr
     JOIN stadium_standard_profiles sp ON sp.id=csr.profile_id
     JOIN competitions comp ON comp.id=csr.competition_id
     LEFT JOIN competition_rounds cr ON cr.id=csr.round_id
     WHERE csr.competition_id=? AND csr.is_active=TRUE
     ORDER BY (csr.round_id IS NULL),csr.stage_type,cr.round_order`,
    [competitionId]
  );
  return ok(res, rows);
});

router.post('/stadium-compliance/requirements', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.body.competition_id, 'competition_id');
  const stageType = parseEnum(req.body.stage_type || 'ANY', STAGES, 'stage_type');
  const roundId = parsePositiveInt(req.body.round_id, 'round_id', { required: false });
  const profileId = parsePositiveInt(req.body.profile_id, 'profile_id');
  const enforcementMode = parseEnum(req.body.enforcement_mode || 'BLOCK', ENFORCEMENT, 'enforcement_mode');
  const allowConditional = parseBoolean(req.body.allow_conditional, true);
  const note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 600 });
  const [competition, profile] = await Promise.all([
    first(`SELECT id,name FROM competitions WHERE id=?`, [competitionId]),
    first(`SELECT id,name FROM stadium_standard_profiles WHERE id=? AND is_active=TRUE`, [profileId])
  ]);
  if (!competition) throw new ApiError(404, 'Không tìm thấy giải đấu.');
  if (!profile) throw new ApiError(404, 'Không tìm thấy bộ tiêu chuẩn sân.');
  if (roundId) {
    const round = await first(`SELECT id FROM competition_rounds WHERE id=? AND competition_id=?`, [roundId, competitionId]);
    if (!round) throw new ApiError(400, 'Vòng đấu không thuộc giải đã chọn.');
  }
  const requirementId = await transaction(async (connection) => {
    await query(
      `UPDATE competition_stadium_requirements SET is_active=FALSE
       WHERE competition_id=? AND stage_type=? AND round_id <=> ? AND is_active=TRUE`,
      [competitionId, stageType, roundId],
      connection
    );
    const insert = await query(
      `INSERT INTO competition_stadium_requirements(
         competition_id,stage_type,round_id,profile_id,enforcement_mode,allow_conditional,note,is_active,created_by_user_id)
       VALUES(?,?,?,?,?,?,?,TRUE,?)`,
      [competitionId, stageType, roundId, profileId, enforcementMode, allowConditional, note, req.user.id],
      connection
    );
    await audit({
      userId: req.user.id,
      actionCode: 'SET_STADIUM_REQUIREMENT',
      entityTable: 'competition_stadium_requirements',
      entityId: insert.insertId,
      details: { competitionId, stageType, roundId, profileId, enforcementMode, allowConditional }
    }, connection);
    return insert.insertId;
  });
  return ok(res, await first(
    `SELECT csr.*,sp.code AS profile_code,sp.name AS profile_name,cr.round_name
     FROM competition_stadium_requirements csr
     JOIN stadium_standard_profiles sp ON sp.id=csr.profile_id
     LEFT JOIN competition_rounds cr ON cr.id=csr.round_id WHERE csr.id=?`,
    [requirementId]
  ), 201);
});

router.delete('/stadium-compliance/requirements/:id', authenticate, requireAdmin, async (req, res) => {
  const id = parsePositiveInt(req.params.id, 'requirement_id');
  const row = await first(`SELECT * FROM competition_stadium_requirements WHERE id=?`, [id]);
  if (!row) throw new ApiError(404, 'Không tìm thấy quy định sân.');
  await query(`UPDATE competition_stadium_requirements SET is_active=FALSE WHERE id=?`, [id]);
  await audit({ userId: req.user.id, actionCode: 'DISABLE_STADIUM_REQUIREMENT', entityTable: 'competition_stadium_requirements', entityId: id, details: {} });
  return ok(res, { id, disabled: true });
});

router.get('/stadium-compliance/matches/:matchId/options', authenticate, requireClubOrAdmin, async (req, res) => {
  const matchId = parsePositiveInt(req.params.matchId, 'match_id');
  const match = await getMatch(matchId);
  const clubId = assertClubScope(req, req.query.club_id || match.home_club_id);
  return ok(res, await getVenueOptions(matchId, clubId));
});

router.post('/stadium-compliance/matches/:matchId/assign', authenticate, requireClubOrAdmin, async (req, res) => {
  const matchId = parsePositiveInt(req.params.matchId, 'match_id');
  const stadiumId = parsePositiveInt(req.body.stadium_id, 'stadium_id');
  const match = await getMatch(matchId);
  const clubId = assertClubScope(req, req.body.club_id || match.home_club_id);
  if (Number(clubId) !== Number(match.home_club_id)) throw new ApiError(403, 'Chỉ đội chủ nhà được chọn sân.');
  const access = await first(
    `SELECT id FROM stadium_club_links WHERE stadium_id=? AND club_id=? AND status='ACTIVE'
       AND (starts_on IS NULL OR starts_on<=CURRENT_DATE) AND (ends_on IS NULL OR ends_on>=CURRENT_DATE)`,
    [stadiumId, clubId]
  );
  if (!access) {
    throw new ApiError(403, 'CLB chưa có quyền sử dụng sân này. Hãy thuê sân trước.');
  }
  const preview = await evaluateStadiumForMatch(matchId, stadiumId);
  const needsOverride = preview.evaluation.eligibility_status === 'NOT_ELIGIBLE'
    || (preview.evaluation.eligibility_status === 'CONDITIONAL'
      && !preview.requirement.allow_conditional
      && preview.requirement.enforcement_mode === 'BLOCK');
  let overrideReason = null;
  if (needsOverride) {
    if (req.user.accountType !== 'FIFA_ADMIN') {
      throw new ApiError(400, 'Sân chưa đủ chuẩn và giải không cho phép CLB tự vượt tiêu chí.');
    }
    overrideReason = parseText(req.body.override_reason, 'override_reason', { max: 800 });
  }
  const saved = await transaction(async (connection) => {
    const result = await saveAssignment({ matchId, stadiumId, userId: req.user.id, overrideReason }, connection);
    await audit({
      userId: req.user.id,
      actionCode: overrideReason ? 'OVERRIDE_MATCH_STADIUM' : 'ASSIGN_MATCH_STADIUM',
      entityTable: 'match_stadium_assignments',
      entityId: result.assignment.id,
      details: { matchId, stadiumId, status: result.assignment.eligibility_status, overrideReason }
    }, connection);
    return result;
  });
  return ok(res, saved);
});

router.post('/stadium-compliance/stadiums/:stadiumId/quick-lease', authenticate, requireClubOrAdmin, async (req, res) => {
  const stadiumId = parsePositiveInt(req.params.stadiumId, 'stadium_id');
  const clubId = assertClubScope(req, req.body.club_id || req.user.clubId);
  const stadium = await first(`SELECT * FROM v_stadium_ratings WHERE id=? AND status<>'INACTIVE'`, [stadiumId]);
  if (!stadium) throw new ApiError(404, 'Không tìm thấy sân có thể thuê.');
  const owner = await first(
    `SELECT l.club_id,c.name AS club_name FROM stadium_club_links l JOIN clubs c ON c.id=l.club_id
     WHERE l.stadium_id=? AND l.relationship_type='OWNED' AND l.status='ACTIVE' LIMIT 1`,
    [stadiumId]
  );
  if (Number(owner?.club_id || 0) === Number(clubId)) throw new ApiError(400, 'Đây đã là sân của CLB.');
  const estimatedFee = Math.max(50000000, Math.round((toNumber(stadium.capacity_total) * 18000 + toNumber(stadium.rating_score) * 8000000) / 10000000) * 10000000);
  await query(
    `INSERT INTO stadium_club_links(stadium_id,club_id,relationship_type,is_primary,lease_fee_per_match,owner_revenue_share_pct,status)
     VALUES(?,?,'LEASED',FALSE,?,5.00,'ACTIVE')
     ON DUPLICATE KEY UPDATE relationship_type='LEASED',lease_fee_per_match=VALUES(lease_fee_per_match),
       owner_revenue_share_pct=5.00,status='ACTIVE'`,
    [stadiumId, clubId, estimatedFee]
  );
  await audit({ userId: req.user.id, actionCode: 'QUICK_LEASE_COMPLIANT_STADIUM', entityTable: 'stadium_club_links', entityId: stadiumId, details: { clubId, estimatedFee, ownerClubId: owner?.club_id || null } });
  return ok(res, { stadium_id: stadiumId, club_id: clubId, lease_fee_per_match: estimatedFee, owner_revenue_share_pct: 5 });
});

module.exports = {
  router,
  evaluateStadiumForMatch,
  ensureVenueCanHost,
  resolveMatchRequirement,
  getVenueOptions
};
