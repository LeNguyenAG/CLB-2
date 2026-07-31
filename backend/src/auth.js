'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ApiError, first } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'development-only-change-this-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

async function verifyPassword(plainPassword, user) {
  if (user.password_scheme === 'SHA256_DEMO') {
    const digest = crypto.createHash('sha256').update(String(plainPassword), 'utf8').digest('hex');
    const stored = String(user.password_hash || '').toLowerCase();
    if (stored.length !== digest.length) return false;
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(stored));
  }
  if (user.password_scheme === 'BCRYPT') {
    return bcrypt.compare(String(plainPassword), user.password_hash);
  }
  throw new ApiError(401, 'Cơ chế mật khẩu của tài khoản chưa được hỗ trợ.');
}

async function hashPassword(password) {
  const text = String(password || '');
  if (text.length < 8 || text.length > 72) {
    throw new ApiError(400, 'Mật khẩu phải có từ 8 đến 72 ký tự.');
  }
  return bcrypt.hash(text, 12);
}

function signToken(user) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      accountType: user.account_type,
      clubId: user.club_id ? String(user.club_id) : null
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN, issuer: 'football-rank-manager-api' }
  );
}

async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw new ApiError(401, 'Thiếu Bearer token.');

    const payload = jwt.verify(token, JWT_SECRET, { issuer: 'football-rank-manager-api' });
    const user = await first(
      `SELECT id, username, account_type, club_id, is_active
       FROM users WHERE id = ? LIMIT 1`,
      [payload.sub]
    );
    if (!user || !user.is_active) throw new ApiError(401, 'Tài khoản không tồn tại hoặc đã bị khóa.');

    req.user = {
      id: Number(user.id),
      username: user.username,
      accountType: user.account_type,
      clubId: user.club_id ? Number(user.club_id) : null
    };
    next();
  } catch (error) {
    if (error instanceof ApiError) return next(error);
    return next(new ApiError(401, 'Token không hợp lệ hoặc đã hết hạn.'));
  }
}

function optionalAuthenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  if (!header) return next();
  return authenticate(req, _res, next);
}

function requireAdmin(req, _res, next) {
  if (!req.user || req.user.accountType !== 'FIFA_ADMIN') {
    return next(new ApiError(403, 'Chỉ Admin FIFA được thực hiện thao tác này.'));
  }
  next();
}

function requireClubOrAdmin(req, _res, next) {
  if (!req.user || !['FIFA_ADMIN', 'CLUB'].includes(req.user.accountType)) {
    return next(new ApiError(403, 'Tài khoản không có quyền thực hiện thao tác này.'));
  }
  next();
}

function assertClubScope(req, requestedClubId) {
  const clubId = Number(requestedClubId);
  if (!Number.isInteger(clubId) || clubId <= 0) throw new ApiError(400, 'club_id không hợp lệ.');
  if (req.user.accountType === 'CLUB' && req.user.clubId !== clubId) {
    throw new ApiError(403, 'Tài khoản CLB chỉ được thao tác dữ liệu của chính CLB đó.');
  }
  return clubId;
}

module.exports = {
  verifyPassword,
  hashPassword,
  signToken,
  authenticate,
  optionalAuthenticate,
  requireAdmin,
  requireClubOrAdmin,
  assertClubScope
};
