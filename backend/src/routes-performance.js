'use strict';

const express = require('express');
const { parsePositiveInt, parseBoolean, ok } = require('./db');
const { authenticate, optionalAuthenticate, requireAdmin } = require('./auth');
const {
  previewMatchRatings,
  finalizeMatchRatings,
  finalizeAllCompetitionMatchRatings,
  getCompetitionPerformance,
  finalizeCompetitionPerformance
} = require('./performance-engine');

const router = express.Router();

router.get('/matches/:matchId/ratings/preview', authenticate, async (req, res) => {
  const matchId = parsePositiveInt(req.params.matchId, 'match_id');
  return ok(res, await previewMatchRatings(matchId));
});

router.post('/matches/:matchId/ratings/finalize', authenticate, requireAdmin, async (req, res) => {
  const matchId = parsePositiveInt(req.params.matchId, 'match_id');
  const allowIncomplete = parseBoolean(req.body.allow_incomplete, false);
  const result = await finalizeMatchRatings(matchId, req.user.id, { allowIncomplete });
  return ok(res, {
    message: `Đã chốt điểm cho ${result.finalized.length} cầu thủ.`,
    ...result
  });
});

router.get('/competitions/:id/performance', optionalAuthenticate, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id, 'competition_id');
  return ok(res, await getCompetitionPerformance(competitionId));
});

router.get('/public/competitions/:id/performance', optionalAuthenticate, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id, 'competition_id');
  return ok(res, await getCompetitionPerformance(competitionId));
});

router.post('/competitions/:id/performance/recalculate-matches', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id, 'competition_id');
  const skipIncomplete = parseBoolean(req.body.skip_incomplete, true);
  const result = await finalizeAllCompetitionMatchRatings(competitionId, req.user.id, { skipIncomplete });
  return ok(res, {
    message: `Đã chốt điểm ${result.finalized.length}/${result.total_matches} trận.`,
    ...result
  });
});

router.post('/competitions/:id/performance/finalize', authenticate, requireAdmin, async (req, res) => {
  const competitionId = parsePositiveInt(req.params.id, 'competition_id');
  const allowIncomplete = parseBoolean(req.body.allow_incomplete, false);
  const matchRatings = await finalizeAllCompetitionMatchRatings(competitionId, req.user.id, { skipIncomplete: allowIncomplete });
  const result = await finalizeCompetitionPerformance(competitionId, req.user.id, { allowIncomplete });
  return ok(res, {
    message: `Đã chốt BXH hiệu suất và cộng điểm cho ${result.awarded.length} cầu thủ.`,
    matchRatings,
    ...result
  });
});

module.exports = router;
