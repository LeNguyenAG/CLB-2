'use strict';

const baseUrl = process.env.API_BASE_URL || 'http://localhost:3000/api';
const username = process.env.ADMIN_USERNAME || 'admin_fifa';
const password = process.env.ADMIN_PASSWORD || 'Admin@123';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path}: HTTP ${response.status} - ${body?.error?.message || 'Unknown error'}`);
  }
  return body;
}

(async () => {
  const health = await request('/health');
  console.log('✓ Health:', health.data);

  const login = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
  const token = login.data.token;
  console.log('✓ Login:', login.data.user.username);

  const authHeaders = { Authorization: `Bearer ${token}` };
  const dashboard = await request('/dashboard', { headers: authHeaders });
  console.log('✓ Dashboard loaded:', Boolean(dashboard.data));

  const seasons = await request('/seasons');
  console.log('✓ Seasons:', seasons.data.length);

  const clubs = await request('/rankings/clubs?limit=5');
  console.log('✓ Club ranking:', clubs.data.length);

  const players = await request('/rankings/players?category=OVERALL&limit=5');
  console.log('✓ Player ranking:', players.data.length);

  const competitions = await request('/competitions?limit=5', { headers: authHeaders });
  console.log('✓ Competitions:', competitions.data.length);

  console.log('\nSMOKE_TEST_OK');
})().catch((error) => {
  console.error('\nSMOKE_TEST_FAILED');
  console.error(error.message);
  process.exit(1);
});
