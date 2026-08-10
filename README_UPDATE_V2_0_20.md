# Football Rank Manager v2.0.20

## Tạo mùa giải nhanh hơn

Khi FIFA chọn một hệ giải đã từng tổ chức, form tạo giải tự lấy logo và các thông số từ mùa gần nhất. Tên giải, mùa giải và ngày thi đấu không bị sao chép để tránh dùng nhầm dữ liệu cũ.

## Hạt giống tự động

- Giải theo quốc gia: tối đa 8 hạt giống, xếp theo huy chương, điểm và danh hiệu quốc gia.
- Giải theo CLB: tối đa 4 hạt giống, xếp theo điểm và thành tích CLB.
- Admin không còn phải nhập số hạt giống.
- Ký hiệu S1, S2… xuất hiện cạnh đội ở danh sách, bảng đấu và nhánh đấu.

## Cập nhật database local

Chọn đúng database hiện tại trong MySQL Workbench rồi chạy `UPDATE_V2_0_20_SMART_CREATION_AUTO_SEEDS.sql`. File không ghi cứng tên database và có thể chạy lại an toàn.
