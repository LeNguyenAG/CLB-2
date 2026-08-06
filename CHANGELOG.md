# Changelog

## 2.0.16 — Automatic Player Valuation & Market Floor

- Định giá toàn bộ cầu thủ theo rating, phong độ gần đây, bàn thắng, kiến tạo, đóng góp theo vị trí, MVP và điểm xếp hạng.
- Tính cả World Cup 48 và giải quốc gia đặc biệt 32; thành tích quốc gia có hệ số uy tín riêng.
- Huy chương tập thể được nhân hệ số cống hiến để cầu thủ “hưởng ké” không vượt cầu thủ gánh đội.
- Cầu thủ mới giữ giá 0; khi có dữ liệu xác nhận, giá tối thiểu bắt đầu từ 10 triệu và không đặt trần cứng.
- Mỗi kỳ định giá có dao động thị trường giới hạn ±1,75%, lịch sử tăng/giảm và ảnh chụp công thức.
- Tự nâng lương hợp đồng đang hoạt động lên giá sàn khi định giá tăng; hợp đồng mới và phí chuyển nhượng không được thấp hơn sàn.
- Thêm lọc giá cao/thấp, tăng/giảm, bảng chi tiết hệ số và tự định giá khi đóng mùa giải.

## 2.0.15 — National Special 32 & Dual-Scope Player Ranking

- Thêm giải quốc gia đặc biệt 32 đội loại trực tiếp, đủ hạng 1–32.
- Chia suất châu lục theo tỷ lệ Hamilton từ thư viện quốc gia hiện tại.
- Bốc thăm có/không hạt giống, tách hạt giống mạnh và tránh cùng liên đoàn tối đa.
- Thêm tiền thưởng FIFA tự cấu hình, điểm tiến sâu cân bằng và danh hiệu cá nhân tự động.
- Tách điểm cầu thủ `CLUB`/`NATIONAL_TEAM`; giữ BXH tổng thể gộp cả hai.
- Thêm BXH đội tuyển và bộ lọc vinh danh Tổng hợp/Cấp CLB/Cấp quốc gia.
- World Cup 48 chốt đủ hạng 1–32, cộng điểm tứ kết/vòng 16/vòng 32 và backfill kỳ cũ.
- Khóa sửa tỷ số/reset sau khi đã chi thưởng để ngăn thanh toán trùng.

## 2.0.14 — Performance Rating, Influence & Fan Economy

- Chấm điểm cầu thủ 1–10 theo vị trí và thống kê trận đấu đã xác nhận.
- Tự xác định cầu thủ hay nhất đội, hay nhất trận và BXH hiệu suất giải.
- Cộng điểm BXH cá nhân theo rating, MVP và hệ số giải.
- Bổ sung danh tiếng, fan, truyền thông, thương mại và động lượng CLB.
- Bổ sung độ nổi tiếng, khả năng quảng cáo và hệ số vật phẩm chữ ký cho cầu thủ.
- Thêm sự kiện thương mại ngẫu nhiên, chiến dịch vật phẩm và thưởng sức ảnh hưởng FIFA.
- Thêm trang Portal/Public cho hệ thống sức ảnh hưởng.
- Đồng bộ sức hút CLB với Stadium Economy và tự tính lại sau khi kết thúc giải.

# 2.0.13 — Smooth Lite Performance Patch

- Bỏ Motion Director theo dõi chuột, ripple, magnetic hover, card tilt và lens glow.
- Giảm cực quang xuống một lớp gradient nhẹ và giới hạn blur kính.
- Sửa bảng điều khiển giao diện bằng z-index/pointer-events rõ ràng để nút bấm hoạt động ổn định.
- Rút bảng độ mượt còn 3 mức: Tắt hiệu ứng, Nhẹ và Mượt vừa đủ.
- Dùng chuyển trang dạng trượt ngắn, không dùng blur.
- Giữ sân vận động 3D nhưng bỏ xoay theo chuột và hầu hết animation chạy liên tục.
- Không thay đổi database, Backend API hoặc dữ liệu hiện có.

# 2.0.12 — Fluid Interaction Engine & 3D Stadium Experience

- Bổ sung Motion Director dùng requestAnimationFrame để tạo ripple, phản hồi nhấn, magnetic hover và độ nghiêng 3D có kiểm soát.
- Làm lại bảng độ mượt thành 4 hồ sơ rõ ràng: Tắt, Tiết kiệm, Mượt 60 FPS và Điện ảnh.
- Thêm thanh chỉnh cường độ ánh sáng/cực quang, chiều sâu 3D và công tắc hiệu ứng nút bấm.
- Tăng độ rõ của cực quang bằng nhiều dải ánh sáng, sao, lens glow và horizon light; tự giảm lớp hiệu ứng ở máy yếu.
- Làm lại StadiumArena thành mô hình CSS 3D có bowl, khán đài nhiều tầng, mái, đèn pha, bảng điểm, LED, sân cỏ và góc nhìn tương tác.
- Chuẩn hóa animation nút, input, tab, menu, card và chuyển trang bằng transform/opacity để giảm cảm giác giật.
- Không thay đổi database, Backend API, ví, giải đấu hoặc dữ liệu hiện có.

# 2.0.8 — Smart Awards & Global Flags

- Tự cộng thống kê từng trận theo toàn giải và đề cử khách quan: Cầu thủ xuất sắc, Vua phá lưới, Vua kiến tạo, Thủ môn xuất sắc.
- Chỉ sử dụng dữ liệu trận đấu đã được FIFA xác nhận; cảnh báo độ phủ trước khi chốt.
- Khi kết thúc giải, hệ thống tự trao danh hiệu đủ điều kiện và tự cộng điểm BXH cầu thủ.
- Thêm Trung tâm danh hiệu tự động với đề cử, chỉ số thắng và quy tắc minh bạch.
- Thêm danh mục 250+ quốc gia/đội tuyển song ngữ Việt–Anh trong MySQL.
- Nhập tên nước bằng tiếng Việt hoặc English để tự nhận mã thi đấu, liên đoàn và cờ.
- Dùng mô hình lai: metadata quốc gia lưu cục bộ, ảnh cờ tải theo URL chuẩn và có emoji dự phòng.
- Cho phép nhiều cầu thủ cùng gắn một quốc gia; mỗi kỳ World Cup vẫn chỉ chọn một đại diện.
- Giữ nguyên Football Pulse, đội hình cố định CLB, World Cup 48, huy chương, ví và dữ liệu cũ.

# 2.0.7 — Football Pulse

- Thêm trang công khai **Nhịp đập bóng đá** tự làm mới mỗi 45 giây.
- Tự tổng hợp kết quả, chuyển nhượng, danh hiệu, nhà vô địch và các cú sốc.
- Thêm bảng phong độ 5 trận gần nhất cho CLB.
- Thêm khu vực kỷ lục sống: vua phá lưới, kiến tạo, danh hiệu, giá trị, tài sản và CLB thành công nhất.
- Thêm danh sách trận sắp diễn ra và biến động giá cầu thủ.
- Không thay đổi database và không ảnh hưởng chức năng World Cup, CLB, ví, BXH hoặc giải cũ.

# Changelog

## 2.0.6

- Bổ sung chế độ giải **World Cup 48 quốc gia**; mỗi cầu thủ đại diện một quốc gia.
- Tự chia 48 quốc gia vào 12 bảng A–L, mỗi bảng 4 đội và sinh 72 trận vòng bảng.
- Hỗ trợ bốc thăm theo 4 pot hạt giống với ràng buộc liên đoàn hoặc ngẫu nhiên hoàn toàn.
- Tự xếp hạng 12 đội hạng ba và chọn 8 đội tốt nhất theo điểm, hiệu số, bàn thắng, số trận thắng và hạt giống.
- Tự tạo nhánh 32 đội theo chế độ hạt giống hoặc ngẫu nhiên; cả hai đều tránh tái đấu cùng bảng.
- Tự đẩy đội thắng qua vòng 16, tứ kết, bán kết, tranh hạng ba và chung kết.
- Bổ sung HCV/HCB/HCĐ World Cup, điểm BXH cầu thủ, tiền thưởng và danh hiệu cá nhân đội tuyển.
- Bổ sung điểm thưởng khi đánh bại đương kim vô địch hoặc á quân kỳ World Cup trước.
- Bổ sung hồ sơ quốc gia cố định của cầu thủ và chặn trùng quốc gia/mã quốc gia.
- Tạo giao diện World Cup riêng với ba chủ đề, ánh sao, globe, podium, Giant Killers, bảng hạng ba và nhánh phát sáng.
- Thêm kiểm tra thuật toán tự động cho 48 đội, 12 bảng, 72 trận và ghép vòng 32.

## 2.0.5

- Xác định **đội hình cố định của CLB** từ toàn bộ cầu thủ đang hoạt động hoặc được rao bán của CLB.
- Khi FIFA thêm CLB vào giải, Backend tự động chép toàn bộ đội hình CLB vào `competition_rosters`.
- Khi CLB thêm cầu thủ mới, kích hoạt lại cầu thủ, chuyển nhượng hoặc thanh lý, danh sách các giải đang mở được đồng bộ tự động.
- Cảnh báo rõ CLB chưa đủ số cầu thủ tối thiểu; mặc định là 11 và có thể đổi trong `system_settings`.
- FIFA chỉ thêm CLB và xem đội hình; CLB tự quản lý, đồng bộ hoặc loại bớt cầu thủ khỏi danh sách riêng của giải.
- Khi kết thúc giải, HCV/HCB/HCĐ được tự động trao cho toàn bộ cầu thủ thuộc đội hình giải.
- Thêm chức năng bổ sung huy chương hồi tố cho từng giải hoặc toàn bộ giải đã kết thúc.
- File `UPDATE_V2_0_5.sql` tự nâng cấp database hiện tại và tự bổ sung huy chương còn thiếu cho các giải cũ.

## 2.0.9 — Stadium Economy & Sponsorship

- Sửa lỗi collation 1271 còn dang dở trong migration 2.0.8.
- Thêm nhiều sân/CLB, sân sở hữu, thuê và dùng chung.
- Thêm Stadium Rating, phân hạng C/B/A/Elite/World Class.
- Thêm mô phỏng ngày thi đấu, vé thường, VIP, dịch vụ và bãi xe.
- Thêm 0–4 lời mời tài trợ theo sức hút trận và xung đột ngành hàng.
- Thêm 28 thương hiệu mô phỏng và 10 gói nâng cấp sân.
- Thêm ghi sổ tài chính cho doanh thu, tài trợ, chi phí, thuê và nâng cấp sân.
- Thêm giao diện Stadium Center và thư viện sân công khai với animation.

## 2.0.10 — Stadium Compliance & Venue Intelligence

- Tách cấp sân và tiêu chuẩn tổ chức từng trận thành hai hệ thống riêng.
- Thêm 6 bộ tiêu chuẩn sân và cấu hình theo giải/giai đoạn/vòng đấu.
- Thêm kiểm định ELIGIBLE, CONDITIONAL và NOT_ELIGIBLE.
- Thêm VAR, goal-line, LED, điện dự phòng, media center và trung tâm y tế.
- Thêm chọn sân theo trận, khóa sân không đạt, ngoại lệ FIFA có ghi lý do.
- Thêm gợi ý sân thay thế, thuê nhanh, lợi nhuận dự kiến và gói nâng cấp còn thiếu.
- Thêm giao diện Venue Intelligence với animation radar, scanner và trạng thái kiểm định.
- Sửa file database cài mới: loại bỏ CHECK xung đột khóa ngoại World Cup và tên constraint bị trùng.

## 2.0.11 — Visual Motion & Theme Studio
- Thêm bảng tùy biến giao diện dùng chung cho trang công khai và Portal.
- 6 bảng màu cao cấp và màu chủ đạo tùy chỉnh bằng color picker.
- Chế độ sáng, tối và đồng bộ giao diện hệ điều hành.
- 4 phông nền: Cực quang, Đèn sân, Carbon và Tối giản.
- 4 mức chuyển động: Tắt, Nhẹ, Mượt và Sống động.
- 3 mức hiệu ứng kính; lưu lựa chọn lâu dài trên thiết bị.
- Thêm chuyển trang mượt, ambient lighting, stadium beams, cursor glow và micro-interactions.
- Tự tôn trọng thiết lập giảm chuyển động của hệ điều hành.
