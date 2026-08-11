'use strict';

const express = require('express');
const { ApiError, parsePositiveInt, parseText, ok } = require('./db');
const { authenticate, optionalAuthenticate, requireAdmin } = require('./auth');
const {
  recalculatePlayerValues,
  getValuationSummary,
  getPlayerValuation,
  getValuationBatches
} = require('./player-valuation-engine');

const router = express.Router();

router.get('/player-valuations/summary', authenticate, requireAdmin, async (_req, res) => {
  return ok(res, await getValuationSummary());
});

router.get('/player-valuations/batches', authenticate, requireAdmin, async (req, res) => {
  return ok(res, await getValuationBatches(req.query.limit));
});

router.get('/players/:id/valuation', optionalAuthenticate, async (req, res) => {
  const playerId = parsePositiveInt(req.params.id, 'player_id');
  const data = await getPlayerValuation(playerId);
  if (req.user?.accountType === 'CLUB' && data.player.club_id
      && Number(data.player.club_id) !== Number(req.user.clubId)) {
    throw new ApiError(403, 'CLB chỉ được xem chi tiết định giá cầu thủ thuộc đội mình.');
  }
  return ok(res, data);
});

router.post('/player-valuations/recalculate', authenticate, requireAdmin, async (req, res) => {
  const note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 500 });
  const result = await recalculatePlayerValues({ userId: req.user.id, note });
  return ok(res, { message: `Đã định giá lại ${result.batch.total_players} cầu thủ.`, ...result });
});

router.post('/players/:id/valuation/recalculate', authenticate, requireAdmin, async (req, res) => {
  const playerId = parsePositiveInt(req.params.id, 'player_id');
  const note = parseText(req.body.note, 'note', { required: false, nullable: true, max: 500 });
  const result = await recalculatePlayerValues({ userId: req.user.id, playerId, note });
  return ok(res, { message: 'Đã làm mới định giá cầu thủ.', ...result });
});

module.exports = router;
