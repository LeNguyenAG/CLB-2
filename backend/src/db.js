'use strict';

const mysql = require('mysql2/promise');

class ApiError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'football_rank_manager',
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true,
  supportBigNumbers: true,
  bigNumberStrings: true,
  decimalNumbers: false,
  multipleStatements: false
});

async function query(sql, params = [], connection = pool) {
  // Luôn format câu lệnh ở phía client rồi dùng text protocol. Cách này tránh
  // lỗi ER_WRONG_ARGUMENTS của một số bản MySQL/Workbench khi bind LIMIT/OFFSET
  // bằng prepared statement, đồng thời mysql2 vẫn escape toàn bộ tham số.
  const formattedSql = mysql.format(sql, params);
  const [rows] = await connection.query(formattedSql);
  return rows;
}

async function first(sql, params = [], connection = pool) {
  const rows = await query(sql, params, connection);
  return rows[0] || null;
}

async function transaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (_) {
      // Giữ nguyên lỗi gốc.
    }
    throw error;
  } finally {
    connection.release();
  }
}

function normalizeProcedureResult(rawRows) {
  if (!Array.isArray(rawRows)) return [];
  return rawRows.filter((item) => Array.isArray(item));
}

async function callProcedure(name, args = [], connection = pool) {
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    throw new ApiError(500, 'Tên thủ tục không hợp lệ.');
  }
  const placeholders = args.map(() => '?').join(',');
  const formattedSql = mysql.format(`CALL ${name}(${placeholders})`, args);
  const [rawRows] = await connection.query(formattedSql);
  return normalizeProcedureResult(rawRows);
}

function parsePositiveInt(value, field = 'id', { required = true, min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new ApiError(400, `${field} là bắt buộc.`);
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new ApiError(400, `${field} không hợp lệ.`);
  }
  return number;
}

function parseMoney(value, field = 'amount', { allowZero = true, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new ApiError(400, `${field} là bắt buộc.`);
  }
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    throw new ApiError(400, `${field} phải là số nguyên không âm, gửi dưới dạng số hoặc chuỗi số.`);
  }
  if (!allowZero && /^0+$/.test(text)) {
    throw new ApiError(400, `${field} phải lớn hơn 0.`);
  }
  if (text.length > 20) {
    throw new ApiError(400, `${field} vượt giới hạn DECIMAL(20,0).`);
  }
  return text.replace(/^0+(?=\d)/, '');
}

function parseDecimal(value, field, { min = null, max = null, required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new ApiError(400, `${field} là bắt buộc.`);
  }
  const text = String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    throw new ApiError(400, `${field} không phải số hợp lệ.`);
  }
  const number = Number(text);
  if (!Number.isFinite(number) || (min !== null && number < min) || (max !== null && number > max)) {
    throw new ApiError(400, `${field} nằm ngoài phạm vi cho phép.`);
  }
  return text;
}

function parseEnum(value, allowed, field, { required = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (!required) return null;
    throw new ApiError(400, `${field} là bắt buộc.`);
  }
  const normalized = String(value).trim().toUpperCase();
  if (!allowed.includes(normalized)) {
    throw new ApiError(400, `${field} phải thuộc: ${allowed.join(', ')}.`);
  }
  return normalized;
}

function parseText(value, field, { required = true, max = 500, min = 1, nullable = false } = {}) {
  if (value === undefined || value === null) {
    if (!required || nullable) return null;
    throw new ApiError(400, `${field} là bắt buộc.`);
  }
  const text = String(value).trim();
  if (!text && required) throw new ApiError(400, `${field} là bắt buộc.`);
  if (!text && nullable) return null;
  if (text.length < min || text.length > max) {
    throw new ApiError(400, `${field} phải có độ dài từ ${min} đến ${max} ký tự.`);
  }
  return text;
}

function parseBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'true') return true;
  if (value === false || value === 0 || value === '0' || String(value).toLowerCase() === 'false') return false;
  throw new ApiError(400, 'Giá trị boolean không hợp lệ.');
}

function parseDate(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, `${field} là bắt buộc.`);
    return null;
  }
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new ApiError(400, `${field} phải có dạng YYYY-MM-DD.`);
  return text;
}

function pagination(req, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number.parseInt(req.query.limit || String(defaultLimit), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}


function sqlLimit(limit, offset = null) {
  const safeLimit = Number(limit);
  const safeOffset = offset === null ? null : Number(offset);
  if (!Number.isInteger(safeLimit) || safeLimit < 1 || safeLimit > 1000) {
    throw new ApiError(500, 'Giới hạn phân trang nội bộ không hợp lệ.');
  }
  if (safeOffset !== null && (!Number.isInteger(safeOffset) || safeOffset < 0)) {
    throw new ApiError(500, 'Độ lệch phân trang nội bộ không hợp lệ.');
  }
  return safeOffset === null ? `LIMIT ${safeLimit}` : `LIMIT ${safeLimit} OFFSET ${safeOffset}`;
}

function buildUpdate(body, allowedFields) {
  const sets = [];
  const values = [];
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field) && body[field] !== undefined) {
      sets.push(`\`${field}\` = ?`);
      values.push(body[field]);
    }
  }
  if (!sets.length) throw new ApiError(400, 'Không có trường hợp lệ để cập nhật.');
  return { sql: sets.join(', '), values };
}

function ok(res, data = null, status = 200, meta = undefined) {
  const payload = { success: true, data };
  if (meta !== undefined) payload.meta = meta;
  return res.status(status).json(payload);
}

async function audit({ userId = null, actionCode, entityTable = null, entityId = null, details = null }, connection = pool) {
  await query(
    `INSERT INTO audit_logs(user_id, action_code, entity_table, entity_id, details)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, actionCode, entityTable, entityId, details ? JSON.stringify(details) : null],
    connection
  );
}

module.exports = {
  pool,
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
  parseBoolean,
  parseDate,
  pagination,
  sqlLimit,
  buildUpdate,
  ok,
  audit
};
