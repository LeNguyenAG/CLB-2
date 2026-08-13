'use strict';

const express = require('express');
const {
  query, first, ApiError, parsePositiveInt, parseEnum, parseText, parseMoney,
  parseDecimal, ok, audit
} = require('./db');
const { authenticate, requireAdmin, requireClubOrAdmin, assertClubScope } = require('./auth');
const {
  MATCH_KINDS, loadMatchContext, autoAssignMatch, forceAssignMatch, settleFinishedMatch
} = require('./stadium-match-engine');

const router = express.Router();

function requestedClubId(req, { required = false } = {}) {
  const raw = req.query?.club_id ?? req.body?.club_id ?? req.user?.clubId;
  if ((raw === undefined || raw === null || raw === '') && !required) return null;
  return assertClubScope(req, raw);
}

router.get('/stadium-operations/dashboard', authenticate, requireClubOrAdmin, async (req, res) => {
  const clubId = requestedClubId(req);
  const params = [];
  let scope = '';
  if (clubId) {
    scope = 'WHERE (o.owner_club_id=? OR o.home_club_id=? OR o.away_club_id=?)';
    params.push(clubId,clubId,clubId);
  }
  const [operations, requests, totals, fanTransfers] = await Promise.all([
    query(
      `SELECT o.*,s.name AS stadium_name,s.city,s.condition_pct,s.available_after,c.name AS owner_club_name,
              f.id AS finance_id,f.status AS finance_status,f.attractiveness_score,f.occupancy_pct,f.attendance_total,
              f.gross_revenue,f.operating_cost,f.damage_cost,f.owner_payout,f.condition_before,f.condition_after,
              f.recovery_hours,f.settled_at
       FROM stadium_match_operations o JOIN stadiums s ON s.id=o.stadium_id
       LEFT JOIN clubs c ON c.id=o.owner_club_id LEFT JOIN stadium_match_finances_v2 f ON f.operation_id=o.id
       ${scope} ORDER BY COALESCE(o.scheduled_at,o.assigned_at) DESC LIMIT 120`, params),
    query(
      `SELECT r.*,s.name AS stadium_name,c.name AS requesting_club_name,o.name AS owner_club_name
       FROM stadium_match_requests r JOIN stadiums s ON s.id=r.stadium_id
       JOIN clubs c ON c.id=r.requesting_club_id
       LEFT JOIN stadium_club_links l ON l.stadium_id=r.stadium_id AND l.relationship_type='OWNED' AND l.status='ACTIVE'
       LEFT JOIN clubs o ON o.id=l.club_id
       ${clubId ? 'WHERE r.requesting_club_id=? OR l.club_id=?' : ''}
       ORDER BY FIELD(r.status,'PENDING','APPROVED','REJECTED','CANCELLED','EXPIRED'),r.requested_at DESC LIMIT 100`,
      clubId ? [clubId,clubId] : []),
    first(
      `SELECT COUNT(*) AS match_count,COALESCE(SUM(f.attendance_total),0) AS attendance,
              COALESCE(AVG(f.occupancy_pct),0) AS avg_occupancy,COALESCE(SUM(f.gross_revenue),0) AS gross_revenue,
              COALESCE(SUM(f.damage_cost),0) AS damage_cost,COALESCE(SUM(f.owner_payout),0) AS owner_payout
       FROM stadium_match_operations o LEFT JOIN stadium_match_finances_v2 f ON f.operation_id=o.id AND f.status='SETTLED'
       ${clubId ? 'WHERE o.owner_club_id=?' : ''}`, clubId ? [clubId] : []),
    clubId ? query(
      `SELECT e.*,p.full_name,fc.name AS from_club_name,tc.name AS to_club_name
       FROM player_fan_transfer_events e JOIN players p ON p.id=e.player_id
       LEFT JOIN clubs fc ON fc.id=e.from_club_id JOIN clubs tc ON tc.id=e.to_club_id
       WHERE e.from_club_id=? OR e.to_club_id=? ORDER BY e.processed_at DESC LIMIT 40`,[clubId,clubId]
    ) : []
  ]);
  return ok(res,{operations,requests,totals,fan_transfers:fanTransfers});
});

router.get('/stadium-operations/:operationId/statement', authenticate, requireClubOrAdmin, async (req,res)=>{
  const operationId=parsePositiveInt(req.params.operationId,'operation_id');
  const operation=await first(
    `SELECT o.*,s.name AS stadium_name,c.name AS owner_club_name,f.*,
            o.id AS operation_id,f.id AS finance_id
     FROM stadium_match_operations o JOIN stadiums s ON s.id=o.stadium_id
     LEFT JOIN clubs c ON c.id=o.owner_club_id LEFT JOIN stadium_match_finances_v2 f ON f.operation_id=o.id
     WHERE o.id=?`,[operationId]
  );
  if(!operation)throw new ApiError(404,'Không tìm thấy trận/sao kê sân.');
  if(req.user.accountType==='CLUB'&&![operation.owner_club_id,operation.home_club_id,operation.away_club_id].some(id=>Number(id)===req.user.clubId)){
    throw new ApiError(403,'CLB không có quyền xem sao kê trận này.');
  }
  const lines=operation.finance_id?await query(`SELECT * FROM stadium_finance_statement_lines WHERE finance_id=? ORDER BY line_order`,[operation.finance_id]):[];
  return ok(res,{operation,lines});
});

router.post('/stadium-operations/requests', authenticate, requireClubOrAdmin, async (req,res)=>{
  const kind=parseEnum(String(req.body.match_kind||'REGULAR').toUpperCase(),MATCH_KINDS,'match_kind');
  if(kind!=='REGULAR')throw new ApiError(400,'Yêu cầu của CLB chỉ áp dụng cho trận cấp CLB; sân World Cup do FIFA sắp xếp.');
  const matchId=parsePositiveInt(req.body.source_match_id,'source_match_id');
  const match=await loadMatchContext(kind,matchId);
  const clubId=assertClubScope(req,req.body.club_id||match.home_club_id);
  if(Number(match.home_club_id)!==Number(clubId))throw new ApiError(403,'Chỉ CLB chủ nhà được gửi yêu cầu sân cho trận này.');
  const stadiumId=parsePositiveInt(req.body.stadium_id,'stadium_id');
  const stadium=await first(`SELECT id,name,status FROM stadiums WHERE id=?`,[stadiumId]);
  if(!stadium||stadium.status==='INACTIVE')throw new ApiError(404,'Sân không tồn tại hoặc đang ngừng hoạt động.');
  const proposedFee=parseMoney(req.body.proposed_fee||0,'proposed_fee');
  const proposedShare=parseDecimal(req.body.proposed_owner_share_pct||0,'proposed_owner_share_pct',{min:0,max:80});
  const note=parseText(req.body.note,'note',{required:false,nullable:true,max:600});
  const result=await query(
    `INSERT INTO stadium_match_requests(match_kind,source_match_id,competition_id,requesting_club_id,stadium_id,
     proposed_fee,proposed_owner_share_pct,note,status,requested_by_user_id)
     VALUES(?,?,?,?,?,?,?,?,'PENDING',?)
     ON DUPLICATE KEY UPDATE proposed_fee=VALUES(proposed_fee),proposed_owner_share_pct=VALUES(proposed_owner_share_pct),
       note=VALUES(note),status='PENDING',requested_by_user_id=VALUES(requested_by_user_id),requested_at=NOW(6),reviewed_at=NULL,
       reviewed_by_user_id=NULL,review_note=NULL`,
    [kind,matchId,match.competition_id,clubId,stadiumId,proposedFee,proposedShare,note,req.user.id]
  );
  const row=await first(`SELECT * FROM stadium_match_requests WHERE match_kind=? AND source_match_id=? AND requesting_club_id=? AND stadium_id=?`,[kind,matchId,clubId,stadiumId]);
  await audit({userId:req.user.id,actionCode:'REQUEST_MATCH_STADIUM',entityTable:'stadium_match_requests',entityId:row.id,details:{matchId,stadiumId,proposedFee,proposedShare}});
  return ok(res,row,result.insertId?201:200);
});

router.patch('/stadium-operations/requests/:id/review', authenticate, requireAdmin, async (req,res)=>{
  const requestId=parsePositiveInt(req.params.id,'request_id');
  const status=parseEnum(req.body.status,['APPROVED','REJECTED'],'status');
  const reviewNote=parseText(req.body.review_note,'review_note',{required:false,nullable:true,max:600});
  const request=await first(`SELECT * FROM stadium_match_requests WHERE id=?`,[requestId]);
  if(!request)throw new ApiError(404,'Không tìm thấy yêu cầu sân.');
  if(request.status!=='PENDING')throw new ApiError(409,'Yêu cầu này đã được xử lý.');
  let operation=null;
  if(status==='APPROVED'){
    operation=await forceAssignMatch({kind:request.match_kind,matchId:request.source_match_id,stadiumId:request.stadium_id,
      userId:req.user.id,requestId,method:'CLUB_REQUEST'});
  }
  await query(`UPDATE stadium_match_requests SET status=?,reviewed_by_user_id=?,review_note=?,reviewed_at=NOW(6) WHERE id=?`,[status,req.user.id,reviewNote,requestId]);
  await audit({userId:req.user.id,actionCode:`${status}_MATCH_STADIUM_REQUEST`,entityTable:'stadium_match_requests',entityId:requestId,details:{operationId:operation?.id||null}});
  return ok(res,{request:await first(`SELECT * FROM stadium_match_requests WHERE id=?`,[requestId]),operation});
});

router.post('/stadium-operations/assign', authenticate, requireAdmin, async (req,res)=>{
  const kind=parseEnum(String(req.body.match_kind||'REGULAR').toUpperCase(),MATCH_KINDS,'match_kind');
  const matchId=parsePositiveInt(req.body.source_match_id,'source_match_id');
  const stadiumId=parsePositiveInt(req.body.stadium_id,'stadium_id');
  const reason=parseText(req.body.override_reason,'override_reason',{required:false,nullable:true,max:800});
  return ok(res,await forceAssignMatch({kind,matchId,stadiumId,userId:req.user.id,method:'FIFA',overrideReason:reason}));
});

router.post('/stadium-operations/auto-assign/:kind/:matchId', authenticate, requireAdmin, async (req,res)=>{
  const kind=parseEnum(String(req.params.kind).toUpperCase(),MATCH_KINDS,'match_kind');
  const matchId=parsePositiveInt(req.params.matchId,'source_match_id');
  return ok(res,await autoAssignMatch(kind,matchId,req.user.id,{force:Boolean(req.body.force)}));
});

router.post('/stadium-operations/auto-assign-pending', authenticate, requireAdmin, async (req,res)=>{
  const competitionId=req.body.competition_id?parsePositiveInt(req.body.competition_id,'competition_id'):null;
  const params=competitionId?[competitionId]:[];
  const filter=competitionId?'AND competition_id=?':'';
  const rows=await query(
    `SELECT 'REGULAR' AS match_kind,id AS source_match_id FROM matches WHERE status IN('SCHEDULED','LIVE') ${filter}
     UNION ALL SELECT 'WORLD_CUP',id FROM world_cup_matches WHERE status IN('SCHEDULED','LIVE') ${filter}
     UNION ALL SELECT 'NATIONAL_CUP',id FROM national_cup_matches WHERE status IN('SCHEDULED','LIVE') ${filter}`,
    competitionId?[...params,...params,...params]:[]
  );
  const results=[];
  for(const row of rows){
    try{const operation=await autoAssignMatch(row.match_kind,row.source_match_id,req.user.id);results.push({match_kind:row.match_kind,source_match_id:row.source_match_id,status:'ASSIGNED',operation_id:operation.id,stadium_id:operation.stadium_id});}
    catch(error){results.push({match_kind:row.match_kind,source_match_id:row.source_match_id,status:'SKIPPED',message:error.message});}
  }
  return ok(res,{total:rows.length,assigned:results.filter(x=>x.status==='ASSIGNED').length,skipped:results.filter(x=>x.status==='SKIPPED').length,results});
});

router.post('/stadium-operations/:kind/:matchId/settle', authenticate, requireAdmin, async (req,res)=>{
  const kind=parseEnum(String(req.params.kind).toUpperCase(),MATCH_KINDS,'match_kind');
  const matchId=parsePositiveInt(req.params.matchId,'source_match_id');
  return ok(res,await settleFinishedMatch(kind,matchId,req.user.id));
});

module.exports=router;
