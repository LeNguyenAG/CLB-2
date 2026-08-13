'use strict';

const { query, first, transaction, callProcedure, audit } = require('./db');

function number(value,fallback=0){const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;}
function clamp(value,min,max){return Math.min(max,Math.max(min,number(value)));}
function roundMoney(value,unit=1000000){return Math.max(0,Math.round(number(value)/unit)*unit);}
function hashSeed(value){let hash=2166136261;for(const char of String(value))hash=Math.imul(hash^char.charCodeAt(0),16777619);return hash>>>0||1;}
function seededRandom(seedValue){let seed=Number(seedValue)>>>0;return()=>{seed+=0x6D2B79F5;let t=seed;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}

async function generateStadiumCompetitionOffers(operationId,userId=null,connection=undefined){
  const context=await first(
    `SELECT o.id,o.competition_id,o.stadium_id,o.owner_club_id,o.fairness_score,o.round_label,
            c.name AS competition_name,c.coefficient,c.ends_on,se.name AS season_name,
            s.name AS stadium_name,s.rating_score,s.capacity_total,s.commercial_quality,s.hospitality_quality
     FROM stadium_match_operations o JOIN competitions c ON c.id=o.competition_id
     JOIN seasons se ON se.id=c.season_id JOIN v_stadium_ratings s ON s.id=o.stadium_id
     WHERE o.id=?`,[operationId],connection);
  if(!context?.owner_club_id)return {generated:0,reason:'NO_STADIUM_OWNER'};
  const exists=await first(
    `SELECT COUNT(*) AS total FROM sponsorship_offers
     WHERE club_id=? AND stadium_id=? AND competition_id=? AND generation_source='AUTO_STADIUM_COMPETITION'`,
    [context.owner_club_id,context.stadium_id,context.competition_id],connection);
  if(number(exists?.total)>0)return {generated:0,reason:'ALREADY_GENERATED'};

  const attraction=clamp(18+number(context.coefficient,1)*15+number(context.rating_score)*0.32+
    Math.log10(Math.max(1000,number(context.capacity_total)))*5+number(context.commercial_quality)*0.12,15,98);
  const random=seededRandom(hashSeed(`AUTO-SPONSOR:${context.competition_id}:${context.stadium_id}`));
  const count=attraction>=78?4:attraction>=58?3:attraction>=38?2:1;
  const brands=await query(
    `SELECT sb.*,
            COALESCE(h.accepted_count,0) AS accepted_count,COALESCE(h.rejected_count,0) AS rejected_count,
            COALESCE(h.paid_value,0) AS paid_value
     FROM sponsor_brands sb
     LEFT JOIN(
       SELECT so.brand_id,SUM(so.status IN('ACCEPTED','PAID')) AS accepted_count,
              SUM(so.status='REJECTED') AS rejected_count,
              SUM(CASE WHEN so.status='PAID' THEN so.amount ELSE 0 END) AS paid_value
       FROM sponsorship_offers so WHERE so.club_id=? GROUP BY so.brand_id
     ) h ON h.brand_id=sb.id
     WHERE sb.is_active=TRUE`,[context.owner_club_id],connection);
  const ranked=brands.map((brand)=>{
    const historyBoost=number(brand.accepted_count)*16-number(brand.rejected_count)*5+Math.log10(Math.max(1,number(brand.paid_value)))*1.4;
    const tierBoost={GLOBAL:18,NATIONAL:12,REGIONAL:7,LOCAL:3}[brand.brand_tier]||0;
    return {...brand,preference_score:clamp(35+historyBoost+tierBoost+random()*18,1,100)};
  }).sort((a,b)=>b.preference_score-a.preference_score).slice(0,count);

  for(const brand of ranked){
    const base=number(brand.min_offer)+random()*(number(brand.max_offer)-number(brand.min_offer));
    const scale=0.55+attraction/95+number(context.commercial_quality)/240+number(context.coefficient)*0.09;
    const amount=roundMoney(base*scale*(0.85+random()*0.35));
    const offerTypes=['STADIUM_PARTNER','LED_BOARD','VIP_LOUNGE','SEASON_PARTNER'];
    const offerType=offerTypes[Math.floor(random()*offerTypes.length)];
    await query(
      `INSERT INTO sponsorship_offers(club_id,stadium_id,competition_id,match_id,source_operation_id,generation_source,
       brand_id,offer_type,amount,status,attractiveness_score,appearance_probability,preference_score,factors,expires_at,created_by_user_id)
       VALUES(?,?,?,NULL,?,'AUTO_STADIUM_COMPETITION',?,?,?,'OFFERED',?,?,?,?,
       COALESCE(DATE_ADD(?,INTERVAL 14 DAY),DATE_ADD(NOW(),INTERVAL 120 DAY)),?)`,
      [context.owner_club_id,context.stadium_id,context.competition_id,operationId,brand.id,offerType,amount,
       attraction,clamp(attraction+brand.preference_score*0.18,1,99),brand.preference_score,
       JSON.stringify({formula_version:'2.0.24',automatic:true,season:context.season_name,competition:context.competition_name,
         stadium:context.stadium_name,historyAccepted:number(brand.accepted_count),historyRejected:number(brand.rejected_count)}),
       context.ends_on,userId],connection);
  }
  await audit({userId,actionCode:'AUTO_PROPOSE_STADIUM_SPONSORS',entityTable:'stadium_match_operations',entityId:operationId,
    details:{competitionId:context.competition_id,stadiumId:context.stadium_id,clubId:context.owner_club_id,count:ranked.length,attraction}},connection);
  return {generated:ranked.length,attraction};
}

async function settleCompetitionSponsorships(competitionId,userId=null,connection=undefined){
  if(!connection)return transaction((transactionConnection)=>settleCompetitionSponsorships(competitionId,userId,transactionConnection));
  const offers=await query(
    `SELECT so.*,sb.name AS brand_name,w.id AS wallet_id,w.status AS wallet_status
     FROM sponsorship_offers so JOIN sponsor_brands sb ON sb.id=so.brand_id
     LEFT JOIN wallets w ON w.wallet_type='CLUB' AND w.club_id=so.club_id
     WHERE so.competition_id=? AND so.generation_source='AUTO_STADIUM_COMPETITION' AND so.status='ACCEPTED'
     FOR UPDATE`,
    [competitionId],connection);
  let paid=0,total=0;
  for(const offer of offers){
    if(!offer.wallet_id||offer.wallet_status!=='ACTIVE')continue;
    await callProcedure('sp_post_wallet_entry_core',[offer.wallet_id,'CREDIT','SPONSORSHIP',String(offer.amount),null,null,
      'sponsorship_offers',offer.id,`Quảng cáo ${offer.brand_name} sau khi kết thúc giải`,userId,null],connection);
    const tx=await first(`SELECT id FROM wallet_transactions WHERE reference_table='sponsorship_offers' AND reference_id=? ORDER BY id DESC LIMIT 1`,[offer.id],connection);
    await query(`UPDATE sponsorship_offers SET status='PAID',paid_at=NOW(6) WHERE id=? AND status='ACCEPTED'`,[offer.id],connection);
    await query(`UPDATE sponsorship_contracts SET status='COMPLETED',paid_at=NOW(6),wallet_transaction_id=? WHERE offer_id=? AND status='ACTIVE'`,[tx?.id||null,offer.id],connection);
    paid+=1;total+=number(offer.amount);
  }
  await audit({userId,actionCode:'SETTLE_COMPETITION_STADIUM_SPONSORS',entityTable:'competitions',entityId:competitionId,details:{paid,total}},connection);
  return {paid,total};
}

module.exports={generateStadiumCompetitionOffers,settleCompetitionSponsorships};
