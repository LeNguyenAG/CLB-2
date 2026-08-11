import { createRouter, createWebHistory } from 'vue-router'
import { authStore } from './stores/auth'

const routes = [
  {
    path: '/', component: () => import('./layouts/PublicLayout.vue'), children: [
      { path: '', name: 'home', component: () => import('./views/public/HomeView.vue') },
      { path: 'rankings', name: 'rankings', component: () => import('./views/public/RankingsView.vue') },
      { path: 'honours', name: 'honours', component: () => import('./views/public/HonoursView.vue') },
      { path: 'pulse', name: 'pulse', component: () => import('./views/public/PulseView.vue') },
      { path: 'influence', name: 'influence', component: () => import('./views/public/InfluenceView.vue') },
      { path: 'stadiums', name: 'stadiums', component: () => import('./views/public/StadiumsView.vue') },
      { path: 'clubs', name: 'clubs', component: () => import('./views/public/ClubsView.vue') },
      { path: 'clubs/:id', name: 'club-detail', component: () => import('./views/public/ClubDetailView.vue') },
      { path: 'players', name: 'players', component: () => import('./views/public/PlayersView.vue') },
      { path: 'players/:id', name: 'player-detail', component: () => import('./views/public/PlayerDetailView.vue') },
      { path: 'competitions', name: 'competitions', component: () => import('./views/public/CompetitionsView.vue') },
      { path: 'competitions/:id', name: 'competition-detail', component: () => import('./views/public/CompetitionDetailView.vue') },
    ],
  },
  { path: '/login', name: 'login', component: () => import('./views/public/LoginView.vue'), meta: { guestOnly: true } },
  { path: '/register-club', name: 'register-club', component: () => import('./views/public/RegisterClubView.vue'), meta: { guestOnly: true } },
  {
    path: '/portal', component: () => import('./layouts/PortalLayout.vue'), meta: { auth: true }, children: [
      { path: '', redirect: '/portal/dashboard' },
      { path: 'dashboard', name: 'portal-dashboard', component: () => import('./views/portal/DashboardView.vue') },
      { path: 'clubs', name: 'portal-clubs', component: () => import('./views/portal/ClubsAdminView.vue'), meta: { role: 'FIFA_ADMIN' } },
      { path: 'mascots', name: 'portal-mascots', component: () => import('./views/portal/MascotCenterView.vue'), meta: { title: 'Linh vật câu lạc bộ' } },
      { path: 'players', name: 'portal-players', component: () => import('./views/portal/PlayersAdminView.vue') },
      { path: 'world-cup-countries', name: 'portal-world-cup-countries', component: () => import('./views/portal/NationalProfilesView.vue'), meta: { role: 'FIFA_ADMIN', title: 'Hồ sơ quốc gia World Cup' } },
      { path: 'finance', name: 'portal-finance', component: () => import('./views/portal/FinanceView.vue') },
      { path: 'stadiums', name: 'portal-stadiums', component: () => import('./views/portal/StadiumCenterView.vue'), meta: { title: 'Trung tâm sân vận động' } },
      { path: 'influence', name: 'portal-influence', component: () => import('./views/portal/InfluenceCenterView.vue'), meta: { title: 'Sức ảnh hưởng & thương mại' } },
      { path: 'transfers', name: 'portal-transfers', component: () => import('./views/portal/TransfersView.vue') },
      { path: 'competitions', name: 'portal-competitions', component: () => import('./views/portal/CompetitionsAdminView.vue') },
      { path: 'competitions/:id', name: 'portal-competition-detail', component: () => import('./views/portal/CompetitionAdminView.vue') },
      { path: 'seasons', name: 'portal-seasons', component: () => import('./views/portal/SeasonsView.vue'), meta: { role: 'FIFA_ADMIN' } },
      { path: 'awards', name: 'portal-awards', component: () => import('./views/portal/AwardsView.vue') },
      { path: 'activity', name: 'portal-activity', component: () => import('./views/portal/ActivityView.vue'), meta: { role: 'FIFA_ADMIN' } },
      { path: 'profile', name: 'portal-profile', component: () => import('./views/portal/ProfileView.vue') },
    ],
  },
  { path: '/:pathMatch(.*)*', component: () => import('./views/public/NotFoundView.vue') },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0, behavior: 'smooth' }),
})

router.beforeEach(async (to) => {
  await authStore.restore()
  if (to.meta.auth && !authStore.isAuthenticated.value) return { name: 'login', query: { redirect: to.fullPath } }
  if (to.meta.guestOnly && authStore.isAuthenticated.value) return { name: 'portal-dashboard' }
  if (to.meta.role && authStore.user.value?.accountType !== to.meta.role) return { name: 'portal-dashboard' }
  return true
})

export default router
