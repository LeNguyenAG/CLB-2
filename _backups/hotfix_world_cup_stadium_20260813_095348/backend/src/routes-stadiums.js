'use strict';

const crypto = require('crypto');
const express = require('express');
const {
  query,
  first,
  transaction,
  callProcedure,
  ApiError,
  parsePositiveInt,
  parseMoney,
  parseDecimal,
  parseEnum,
  parseText,
  parseDate,
  parseBoolean,
  ok,
  audit
} = require('./db');
const {
  authenticate,
  optionalAuthenticate,
  requireAdmin,
  requireClubOrAdmin,
  assertClubScope
} = require('./auth');

const { ensureVenueCanHost } = require('./routes-stadium-compliance');

const router = express.Router();

const STADIUM_STATUSES = ['ACTIVE', 'UNDER_UPGRADE', 'INACTIVE'];
const LINK_TYPES = ['OWNED', 'LEASED', 'SHARED'];
const OFFER_TYPES = ['MATCH_PARTNER', 'LED_BOARD', 'VIP_LOUNGE', 'STADIUM_PARTNER', 'SEASON_PARTNER'];
const OFFER_STATUSES = ['ACCEPTED', 'REJECTED'];
const STADIUM_FEATURE_FIELDS = ['has_var','has_goal_line_technology','has_led_perimeter','has_backup_power','has_media_center','has_medical_center'];
const QUALITY_FIELDS = [
  'pitch_quality', 'seating_quality', 'stands_quality', 'lighting_quality',
  'technology_quality', 'hospitality_quality', 'parking_quality', 'security_quality',
  'commercial_quality', 'atmosphere_quality'
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function roundMoney(value, unit = 10000) {
  return Math.max(0, Math.round(Number(value || 0) / unit) * unit);
}

function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
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

function weightedChoice(random, choices) {
  const roll = random() * choices.reduce((sum, item) => sum + item.weight, 0);
  let cursor = 0;
  for (const item of choices) {
    cursor += item.weight;
    if (roll <= cursor) return item.value;
  }
  return choices[choices.length - 1].value;
}

function currentClubId(req, requested = null, { required = true } = {}) {
  const raw = requested ?? req.query?.club_id ?? req.body?.club_id ?? req.user?.clubId;
  if ((raw === null || raw === undefined || raw === '') && !required) return null;
  return assertClubScope(req, raw);
}

async function getClubWallet(clubId, connection = undefined) {
  const wallet = await first(
    `SELECT id, balance, status FROM wallets WHERE wallet_type='CLUB' AND club_id=? LIMIT 1`,
    [clubId],
    connection
  );
  if (!wallet) throw new ApiError(400, 'CLB chưa có ví. Hãy tạo hoặc kiểm tra ví CLB trước.');
  if (wallet.status !== 'ACTIVE') throw new ApiError(400, 'Ví CLB không ở trạng thái hoạt động.');
  return wallet;
}

async function getStadiumAccess(stadiumId, clubId, connection = undefined) {
  const row = await first(
    `SELECT v.*, l.id AS link_id, l.club_id, l.relationship_type, l.is_primary,
            l.lease_fee_per_match, l.owner_revenue_share_pct, l.status AS link_status
     FROM v_stadium_ratings v
     JOIN stadium_club_links l ON l.stadium_id=v.id
     WHERE v.id=? AND l.club_id=? AND l.status='ACTIVE'
     LIMIT 1`,
    [stadiumId, clubId],
    connection
  );
  if (!row) throw new ApiError(404, 'CLB không có quyền sử dụng sân vận động này.');
  return row;
}

async function getStadiumOwner(stadiumId, connection = undefined) {
  return first(
    `SELECT l.club_id, c.name AS club_name, w.id AS wallet_id
     FROM stadium_club_links l
     JOIN clubs c ON c.id=l.club_id
     LEFT JOIN wallets w ON w.club_id=l.club_id AND w.wallet_type='CLUB'
     WHERE l.stadium_id=? AND l.relationship_type='OWNED' AND l.status='ACTIVE'
     ORDER BY l.id LIMIT 1`,
    [stadiumId],
    connection
  );
}

async function getMatchContext(matchId, connection = undefined) {
  const match = await first(
    `SELECT m.*, comp.name AS competition_name, comp.coefficient, comp.status AS competition_status,
            hc.name AS home_club_name, ac.name AS away_club_name,
            r.round_name, r.round_order, g.group_code
     FROM matches m
     JOIN competitions comp ON comp.id=m.competition_id
     LEFT JOIN clubs hc ON hc.id=m.home_club_id
     LEFT JOIN clubs ac ON ac.id=m.away_club_id
     LEFT JOIN competition_rounds r ON r.id=m.round_id
     LEFT JOIN competition_groups g ON g.id=m.group_id
     WHERE m.id=? LIMIT 1`,
    [matchId],
    connection
  );
  if (!match) throw new ApiError(404, 'Không tìm thấy trận đấu.');
  if (!match.home_club_id) throw new ApiError(400, 'Trận chưa xác định CLB chủ nhà.');
  if (match.status === 'CANCELLED') throw new ApiError(400, 'Không thể vận hành doanh thu cho trận đã hủy.');
  return match;
}

async function clubAppeal(clubId, connection = undefined) {
  const [ranking, squad, form, influence] = await Promise.all([
    first(`SELECT rank_position, score FROM v_latest_club_world_ranking WHERE club_id=?`, [clubId], connection),
    first(`SELECT COALESCE(MAX(market_value),0) AS top_value, COALESCE(SUM(market_value),0) AS squad_value
           FROM players WHERE club_id=? AND status IN ('ACTIVE','TRANSFER_LISTED')`, [clubId], connection),
    first(
      `SELECT COALESCE(SUM(points),0) AS form_points, COUNT(*) AS match_count
       FROM (
         SELECT CASE
           WHEN winner_club_id=? THEN 3
           WHEN status='FINISHED' AND home_score=away_score THEN 1
           ELSE 0 END AS points
         FROM matches
         WHERE status='FINISHED' AND (home_club_id=? OR away_club_id=?)
         ORDER BY COALESCE(scheduled_at,created_at) DESC LIMIT 5
       ) recent`,
      [clubId, clubId, clubId],
      connection
    ),
    first(`SELECT reputation_score,fan_count,media_score,commercial_score,momentum_score FROM club_influence_profiles WHERE club_id=?`, [clubId], connection)
  ]);
  const rank = toNumber(ranking?.rank_position || 30);
  const rankScore = rank <= 3 ? 1 : rank <= 10 ? 0.82 : rank <= 20 ? 0.62 : rank <= 40 ? 0.42 : 0.25;
  const starScore = clamp(toNumber(squad?.top_value) / 10000000000, 0, 1);
  const squadScore = clamp(toNumber(squad?.squad_value) / 100000000000, 0, 1);
  const formScore = toNumber(form?.match_count) ? clamp(toNumber(form.form_points) / (toNumber(form.match_count) * 3), 0, 1) : 0.5;
  const reputationScore = clamp(toNumber(influence?.reputation_score || 35) / 100, 0, 1);
  const commercialScore = clamp(toNumber(influence?.commercial_score || 30) / 100, 0, 1);
  const mediaScore = clamp(toNumber(influence?.media_score || 30) / 100, 0, 1);
  const momentumScore = clamp(toNumber(influence?.momentum_score || 50) / 100, 0, 1);
  const fanScore = clamp(Math.log10(Math.max(10, toNumber(influence?.fan_count || 50000))) / 8, 0, 1);
  return { rank, rankScore, starScore, squadScore, formScore, reputationScore, commercialScore, mediaScore, momentumScore, fanScore };
}

async function calculateMatchAttractiveness(match, stadium, connection = undefined) {
  const [home, away] = await Promise.all([
    clubAppeal(Number(match.home_club_id), connection),
    match.away_club_id ? clubAppeal(Number(match.away_club_id), connection) : Promise.resolve({ rank:30, rankScore:0.35, starScore:0.2, squadScore:0.2, formScore:0.5, reputationScore:0.35, commercialScore:0.3, mediaScore:0.3, momentumScore:0.5, fanScore:0.45 })
  ]);
  const coefficientScore = clamp((toNumber(match.coefficient) - 0.5) / 2.5, 0, 1);
  const stageScore = match.stage_type === 'KNOCKOUT'
    ? clamp(0.65 + toNumber(match.round_order) * 0.05, 0.65, 1)
    : 0.45;
  const stadiumScore = clamp(toNumber(stadium.rating_score) / 100, 0, 1);
  const rivalry = Math.abs(home.rank - (away.rank || 30)) <= 5 ? 0.1 : 0;
  const score = clamp(
    12 + coefficientScore * 19 + stageScore * 18 + stadiumScore * 16 +
    home.rankScore * 8 + away.rankScore * 6 + home.starScore * 4 + away.starScore * 3 +
    home.formScore * 3 + away.formScore * 2 +
    home.reputationScore * 6 + away.reputationScore * 4 + home.fanScore * 4 + away.fanScore * 2 +
    home.mediaScore * 2 + home.commercialScore * 3 + home.momentumScore * 2 + rivalry * 10,
    5,
    100
  );
  return {
    score,
    factors: { coefficientScore, stageScore, stadiumScore, home, away, rivalry }
  };
}

async function buildMatchdaySimulation({ match, stadium, mode, body, connection = undefined }) {
  const seed = parsePositiveInt(body.random_seed || Date.now() % 4294967295, 'random_seed', { min: 1, max: 4294967295 });
  const random = seededRandom(seed);
  const attraction = await calculateMatchAttractiveness(match, stadium, connection);
  const noise = (random() - 0.5) * 18;
  const calculatedOccupancy = clamp(20 + attraction.score * 0.77 + noise, 12, 100);
  const occupancyPct = mode === 'MANUAL'
    ? Number(parseDecimal(body.occupancy_pct, 'occupancy_pct', { min: 1, max: 100 }))
    : calculatedOccupancy;

  const stagePriceBoost = match.stage_type === 'KNOCKOUT' ? 0.22 + Math.min(0.25, toNumber(match.round_order) * 0.025) : 0;
  const demandPriceBoost = attraction.score / 250;
  const coefficientBoost = clamp(toNumber(match.coefficient) * 0.12, 0.08, 0.45);
  const autoStandardPrice = roundMoney(toNumber(stadium.default_standard_ticket) * (0.72 + stagePriceBoost + demandPriceBoost + coefficientBoost), 10000);
  const autoVipPrice = roundMoney(toNumber(stadium.default_vip_ticket) * (0.78 + stagePriceBoost + demandPriceBoost * 1.15 + coefficientBoost), 50000);
  const standardTicketPrice = mode === 'MANUAL'
    ? Number(parseMoney(body.standard_ticket_price, 'standard_ticket_price'))
    : autoStandardPrice;
  const vipTicketPrice = mode === 'MANUAL'
    ? Number(parseMoney(body.vip_ticket_price, 'vip_ticket_price'))
    : autoVipPrice;

  const vipOccupancyPct = clamp(occupancyPct + (attraction.score >= 65 ? 6 : 1) + (random() - 0.5) * 10, 8, 100);
  const attendanceStandard = Math.min(toNumber(stadium.standard_seats), Math.round(toNumber(stadium.standard_seats) * occupancyPct / 100));
  const attendanceVip = Math.min(toNumber(stadium.vip_seats), Math.round(toNumber(stadium.vip_seats) * vipOccupancyPct / 100));
  const attendanceTotal = Math.min(toNumber(stadium.capacity_total), attendanceStandard + attendanceVip);

  const standardRevenue = attendanceStandard * standardTicketPrice;
  const vipRevenue = attendanceVip * vipTicketPrice;
  const concessionsRevenue = roundMoney(attendanceTotal * toNumber(stadium.concession_per_head) * (0.78 + random() * 0.42), 1000);
  const parkingRevenue = roundMoney(attendanceTotal * toNumber(stadium.parking_per_head) * (0.55 + toNumber(stadium.parking_quality) / 200), 1000);
  const sponsorship = await first(
    `SELECT COALESCE(SUM(amount),0) AS total
     FROM sponsorship_offers
     WHERE club_id=? AND match_id=? AND status='ACCEPTED'`,
    [match.home_club_id, match.id],
    connection
  );
  const sponsorshipRevenue = toNumber(sponsorship?.total);
  const grossRevenue = standardRevenue + vipRevenue + concessionsRevenue + parkingRevenue + sponsorshipRevenue;
  const capacityCost = toNumber(stadium.capacity_total) * (1100 + toNumber(stadium.security_quality) * 6);
  const qualityCost = toNumber(stadium.rating_score) * 420000;
  const stageCost = match.stage_type === 'KNOCKOUT' ? 35000000 + toNumber(match.round_order) * 5000000 : 12000000;
  const operatingCost = roundMoney(8000000 + capacityCost + qualityCost + stageCost, 1000000);
  const stadiumRent = toNumber(stadium.lease_fee_per_match);
  const shareBase = standardRevenue + vipRevenue + concessionsRevenue + parkingRevenue;
  const ownerRevenueShare = roundMoney(shareBase * toNumber(stadium.owner_revenue_share_pct) / 100, 1000);
  const netRevenue = grossRevenue - operatingCost - stadiumRent - ownerRevenueShare;

  return {
    seed,
    attractivenessScore: attraction.score,
    occupancyPct,
    attendanceStandard,
    attendanceVip,
    attendanceTotal,
    standardTicketPrice,
    vipTicketPrice,
    standardRevenue,
    vipRevenue,
    concessionsRevenue,
    parkingRevenue,
    sponsorshipRevenue,
    grossRevenue,
    operatingCost,
    stadiumRent,
    ownerRevenueShare,
    netRevenue,
    snapshot: { attraction, vipOccupancyPct, formulaVersion: '2.0.9' }
  };
}

function normalizeStadiumInput(body, { partial = false } = {}) {
  const result = {};
  const textFields = ['name', 'city', 'country_name', 'image_url'];
  for (const field of textFields) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) {
      result[field] = parseText(body[field], field, {
        required: field === 'name' && !partial,
        nullable: field !== 'name',
        max: field === 'image_url' ? 500 : 180
      });
    }
  }
  const integerFields = {
    opened_year: { required: false, min: 1800, max: 2200 },
    level_no: { min: 1, max: 5 },
    capacity_total: { min: 100, max: 500000 },
    standard_seats: { min: 0, max: 500000 },
    vip_seats: { min: 0, max: 100000 },
    hospitality_boxes: { min: 0, max: 10000 }
  };
  for (const [field, options] of Object.entries(integerFields)) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) {
      result[field] = parsePositiveInt(body[field], field, { required: options.required !== false && !partial, min: options.min, max: options.max });
    }
  }
  for (const field of QUALITY_FIELDS) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) {
      result[field] = parsePositiveInt(body[field], field, { required: !partial, min: 1, max: 100 });
    }
  }
  for (const field of ['default_standard_ticket', 'default_vip_ticket', 'concession_per_head', 'parking_per_head']) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) result[field] = parseMoney(body[field], field);
  }
  for (const field of STADIUM_FEATURE_FIELDS) {
    if (!partial || Object.prototype.hasOwnProperty.call(body, field)) result[field] = parseBoolean(body[field], false);
  }
  if (!partial || Object.prototype.hasOwnProperty.call(body, 'status')) result.status = parseEnum(body.status || 'ACTIVE', STADIUM_STATUSES, 'status');
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined));
}

/* ========================================================================== */
/* PUBLIC SHOWCASE                                                            */
/* ========================================================================== */

router.get('/public/stadiums', optionalAuthenticate, async (req, res) => {
  const rows = await query(
    `SELECT v.id,v.code,v.name,v.city,v.country_name,v.image_url,v.capacity_total,v.standard_seats,v.vip_seats,
            v.hospitality_boxes,v.rating_score,v.stadium_class,v.level_no,v.status,s.condition_pct,s.available_after,s.matches_hosted,
            GROUP_CONCAT(DISTINCT CASE WHEN l.status='ACTIVE' THEN c.name END ORDER BY l.is_primary DESC SEPARATOR ', ') AS clubs,
            MAX(CASE WHEN l.is_primary THEN c.id END) AS primary_club_id,
            MAX(CASE WHEN l.is_primary THEN c.logo_url END) AS primary_club_logo
     FROM v_stadium_ratings v
     JOIN stadiums s ON s.id=v.id
     LEFT JOIN stadium_club_links l ON l.stadium_id=v.id
     LEFT JOIN clubs c ON c.id=l.club_id
     WHERE v.status<>'INACTIVE'
     GROUP BY v.id
     ORDER BY v.rating_score DESC,v.capacity_total DESC
     LIMIT 50`
  );
  return ok(res, rows);
});

router.get('/public/stadiums/:id', optionalAuthenticate, async (req, res) => {
  const stadiumId = parsePositiveInt(req.params.id, 'stadium_id');
  const [stadium, clubs, recent] = await Promise.all([
    first(`SELECT * FROM v_stadium_ratings WHERE id=?`, [stadiumId]),
    query(
      `SELECT l.*,c.name AS club_name,c.logo_url
       FROM stadium_club_links l JOIN clubs c ON c.id=l.club_id
       WHERE l.stadium_id=? AND l.status='ACTIVE' ORDER BY l.is_primary DESC,l.relationship_type`,
      [stadiumId]
    ),
    query(
      `SELECT match_id,host_club_name,home_club_name,away_club_name,competition_name,scheduled_at,
              attendance_total,occupancy_pct,gross_revenue,net_revenue
       FROM v_matchday_finance_summary WHERE stadium_id=? AND status='SETTLED'
       ORDER BY settled_at DESC LIMIT 10`,
      [stadiumId]
    )
  ]);
  if (!stadium) throw new ApiError(404, 'Không tìm thấy sân vận động.');
  return ok(res, { stadium, clubs, recent });
});

/* ========================================================================== */
/* STADIUM CENTRE                                                             */
/* ========================================================================== */

router.get('/stadium-centre/summary', authenticate, requireClubOrAdmin, async (req, res) => {
  const clubId = currentClubId(req);
  const [club, wallet, stadiums, matchdays, offers, upgrades, totals] = await Promise.all([
    first(`SELECT id,name,logo_url FROM clubs WHERE id=?`, [clubId]),
    first(`SELECT id,balance,status FROM wallets WHERE wallet_type='CLUB' AND club_id=?`, [clubId]),
    query(`SELECT * FROM v_club_stadium_overview WHERE club_id=? ORDER BY is_primary DESC,rating_score DESC`, [clubId]),
    query(
      `SELECT m.id AS match_id,m.competition_id,m.status,m.stage_type,m.round_id,cr.round_name,cr.round_order,m.scheduled_at,m.home_club_id,m.away_club_id,
              hc.name AS home_club_name,ac.name AS away_club_name,comp.name AS competition_name,comp.coefficient,
              mf.id AS finance_id,mf.status AS finance_status,mf.occupancy_pct,mf.attendance_total,mf.gross_revenue,mf.net_revenue,
              mf.stadium_id,s.name AS stadium_name,
              msa.stadium_id AS assigned_stadium_id, assigned_s.name AS assigned_stadium_name,
              msa.eligibility_status AS stadium_eligibility_status, msa.compliance_score AS stadium_compliance_score,
              msa.hard_fail_count AS stadium_hard_fail_count, msa.soft_fail_count AS stadium_soft_fail_count
       FROM matches m
       JOIN competitions comp ON comp.id=m.competition_id
       LEFT JOIN competition_rounds cr ON cr.id=m.round_id
       LEFT JOIN clubs hc ON hc.id=m.home_club_id LEFT JOIN clubs ac ON ac.id=m.away_club_id
       LEFT JOIN matchday_finances mf ON mf.match_id=m.id
       LEFT JOIN stadiums s ON s.id=mf.stadium_id
       LEFT JOIN match_stadium_assignments msa ON msa.match_id=m.id
       LEFT JOIN stadiums assigned_s ON assigned_s.id=msa.stadium_id
       WHERE m.home_club_id=? AND m.status<>'CANCELLED'
       ORDER BY COALESCE(m.scheduled_at,m.created_at) DESC LIMIT 40`,
      [clubId]
    ),
    query(
      `SELECT so.*,sb.name AS brand_name,sb.industry,sb.brand_tier,sb.conflict_group,sb.accent_hex,
              s.name AS stadium_name,comp.name AS competition_name,
              hc.name AS home_club_name,ac.name AS away_club_name
       FROM sponsorship_offers so
       JOIN sponsor_brands sb ON sb.id=so.brand_id
       LEFT JOIN stadiums s ON s.id=so.stadium_id
       LEFT JOIN competitions comp ON comp.id=so.competition_id
       LEFT JOIN matches m ON m.id=so.match_id
       LEFT JOIN clubs hc ON hc.id=m.home_club_id LEFT JOIN clubs ac ON ac.id=m.away_club_id
       WHERE so.club_id=? ORDER BY FIELD(so.status,'OFFERED','ACCEPTED','PAID','REJECTED','EXPIRED'),so.created_at DESC LIMIT 80`,
      [clubId]
    ),
    query(
      `SELECT su.*,uc.code AS upgrade_code,uc.name AS upgrade_name,uc.category,uc.description,s.name AS stadium_name,
              TIMESTAMPDIFF(SECOND,su.starts_at,NOW()) AS elapsed_seconds,
              TIMESTAMPDIFF(SECOND,su.starts_at,su.expected_at) AS total_seconds
       FROM stadium_upgrades su
       JOIN stadium_upgrade_catalog uc ON uc.id=su.catalog_id JOIN stadiums s ON s.id=su.stadium_id
       WHERE su.club_id=? ORDER BY FIELD(su.status,'IN_PROGRESS','PLANNED','COMPLETED','CANCELLED'),su.created_at DESC LIMIT 60`,
      [clubId]
    ),
    first(
      `SELECT COUNT(*) AS settled_matchdays,COALESCE(SUM(attendance_total),0) AS attendance,
              COALESCE(SUM(gross_revenue),0) AS gross_revenue,COALESCE(SUM(net_revenue),0) AS net_revenue,
              COALESCE(AVG(occupancy_pct),0) AS avg_occupancy
       FROM matchday_finances WHERE host_club_id=? AND status='SETTLED'`,
      [clubId]
    )
  ]);
  if (!club) throw new ApiError(404, 'Không tìm thấy CLB.');
  return ok(res, { club, wallet, stadiums, matchdays, offers, upgrades, totals });
});

router.get('/stadium-upgrades/catalog', authenticate, requireClubOrAdmin, async (_req, res) => {
  const rows = await query(`SELECT * FROM stadium_upgrade_catalog WHERE is_active=TRUE ORDER BY category,base_cost`);
  return ok(res, rows);
});

router.get('/sponsor-brands', authenticate, requireClubOrAdmin, async (_req, res) => {
  const rows = await query(`SELECT * FROM sponsor_brands WHERE is_active=TRUE ORDER BY FIELD(brand_tier,'GLOBAL','NATIONAL','REGIONAL','LOCAL'),name`);
  return ok(res, rows);
});

router.post('/sponsor-brands', authenticate, requireAdmin, async (req, res) => {
  const code = parseText(req.body.code, 'code', { max: 50 }).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  const name = parseText(req.body.name, 'name', { max: 150 });
  const industry = parseText(req.body.industry, 'industry', { max: 100 });
  const brandTier = parseEnum(req.body.brand_tier, ['LOCAL','REGIONAL','NATIONAL','GLOBAL'], 'brand_tier');
  const minOffer = parseMoney(req.body.min_offer, 'min_offer');
  const maxOffer = parseMoney(req.body.max_offer, 'max_offer');
  if (Number(maxOffer) < Number(minOffer)) throw new ApiError(400, 'Mức tối đa phải lớn hơn hoặc bằng mức tối thiểu.');
  const conflictGroup = parseText(req.body.conflict_group || industry, 'conflict_group', { max: 80 }).toUpperCase().replace(/\s+/g, '_');
  const accentHex = parseText(req.body.accent_hex || '#3982FF', 'accent_hex', { max: 9 });
  const result = await query(
    `INSERT INTO sponsor_brands(code,name,industry,brand_tier,min_offer,max_offer,conflict_group,accent_hex,is_real_world_reference,is_active)
     VALUES(?,?,?,?,?,?,?,?,FALSE,TRUE)`,
    [code,name,industry,brandTier,minOffer,maxOffer,conflictGroup,accentHex]
  );
  return ok(res, await first(`SELECT * FROM sponsor_brands WHERE id=?`, [result.insertId]), 201);
});

router.post('/stadiums', authenticate, requireClubOrAdmin, async (req, res) => {
  const clubId = currentClubId(req);
  const input = normalizeStadiumInput({
    ...req.body,
    level_no: req.body.level_no || 1,
    capacity_total: req.body.capacity_total || 10000,
    standard_seats: req.body.standard_seats ?? 9000,
    vip_seats: req.body.vip_seats ?? 1000,
    hospitality_boxes: req.body.hospitality_boxes ?? 0,
    default_standard_ticket: req.body.default_standard_ticket || 100000,
    default_vip_ticket: req.body.default_vip_ticket || 500000,
    concession_per_head: req.body.concession_per_head || 35000,
    parking_per_head: req.body.parking_per_head || 8000,
    pitch_quality: req.body.pitch_quality || 45,
    seating_quality: req.body.seating_quality || 40,
    stands_quality: req.body.stands_quality || 40,
    lighting_quality: req.body.lighting_quality || 45,
    technology_quality: req.body.technology_quality || 35,
    hospitality_quality: req.body.hospitality_quality || 30,
    parking_quality: req.body.parking_quality || 35,
    security_quality: req.body.security_quality || 45,
    commercial_quality: req.body.commercial_quality || 30,
    atmosphere_quality: req.body.atmosphere_quality || 45,
    status: 'ACTIVE'
  });
  if (Number(input.standard_seats) + Number(input.vip_seats) > Number(input.capacity_total)) {
    throw new ApiError(400, 'Tổng ghế thường và VIP không được vượt sức chứa.');
  }
  const relationship = parseEnum(req.body.relationship_type || 'OWNED', LINK_TYPES, 'relationship_type');
  const result = await transaction(async (connection) => {
    const count = await first(`SELECT COUNT(*) AS total FROM stadium_club_links WHERE club_id=? AND status='ACTIVE'`, [clubId], connection);
    const code = String(req.body.code || `STD-${clubId}-${Date.now().toString(36)}`).trim().toUpperCase();
    const insert = await query(
      `INSERT INTO stadiums(code,name,city,country_name,image_url,opened_year,status,level_no,capacity_total,standard_seats,vip_seats,hospitality_boxes,
        default_standard_ticket,default_vip_ticket,concession_per_head,parking_per_head,
        pitch_quality,seating_quality,stands_quality,lighting_quality,technology_quality,hospitality_quality,parking_quality,security_quality,commercial_quality,atmosphere_quality,created_by_user_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [code,input.name,input.city,input.country_name||'Việt Nam',input.image_url,input.opened_year,input.status,input.level_no,input.capacity_total,input.standard_seats,input.vip_seats,input.hospitality_boxes,
       input.default_standard_ticket,input.default_vip_ticket,input.concession_per_head,input.parking_per_head,
       input.pitch_quality,input.seating_quality,input.stands_quality,input.lighting_quality,input.technology_quality,input.hospitality_quality,input.parking_quality,input.security_quality,input.commercial_quality,input.atmosphere_quality,req.user.id],
      connection
    );
    const stadiumId = insert.insertId;
    await query(
      `INSERT INTO stadium_club_links(stadium_id,club_id,relationship_type,is_primary,lease_fee_per_match,owner_revenue_share_pct,status)
       VALUES(?,?,?,?,?,?,'ACTIVE')`,
      [stadiumId,clubId,relationship,Number(count.total)===0,parseMoney(req.body.lease_fee_per_match||0,'lease_fee_per_match'),parseDecimal(req.body.owner_revenue_share_pct||0,'owner_revenue_share_pct',{min:0,max:80})],
      connection
    );
    await audit({userId:req.user.id,actionCode:'CREATE_STADIUM',entityTable:'stadiums',entityId:stadiumId,details:{clubId,relationship}},connection);
    return stadiumId;
  });
  return ok(res, await first(`SELECT * FROM v_club_stadium_overview WHERE id=? AND club_id=?`, [result, clubId]), 201);
});

router.patch('/stadiums/:id', authenticate, requireClubOrAdmin, async (req, res) => {
  const stadiumId = parsePositiveInt(req.params.id, 'stadium_id');
  const clubId = currentClubId(req);
  const access = await getStadiumAccess(stadiumId, clubId);
  if (access.relationship_type !== 'OWNED' && req.user.accountType !== 'FIFA_ADMIN') {
    throw new ApiError(403, 'Chỉ chủ sở hữu sân hoặc Admin FIFA được sửa thông tin sân.');
  }
  const input = normalizeStadiumInput(req.body, { partial: true });
  const fields = Object.keys(input);
  if (!fields.length) throw new ApiError(400, 'Không có dữ liệu hợp lệ để cập nhật.');
  const mergedCapacity = Number(input.capacity_total ?? access.capacity_total);
  const mergedStandard = Number(input.standard_seats ?? access.standard_seats);
  const mergedVip = Number(input.vip_seats ?? access.vip_seats);
  if (mergedStandard + mergedVip > mergedCapacity) throw new ApiError(400, 'Tổng ghế thường và VIP không được vượt sức chứa.');
  await query(`UPDATE stadiums SET ${fields.map((field)=>`\`${field}\`=?`).join(',')} WHERE id=?`, [...fields.map((field)=>input[field]),stadiumId]);
  await audit({userId:req.user.id,actionCode:'UPDATE_STADIUM',entityTable:'stadiums',entityId:stadiumId,details:{fields}});
  return ok(res, await first(`SELECT * FROM v_club_stadium_overview WHERE id=? AND club_id=?`, [stadiumId, clubId]));
});

router.post('/stadiums/:id/links', authenticate, requireClubOrAdmin, async (req, res) => {
  const stadiumId = parsePositiveInt(req.params.id, 'stadium_id');
  const clubId = currentClubId(req);
  const relationship = parseEnum(req.body.relationship_type || 'LEASED', LINK_TYPES, 'relationship_type');
  if (relationship === 'OWNED' && req.user.accountType !== 'FIFA_ADMIN') throw new ApiError(403, 'Chỉ Admin FIFA được chuyển quyền sở hữu sân.');
  const fee = parseMoney(req.body.lease_fee_per_match || 0, 'lease_fee_per_match');
  const share = parseDecimal(req.body.owner_revenue_share_pct || 0, 'owner_revenue_share_pct', { min: 0, max: 80 });
  const startsOn = parseDate(req.body.starts_on, 'starts_on');
  const endsOn = parseDate(req.body.ends_on, 'ends_on');
  if (startsOn && endsOn && endsOn < startsOn) throw new ApiError(400, 'Ngày kết thúc thuê sân không hợp lệ.');
  const stadium = await first(`SELECT id FROM stadiums WHERE id=? AND status<>'INACTIVE'`, [stadiumId]);
  if (!stadium) throw new ApiError(404, 'Không tìm thấy sân hoạt động.');
  await query(
    `INSERT INTO stadium_club_links(stadium_id,club_id,relationship_type,is_primary,lease_fee_per_match,owner_revenue_share_pct,starts_on,ends_on,status)
     VALUES(?,?,?,FALSE,?,?,?,?,'ACTIVE')
     ON DUPLICATE KEY UPDATE relationship_type=VALUES(relationship_type),lease_fee_per_match=VALUES(lease_fee_per_match),
       owner_revenue_share_pct=VALUES(owner_revenue_share_pct),starts_on=VALUES(starts_on),ends_on=VALUES(ends_on),status='ACTIVE'`,
    [stadiumId,clubId,relationship,fee,share,startsOn,endsOn]
  );
  return ok(res, await first(`SELECT * FROM v_club_stadium_overview WHERE id=? AND club_id=?`, [stadiumId, clubId]), 201);
});

router.post('/stadiums/:id/set-primary', authenticate, requireClubOrAdmin, async (req, res) => {
  const stadiumId = parsePositiveInt(req.params.id, 'stadium_id');
  const clubId = currentClubId(req);
  await getStadiumAccess(stadiumId, clubId);
  await transaction(async (connection) => {
    await query(`UPDATE stadium_club_links SET is_primary=FALSE WHERE club_id=?`, [clubId], connection);
    await query(`UPDATE stadium_club_links SET is_primary=TRUE WHERE club_id=? AND stadium_id=? AND status='ACTIVE'`, [clubId,stadiumId], connection);
  });
  return ok(res, { club_id: clubId, stadium_id: stadiumId, is_primary: true });
});

router.post('/stadiums/:id/upgrades', authenticate, requireClubOrAdmin, async (req, res) => {
  const stadiumId = parsePositiveInt(req.params.id, 'stadium_id');
  const clubId = currentClubId(req);
  const access = await getStadiumAccess(stadiumId, clubId);
  if (access.relationship_type !== 'OWNED' && req.user.accountType !== 'FIFA_ADMIN') throw new ApiError(403, 'Chỉ CLB sở hữu sân mới được nâng cấp.');
  const catalogId = parsePositiveInt(req.body.catalog_id, 'catalog_id');
  const catalog = await first(`SELECT * FROM stadium_upgrade_catalog WHERE id=? AND is_active=TRUE`, [catalogId]);
  if (!catalog) throw new ApiError(404, 'Không tìm thấy gói nâng cấp.');
  if (Number(access.level_no) < Number(catalog.min_level)) throw new ApiError(400, `Sân phải đạt cấp ${catalog.min_level} để dùng nâng cấp này.`);
  const existing = await first(`SELECT id FROM stadium_upgrades WHERE stadium_id=? AND catalog_id=? AND status IN ('PLANNED','IN_PROGRESS')`, [stadiumId,catalogId]);
  if (existing) throw new ApiError(409, 'Gói nâng cấp này đang được triển khai tại sân.');
  const costFactor = 0.88 + Number(access.level_no) * 0.06 + Number(access.rating_score) / 500;
  const finalCost = roundMoney(Number(catalog.base_cost) * costFactor, 1000000);
  const upgradeId = await transaction(async (connection) => {
    const wallet = await getClubWallet(clubId, connection);
    if (Number(wallet.balance) < finalCost) throw new ApiError(400, 'Ví CLB không đủ tiền thực hiện nâng cấp.');
    const expectedAt = new Date(Date.now() + Number(catalog.duration_days) * 86400000);
    const before = Object.fromEntries(['level_no','capacity_total','standard_seats','vip_seats','hospitality_boxes',...QUALITY_FIELDS].map((key)=>[key,access[key]]));
    const insert = await query(
      `INSERT INTO stadium_upgrades(stadium_id,club_id,catalog_id,status,final_cost,expected_at,before_snapshot,created_by_user_id)
       VALUES(?,?,?,'IN_PROGRESS',?,?,?,?)`,
      [stadiumId,clubId,catalogId,finalCost,expectedAt.toISOString().slice(0,19).replace('T',' '),JSON.stringify(before),req.user.id],
      connection
    );
    const id = insert.insertId;
    await callProcedure('sp_post_wallet_entry_core',[
      wallet.id,'DEBIT','STADIUM_UPGRADE',String(finalCost),null,null,'stadium_upgrades',id,
      `Đầu tư ${catalog.name} cho ${access.name}`,req.user.id,null
    ],connection);
    const tx = await first(`SELECT id FROM wallet_transactions WHERE reference_table='stadium_upgrades' AND reference_id=? AND transaction_type='STADIUM_UPGRADE' ORDER BY id DESC LIMIT 1`,[id],connection);
    await query(`UPDATE stadium_upgrades SET wallet_transaction_id=? WHERE id=?`,[tx?.id||null,id],connection);
    await query(`UPDATE stadiums SET status='UNDER_UPGRADE' WHERE id=?`,[stadiumId],connection);
    await audit({userId:req.user.id,actionCode:'START_STADIUM_UPGRADE',entityTable:'stadium_upgrades',entityId:id,details:{stadiumId,clubId,catalogId,finalCost}},connection);
    return id;
  });
  return ok(res, await first(
    `SELECT su.*,uc.name AS upgrade_name,s.name AS stadium_name FROM stadium_upgrades su
     JOIN stadium_upgrade_catalog uc ON uc.id=su.catalog_id JOIN stadiums s ON s.id=su.stadium_id WHERE su.id=?`,[upgradeId]
  ),201);
});

router.post('/stadium-upgrades/:id/complete', authenticate, requireClubOrAdmin, async (req, res) => {
  const upgradeId = parsePositiveInt(req.params.id, 'upgrade_id');
  const row = await first(
    `SELECT su.*,uc.*,s.name AS stadium_name FROM stadium_upgrades su
     JOIN stadium_upgrade_catalog uc ON uc.id=su.catalog_id JOIN stadiums s ON s.id=su.stadium_id WHERE su.id=?`,
    [upgradeId]
  );
  if (!row) throw new ApiError(404, 'Không tìm thấy tiến độ nâng cấp.');
  assertClubScope(req, row.club_id);
  if (row.status === 'COMPLETED') return ok(res, row);
  if (row.status !== 'IN_PROGRESS') throw new ApiError(400, 'Nâng cấp không ở trạng thái đang thực hiện.');
  const force = parseBoolean(req.body.force, false);
  if (new Date(row.expected_at).getTime() > Date.now() && !force && req.user.accountType !== 'FIFA_ADMIN') {
    throw new ApiError(400, 'Nâng cấp chưa đến thời điểm hoàn thành.');
  }
  await transaction(async (connection) => {
    const stadium = await first(`SELECT * FROM stadiums WHERE id=? FOR UPDATE`, [row.stadium_id], connection);
    const updated = {
      capacity_total: Math.max(100, Number(stadium.capacity_total)+Number(row.capacity_add)),
      standard_seats: Math.max(0, Number(stadium.standard_seats)+Number(row.standard_seats_add)),
      vip_seats: Math.max(0, Number(stadium.vip_seats)+Number(row.vip_seats_add)),
      hospitality_boxes: Math.max(0, Number(stadium.hospitality_boxes)+Number(row.hospitality_boxes_add))
    };
    for (const field of QUALITY_FIELDS) {
      const catalogField = field.replace('_quality','_bonus');
      updated[field] = clamp(Number(stadium[field]) + Number(row[catalogField] || 0), 1, 100);
    }
    let featureUnlocks = {};
    try {
      featureUnlocks = typeof row.feature_unlocks === 'string' ? JSON.parse(row.feature_unlocks) : (row.feature_unlocks || {});
    } catch {
      featureUnlocks = {};
    }
    for (const field of STADIUM_FEATURE_FIELDS) {
      updated[field] = Boolean(featureUnlocks[field]) || Boolean(stadium[field]);
    }
    const rating = QUALITY_FIELDS.reduce((sum,field)=>sum+updated[field],0)/QUALITY_FIELDS.length;
    updated.level_no = rating >= 88 ? 5 : rating >= 75 ? 4 : rating >= 60 ? 3 : rating >= 45 ? 2 : 1;
    await query(
      `UPDATE stadiums SET capacity_total=?,standard_seats=?,vip_seats=?,hospitality_boxes=?,level_no=?,
       pitch_quality=?,seating_quality=?,stands_quality=?,lighting_quality=?,technology_quality=?,hospitality_quality=?,
       parking_quality=?,security_quality=?,commercial_quality=?,atmosphere_quality=?,
       has_var=?,has_goal_line_technology=?,has_led_perimeter=?,has_backup_power=?,has_media_center=?,has_medical_center=?,
       status='ACTIVE' WHERE id=?`,
      [updated.capacity_total,updated.standard_seats,updated.vip_seats,updated.hospitality_boxes,updated.level_no,
       ...QUALITY_FIELDS.map((field)=>updated[field]),...STADIUM_FEATURE_FIELDS.map((field)=>updated[field]),row.stadium_id],
      connection
    );
    await query(`UPDATE stadium_upgrades SET status='COMPLETED',completed_at=NOW(6),after_snapshot=? WHERE id=?`,[JSON.stringify(updated),upgradeId],connection);
    await audit({userId:req.user.id,actionCode:'COMPLETE_STADIUM_UPGRADE',entityTable:'stadium_upgrades',entityId:upgradeId,details:updated},connection);
  });
  return ok(res, await first(`SELECT * FROM stadium_upgrades WHERE id=?`, [upgradeId]));
});

/* ========================================================================== */
/* MATCHDAY ECONOMY                                                           */
/* ========================================================================== */

router.post('/stadium-matchdays/:matchId/simulate', authenticate, requireClubOrAdmin, async (req, res) => {
  const matchId = parsePositiveInt(req.params.matchId, 'match_id');
  const match = await getMatchContext(matchId);
  const clubId = assertClubScope(req, match.home_club_id);
  const stadiumId = parsePositiveInt(req.body.stadium_id, 'stadium_id');
  const stadium = await getStadiumAccess(stadiumId, clubId);
  if (stadium.status === 'INACTIVE') throw new ApiError(400, 'Sân đang ngừng hoạt động.');
  await ensureVenueCanHost({ matchId, stadiumId, user: req.user });
  const existing = await first(`SELECT status FROM matchday_finances WHERE match_id=?`, [matchId]);
  if (existing?.status === 'SETTLED') throw new ApiError(409, 'Doanh thu trận này đã chốt, không thể mô phỏng lại.');
  const mode = parseEnum(req.body.simulation_mode || 'RANDOM', ['RANDOM','MANUAL'], 'simulation_mode');
  const simulation = await buildMatchdaySimulation({ match, stadium, mode, body: req.body });
  await query(
    `INSERT INTO matchday_finances(
       match_id,stadium_id,stadium_club_link_id,host_club_id,simulation_mode,random_seed,attractiveness_score,occupancy_pct,
       attendance_standard,attendance_vip,attendance_total,standard_ticket_price,vip_ticket_price,
       standard_ticket_revenue,vip_ticket_revenue,concessions_revenue,parking_revenue,sponsorship_revenue,gross_revenue,
       operating_cost,stadium_rent,owner_revenue_share,net_revenue,calculation_snapshot,status,created_by_user_id)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'DRAFT',?)
     ON DUPLICATE KEY UPDATE stadium_id=VALUES(stadium_id),stadium_club_link_id=VALUES(stadium_club_link_id),
       simulation_mode=VALUES(simulation_mode),random_seed=VALUES(random_seed),attractiveness_score=VALUES(attractiveness_score),
       occupancy_pct=VALUES(occupancy_pct),attendance_standard=VALUES(attendance_standard),attendance_vip=VALUES(attendance_vip),
       attendance_total=VALUES(attendance_total),standard_ticket_price=VALUES(standard_ticket_price),vip_ticket_price=VALUES(vip_ticket_price),
       standard_ticket_revenue=VALUES(standard_ticket_revenue),vip_ticket_revenue=VALUES(vip_ticket_revenue),
       concessions_revenue=VALUES(concessions_revenue),parking_revenue=VALUES(parking_revenue),sponsorship_revenue=VALUES(sponsorship_revenue),
       gross_revenue=VALUES(gross_revenue),operating_cost=VALUES(operating_cost),stadium_rent=VALUES(stadium_rent),
       owner_revenue_share=VALUES(owner_revenue_share),net_revenue=VALUES(net_revenue),calculation_snapshot=VALUES(calculation_snapshot),
       status='DRAFT',created_by_user_id=VALUES(created_by_user_id)`,
    [matchId,stadiumId,stadium.link_id,clubId,mode,simulation.seed,simulation.attractivenessScore,simulation.occupancyPct,
     simulation.attendanceStandard,simulation.attendanceVip,simulation.attendanceTotal,simulation.standardTicketPrice,simulation.vipTicketPrice,
     simulation.standardRevenue,simulation.vipRevenue,simulation.concessionsRevenue,simulation.parkingRevenue,simulation.sponsorshipRevenue,
     simulation.grossRevenue,simulation.operatingCost,simulation.stadiumRent,simulation.ownerRevenueShare,simulation.netRevenue,
     JSON.stringify(simulation.snapshot),req.user.id]
  );
  return ok(res, await first(`SELECT * FROM v_matchday_finance_summary WHERE match_id=?`, [matchId]));
});

router.post('/stadium-matchdays/:matchId/settle', authenticate, requireClubOrAdmin, async (req, res) => {
  const matchId = parsePositiveInt(req.params.matchId, 'match_id');
  const finance = await first(`SELECT * FROM matchday_finances WHERE match_id=?`, [matchId]);
  if (!finance) throw new ApiError(404, 'Hãy mô phỏng hoặc nhập doanh thu trận đấu trước.');
  const clubId = assertClubScope(req, finance.host_club_id);
  if (finance.status === 'SETTLED') throw new ApiError(409, 'Doanh thu trận đấu đã được chốt trước đó.');
  await transaction(async (connection) => {
    const wallet = await getClubWallet(clubId, connection);
    const stadium = await getStadiumAccess(finance.stadium_id, clubId, connection);
    const owner = await getStadiumOwner(finance.stadium_id, connection);
    const baseRevenue = Number(finance.standard_ticket_revenue)+Number(finance.vip_ticket_revenue)+Number(finance.concessions_revenue)+Number(finance.parking_revenue);
    if (baseRevenue > 0) {
      await callProcedure('sp_post_wallet_entry_core',[wallet.id,'CREDIT','MATCHDAY_REVENUE',String(baseRevenue),null,null,'matchday_finances',finance.id,'Doanh thu vé và dịch vụ ngày thi đấu',req.user.id,null],connection);
    }
    const sponsorRevenue = await first(`SELECT COALESCE(SUM(amount),0) AS total FROM sponsorship_offers WHERE club_id=? AND match_id=? AND status='ACCEPTED'`,[clubId,matchId],connection);
    const sponsorAmount = Number(sponsorRevenue?.total||0);
    if (sponsorAmount > 0) {
      await callProcedure('sp_post_wallet_entry_core',[wallet.id,'CREDIT','SPONSORSHIP',String(sponsorAmount),null,null,'matchday_finances',finance.id,'Tài trợ quảng cáo trận đấu',req.user.id,null],connection);
    }
    if (Number(finance.operating_cost)>0) {
      await callProcedure('sp_post_wallet_entry_core',[wallet.id,'DEBIT','MATCHDAY_COST',String(finance.operating_cost),null,null,'matchday_finances',finance.id,'Chi phí tổ chức và vận hành sân',req.user.id,null],connection);
    }
    const rentAndShare = Number(finance.stadium_rent)+Number(finance.owner_revenue_share);
    if (rentAndShare > 0) {
      if (owner?.wallet_id && Number(owner.club_id)!==Number(clubId)) {
        await callProcedure('sp_wallet_transfer_core',[wallet.id,owner.wallet_id,'STADIUM_RENT',String(rentAndShare),`RENT-${finance.id}`,'matchday_finances',finance.id,`Phí thuê/chia sẻ doanh thu sân ${stadium.name}`,req.user.id],connection);
      } else {
        await callProcedure('sp_post_wallet_entry_core',[wallet.id,'DEBIT','STADIUM_RENT',String(rentAndShare),null,null,'matchday_finances',finance.id,'Phí thuê và chia sẻ doanh thu sân',req.user.id,null],connection);
      }
    }
    const refreshedSponsor = sponsorAmount;
    const refreshedGross = baseRevenue + refreshedSponsor;
    const refreshedNet = refreshedGross-Number(finance.operating_cost)-rentAndShare;
    await query(`UPDATE matchday_finances SET sponsorship_revenue=?,gross_revenue=?,net_revenue=?,status='SETTLED',settled_at=NOW(6) WHERE id=?`,[refreshedSponsor,refreshedGross,refreshedNet,finance.id],connection);
    await query(`UPDATE sponsorship_offers SET status='PAID',paid_at=NOW(6) WHERE club_id=? AND match_id=? AND status='ACCEPTED'`,[clubId,matchId],connection);
    await query(`UPDATE sponsorship_contracts SET status='COMPLETED',paid_at=NOW(6) WHERE club_id=? AND match_id=? AND status='ACTIVE'`,[clubId,matchId],connection);
    await audit({userId:req.user.id,actionCode:'SETTLE_MATCHDAY_FINANCE',entityTable:'matchday_finances',entityId:finance.id,details:{matchId,clubId,netRevenue:refreshedNet}},connection);
  });
  return ok(res, await first(`SELECT * FROM v_matchday_finance_summary WHERE match_id=?`, [matchId]));
});

/* ========================================================================== */
/* SPONSORSHIP MARKET                                                         */
/* ========================================================================== */

router.post('/sponsorship/offers/random', authenticate, requireClubOrAdmin, async (req, res) => {
  const clubId = currentClubId(req);
  const matchId = parsePositiveInt(req.body.match_id, 'match_id');
  const match = await getMatchContext(matchId);
  if (Number(match.home_club_id)!==Number(clubId)) throw new ApiError(403, 'Chỉ CLB chủ nhà mới nhận tài trợ trận này.');
  const stadiumId = parsePositiveInt(req.body.stadium_id, 'stadium_id');
  const stadium = await getStadiumAccess(stadiumId, clubId);
  const finance = await first(`SELECT attractiveness_score FROM matchday_finances WHERE match_id=?`,[matchId]);
  const attraction = finance ? Number(finance.attractiveness_score) : (await calculateMatchAttractiveness(match,stadium)).score;
  const seed = parsePositiveInt(req.body.random_seed || Date.now()%4294967295,'random_seed',{min:1,max:4294967295});
  const random = seededRandom(seed);
  let weights;
  if (attraction < 30) weights=[{value:0,weight:55},{value:1,weight:35},{value:2,weight:9},{value:3,weight:1}];
  else if (attraction < 55) weights=[{value:0,weight:25},{value:1,weight:45},{value:2,weight:23},{value:3,weight:6},{value:4,weight:1}];
  else if (attraction < 75) weights=[{value:0,weight:8},{value:1,weight:32},{value:2,weight:38},{value:3,weight:18},{value:4,weight:4}];
  else weights=[{value:0,weight:2},{value:1,weight:18},{value:2,weight:35},{value:3,weight:32},{value:4,weight:13}];
  const count = weightedChoice(random,weights);
  const allowedTiers = attraction>=78?['GLOBAL','NATIONAL','REGIONAL','LOCAL']:attraction>=58?['NATIONAL','REGIONAL','LOCAL','GLOBAL']:attraction>=35?['REGIONAL','LOCAL','NATIONAL']:['LOCAL','REGIONAL'];
  const brands = await query(`SELECT * FROM sponsor_brands WHERE is_active=TRUE AND brand_tier IN (${allowedTiers.map(()=>'?').join(',')})`,allowedTiers);
  const shuffled=[...brands].sort(()=>random()-.5).slice(0,count);
  await transaction(async(connection)=>{
    await query(`UPDATE sponsorship_offers SET status='EXPIRED' WHERE club_id=? AND match_id=? AND status='OFFERED'`,[clubId,matchId],connection);
    for(const brand of shuffled){
      const base=Number(brand.min_offer)+random()*(Number(brand.max_offer)-Number(brand.min_offer));
      const scale=0.45+attraction/82+Number(stadium.commercial_quality)/260+Number(match.coefficient)*0.08;
      const amount=roundMoney(base*scale*(0.78+random()*0.52),1000000);
      const offerType=weightedChoice(random,[
        {value:'MATCH_PARTNER',weight:35},{value:'LED_BOARD',weight:30},{value:'VIP_LOUNGE',weight:15},{value:'STADIUM_PARTNER',weight:20}
      ]);
      const probability=clamp(12+attraction*0.72+Number(stadium.commercial_quality)*0.18+(brand.brand_tier==='GLOBAL'?-8:8),1,98);
      await query(
        `INSERT INTO sponsorship_offers(club_id,stadium_id,competition_id,match_id,brand_id,offer_type,amount,status,attractiveness_score,appearance_probability,factors,expires_at,created_by_user_id)
         VALUES(?,?,?,?,?,?,?,'OFFERED',?,?,?,DATE_ADD(NOW(),INTERVAL 7 DAY),?)`,
        [clubId,stadiumId,match.competition_id,matchId,brand.id,offerType,amount,attraction,probability,JSON.stringify({seed,stadiumRating:stadium.rating_score,competitionCoefficient:match.coefficient,brandTier:brand.brand_tier}),req.user.id],
        connection
      );
    }
    await audit({userId:req.user.id,actionCode:'RANDOM_SPONSOR_OFFERS',entityTable:'matches',entityId:matchId,details:{clubId,count,attraction,seed}},connection);
  });
  const rows=await query(
    `SELECT so.*,sb.name AS brand_name,sb.industry,sb.brand_tier,sb.conflict_group,sb.accent_hex
     FROM sponsorship_offers so JOIN sponsor_brands sb ON sb.id=so.brand_id
     WHERE so.club_id=? AND so.match_id=? AND so.status='OFFERED' ORDER BY so.amount DESC`,[clubId,matchId]
  );
  return ok(res,{count:rows.length,attractiveness_score:attraction,offers:rows});
});

router.post('/sponsorship/offers/manual', authenticate, requireAdmin, async (req,res)=>{
  const clubId=parsePositiveInt(req.body.club_id,'club_id');
  const brandId=parsePositiveInt(req.body.brand_id,'brand_id');
  const stadiumId=parsePositiveInt(req.body.stadium_id,'stadium_id',{required:false});
  const matchId=parsePositiveInt(req.body.match_id,'match_id',{required:false});
  const competitionId=parsePositiveInt(req.body.competition_id,'competition_id',{required:false});
  const offerType=parseEnum(req.body.offer_type||'MATCH_PARTNER',OFFER_TYPES,'offer_type');
  const amount=parseMoney(req.body.amount,'amount',{allowZero:false});
  const brand=await first(`SELECT id FROM sponsor_brands WHERE id=? AND is_active=TRUE`,[brandId]);
  if(!brand)throw new ApiError(404,'Không tìm thấy thương hiệu tài trợ.');
  const insert=await query(
    `INSERT INTO sponsorship_offers(club_id,stadium_id,competition_id,match_id,brand_id,offer_type,amount,status,attractiveness_score,appearance_probability,factors,expires_at,created_by_user_id)
     VALUES(?,?,?,?,?,?,?,'OFFERED',100,100,?,DATE_ADD(NOW(),INTERVAL 30 DAY),?)`,
    [clubId,stadiumId,competitionId,matchId,brandId,offerType,amount,JSON.stringify({manual:true}),req.user.id]
  );
  return ok(res,await first(`SELECT * FROM sponsorship_offers WHERE id=?`,[insert.insertId]),201);
});

router.patch('/sponsorship/offers/:id/status', authenticate, requireClubOrAdmin, async (req,res)=>{
  const offerId=parsePositiveInt(req.params.id,'offer_id');
  const status=parseEnum(req.body.status,OFFER_STATUSES,'status');
  const offer=await first(
    `SELECT so.*,sb.conflict_group,sb.name AS brand_name FROM sponsorship_offers so JOIN sponsor_brands sb ON sb.id=so.brand_id WHERE so.id=?`,[offerId]
  );
  if(!offer)throw new ApiError(404,'Không tìm thấy lời mời tài trợ.');
  assertClubScope(req,offer.club_id);
  if(offer.status!=='OFFERED')throw new ApiError(409,'Lời mời này đã được xử lý.');
  await transaction(async(connection)=>{
    if(status==='ACCEPTED'){
      const conflict=await first(
        `SELECT so.id,sb.name FROM sponsorship_offers so JOIN sponsor_brands sb ON sb.id=so.brand_id
         WHERE so.club_id=? AND so.id<>? AND so.status IN ('ACCEPTED','PAID') AND sb.conflict_group=?
           AND ((? IS NOT NULL AND so.match_id=?) OR (? IS NULL AND so.competition_id <=> ?)) LIMIT 1`,
        [offer.club_id,offerId,offer.conflict_group,offer.match_id,offer.match_id,offer.match_id,offer.competition_id],connection
      );
      if(conflict)throw new ApiError(409,`Xung đột ngành hàng với ${conflict.name}. Chỉ được chọn một nhãn hàng trong cùng nhóm cho phạm vi này.`);
      await query(`UPDATE sponsorship_offers SET status='ACCEPTED',accepted_at=NOW(6) WHERE id=?`,[offerId],connection);
      await query(
        `INSERT INTO sponsorship_contracts(offer_id,club_id,brand_id,match_id,stadium_id,amount,status,ends_at)
         VALUES(?,?,?,?,?,?,'ACTIVE',COALESCE(?,DATE_ADD(NOW(),INTERVAL 90 DAY)))`,
        [offerId,offer.club_id,offer.brand_id,offer.match_id,offer.stadium_id,offer.amount,offer.expires_at],connection
      );
      if(!offer.match_id){
        const wallet=await getClubWallet(offer.club_id,connection);
        await callProcedure('sp_post_wallet_entry_core',[wallet.id,'CREDIT','SPONSORSHIP',String(offer.amount),null,null,'sponsorship_offers',offerId,`Tài trợ ${offer.brand_name}`,req.user.id,null],connection);
        const tx=await first(`SELECT id FROM wallet_transactions WHERE reference_table='sponsorship_offers' AND reference_id=? ORDER BY id DESC LIMIT 1`,[offerId],connection);
        await query(`UPDATE sponsorship_offers SET status='PAID',paid_at=NOW(6) WHERE id=?`,[offerId],connection);
        await query(`UPDATE sponsorship_contracts SET status='COMPLETED',paid_at=NOW(6),wallet_transaction_id=? WHERE offer_id=?`,[tx?.id||null,offerId],connection);
      }
    }else{
      await query(`UPDATE sponsorship_offers SET status='REJECTED' WHERE id=?`,[offerId],connection);
    }
    await audit({userId:req.user.id,actionCode:`${status}_SPONSOR_OFFER`,entityTable:'sponsorship_offers',entityId:offerId,details:{brand:offer.brand_name,amount:offer.amount}},connection);
  });
  return ok(res,await first(
    `SELECT so.*,sb.name AS brand_name,sb.industry,sb.brand_tier,sb.conflict_group,sb.accent_hex
     FROM sponsorship_offers so JOIN sponsor_brands sb ON sb.id=so.brand_id WHERE so.id=?`,[offerId]
  ));
});

module.exports = router;
