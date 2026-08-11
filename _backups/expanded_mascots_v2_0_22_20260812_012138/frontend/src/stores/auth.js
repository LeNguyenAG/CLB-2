import { computed, reactive } from 'vue'
import { api, getToken, setToken } from '../services/api'

const USER_KEY = 'frm_v2_user'

function readUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null') } catch { return null }
}

const state = reactive({
  user: readUser(),
  ready: false,
  loading: false,
})

function persistUser(user) {
  state.user = user || null
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user))
  else localStorage.removeItem(USER_KEY)
}

async function login(credentials) {
  state.loading = true
  try {
    const { data } = await api.post('/auth/login', credentials, { auth: false })
    setToken(data.token)
    persistUser(data.user)
    return data.user
  } finally {
    state.loading = false
  }
}

async function restore() {
  if (state.ready) return state.user
  const token = getToken()
  if (!token) {
    state.ready = true
    persistUser(null)
    return null
  }
  try {
    const { data } = await api.get('/auth/me')
    persistUser({
      id: Number(data.id),
      username: data.username,
      accountType: data.account_type,
      clubId: data.club_id ? Number(data.club_id) : null,
      clubName: data.club_name || null,
      logoUrl: data.logo_url || null,
    })
    return state.user
  } catch {
    setToken('')
    persistUser(null)
    return null
  } finally {
    state.ready = true
  }
}

function logout() {
  setToken('')
  persistUser(null)
}

window.addEventListener('frm:unauthorized', logout)

export const authStore = {
  state,
  user: computed(() => state.user),
  isAuthenticated: computed(() => Boolean(state.user && getToken())),
  isAdmin: computed(() => state.user?.accountType === 'FIFA_ADMIN'),
  isClub: computed(() => state.user?.accountType === 'CLUB'),
  login,
  logout,
  restore,
}
