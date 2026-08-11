import { reactive } from 'vue'

const storageKeys = {
  theme: 'frm_v2_theme',
  themeMode: 'frm_v211_theme_mode',
  accent: 'frm_v211_accent',
  customAccent: 'frm_v211_custom_accent',
  motion: 'frm_v213_motion',
  backdrop: 'frm_v211_backdrop',
  glass: 'frm_v211_glass',
  effects: 'frm_v213_effects',
  depth: 'frm_v213_depth',
  buttonFx: 'frm_v213_button_fx',
}

function readStorage(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback } catch { return fallback }
}
function writeStorage(key, value) {
  try { localStorage.setItem(key, String(value)) } catch { /* Storage may be unavailable. */ }
}
function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function numberStorage(key, fallback, min = 0, max = 100) {
  const parsed = Number(readStorage(key, fallback))
  return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback
}
function booleanStorage(key, fallback) {
  const value = readStorage(key, fallback ? '1' : '0')
  return value === '1' || value === 'true'
}

export const appearancePresets = [
  { id: 'ocean', name: 'Ocean Blue', primary: '#3982ff', secondary: '#6a5cff', glow: '#29d8ff' },
  { id: 'pitch', name: 'Emerald Pitch', primary: '#16b978', secondary: '#079a9a', glow: '#4ade80' },
  { id: 'royal', name: 'Royal Purple', primary: '#8b5cf6', secondary: '#d946ef', glow: '#c084fc' },
  { id: 'trophy', name: 'Trophy Gold', primary: '#f59e0b', secondary: '#f97316', glow: '#facc15' },
  { id: 'crimson', name: 'Crimson Energy', primary: '#ef4444', secondary: '#e11d48', glow: '#fb7185' },
  { id: 'ice', name: 'Ice Cyan', primary: '#06b6d4', secondary: '#3b82f6', glow: '#67e8f9' },
]

export const motionProfiles = [
  {
    id: 'off',
    label: 'Tắt hiệu ứng',
    short: 'Nhẹ nhất',
    description: 'Không chạy nền động; thao tác hiển thị tức thời.',
    strength: 0,
    recommendation: 'Máy yếu hoặc cần tiết kiệm pin',
  },
  {
    id: 'subtle',
    label: 'Nhẹ',
    short: 'Ưu tiên hiệu năng',
    description: 'Chuyển trang trượt ngắn, nút phản hồi nhẹ, nền gần như tĩnh.',
    strength: 42,
    recommendation: 'Laptop văn phòng',
  },
  {
    id: 'standard',
    label: 'Mượt vừa đủ',
    short: 'Khuyên dùng',
    description: 'Trượt liền mạch, nút bấm rõ phản hồi và cực quang nhẹ.',
    strength: 70,
    recommendation: 'Hầu hết máy tính',
  },
]

const oldTheme = readStorage(storageKeys.theme, 'dark')
const initialMode = readStorage(storageKeys.themeMode, oldTheme === 'light' ? 'light' : 'dark')
const storedAccent = readStorage(storageKeys.accent, 'ocean')
const rawStoredMotion = readStorage(storageKeys.motion, readStorage('frm_v211_motion', 'standard'))
const storedMotion = rawStoredMotion === 'expressive' ? 'standard' : rawStoredMotion
const storedBackdrop = readStorage(storageKeys.backdrop, 'aurora')
const storedGlass = readStorage(storageKeys.glass, 'standard')

const state = reactive({
  toasts: [],
  sidebarOpen: false,
  theme: 'dark',
  themeMode: ['dark', 'light', 'system'].includes(initialMode) ? initialMode : 'dark',
  accent: storedAccent === 'custom' || appearancePresets.some((item) => item.id === storedAccent) ? storedAccent : 'ocean',
  customAccent: readStorage(storageKeys.customAccent, '#3982ff'),
  motion: motionProfiles.some((item) => item.id === storedMotion) ? storedMotion : 'standard',
  backdrop: ['aurora', 'stadium', 'carbon', 'minimal'].includes(storedBackdrop) ? storedBackdrop : 'aurora',
  glass: ['soft', 'standard', 'strong'].includes(storedGlass) ? storedGlass : 'standard',
  effects: numberStorage(storageKeys.effects, 30, 0, 55),
  depth: numberStorage(storageKeys.depth, 24, 0, 45),
  buttonFx: booleanStorage(storageKeys.buttonFx, true),
})

let systemListenerBound = false
function resolveTheme(mode = state.themeMode) {
  if (mode !== 'system') return mode
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
function ensureSystemListener() {
  if (systemListenerBound || typeof window === 'undefined' || !window.matchMedia) return
  const media = window.matchMedia('(prefers-color-scheme: light)')
  media.addEventListener?.('change', () => {
    if (state.themeMode === 'system') applyAppearance()
  })
  systemListenerBound = true
}
function normalizeHex(value) {
  const clean = String(value || '').trim().replace('#', '')
  if (/^[0-9a-f]{3}$/i.test(clean)) return `#${clean.split('').map((c) => c + c).join('')}`
  if (/^[0-9a-f]{6}$/i.test(clean)) return `#${clean}`
  return '#3982ff'
}
function hexToHsl(hex) {
  const value = normalizeHex(hex).slice(1)
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let h = 0, s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > .5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
  }
  return { h: h * 360, s: s * 100, l: l * 100 }
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360
  s = clamp(s, 0, 100) / 100
  l = clamp(l, 0, 100) / 100
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = l - c / 2
  let r = 0, g = 0, b = 0
  if (h < 60) [r, g] = [c, x]
  else if (h < 120) [r, g] = [x, c]
  else if (h < 180) [g, b] = [c, x]
  else if (h < 240) [g, b] = [x, c]
  else if (h < 300) [r, b] = [x, c]
  else [r, b] = [c, x]
  return `#${[r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')}`
}
function derivedPalette(primary) {
  const hsl = hexToHsl(primary)
  return {
    primary: normalizeHex(primary),
    secondary: hslToHex(hsl.h + 34, clamp(hsl.s + 2, 38, 92), clamp(hsl.l + 4, 42, 66)),
    glow: hslToHex(hsl.h - 24, clamp(hsl.s + 8, 42, 96), clamp(hsl.l + 12, 54, 76)),
  }
}
function getPalette() {
  if (state.accent === 'custom') return derivedPalette(state.customAccent)
  return appearancePresets.find((item) => item.id === state.accent) || appearancePresets[0]
}
function applyAppearance() {
  if (typeof document === 'undefined') return
  ensureSystemListener()
  const root = document.documentElement
  const theme = resolveTheme()
  const palette = getPalette()
  const profile = motionProfiles.find((item) => item.id === state.motion) || motionProfiles[2]
  const profileLimit = state.motion === 'off' ? 0 : state.motion === 'subtle' ? 20 : 55
  const effectiveEffects = Math.min(state.effects, profileLimit)
  const effectiveDepth = state.motion === 'off' ? 0 : Math.min(state.depth, 45)

  state.theme = theme
  root.dataset.theme = theme
  root.dataset.themeMode = state.themeMode
  root.dataset.accent = state.accent
  root.dataset.motion = state.motion
  root.dataset.backdrop = ['aurora', 'stadium', 'carbon', 'minimal'].includes(state.backdrop) ? state.backdrop : 'aurora'
  root.dataset.glass = ['soft', 'standard', 'strong'].includes(state.glass) ? state.glass : 'standard'
  root.dataset.buttonFx = state.buttonFx ? 'on' : 'off'
  root.style.setProperty('--primary', palette.primary)
  root.style.setProperty('--primary-2', palette.secondary)
  root.style.setProperty('--cyan', palette.glow)
  root.style.setProperty('--accent-rgb', `${parseInt(palette.primary.slice(1, 3), 16)}, ${parseInt(palette.primary.slice(3, 5), 16)}, ${parseInt(palette.primary.slice(5, 7), 16)}`)
  root.style.setProperty('--fx-strength', String(effectiveEffects / 100))
  root.style.setProperty('--depth-strength', String(effectiveDepth / 100))
  root.style.setProperty('--motion-strength', String(profile.strength / 100))
  root.style.setProperty('--motion-deg', `${profile.strength * 3.6}deg`)
}

function notify(message, type = 'success', duration = 3600) {
  const id = `${Date.now()}-${Math.random()}`
  state.toasts.push({ id, message, type })
  window.setTimeout(() => dismiss(id), duration)
}
function dismiss(id) {
  const index = state.toasts.findIndex((item) => item.id === id)
  if (index >= 0) state.toasts.splice(index, 1)
}
function toggleSidebar(force) {
  state.sidebarOpen = typeof force === 'boolean' ? force : !state.sidebarOpen
}
function setTheme(mode) {
  state.themeMode = ['dark', 'light', 'system'].includes(mode) ? mode : 'dark'
  writeStorage(storageKeys.themeMode, state.themeMode)
  writeStorage(storageKeys.theme, resolveTheme(state.themeMode))
  applyAppearance()
}
function setAccent(id, customColor) {
  if (id === 'custom' && customColor) {
    state.customAccent = normalizeHex(customColor)
    writeStorage(storageKeys.customAccent, state.customAccent)
  }
  state.accent = id === 'custom' || appearancePresets.some((item) => item.id === id) ? id : 'ocean'
  writeStorage(storageKeys.accent, state.accent)
  applyAppearance()
}
function setMotion(value) {
  const normalized = value === 'expressive' ? 'standard' : value
  state.motion = motionProfiles.some((item) => item.id === normalized) ? normalized : 'standard'
  writeStorage(storageKeys.motion, state.motion)
  applyAppearance()
}
function setBackdrop(value) {
  state.backdrop = ['aurora', 'stadium', 'carbon', 'minimal'].includes(value) ? value : 'aurora'
  writeStorage(storageKeys.backdrop, state.backdrop)
  applyAppearance()
}
function setGlass(value) {
  state.glass = ['soft', 'standard', 'strong'].includes(value) ? value : 'standard'
  writeStorage(storageKeys.glass, state.glass)
  applyAppearance()
}
function setEffects(value) {
  state.effects = clamp(Number(value) || 0, 0, 55)
  writeStorage(storageKeys.effects, state.effects)
  applyAppearance()
}
function setDepth(value) {
  state.depth = clamp(Number(value) || 0, 0, 45)
  writeStorage(storageKeys.depth, state.depth)
  applyAppearance()
}
function setButtonFx(value) {
  state.buttonFx = Boolean(value)
  writeStorage(storageKeys.buttonFx, state.buttonFx ? '1' : '0')
  applyAppearance()
}
function resetAppearance() {
  state.themeMode = 'dark'
  state.accent = 'ocean'
  state.customAccent = '#3982ff'
  state.motion = 'standard'
  state.backdrop = 'aurora'
  state.glass = 'standard'
  state.effects = 30
  state.depth = 24
  state.buttonFx = true
  Object.values(storageKeys).forEach((key) => { try { localStorage.removeItem(key) } catch { /* no-op */ } })
  applyAppearance()
}

applyAppearance()

export const uiStore = {
  state,
  presets: appearancePresets,
  motionProfiles,
  notify,
  dismiss,
  toggleSidebar,
  setTheme,
  setAccent,
  setMotion,
  setBackdrop,
  setGlass,
  setEffects,
  setDepth,
  setButtonFx,
  resetAppearance,
  applyAppearance,
}
