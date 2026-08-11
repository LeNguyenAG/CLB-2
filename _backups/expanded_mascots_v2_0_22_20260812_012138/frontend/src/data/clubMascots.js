export const clubMascots = [
  { key: 'dragon-ascendant', name: 'Thiên Long Thăng Vân', style: 'Kiểm soát · áp đảo', rarity: 'MYTHIC', color: '#ffbf3f', keywords: ['dragon','rồng','long','thăng','royal','hoàng'] },
  { key: 'golden-buffalo', name: 'Kim Ngưu Chiến Giáp', style: 'Sức mạnh · bền bỉ', rarity: 'MYTHIC', color: '#ffd65a', keywords: ['buffalo','trâu','ngưu','gold','kim','tê con'] },
  { key: 'fire-phoenix', name: 'Hỏa Phượng Tái Sinh', style: 'Bùng nổ · ngược dòng', rarity: 'LEGENDARY', color: '#ff5b35', keywords: ['phoenix','phượng','fire','hỏa','lửa'] },
  { key: 'thunder-wolf', name: 'Lôi Lang Bão Tố', style: 'Tốc độ · pressing', rarity: 'LEGENDARY', color: '#3eb8ff', keywords: ['thunder','sấm','lôi','wolf','sói','storm','bão'] },
  { key: 'royal-lion', name: 'Sư Vương Hoàng Gia', style: 'Lãnh đạo · bản lĩnh', rarity: 'EPIC', color: '#b378ff', keywords: ['lion','sư tử','royal','vương','king','đế'] },
  { key: 'ocean-shark', name: 'Hải Kình Chiến Binh', style: 'Trực diện · săn bàn', rarity: 'EPIC', color: '#2bd9ff', keywords: ['ocean','biển','hải','shark','cá mập','blue'] },
  { key: 'snow-leopard', name: 'Tuyết Báo Sơn Vương', style: 'Lạnh lùng · phản công', rarity: 'EPIC', color: '#8bdcff', keywords: ['mountain','núi','sơn','snow','tuyết','leopard','báo'] },
  { key: 'golden-eagle', name: 'Kim Ưng Thiên Kích', style: 'Không chiến · tốc độ', rarity: 'EPIC', color: '#f5c94a', keywords: ['eagle','đại bàng','ưng','golden','kim','sky'] },
  { key: 'void-panther', name: 'Hắc Báo Hư Không', style: 'Ẩn mình · đột kích', rarity: 'RARE', color: '#a65cff', keywords: ['black','hắc','dark','panther','báo','night','đêm'] },
  { key: 'jade-tiger', name: 'Ngọc Hổ Cuồng Phong', style: 'Cân bằng · quyết liệt', rarity: 'RARE', color: '#38df91', keywords: ['tiger','hổ','jade','ngọc','green','lục'] },
  { key: 'mecha-falcon', name: 'Ngân Ưng Cơ Giới', style: 'Chiến thuật · chính xác', rarity: 'RARE', color: '#69d9ff', keywords: ['tech','cơ khí','machine','silver','ngân','falcon','ưng'] },
  { key: 'cosmic-stag', name: 'Tinh Lộc Ngân Hà', style: 'Sáng tạo · thanh thoát', rarity: 'RARE', color: '#746dff', keywords: ['galaxy','ngân hà','star','tinh','cosmic','vũ trụ','deer','hươu'] },
]

export const mascotMap = new Map(clubMascots.map((mascot) => [mascot.key, mascot]))

export function mascotFor(key) {
  return mascotMap.get(key) || null
}

export function suggestMascot(clubName, occupiedKeys = []) {
  const normalized = String(clubName || '').toLocaleLowerCase('vi')
  const available = clubMascots.filter((mascot) => !occupiedKeys.includes(mascot.key))
  return available.find((mascot) => mascot.keywords.some((keyword) => normalized.includes(keyword))) || available[0] || clubMascots[0]
}
