'use strict';

const express = require('express');
const {
  query,
  first,
  transaction,
  callProcedure,
  ApiError,
  parsePositiveInt,
  parseMoney,
  parseEnum,
  parseText,
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

const router = express.Router();
const EVENT_DECISIONS = ['ACCEPTED', 'REJECTED'];
const PRODUCTS = ['HOME_SHIRT', 'AWAY_SHIRT', 'SIGNED_SHIRT', 'SIGNED_BALL', 'SCARF', 'LIMITED_BOX'];

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, number(value))); }
function roundMoney(value, unit = 1000000) { return Math.round(number(value) / unit) * unit; }
function randomBetween(random, min, max) { return number(min) + random() * (number(max) - number(min)); }
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
function currentClubId(req, requested = null) {
  const raw = requested ?? req.query.club_id ?? req.body.club_id ?? req.user?.clubId;
  return assertClubScope(req, raw);
}

async function activeSeason(connection = undefined) {
  return first(`SELECT id,name,status FROM seasons WHERE status='ACTIVE' ORDER BY sequence_no DESC LIMIT 1`, [], connection);
}

async function getWallet({ clubId = null, playerId = null, fifa = false }, connection = undefined) {
  let row;
  if (fifa) row = await first(`SELECT * FROM wallets WHERE wallet_type='FIFA' LIMIT 1`, [], connection);
  else if (clubId) row = await first(`SELECT * FROM wallets WHERE wallet_type='CLUB' AND club_id=? LIMIT 1`, [clubId], connection);
  else row = await first(`SELECT * FROM wallets WHERE wallet_type='PLAYER' AND player_id=? LIMIT 1`, [playerId], connection);
  if (!row) throw new ApiError(400, 'Không tìm thấy ví phù hợp.');
  if (row.status !== 'ACTIVE') throw new ApiError(400, 'Ví không ở trạng thái hoạt động.');
  return row;
}

async function recalculatePlayerInfluence(playerId, connection) {
  const row = await first(
    `SELECT p.id,p.market_value,p.status,v.overall_world_rank,
            COALESCE(aw.award_count,0) AS award_count,
            COALESCE(mvp.match_mvp_count,0) AS match_mvp_count,
            COALESCE(tmvp.team_mvp_count,0) AS team_mvp_count
     FROM players p
     LEFT JOIN v_player_rankings_current v ON v.player_id=p.id
     LEFT JOIN (SELECT player_id,COUNT(*) AS award_count FROM player_awards GROUP BY player_id) aw ON aw.player_id=p.id
     LEFT JOIN (SELECT player_id,SUM(is_match_mvp) AS match_mvp_count FROM match_player_ratings GROUP BY player_id) mvp ON mvp.player_id=p.id
     LEFT JOIN (SELECT player_id,SUM(is_team_mvp) AS team_mvp_count FROM match_player_ratings GROUP BY player_id) tmvp ON tmvp.player_id=p.id
     WHERE p.id=?`,
    [playerId],
    connection
  );
  if (!row) throw new ApiError(404, 'Không tìm thấy cầu thủ.');
  const rank = number(row.overall_world_rank, 200);
  const rankScore = rank === 1 ? 40 : rank <= 3 ? 34 : rank <= 10 ? 28 : rank <= 25 ? 20 : rank <= 50 ? 13 : 7;
  const awardScore = Math.min(25, number(row.award_count) * 4);
  const mvpScore = Math.min(17, number(row.match_mvp_count) * 2.5 + number(row.team_mvp_count) * 0.7);
  const marketScore = Math.min(18, Math.max(0, (Math.log10(Math.max(1, number(row.market_value))) - 6) * 5));
  const popularity = clamp(rankScore + awardScore + mvpScore + marketScore, 5, 100);
  const endorsement = clamp(popularity * 0.72 + marketScore * 1.1 + awardScore * 0.35, 5, 100);
  const multiplier = clamp(1 + popularity / 70, 1, 2.5);
  const followers = Math.round(5000 + popularity * popularity * 850);
  const snapshot = { rank, rankScore, awardScore, mvpScore, marketScore, formulaVersion: '2.0.14' };
  await query(
    `INSERT INTO player_influence_profiles(player_id,popularity_score,endorsement_score,signed_merch_multiplier,social_followers,last_calculation,recalculated_at)
     VALUES(?,?,?,?,?,?,NOW(6))
     ON DUPLICATE KEY UPDATE popularity_score=VALUES(popularity_score),endorsement_score=VALUES(endorsement_score),
       signed_merch_multiplier=VALUES(signed_merch_multiplier),social_followers=VALUES(social_followers),
       last_calculation=VALUES(last_calculation),recalculated_at=NOW(6)`,
    [playerId, popularity.toFixed(2), endorsement.toFixed(2), multiplier.toFixed(3), followers, JSON.stringify(snapshot)],
    connection
  );
  return { player_id: playerId, popularity_score: popularity, endorsement_score: endorsement, signed_merch_multiplier: multiplier, social_followers: followers };
}

async function recalculateClubInfluence(clubId, connection, reason = 'RECALCULATE') {
  const players = await query(`SELECT id FROM players WHERE club_id=? AND status IN ('ACTIVE','TRANSFER_LISTED')`, [clubId], connection);
  for (const player of players) await recalculatePlayerInfluence(Number(player.id), connection);
  const row = await first(
    `SELECT c.id,c.name,
            COALESCE(r.rank_position,50) AS rank_position,
            COALESCE(h.gold_count,0) AS gold_count,COALESCE(h.silver_count,0) AS silver_count,COALESCE(h.bronze_count,0) AS bronze_count,
            COALESCE(st.rating_score,40) AS stadium_rating,COALESCE(st.commercial_quality,35) AS stadium_commercial,
            COALESCE(pp.top_popularity,20) AS top_popularity,COALESCE(pp.avg_popularity,15) AS avg_popularity,
            COALESCE(f.form_points,5) AS form_points,COALESCE(f.match_count,2) AS form_match_count,
            cip.fan_count AS current_fans,cip.loyalty_score AS current_loyalty
     FROM clubs c
     LEFT JOIN v_latest_club_world_ranking r ON r.club_id=c.id
     LEFT JOIN (
       SELECT club_id,SUM(medal_type='GOLD') AS gold_count,SUM(medal_type='SILVER') AS silver_count,SUM(medal_type='BRONZE') AS bronze_count
       FROM club_achievements GROUP BY club_id
     ) h ON h.club_id=c.id
     LEFT JOIN (
       SELECT l.club_id,MAX(v.rating_score) AS rating_score,MAX(v.commercial_quality) AS commercial_quality
       FROM stadium_club_links l JOIN v_stadium_ratings v ON v.id=l.stadium_id
       WHERE l.status='ACTIVE' GROUP BY l.club_id
     ) st ON st.club_id=c.id
     LEFT JOIN (
       SELECT p.club_id,MAX(pip.popularity_score) AS top_popularity,AVG(pip.popularity_score) AS avg_popularity
       FROM players p JOIN player_influence_profiles pip ON pip.player_id=p.id
       WHERE p.status IN ('ACTIVE','TRANSFER_LISTED') GROUP BY p.club_id
     ) pp ON pp.club_id=c.id
     LEFT JOIN (
       SELECT club_id,SUM(points) AS form_points,COUNT(*) AS match_count
       FROM (
         SELECT base.*,ROW_NUMBER() OVER(PARTITION BY club_id ORDER BY match_time DESC,match_id DESC) AS rn
         FROM (
           SELECT m.id AS match_id,m.home_club_id AS club_id,COALESCE(m.scheduled_at,m.created_at) AS match_time,
                  CASE WHEN m.winner_club_id=m.home_club_id THEN 3 WHEN m.home_score=m.away_score THEN 1 ELSE 0 END AS points
           FROM matches m WHERE m.status='FINISHED' AND m.home_club_id IS NOT NULL
           UNION ALL
           SELECT m.id AS match_id,m.away_club_id AS club_id,COALESCE(m.scheduled_at,m.created_at) AS match_time,
                  CASE WHEN m.winner_club_id=m.away_club_id THEN 3 WHEN m.home_score=m.away_score THEN 1 ELSE 0 END AS points
           FROM matches m WHERE m.status='FINISHED' AND m.away_club_id IS NOT NULL
         ) base
       ) z WHERE rn<=5 GROUP BY club_id
     ) f ON f.club_id=c.id
     LEFT JOIN club_influence_profiles cip ON cip.club_id=c.id
     WHERE c.id=?`,
    [clubId],
    connection
  );
  if (!row) throw new ApiError(404, 'Không tìm thấy CLB.');
  const rank = number(row.rank_position, 50);
  const rankScore = rank === 1 ? 30 : rank <= 3 ? 26 : rank <= 10 ? 21 : rank <= 20 ? 15 : rank <= 40 ? 10 : 6;
  const honourScore = Math.min(22, number(row.gold_count) * 6 + number(row.silver_count) * 3 + number(row.bronze_count) * 1.5);
  const stadiumScore = clamp(number(row.stadium_rating) / 100 * 13, 2, 13);
  const starScore = clamp(number(row.top_popularity) / 100 * 15, 2, 15);
  const formRatio = number(row.form_match_count) ? number(row.form_points) / (number(row.form_match_count) * 3) : 0.5;
  const formScore = clamp(formRatio * 10, 0, 10);
  const reputation = clamp(13 + rankScore + honourScore + stadiumScore + starScore + formScore, 8, 100);
  const currentFans = number(row.current_fans, 0);
  const targetFans = Math.round(25000 + reputation * reputation * 1200 + number(row.gold_count) * 300000 + number(row.top_popularity) * 40000);
  const fanCount = currentFans ? Math.max(1000, Math.round(currentFans * 0.8 + targetFans * 0.2)) : targetFans;
  const socialFollowers = Math.round(fanCount * (0.55 + reputation / 220));
  const media = clamp(reputation * 0.6 + number(row.top_popularity) * 0.28 + formScore * 1.2, 5, 100);
  const commercial = clamp(reputation * 0.45 + number(row.stadium_commercial) * 0.25 + number(row.avg_popularity) * 0.3, 5, 100);
  const loyalty = clamp(number(row.current_loyalty, 55) * 0.85 + (45 + formRatio * 35) * 0.15, 20, 100);
  const momentum = clamp(30 + formRatio * 60 + (media - 50) * 0.15, 5, 100);
  const snapshot = { rank,rankScore,honourScore,stadiumScore,starScore,formScore,targetFans,formulaVersion:'2.0.14' };
  await query(
    `INSERT INTO club_influence_profiles(club_id,reputation_score,fan_count,social_followers,media_score,commercial_score,loyalty_score,momentum_score,last_calculation,recalculated_at)
     VALUES(?,?,?,?,?,?,?,?,?,NOW(6))
     ON DUPLICATE KEY UPDATE reputation_score=VALUES(reputation_score),fan_count=VALUES(fan_count),social_followers=VALUES(social_followers),
       media_score=VALUES(media_score),commercial_score=VALUES(commercial_score),loyalty_score=VALUES(loyalty_score),
       momentum_score=VALUES(momentum_score),last_calculation=VALUES(last_calculation),recalculated_at=NOW(6)`,
    [clubId,reputation.toFixed(2),fanCount,socialFollowers,media.toFixed(2),commercial.toFixed(2),loyalty.toFixed(2),momentum.toFixed(2),JSON.stringify(snapshot)],
    connection
  );
  const season = await activeSeason(connection);
  await query(
    `INSERT INTO club_influence_history(club_id,season_id,reputation_score,fan_count,social_followers,media_score,commercial_score,reason)
     VALUES(?,?,?,?,?,?,?,?)`,
    [clubId,season?.id||null,reputation.toFixed(2),fanCount,socialFollowers,media.toFixed(2),commercial.toFixed(2),reason],
    connection
  );
  return { club_id:clubId,reputation_score:reputation,fan_count:fanCount,social_followers:socialFollowers,media_score:media,commercial_score:commercial,loyalty_score:loyalty,momentum_score:momentum };
}

async function applyEventInConnection(eventId, userId, connection) {
  const event = await first(
    `SELECT e.*,t.title,t.category,t.tone FROM club_commercial_events e
     JOIN commercial_event_templates t ON t.id=e.template_id WHERE e.id=? FOR UPDATE`,
    [eventId], connection
  );
  if (!event) throw new ApiError(404, 'Không tìm thấy sự kiện.');
  if (event.status === 'APPLIED') return event;
  if (!['OFFERED','ACCEPTED'].includes(event.status)) throw new ApiError(409, 'Sự kiện không còn khả dụng.');
  const wallet = await getWallet({ clubId:event.club_id }, connection);
  let actualAmount = number(event.amount);
  let txId = null;
  if (actualAmount > 0) {
    await callProcedure('sp_post_wallet_entry_core',[wallet.id,'CREDIT','COMMERCIAL_EVENT',String(Math.round(actualAmount)),null,null,'club_commercial_events',event.id,event.title,userId,null],connection);
  } else if (actualAmount < 0) {
    const debit = Math.min(Math.abs(actualAmount), number(wallet.balance));
    actualAmount = -debit;
    if (debit > 0) await callProcedure('sp_post_wallet_entry_core',[wallet.id,'DEBIT','COMMERCIAL_EVENT',String(Math.round(debit)),null,null,'club_commercial_events',event.id,event.title,userId,null],connection);
  }
  if (actualAmount !== 0) {
    const tx = await first(`SELECT id FROM wallet_transactions WHERE reference_table='club_commercial_events' AND reference_id=? ORDER BY id DESC LIMIT 1`,[event.id],connection);
    txId = tx?.id || null;
  }
  await query(
    `UPDATE club_influence_profiles SET
       fan_count=GREATEST(0,CAST(fan_count AS SIGNED)+?),
       social_followers=GREATEST(0,CAST(social_followers AS SIGNED)+ROUND(?*0.7)),
       reputation_score=LEAST(100,GREATEST(0,reputation_score+?)),
       media_score=LEAST(100,GREATEST(0,media_score+?)),
       commercial_score=LEAST(100,GREATEST(0,commercial_score+?))
     WHERE club_id=?`,
    [event.fan_change,event.fan_change,event.reputation_delta,event.media_delta,event.commercial_delta,event.club_id],
    connection
  );
  await query(`UPDATE club_commercial_events SET status='APPLIED',amount=?,wallet_transaction_id=?,applied_at=NOW(6) WHERE id=?`,[actualAmount,txId,event.id],connection);
  await audit({userId,actionCode:'APPLY_COMMERCIAL_EVENT',entityTable:'club_commercial_events',entityId:event.id,details:{amount:actualAmount,fan_change:event.fan_change}},connection);
  return first(`SELECT e.*,t.title,t.description,t.category,t.tone FROM club_commercial_events e JOIN commercial_event_templates t ON t.id=e.template_id WHERE e.id=?`,[event.id],connection);
}

async function influenceGrantPreview(seasonId, connection = undefined) {
  const season = await first(`SELECT * FROM seasons WHERE id=?`,[seasonId],connection);
  if (!season) throw new ApiError(404,'Không tìm thấy mùa giải.');
  const [clubRows,playerRows,rules,paid] = await Promise.all([
    query(
      `SELECT ranked.*,c.name,c.logo_url,cip.reputation_score,cip.fan_count,
              DENSE_RANK() OVER(ORDER BY ranked.score DESC,cip.reputation_score DESC,cip.fan_count DESC,ranked.club_id) AS rank_position
       FROM (SELECT club_id,SUM(points) AS score FROM club_ranking_points WHERE season_id=? GROUP BY club_id HAVING SUM(points)>0) ranked
       JOIN clubs c ON c.id=ranked.club_id LEFT JOIN club_influence_profiles cip ON cip.club_id=ranked.club_id`,[seasonId],connection),
    query(
      `SELECT ranked.*,p.full_name,p.photo_url,p.club_id,c.name AS club_name,pip.popularity_score,
              DENSE_RANK() OVER(ORDER BY ranked.score DESC,pip.popularity_score DESC,p.market_value DESC,ranked.player_id) AS rank_position
       FROM (SELECT player_id,SUM(points) AS score FROM player_ranking_points WHERE season_id=? GROUP BY player_id HAVING SUM(points)>0) ranked
       JOIN players p ON p.id=ranked.player_id LEFT JOIN clubs c ON c.id=p.club_id LEFT JOIN player_influence_profiles pip ON pip.player_id=ranked.player_id`,[seasonId],connection),
    query(`SELECT * FROM influence_grant_rules WHERE is_active=TRUE ORDER BY entity_type,rank_from`,[],connection),
    query(`SELECT entity_type,entity_key FROM influence_grant_payments WHERE season_id=?`,[seasonId],connection)
  ]);
  const paidKeys = new Set(paid.map((row)=>`${row.entity_type}:${row.entity_key}`));
  const resolve = (type,row) => {
    const rank = number(row.rank_position);
    const rule = rules.find((item)=>item.entity_type===type && rank>=number(item.rank_from) && rank<=number(item.rank_to));
    if (!rule) return null;
    const key = type==='CLUB'?String(row.club_id):String(row.player_id);
    return {...row,entity_type:type,entity_key:key,grant_amount:number(rule.grant_amount),grant_label:rule.label,paid:paidKeys.has(`${type}:${key}`)};
  };
  const clubs=clubRows.map((row)=>resolve('CLUB',row)).filter(Boolean);
  const players=playerRows.map((row)=>resolve('PLAYER',row)).filter(Boolean);
  return {season,clubs,players,total_amount:[...clubs,...players].filter((x)=>!x.paid).reduce((sum,x)=>sum+x.grant_amount,0)};
}

router.get('/public/influence/leaderboards', optionalAuthenticate, async (_req,res)=>{
  const [clubs,players]=await Promise.all([
    query(`SELECT * FROM v_club_influence_ranking ORDER BY influence_rank LIMIT 30`),
    query(`SELECT * FROM v_player_influence_ranking ORDER BY influence_rank LIMIT 30`)
  ]);
  return ok(res,{clubs,players});
});

router.get('/influence/summary',authenticate,requireClubOrAdmin,async(req,res)=>{
  const clubId=currentClubId(req);
  const profileExists=await first(`SELECT club_id FROM club_influence_profiles WHERE club_id=?`,[clubId]);
  if(!profileExists)await transaction((connection)=>recalculateClubInfluence(clubId,connection,'INITIAL_PROFILE'));
  const [summary,players,events,campaigns,grants,history]=await Promise.all([
    first(`SELECT s.*,w.balance AS wallet_balance,w.status AS wallet_status FROM v_club_commercial_summary s LEFT JOIN wallets w ON w.club_id=s.club_id AND w.wallet_type='CLUB' WHERE s.club_id=?`,[clubId]),
    query(`SELECT v.* FROM v_player_influence_ranking v WHERE v.club_id=? ORDER BY v.influence_rank LIMIT 30`,[clubId]),
    query(`SELECT e.*,t.title,t.description,t.category,t.decision_mode,t.icon_code,t.tone FROM club_commercial_events e JOIN commercial_event_templates t ON t.id=e.template_id WHERE e.club_id=? ORDER BY e.generated_at DESC LIMIT 40`,[clubId]),
    query(`SELECT mc.*,p.full_name,p.photo_url FROM club_merchandise_campaigns mc LEFT JOIN players p ON p.id=mc.player_id WHERE mc.club_id=? ORDER BY mc.created_at DESC LIMIT 30`,[clubId]),
    query(`SELECT gp.*,s.name AS season_name FROM influence_grant_payments gp JOIN seasons s ON s.id=gp.season_id WHERE gp.club_id=? OR gp.player_id IN(SELECT id FROM players WHERE club_id=?) ORDER BY gp.paid_at DESC LIMIT 50`,[clubId,clubId]),
    query(`SELECT * FROM club_influence_history WHERE club_id=? ORDER BY captured_at DESC LIMIT 12`,[clubId])
  ]);
  return ok(res,{summary,players,events,campaigns,grants,history});
});

router.post('/influence/recalculate',authenticate,requireClubOrAdmin,async(req,res)=>{
  const requested=req.body.club_id||req.query.club_id;
  const result=await transaction(async(connection)=>{
    if(req.user.accountType==='FIFA_ADMIN'&&!requested){
      const clubs=await query(`SELECT id FROM clubs WHERE is_active=TRUE AND registration_status='APPROVED' ORDER BY id`,[],connection);
      const rows=[];for(const club of clubs)rows.push(await recalculateClubInfluence(Number(club.id),connection,'ADMIN_RECALCULATE_ALL'));
      return rows;
    }
    const clubId=currentClubId(req,requested);
    return [await recalculateClubInfluence(clubId,connection,'RECALCULATE')];
  });
  return ok(res,{message:`Đã tính lại sức ảnh hưởng cho ${result.length} CLB.`,clubs:result});
});

router.post('/influence/events/random',authenticate,requireClubOrAdmin,async(req,res)=>{
  const clubId=currentClubId(req);
  const seed=parsePositiveInt(req.body.random_seed||Date.now()%4294967295,'random_seed',{min:1,max:4294967295});
  const random=seededRandom(seed);
  const cycleKey=parseText(req.body.cycle_key||new Date().toISOString().slice(0,10),'cycle_key',{max:80});
  const created=await transaction(async(connection)=>{
    const profile=await recalculateClubInfluence(clubId,connection,'EVENT_CYCLE');
    const season=await activeSeason(connection);
    const templates=await query(`SELECT * FROM commercial_event_templates WHERE is_active=TRUE AND min_reputation<=? ORDER BY id`,[profile.reputation_score],connection);
    const countRoll=random();
    const count=profile.reputation_score>=75?(countRoll<0.12?0:countRoll<0.55?1:2):(profile.reputation_score>=45?(countRoll<0.25?0:countRoll<0.78?1:2):(countRoll<0.42?0:1));
    const pool=[...templates];const chosen=[];
    while(chosen.length<count&&pool.length){
      const total=pool.reduce((sum,t)=>sum+number(t.weight_no)*number(t.base_probability),0);
      let roll=random()*total,index=0;
      for(;index<pool.length;index++){roll-=number(pool[index].weight_no)*number(pool[index].base_probability);if(roll<=0)break;}
      chosen.push(pool.splice(Math.min(index,pool.length-1),1)[0]);
    }
    const rows=[];
    for(const template of chosen){
      const scale=0.35+profile.reputation_score/95+profile.commercial_score/170;
      let amount=roundMoney(randomBetween(random,template.min_amount,template.max_amount)*scale,1000000);
      if(template.category==='COST')amount=-amount;
      const fanPct=randomBetween(random,template.fan_change_min_pct,template.fan_change_max_pct);
      const fanChange=Math.round(profile.fan_count*fanPct/100);
      try{
        const insert=await query(
          `INSERT INTO club_commercial_events(club_id,season_id,template_id,status,amount,fan_change,reputation_delta,media_delta,commercial_delta,cycle_key,factors,created_by_user_id)
           VALUES(?,?,?, ?,?,?,?,?,?,?,?,?)`,
          [clubId,season?.id||null,template.id,template.decision_mode==='AUTOMATIC'?'ACCEPTED':'OFFERED',amount,fanChange,template.reputation_delta,template.media_delta,template.commercial_delta,cycleKey,JSON.stringify({seed,scale,fanPct,reputation:profile.reputation_score,commercial:profile.commercial_score}),req.user.id],
          connection
        );
        let row=await first(`SELECT e.*,t.title,t.description,t.category,t.decision_mode,t.icon_code,t.tone FROM club_commercial_events e JOIN commercial_event_templates t ON t.id=e.template_id WHERE e.id=?`,[insert.insertId],connection);
        if(template.decision_mode==='AUTOMATIC')row=await applyEventInConnection(insert.insertId,req.user.id,connection);
        rows.push(row);
      }catch(error){if(error.code!=='ER_DUP_ENTRY')throw error;}
    }
    await audit({userId:req.user.id,actionCode:'GENERATE_COMMERCIAL_EVENTS',entityTable:'clubs',entityId:clubId,details:{seed,cycleKey,count:rows.length}},connection);
    return rows;
  });
  return ok(res,{message:created.length?`Hệ thống đã tạo ${created.length} sự kiện mới.`:'Chu kỳ này không phát sinh sự kiện mới.',events:created});
});

router.patch('/influence/events/:id/status',authenticate,requireClubOrAdmin,async(req,res)=>{
  const eventId=parsePositiveInt(req.params.id,'event_id');
  const status=parseEnum(req.body.status,EVENT_DECISIONS,'status');
  const event=await first(`SELECT * FROM club_commercial_events WHERE id=?`,[eventId]);
  if(!event)throw new ApiError(404,'Không tìm thấy sự kiện.');
  assertClubScope(req,event.club_id);
  const result=await transaction(async(connection)=>{
    if(status==='REJECTED'){
      if(event.status!=='OFFERED')throw new ApiError(409,'Sự kiện đã được xử lý.');
      await query(`UPDATE club_commercial_events SET status='REJECTED' WHERE id=?`,[eventId],connection);
      return first(`SELECT e.*,t.title,t.description,t.category,t.tone FROM club_commercial_events e JOIN commercial_event_templates t ON t.id=e.template_id WHERE e.id=?`,[eventId],connection);
    }
    await query(`UPDATE club_commercial_events SET status='ACCEPTED' WHERE id=? AND status='OFFERED'`,[eventId],connection);
    return applyEventInConnection(eventId,req.user.id,connection);
  });
  return ok(res,result);
});

router.post('/influence/merchandise/simulate',authenticate,requireClubOrAdmin,async(req,res)=>{
  const clubId=currentClubId(req);
  const productType=parseEnum(req.body.product_type||'HOME_SHIRT',PRODUCTS,'product_type');
  const playerId=req.body.player_id?parsePositiveInt(req.body.player_id,'player_id'):null;
  if(['SIGNED_SHIRT','SIGNED_BALL','LIMITED_BOX'].includes(productType)&&!playerId)throw new ApiError(400,'Sản phẩm có chữ ký cần chọn cầu thủ.');
  const units=parsePositiveInt(req.body.units_planned||1000,'units_planned',{min:10,max:1000000});
  const unitPrice=number(parseMoney(req.body.unit_price||500000,'unit_price'));
  const unitCost=number(parseMoney(req.body.unit_cost||Math.round(unitPrice*0.42),'unit_cost'));
  if(unitCost>unitPrice)throw new ApiError(400,'Chi phí mỗi sản phẩm không được cao hơn giá bán.');
  const seed=parsePositiveInt(req.body.random_seed||Date.now()%4294967295,'random_seed',{min:1,max:4294967295});
  const random=seededRandom(seed);
  const campaign=await transaction(async(connection)=>{
    const profile=await recalculateClubInfluence(clubId,connection,'MERCHANDISE_SIMULATION');
    let player=null,popularity=0,multiplier=1;
    if(playerId){
      player=await first(`SELECT p.id,p.full_name,p.club_id,pip.popularity_score,pip.signed_merch_multiplier FROM players p LEFT JOIN player_influence_profiles pip ON pip.player_id=p.id WHERE p.id=?`,[playerId],connection);
      if(!player||Number(player.club_id)!==clubId)throw new ApiError(400,'Cầu thủ không thuộc CLB này.');
      if(!player.popularity_score)await recalculatePlayerInfluence(playerId,connection);
      const refreshed=await first(`SELECT p.full_name,pip.* FROM players p JOIN player_influence_profiles pip ON pip.player_id=p.id WHERE p.id=?`,[playerId],connection);
      player=refreshed;popularity=number(refreshed.popularity_score);multiplier=number(refreshed.signed_merch_multiplier,1);
    }
    const signedBoost=['SIGNED_SHIRT','SIGNED_BALL','LIMITED_BOX'].includes(productType)?multiplier:1;
    const demand=clamp(12+profile.reputation_score*0.34+profile.commercial_score*0.27+popularity*0.28+(random()-.5)*18,5,100);
    const fanReach=clamp(Math.log10(Math.max(10,profile.fan_count))/7,0.25,1.2);
    const priceResistance=clamp(1-(unitPrice/5000000),0.35,1);
    const conversion=clamp((0.08+demand/145)*fanReach*priceResistance*signedBoost,0.04,0.98);
    const unitsSold=Math.min(units,Math.max(0,Math.round(units*conversion*(0.82+random()*0.32))));
    const gross=unitsSold*unitPrice,totalCost=unitsSold*unitCost,net=gross-totalCost;
    const name=req.body.campaign_name||`${productType.replaceAll('_',' ')}${player?.full_name?` — ${player.full_name}`:''}`;
    const insert=await query(
      `INSERT INTO club_merchandise_campaigns(club_id,player_id,product_type,campaign_name,units_planned,unit_price,unit_cost,popularity_snapshot,demand_score,units_sold,gross_revenue,total_cost,net_revenue,simulation_seed,calculation_snapshot,status,created_by_user_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'SIMULATED',?)`,
      [clubId,playerId,productType,name,units,unitPrice,unitCost,popularity,demand.toFixed(2),unitsSold,gross,totalCost,net,seed,JSON.stringify({conversion,fanReach,priceResistance,signedBoost,reputation:profile.reputation_score,commercial:profile.commercial_score}),req.user.id],connection
    );
    return first(`SELECT mc.*,p.full_name,p.photo_url FROM club_merchandise_campaigns mc LEFT JOIN players p ON p.id=mc.player_id WHERE mc.id=?`,[insert.insertId],connection);
  });
  return ok(res,campaign,201);
});

router.post('/influence/merchandise/:id/settle',authenticate,requireClubOrAdmin,async(req,res)=>{
  const campaignId=parsePositiveInt(req.params.id,'campaign_id');
  const campaign=await first(`SELECT * FROM club_merchandise_campaigns WHERE id=?`,[campaignId]);
  if(!campaign)throw new ApiError(404,'Không tìm thấy chiến dịch.');
  assertClubScope(req,campaign.club_id);
  if(campaign.status!=='SIMULATED')throw new ApiError(409,'Chiến dịch đã được xử lý hoặc chưa mô phỏng.');
  const result=await transaction(async(connection)=>{
    const wallet=await getWallet({clubId:campaign.club_id},connection);
    if(number(campaign.net_revenue)>0){
      await callProcedure('sp_post_wallet_entry_core',[wallet.id,'CREDIT','MERCHANDISE',String(campaign.net_revenue),null,null,'club_merchandise_campaigns',campaign.id,`Kinh doanh vật phẩm: ${campaign.campaign_name}`,req.user.id,null],connection);
    }
    const tx=await first(`SELECT id FROM wallet_transactions WHERE reference_table='club_merchandise_campaigns' AND reference_id=? ORDER BY id DESC LIMIT 1`,[campaign.id],connection);
    await query(`UPDATE club_merchandise_campaigns SET status='SETTLED',wallet_transaction_id=?,settled_at=NOW(6) WHERE id=?`,[tx?.id||null,campaign.id],connection);
    await query(`UPDATE club_influence_profiles SET commercial_score=LEAST(100,commercial_score+?),fan_count=fan_count+? WHERE club_id=?`,[Math.min(2,number(campaign.demand_score)/70),Math.round(number(campaign.units_sold)*0.04),campaign.club_id],connection);
    await audit({userId:req.user.id,actionCode:'SETTLE_MERCHANDISE_CAMPAIGN',entityTable:'club_merchandise_campaigns',entityId:campaign.id,details:{net_revenue:campaign.net_revenue,units_sold:campaign.units_sold}},connection);
    return first(`SELECT mc.*,p.full_name,p.photo_url FROM club_merchandise_campaigns mc LEFT JOIN players p ON p.id=mc.player_id WHERE mc.id=?`,[campaign.id],connection);
  });
  return ok(res,result);
});

router.get('/influence/grants/preview',authenticate,requireAdmin,async(req,res)=>{
  const seasonId=parsePositiveInt(req.query.season_id,'season_id');
  return ok(res,await influenceGrantPreview(seasonId));
});

router.post('/influence/grants/finalize',authenticate,requireAdmin,async(req,res)=>{
  const seasonId=parsePositiveInt(req.body.season_id,'season_id');
  const result=await transaction(async(connection)=>{
    const preview=await influenceGrantPreview(seasonId,connection);
    const fifa=await getWallet({fifa:true},connection);
    if(number(fifa.balance)<preview.total_amount)throw new ApiError(400,`Ví FIFA thiếu tiền. Cần ${preview.total_amount.toLocaleString('vi-VN')} đồng.`);
    await query(`INSERT INTO influence_grant_runs(season_id,status,total_amount,snapshot,executed_by_user_id,executed_at) VALUES(?,'PREVIEW',?,?,?,NOW(6)) ON DUPLICATE KEY UPDATE total_amount=VALUES(total_amount),snapshot=VALUES(snapshot),executed_by_user_id=VALUES(executed_by_user_id),executed_at=NOW(6)`,[seasonId,preview.total_amount,JSON.stringify(preview),req.user.id],connection);
    const run=await first(`SELECT * FROM influence_grant_runs WHERE season_id=? FOR UPDATE`,[seasonId],connection);
    const paid=[],skipped=[];
    for(const item of [...preview.clubs,...preview.players].filter((x)=>!x.paid)){
      try{
        const target=item.entity_type==='CLUB'?await getWallet({clubId:item.club_id},connection):await getWallet({playerId:item.player_id},connection);
        const insert=await query(`INSERT INTO influence_grant_payments(run_id,season_id,entity_type,entity_key,club_id,player_id,rank_position,grant_amount) VALUES(?,?,?,?,?,?,?,?)`,[run.id,seasonId,item.entity_type,item.entity_key,item.club_id||null,item.player_id||null,item.rank_position,item.grant_amount],connection);
        await callProcedure('sp_wallet_transfer_core',[fifa.id,target.id,'INFLUENCE_GRANT',String(item.grant_amount),`INFLUENCE-${seasonId}-${item.entity_type}-${item.entity_key}`,'influence_grant_payments',insert.insertId,item.grant_label,req.user.id],connection);
        const tx=await first(`SELECT id FROM wallet_transactions WHERE wallet_id=? AND reference_table='influence_grant_payments' AND reference_id=? AND direction='CREDIT' ORDER BY id DESC LIMIT 1`,[target.id,insert.insertId],connection);
        await query(`UPDATE influence_grant_payments SET wallet_transaction_id=? WHERE id=?`,[tx?.id||null,insert.insertId],connection);
        paid.push(item);
      }catch(error){skipped.push({...item,reason:error.message});}
    }
    const status=skipped.length?'PARTIAL':'COMPLETED';
    const paidTotal=paid.reduce((sum,x)=>sum+x.grant_amount,0);
    await query(`UPDATE influence_grant_runs SET status=?,total_amount=?,snapshot=?,executed_at=NOW(6) WHERE id=?`,[status,paidTotal,JSON.stringify({preview,paid,skipped}),run.id],connection);
    await audit({userId:req.user.id,actionCode:'FINALIZE_INFLUENCE_GRANTS',entityTable:'seasons',entityId:seasonId,details:{paid:paid.length,skipped:skipped.length,total:paidTotal}},connection);
    return {run_id:Number(run.id),status,paid,skipped,total_amount:paidTotal};
  });
  return ok(res,{message:`Đã chi thưởng sức ảnh hưởng cho ${result.paid.length} đối tượng.`,...result});
});

router.get('/influence/grants/history',authenticate,requireClubOrAdmin,async(req,res)=>{
  const clubId=req.user.accountType==='CLUB'?req.user.clubId:(req.query.club_id?parsePositiveInt(req.query.club_id,'club_id'):null);
  const where=clubId?`WHERE gp.club_id=? OR gp.player_id IN(SELECT id FROM players WHERE club_id=?)`:'';
  const params=clubId?[clubId,clubId]:[];
  const rows=await query(`SELECT gp.*,s.name AS season_name,c.name AS club_name,p.full_name AS player_name FROM influence_grant_payments gp JOIN seasons s ON s.id=gp.season_id LEFT JOIN clubs c ON c.id=gp.club_id LEFT JOIN players p ON p.id=gp.player_id ${where} ORDER BY gp.paid_at DESC LIMIT 200`,params);
  return ok(res,rows);
});

module.exports = { router, recalculateClubInfluence, recalculatePlayerInfluence, influenceGrantPreview };
