'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { rateLimit } = require('express-rate-limit');
const { pool, query, first, ApiError } = require('./src/db');
const coreRoutes = require('./src/routes-core');
const footballRoutes = require('./src/routes-football');
const competitionRoutes = require('./src/routes-competitions');
const worldCupRoutes = require('./src/routes-world-cup');
const stadiumRoutes = require('./src/routes-stadiums');
const stadiumComplianceRoutes = require('./src/routes-stadium-compliance').router;
const performanceRoutes = require('./src/routes-performance');
const influenceRoutes = require('./src/routes-influence').router;

const app = express();
const port = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: false }));

const configuredOrigins = String(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);
  
function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (configuredOrigins.includes(origin)) return true;
  if (origin.includes('vercel.app')) return true; // <-- Cho phép tất cả domain Vercel
  if (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  return false;
}

app.use(cors({
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    return callback(new ApiError(403, `Frontend ${origin} chưa được phép truy cập API.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id']
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false, limit: '2mb' }));
app.use(morgan(isProduction ? 'combined' : 'dev'));

app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);
  next();
});

app.use('/api', rateLimit({
  windowMs: 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => !isProduction && req.ip === '127.0.0.1'
}));

app.get('/api', (_req, res) => {
  res.json({
    success: true,
    data: {
      name: 'Football Rank Manager API',
      version: '2.0.14',
      health: '/api/health',
      frontendExpected: process.env.FRONTEND_URL || 'http://localhost:5173'
    }
  });
});

app.get('/api/health', async (_req, res) => {
  const db = await first('SELECT DATABASE() AS database_name, VERSION() AS mysql_version, NOW() AS server_time');
  res.json({
    success: true,
    data: {
      api: 'OK',
      database: db?.database_name ? 'OK' : 'ERROR',
      databaseName: db?.database_name || null,
      mysqlVersion: db?.mysql_version || null,
      serverTime: db?.server_time || null
    }
  });
});

// Kiểm tra nhanh những đối tượng mà trang chủ/đăng nhập cần dùng. Không trả dữ liệu nhạy cảm.
app.get('/api/diagnostics/integration', async (_req, res) => {
  const checks = {};
  const run = async (name, sql, params = []) => {
    try {
      await query(sql, params);
      checks[name] = { ok: true };
    } catch (error) {
      checks[name] = { ok: false, code: error.code || null, message: error.message };
    }
  };
  await run('database', 'SELECT 1');
  await run('users', 'SELECT id FROM users LIMIT 1');
  await run('clubs', 'SELECT id FROM clubs LIMIT 1');
  await run('players', 'SELECT id FROM players LIMIT 1');
  await run('clubRankingView', 'SELECT club_id FROM v_latest_club_world_ranking ORDER BY rank_position LIMIT 1');
  await run('playerRankingView', 'SELECT player_id FROM v_player_rankings_current ORDER BY overall_world_rank LIMIT 1');
  await run('competitions', 'SELECT id FROM competitions ORDER BY id DESC LIMIT 1');
  await run('worldCup48', 'SELECT competition_id FROM world_cup_profiles LIMIT 1');
  await run('stadiumEconomy', 'SELECT id FROM stadiums LIMIT 1');
  await run('stadiumCompliance', 'SELECT id FROM stadium_standard_profiles LIMIT 1');
  await run('performanceRatings', 'SELECT id FROM match_player_ratings LIMIT 1');
  await run('clubInfluence', 'SELECT club_id FROM club_influence_profiles LIMIT 1');
  const ok = Object.values(checks).every((item) => item.ok);
  res.status(ok ? 200 : 500).json({ success: ok, data: { checks } });
});

app.use('/api', coreRoutes);
app.use('/api', footballRoutes);
app.use('/api', competitionRoutes);
app.use('/api', worldCupRoutes);
app.use('/api', stadiumRoutes);
app.use('/api', stadiumComplianceRoutes);
app.use('/api', performanceRoutes);
app.use('/api', influenceRoutes);

app.use((req, _res, next) => next(new ApiError(404, `Không tìm thấy API ${req.method} ${req.originalUrl}.`)));

app.use((error, req, res, _next) => {
  let status = error.status || 500;
  let message = error.message || 'Lỗi máy chủ.';

  if (error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
    status = 409;
    message = 'Dữ liệu bị trùng với một bản ghi đã tồn tại.';
  } else if (['ER_NO_REFERENCED_ROW_2', 'ER_ROW_IS_REFERENCED_2'].includes(error.code) || [1451, 1452].includes(error.errno)) {
    status = 409;
    message = 'Dữ liệu đang được liên kết hoặc tham chiếu không tồn tại.';
  } else if (error.errno === 1644 || error.sqlState === '45000') {
    status = 400;
    message = error.sqlMessage || error.message;
  } else if (error.errno === 3819) {
    status = 400;
    message = 'Dữ liệu vi phạm quy tắc kiểm tra của cơ sở dữ liệu.';
  }

  if (!isProduction) {
    console.error(`[${req.requestId || '-'}] ${req.method} ${req.originalUrl}`, error);
  }

  res.status(status).json({
    success: false,
    error: {
      message,
      code: error.code || null,
      requestId: req.requestId || null,
      details: error.details || null
    }
  });
});

let server;

async function start() {
  try {
    const db = await first('SELECT DATABASE() AS database_name, VERSION() AS mysql_version');
    if (!db?.database_name) throw new Error('MySQL chưa chọn database.');
    server = app.listen(port, () => {
      console.log('============================================================');
      console.log(`Football Rank Manager API: http://localhost:${port}`);
      console.log(`MySQL database: ${db.database_name}`);
      console.log(`MySQL version: ${db.mysql_version}`);
      console.log(`Integration check: http://localhost:${port}/api/diagnostics/integration`);
      console.log('============================================================');
      if (!process.env.JWT_SECRET || process.env.JWT_SECRET.includes('replace_this') || process.env.JWT_SECRET.includes('development-only')) {
        console.warn('CẢNH BÁO: Hãy đổi JWT_SECRET trong file .env trước khi triển khai thật.');
      }
    });
  } catch (error) {
    console.error('KHÔNG THỂ KHỞI ĐỘNG BACKEND:', error.message);
    console.error('Hãy kiểm tra DB_HOST, DB_USER, DB_PASSWORD và DB_NAME trong backend/.env.');
    process.exitCode = 1;
  }
}

async function shutdown(signal) {
  console.log(`\nNhận ${signal}, đang đóng server...`);
  if (!server) {
    await pool.end();
    process.exit(0);
    return;
  }
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) start();

module.exports = { app, start };
