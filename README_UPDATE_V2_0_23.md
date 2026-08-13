# Football Rank Manager v2.0.23 — Stadium Match Operations

## Nội dung chính

- Phân sân dùng chung cho trận CLB, World Cup 48 đội và giải quốc gia 32 đội.
- Thứ tự ưu tiên: FIFA chỉ định → yêu cầu CLB đã được FIFA duyệt → hệ thống tự phân công bằng.
- Chỉ chọn sân đạt chuẩn, đang hoạt động, đã hết thời gian hồi phục và không bị trùng lịch gần 18 giờ.
- Chia đều dựa trên số lần sử dụng 30 ngày gần nhất; sân tốt vẫn có lợi thế nhưng không bị dùng liên tục.
- Tự quyết toán khi FIFA nhập kết quả trận: vé thường, vé VIP, dịch vụ, bãi xe, vận hành, thiệt hại và khoản thực trả chủ sân.
- Mỗi khoản có sao kê; thanh toán vào ví CLB chủ sân đúng một lần.
- Tình trạng sân giảm sau trận, có thời gian bảo trì 8–72 giờ và tự hồi phục dần.
- Hạ nhẹ chuẩn sức chứa/chất lượng nhưng vẫn khóa các lỗi an toàn quan trọng.
- Thêm fan riêng cầu thủ; khi chuyển nhượng, một phần fan đi theo cầu thủ và phần còn lại ở lại CLB cũ.
- Hiệu ứng loa quét độ hot tại Trung tâm Sức ảnh hưởng.

## Cài đặt nhanh

### Dùng gói UPDATE

1. Giải nén gói update.
2. Bấm `APPLY_UPDATE_V2_0_23.cmd`.
3. Nếu chương trình không tự tìm thấy dự án, dán đường dẫn thư mục dự án hiện tại.
4. Nhập mật khẩu MySQL khi cửa sổ MySQL yêu cầu.
5. Chạy `START_ALL.cmd` trong dự án chính.

Script tự sao lưu các file bị thay đổi vào `_backups/update_v2_0_23_<thời gian>` trước khi chép.

### Chạy SQL thủ công khi máy không tìm thấy mysql.exe

Mở MySQL Workbench, chọn database `football_rank_manager`, sau đó chạy:

`UPDATE_V2_0_23_STADIUM_MATCH_OPERATIONS.sql`

File SQL có thể chạy lại, không xóa dữ liệu sân, CLB, cầu thủ, trận, ví hoặc lịch sử cũ.

## Cách sử dụng

- FIFA: **Trung tâm sân vận động → Phân sân & sao kê → Phân sân các trận đang chờ**.
- CLB: tại **Ngày thi đấu**, chọn **Yêu cầu sân**, gửi sân mong muốn để FIFA duyệt.
- FIFA duyệt/từ chối yêu cầu trong tab **Phân sân & sao kê**.
- Sau khi nhập tỷ số, hệ thống tự quyết toán. Chọn **Xem sao kê** để xem từng khoản.
- Fan cầu thủ được cập nhật khi hoàn tất chuyển nhượng; lịch sử hiển thị tại **Sức ảnh hưởng**.

## Kiểm tra đã cập nhật

- `VERSION.txt` phải là `2.0.23`.
- API diagnostics có ba mục mới: `stadiumMatchOperations`, `stadiumOwnerStatements`, `playerFanMobility`.
- Backend: `npm run check` và `npm run schema-check`.
- Frontend: `npm run build`.
