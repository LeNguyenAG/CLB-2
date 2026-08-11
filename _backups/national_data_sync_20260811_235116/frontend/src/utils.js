export const money = (value, compact = false) => {
  const amount = Number(value || 0)
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency', currency: 'VND', maximumFractionDigits: 0,
    notation: compact ? 'compact' : 'standard', compactDisplay: 'short',
  }).format(Number.isFinite(amount) ? amount : 0)
}
export const number = (value, maximumFractionDigits = 2) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits }).format(Number(value || 0))
export const date = (value, withTime = false) => {
  if (!value) return '—'
  const parsed = new Date(String(value).replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return String(value)
  return new Intl.DateTimeFormat('vi-VN', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }).format(parsed)
}
export const positionName = (value) => ({ GK: 'Thủ môn', DF: 'Hậu vệ', MF: 'Tiền vệ', FW: 'Tiền đạo' }[value] || value || '—')
export const statusName = (value) => ({
  DRAFT: 'Bản nháp', ACTIVE: 'Đang hoạt động', FINISHED: 'Đã kết thúc', PENDING: 'Chờ duyệt', APPROVED: 'Đã duyệt',
  REJECTED: 'Từ chối', SUSPENDED: 'Tạm khóa', FREE_AGENT: 'Tự do', TRANSFER_LISTED: 'Rao bán', RETIRED: 'Giải nghệ',
  REGISTRATION: 'Đang đăng ký', GROUP_STAGE: 'Vòng bảng', KNOCKOUT_READY: 'Sẵn sàng chia nhánh', KNOCKOUT_STAGE: 'Đấu loại trực tiếp',
  COMPLETED_PENDING_CLOSE: 'Chờ chốt giải', CANCELLED: 'Đã hủy', REGISTERED: 'Đã đăng ký', WITHDRAWN: 'Rút lui', DISQUALIFIED: 'Bị loại',
  SCHEDULED: 'Sắp diễn ra', LIVE: 'Đang đấu', COMPLETED: 'Hoàn tất', SENT: 'Đã gửi', ACCEPTED: 'Đã chấp nhận',
  COMPLETED: 'Hoàn tất', LOCKED: 'Đã khóa', CLOSED: 'Đã đóng', VERIFIED: 'Đã xác minh', PENDING: 'Chờ xác minh',
}[value] || value || '—')
export const initials = (name = '') => name.split(/\s+/).slice(-2).map((part) => part[0]).join('').toUpperCase() || 'FC'
export const movement = (change) => {
  const value = Number(change)
  if (!Number.isFinite(value) || value === 0) return { type: 'same', value: 0 }
  return { type: value > 0 ? 'up' : 'down', value: Math.abs(value) }
}
