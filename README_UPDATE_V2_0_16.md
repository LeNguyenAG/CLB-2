# Football Rank Manager v2.0.16

## Tính năng định giá cầu thủ tự động

Giá cầu thủ không còn được nhập thủ công khi tạo hồ sơ. Cầu thủ mới luôn bắt đầu ở `0 đ`; sau khi có trận đấu, điểm hoặc danh hiệu đã xác nhận, hệ thống tính giá sàn từ `10.000.000 đ` và không đặt trần cứng.

Điểm định giá gồm:

- Rating trung bình và phong độ 5 trận gần nhất.
- Bàn thắng, kiến tạo, giữ sạch lưới, cứu thua và chỉ số đóng góp riêng theo vị trí.
- MVP đội, MVP trận và điểm xếp hạng.
- Danh hiệu cá nhân, thành tích World Cup 48 và giải quốc gia đặc biệt 32.
- Huy chương tập thể đã nhân hệ số cống hiến; người ít thi đấu/ít đóng góp chỉ nhận phần giá trị nhỏ.
- Điểm kỷ luật và dao động thị trường giới hạn `±1,75%` mỗi kỳ.

Giá sàn được dùng đồng bộ cho:

- Phí chuyển nhượng có phí.
- Lương hợp đồng mới hoặc lương sửa đổi.
- Lương hợp đồng đang hoạt động: tự nâng lên sàn nếu kỳ định giá mới cao hơn; không tự giảm nếu giá cầu thủ giảm.

## Cập nhật dự án

1. Sao lưu database.
2. Chạy `APPLY_UPDATE.cmd` trong gói UPDATE và nhập đường dẫn thư mục dự án hiện tại.
3. Trong MySQL Workbench/phpMyAdmin, chọn đúng database đang chạy website.
4. Chạy `UPDATE_V2_0_16_AUTOMATIC_PLAYER_VALUATION.sql`.
5. Kết quả cuối phải là `AUTOMATIC_PLAYER_VALUATION_V2_0_16_READY`.
6. Deploy lại cả backend và frontend, sau đó nhấn `Ctrl + F5`.

Migration v2.0.16 không ghi cố định `USE football_rank_manager`, nên dùng được cả database online tên `defaultdb`. Database phải hoàn tất v2.0.15 trước; nếu chưa, file sẽ dừng với thông báo rõ và không xóa dữ liệu.

Sau khi cập nhật, đăng nhập FIFA Admin → **Cầu thủ** → **Làm mới định giá**. Từ các lần sau, hệ thống cũng tự tạo một kỳ định giá khi đóng mùa giải.
