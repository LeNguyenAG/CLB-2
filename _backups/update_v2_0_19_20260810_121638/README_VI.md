# Football Rank Manager 2.0.20

Phiên bản đầy đủ giữ toàn bộ quản lý CLB, cầu thủ, ví tiền, chuyển nhượng, sân vận động, giải CLB, World Cup 48, giải quốc gia 32 đội, danh hiệu, định giá và bảng xếp hạng.

## Cập nhật 2.0.20

- Tự dùng lại logo và thông số của mùa gần nhất khi tạo giải cùng hệ.
- Tự xếp 8 hạt giống quốc gia và 4 hạt giống CLB theo thành tích.
- Bỏ nhập hạt giống thủ công; hiển thị huy hiệu S1–S8/S1–S4 trên giao diện.

## Cập nhật 2.0.19

- Làm lại màn hình FIFA Admin chọn 32 quốc gia, có lọc quốc gia, cầu thủ/CLB và châu lục.
- Tự ẩn khu vực đủ suất, tự mở lại khi bỏ đại diện.
- Đồng bộ châu lục theo thư viện quốc gia chuẩn ở cả frontend, backend và database.
- Chia 32 suất theo dữ liệu nội bộ: 60% số quốc gia hợp lệ + 40% số quốc gia trong nhóm xếp hạng mạnh; chỉ dùng 6 châu lục và không dùng suất ngoài đời.
- Không cấp suất vượt số quốc gia hợp lệ; không bốc thăm bằng danh sách chưa lưu hoặc hạn ngạch cũ.
- Xem README_UPDATE_V2_0_18.md để cập nhật.

## Điểm mới nổi bật

- Mỗi cầu thủ đại diện một quốc gia.
- 48 quốc gia, 12 bảng A–L, mỗi bảng 4 đội.
- Bốc thăm theo 4 pot hoặc ngẫu nhiên hoàn toàn.
- 72 trận vòng bảng tự sinh.
- Tự chọn 12 nhất bảng, 12 nhì bảng và 8 hạng ba tốt nhất.
- Tự tạo nhánh 32 đội và tránh tái đấu cùng bảng.
- Tự đẩy đội thắng qua vòng 16, tứ kết, bán kết và chung kết.
- Có trận tranh hạng ba.
- HCV/HCB/HCĐ World Cup cộng điểm BXH cầu thủ và có thể kèm tiền thưởng.
- Danh hiệu cá nhân do Admin FIFA trao.
- Điểm thưởng khi hạ đương kim vô địch hoặc á quân kỳ trước.
- Giao diện World Cup riêng với ánh sao, globe, podium và nhánh đấu phát sáng.

Xem hướng dẫn đầy đủ tại:

```text
README_UPDATE_V2_0_6.md
```

## Nâng cấp database hiện tại

1. Sao lưu database.
2. Mở và chạy toàn bộ `UPDATE_V2_0_6_WORLD_CUP.sql` trong MySQL Workbench.
3. Không chạy lại `database.sql` trên database có dữ liệu thật.
4. Chạy source 2.0.6 bằng `START_ALL.cmd`.
5. Chạy `CHECK_ALL.cmd` để kiểm tra.

## Cài mới

1. Chạy `database.sql` trong MySQL Workbench.
2. Chạy:

```cmd
SETUP_FIRST_TIME.cmd
START_ALL.cmd
```

## Địa chỉ mặc định

- Frontend: `http://localhost:5173`
- Backend: `http://127.0.0.1:3000/api`
- Health: `http://127.0.0.1:3000/api/health`

## Tài khoản mẫu khi cài mới

```text
Admin FIFA: admin_fifa / Admin@123
CLB mẫu: dragon_fc / Club@123
```

## Sân vận động 2.0.9

Sau khi chạy `UPDATE_V2_0_9_STADIUM_ECONOMY.sql`, đăng nhập và vào **Sân vận động** trong Portal để tạo sân, thuê sân, nâng cấp, random doanh thu và nhận lời mời tài trợ. Trang công khai `/stadiums` hiển thị thư viện sân của toàn hệ thống.

## Cập nhật 2.0.13

- Giảm mạnh hiệu ứng nền và blur để tránh lag.
- Bỏ ripple, magnetic hover, card tilt và ánh sáng theo chuột.
- Bảng giao diện đã sửa lớp phủ, bấm ổn định hơn.
- Chỉ còn 3 mức độ mượt rõ ràng: Tắt, Nhẹ, Mượt vừa đủ.
- Giữ mô hình sân vận động 3D, nhưng bỏ phần lớn animation liên tục.
- Chuyển trang và nút bấm dùng hiệu ứng trượt ngắn, nhẹ.

## Cập nhật 2.0.12

- Motion Director cho toàn bộ nút bấm, thẻ, tab và chuyển trang.
- Bảng độ mượt rõ ràng với Tắt, Tiết kiệm, Mượt 60 FPS và Điện ảnh.
- Tùy chỉnh cường độ cực quang, chiều sâu 3D và hiệu ứng nút.
- StadiumArena được dựng lại thành mô hình CSS 3D tương tác.

## Cập nhật 2.0.10

Xem `README_UPDATE_V2_0_10.md` để cài hệ thống kiểm định sân theo từng trận.


## Tính năng v2.0.14

- Chấm điểm cầu thủ tự động theo vị trí và thống kê trận đấu.
- MVP đội, MVP trận và BXH hiệu suất toàn giải.
- Danh tiếng, người hâm mộ và sức mạnh thương mại của CLB/cầu thủ.
- Sự kiện thương mại ngẫu nhiên, vật phẩm có chữ ký và thưởng FIFA cuối mùa.

Xem `README_UPDATE_V2_0_14.md` để cập nhật hệ thống hiện có.

## Tính năng v2.0.15

- Giải quốc gia đặc biệt 32 đội loại trực tiếp với cầu thủ đại diện từng quốc gia.
- Hạn ngạch châu lục theo tỷ lệ, bốc thăm hạt giống và tránh cùng liên đoàn.
- Điểm cầu thủ tách cấp CLB/cấp quốc gia nhưng vẫn có BXH tổng thể.
- World Cup 48 cộng điểm cho toàn bộ hạng 1–32 và các đội tiến vào tứ kết.
- Tiền thưởng FIFA tự cấu hình, danh hiệu cá nhân tự động và kiểm soát trả trùng.

Xem `README_UPDATE_V2_0_15.md` và chạy `UPDATE_V2_0_15_NATIONAL_TOURNAMENTS.sql` khi nâng cấp database hiện có.

## Tính năng v2.0.16

- Giá sàn cầu thủ tự động theo năng lực và phong độ, không nhập giá ban đầu bằng tay.
- Cầu thủ mới có giá 0; giá đã chứng minh bắt đầu từ 10 triệu đồng và không có trần cứng.
- Hệ số ưu tiên rating, bàn thắng, kiến tạo, MVP và đóng góp theo vị trí; huy chương tập thể chỉ chiếm phần nhỏ đã điều chỉnh theo cống hiến.
- Tính cả điểm và thành tích ở CLB, World Cup 48 và giải quốc gia đặc biệt 32.
- Nút **Làm mới định giá**, mũi tên xanh/đỏ, số tiền tăng/giảm và bộ lọc giá cao xuống thấp.
- Lương hợp đồng và phí chuyển nhượng có phí phải từ giá sàn trở lên; được phép trả cao hơn.

Xem `README_UPDATE_V2_0_16.md` và chạy `UPDATE_V2_0_16_AUTOMATIC_PLAYER_VALUATION.sql` sau khi database đã hoàn tất v2.0.15.
