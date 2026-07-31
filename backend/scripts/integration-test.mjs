const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3000/api').replace(/\/$/, '');
const username = process.env.SMOKE_USERNAME || 'admin_fifa';
const password = process.env.SMOKE_PASSWORD || 'Admin@123';

class SmokeError extends Error {
  constructor(message, details = '') { super(message); this.details = details; }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
  } catch (error) {
    throw new SmokeError(`Không kết nối được ${baseUrl}${path}. Backend có đang chạy không?`, error.message);
  }
  const text = await response.text();
  let payload;
  try { payload = text ? JSON.parse(text) : null; }
  catch { throw new SmokeError(`${path} không trả JSON hợp lệ.`, text.slice(0, 800)); }
  if (!response.ok || payload?.success === false) {
    throw new SmokeError(`${options.method || 'GET'} ${path} trả HTTP ${response.status}.`, JSON.stringify(payload, null, 2));
  }
  return payload?.data;
}

async function main() {
  console.log(`Đang kiểm tra API tại ${baseUrl}...`);
  const health = await request('/health');
  console.log(`✓ Health: API ${health.api}, MySQL ${health.mysqlVersion || ''}`);
  const diagnostics = await request('/diagnostics/integration');
  console.log(`✓ Database objects: ${Object.keys(diagnostics.checks || {}).length} kiểm tra`);
  await request('/public/home');
  console.log('✓ Trang chủ công khai');
  await request('/rankings/clubs?limit=5');
  console.log('✓ Xếp hạng CLB');
  await request('/rankings/players?category=OVERALL&limit=5');
  console.log('✓ Xếp hạng cầu thủ');
  await request('/honours/players?limit=5');
  await request('/honours/clubs?limit=5');
  console.log('✓ Bảng vinh danh huy chương');
  await request('/competitions?limit=5');
  console.log('✓ Danh sách giải đấu');

  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  if (!login?.token) throw new SmokeError('Đăng nhập không trả về JWT token.');
  console.log(`✓ Đăng nhập: ${login.user?.username}`);

  const authHeaders = { Authorization: `Bearer ${login.token}` };
  await request('/auth/me', { headers: authHeaders });
  console.log('✓ Xác thực token');
  await request('/dashboard', { headers: authHeaders });
  console.log('✓ Dashboard');
  const seasons = await request('/seasons', { headers: authHeaders });
  if (seasons?.[0]?.id) await request(`/seasons/${seasons[0].id}/delete-preview`, { headers: authHeaders });
  console.log('✓ Xem trước xóa mùa an toàn');
  console.log('\nSMOKE_API_OK: Frontend, Backend và MySQL đã kết nối đồng bộ.');
}

main().catch((error) => {
  console.error(`\nSMOKE_API_FAILED: ${error.message}`);
  if (error.details) console.error(error.details);
  console.error('\nKiểm tra theo thứ tự: Backend npm run dev → /api/health → file .env → MySQL database.');
  process.exitCode = 1;
});
