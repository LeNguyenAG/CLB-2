const base = process.env.API_BASE_URL || 'http://127.0.0.1:3000/api'
async function call(path, options={}) {
  const response = await fetch(`${base}${path}`, options)
  const payload = await response.json().catch(()=>null)
  if(!response.ok || !payload?.success) throw new Error(`${options.method||'GET'} ${path}: HTTP ${response.status} - ${payload?.error?.message||'Không có JSON hợp lệ'}`)
  return payload.data
}
try {
  console.log(`Dang kiem tra Backend tai ${base}...`)
  const health=await call('/health')
  if(health.api!=='OK'||health.database!=='OK') throw new Error('Backend hoặc MySQL chưa sẵn sàng.')
  await call('/public/home')
  await call('/rankings/clubs?limit=5')
  await call('/honours/players?limit=5')
  await call('/honours/clubs?limit=5')
  const login=await call('/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin_fifa',password:'Admin@123'})})
  if(!login.token) throw new Error('Đăng nhập không trả token.')
  await call('/dashboard',{headers:{Authorization:`Bearer ${login.token}`}})
  const seasons=await call('/seasons',{headers:{Authorization:`Bearer ${login.token}`}})
  if(seasons?.[0]?.id) await call(`/seasons/${seasons[0].id}/delete-preview`,{headers:{Authorization:`Bearer ${login.token}`}})
  console.log('SMOKE_API_OK: Public API, bảng vinh danh, đăng nhập, JWT, dashboard và xem trước xóa mùa hoạt động đồng bộ.')
} catch(error) {
  console.error('SMOKE_API_FAILED:', error.message)
  process.exit(1)
}
