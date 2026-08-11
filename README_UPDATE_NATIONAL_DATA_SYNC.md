# Cập nhật đồng bộ hồ sơ quốc gia và khu vực chốt giải

Cập nhật này sửa giao diện chốt giải knockout 32 đội và đồng bộ nguồn dữ liệu
quốc gia – cầu thủ giữa thư viện Quốc gia World Cup, World Cup 48 đội và giải
knockout quốc gia 32 đội.

## Thay đổi

- Đưa khối **Chốt giải chính thức** lên đầu tab Thứ hạng & giải thưởng.
- Hiển thị rõ số trận còn thiếu, trạng thái sẵn sàng và trạng thái đã chốt.
- Khi lưu hồ sơ quốc gia, cập nhật tên nước, mã, cờ và châu lục cho các danh
  sách tham dự World Cup 48 và knockout 32 chưa chốt.
- Giữ nguyên ID đội, nhánh đấu, tỷ số, hạt giống và dữ liệu giải đã chốt.
- Nếu một giải đã có cầu thủ khác đại diện cùng quốc gia, bỏ qua giải đó và
  cảnh báo để tránh ghi đè sai.
- Quốc gia/cầu thủ mới tự xuất hiện trong danh sách chọn của cả hai loại giải.

Không thay đổi cấu trúc MySQL và không cần chạy SQL.
