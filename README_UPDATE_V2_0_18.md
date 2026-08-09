# Football Rank Manager v2.0.18

## Nội dung cập nhật

- Giao diện FIFA Admin chọn 32 đại diện theo tiến độ từng châu lục.
- Tìm riêng theo quốc gia, cầu thủ/CLB; lọc khu vực; sắp xếp theo đề xuất, hạt giống hoặc tên.
- Khu vực đủ suất tự ẩn; bỏ một đại diện sẽ mở lại đúng khu vực đó.
- API quét riêng sử dụng thư viện quốc gia chuẩn, tránh lệch tên/mã/châu lục giữa frontend và backend.
- Phân bổ 80% theo số quốc gia hợp lệ và 20% theo World Cup, chức vô địch, huy chương giải quốc gia.
- Thành tích có lợi suất giảm dần và bị giới hạn quanh tỷ lệ quy mô.
- Không bao giờ cấp số suất vượt số quốc gia khả dụng.
- Không cho bốc thăm bằng danh sách chưa lưu hoặc hạn ngạch cũ.

## Cập nhật

1. Sao lưu mã nguồn và database hiện tại.
2. Chạy APPLY_UPDATE.cmd trong gói UPDATE v2.0.18.
3. Chọn đúng database online rồi chạy UPDATE_V2_0_18_NATIONAL_32_ADMIN_EXPERIENCE.sql.
4. Kết quả cuối phải là NATIONAL_32_ADMIN_V2_0_18_READY.
5. Deploy lại backend và frontend, sau đó nhấn Ctrl+F5.
6. Với giải 32 đội chưa bốc thăm, FIFA Admin mở phần chọn đại diện và bấm Tính lại hạn ngạch.

Migration có thể chạy thẳng từ database v2.0.16 hoặc v2.0.17, không ghi cố định tên database và không xóa quốc gia, cầu thủ, giải đấu, kết quả hoặc dữ liệu tài chính.
