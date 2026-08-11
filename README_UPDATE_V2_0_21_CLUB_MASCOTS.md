# Bản cập nhật 2.0.21 — Linh vật và nhánh đấu CLB

## Cách dùng

1. Chạy `APPLY_UPDATE.cmd` trong gói cập nhật và chọn thư mục dự án chính.
2. Khởi động lại bằng `START_ALL.cmd`.
3. Đăng nhập, mở **Linh vật CLB** trong menu Portal.
4. Admin FIFA có thể bấm **Đề xuất cho CLB chưa có**, sau đó chốt từng linh vật.

## Quy tắc

- Một linh vật chỉ thuộc một CLB tại một thời điểm.
- CLB được đổi sang mẫu còn trống cho tới khi Admin FIFA chốt.
- Admin có thể hoán đổi hai linh vật, chốt hoặc mở khóa.
- Dữ liệu dùng bảng `system_settings` có sẵn; không chạy SQL.
- Logo gốc không bị xóa và vẫn được API trả về ở trường `official_logo_url`.

## Nhánh đấu CLB

- Chọn R32/R16/QF/SF/FINAL để đưa vòng đó thành cột đầu.
- Kéo chuột, touchpad, Shift + con lăn hoặc vuốt tay để cuộn ngang.
- Bấm vào một CLB để làm sáng toàn bộ đường đi của CLB đó.
- Đường thắng thay đổi theo cấp hạt giống; S1 nổi bật nhất.
