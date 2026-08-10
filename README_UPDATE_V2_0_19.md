# Football Rank Manager v2.0.19

## Phạm vi sửa

Chỉ sửa giải đặc biệt knockout 32 quốc gia. Không thay đổi World Cup 48, giải CLB, nhánh đấu, tỷ số, phần thưởng hoặc dữ liệu tài chính.

## Cách chia 32 suất mới

- Nguồn đội là các quốc gia có hồ sơ cầu thủ đại diện đang hoạt động trong database.
- Chỉ dùng 6 châu lục: Châu Á, Châu Phi, Bắc/Trung Mỹ & Caribe, Nam Mỹ, Châu Đại Dương và Châu Âu.
- Không đưa `OTHER/Khu vực khác` vào phép tính, API quét hoặc danh sách chọn.
- 60% trọng số theo số quốc gia hợp lệ của từng châu lục trong database.
- 40% trọng số theo số quốc gia của châu lục nằm trong top 32 `world_seed_rank` hiện tại.
- Nếu chưa có xếp hạng, 40% này tự lùi về tỷ trọng số quốc gia để hệ thống vẫn chia được công bằng.
- Phương pháp phần dư lớn nhất bảo đảm tổng đúng 32; mỗi châu lục có dữ liệu tối thiểu 1 suất và không vượt số quốc gia có thể chọn.

## Cập nhật bản local

1. Chạy `APPLY_UPDATE.cmd` trong gói update và chọn thư mục dự án chính khi được hỏi.
2. Trong MySQL Workbench, chọn đúng database local đang dùng.
3. Chạy `UPDATE_V2_0_19_NATIONAL_32_DATABASE_QUOTAS.sql` một lần. File không ghi cố định tên database và có thể chạy lại.
4. Kết quả cuối phải là `NATIONAL_32_DATABASE_QUOTAS_V2_0_19_READY`.
5. Khởi động lại backend/frontend, đăng nhập FIFA Admin, mở giải 32 quốc gia chưa bốc thăm và bấm **Tính lại**.

Migration không xóa quốc gia, cầu thủ, giải đấu, kết quả hoặc dữ liệu đang có.
