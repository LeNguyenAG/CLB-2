# Football Rank Manager v2.0.15
## Giải quốc gia đặc biệt 32 đội & bảng xếp hạng hai phạm vi

Phiên bản này bổ sung một chế độ giải cấp quốc gia mới, đồng thời tách rõ điểm cầu thủ ở cấp CLB và cấp đội tuyển mà không làm mất dữ liệu cũ.

## 1. Giải quốc gia đặc biệt 32 đội

- FIFA Admin tạo trực tiếp từ **Portal → Giải đấu → Tạo giải**.
- Admin tự nhập 32 quốc gia đã vượt qua vòng loại bên ngoài hệ thống.
- Mỗi quốc gia luôn đi cùng một cầu thủ đại diện.
- Thi đấu loại trực tiếp từ vòng 32, vòng 16, tứ kết, bán kết, tranh hạng ba và chung kết.
- Hệ thống tự đẩy đội thắng sang vòng sau và đưa hai đội thua bán kết vào trận tranh hạng ba.
- Kết thúc giải sẽ chốt đủ thứ hạng 1–32.

### Suất theo châu lục

32 suất được chia theo phương pháp tỷ lệ Hamilton dựa trên số quốc gia đang hoạt động trong `country_catalog` tại thời điểm tạo giải:

- Châu lục có nhiều quốc gia nhận nhiều suất hơn.
- Châu lục có ít quốc gia nhận ít suất hơn.
- Mỗi liên đoàn đang có quốc gia được bảo đảm ít nhất một suất.
- Admin có thể tính lại hạn ngạch trước khi bốc thăm.
- Hệ thống không cho bốc thăm nếu số đội của từng liên đoàn chưa đúng hạn ngạch.

### Bốc thăm

- **Hạt giống + tránh cùng châu lục:** nếu có hạt giống, 16 đội nhóm trên không gặp nhau ở vòng 32; các cặp cùng liên đoàn được tránh tối đa.
- **Ngẫu nhiên + tránh cùng châu lục:** dùng khi không có hạt giống; vẫn tối ưu để giảm số cặp cùng liên đoàn.
- Hạt giống cao được phân tách trên hai nửa nhánh để hạn chế gặp sớm.
- Nếu cấu trúc 32 đội khiến việc tránh hoàn toàn là bất khả thi, giao diện thông báo đúng số cặp cùng liên đoàn còn lại.

## 2. Hệ số điểm cân bằng

Giải đặc biệt mặc định hệ số **1,5**, nằm giữa giải CLB thông thường và World Cup mặc định **2,0**.

| Thành tích | Điểm cơ bản | Điểm với hệ số 1,5 |
|---|---:|---:|
| Vô địch | 100 | 150 |
| Á quân | 70 | 105 |
| Hạng ba | 50 | 75 |
| Hạng tư | 38 | 57 |
| Mỗi đội vào tứ kết | 28 | 42 |
| Mỗi đội vào vòng 16 | 16 | 24 |
| Mỗi đội dự vòng 32 | 6 | 9 |

Điểm cơ bản được khóa trong giao diện để bảo vệ cân bằng toàn hệ thống. FIFA Admin được tự đặt tiền thưởng cho từng mốc; số tiền của một khoảng hạng là tiền cho **mỗi cầu thủ** trong khoảng đó.

## 3. Danh hiệu cá nhân tự động

Khi chốt giải, hệ thống tự xác định và trao:

- Cầu thủ xuất sắc nhất giải: 35 điểm cơ bản.
- Vua phá lưới: 28 điểm cơ bản.
- Thủ môn xuất sắc: 24 điểm cơ bản; chỉ xét cầu thủ có vị trí GK.

Quy tắc xét toàn bộ trận đã hoàn tất, bàn thắng của đội tuyển, số trận thắng, sạch lưới, bàn thua, thứ hạng chung cuộc, hạt giống và ID để phá hòa ổn định.

## 4. Hai phạm vi xếp hạng cầu thủ

Mỗi dòng trong `player_ranking_points` có `ranking_scope`:

- `CLUB`: điểm cầu thủ đạt được ở giải CLB.
- `NATIONAL_TEAM`: điểm khi đại diện quốc gia ở World Cup hoặc giải 32 đội.

Trang **BXH → Đội tuyển** chỉ tính thành tích quốc gia. Thứ tự ưu tiên là HCV → HCB → HCĐ → tổng điểm quốc gia → danh hiệu cá nhân. BXH **Tổng thể** vẫn gộp toàn bộ điểm CLB và quốc gia.

Trang **Đại sảnh vinh danh** có ba chế độ: Tổng hợp, Cấp CLB và Cấp quốc gia. Nhờ đó ví dụ cầu thủ có nhiều HCV CLB vẫn đứng cao ở tổng hợp, nhưng cầu thủ có HCV quốc gia sẽ đứng trên người chỉ có HCB quốc gia khi chuyển sang phạm vi quốc gia.

## 5. World Cup 48 được đồng bộ

- Toàn bộ điểm World Cup được đánh dấu `NATIONAL_TEAM` nhưng vẫn tự động đi vào điểm tổng thể.
- Khi chốt World Cup mới, hệ thống tạo đủ hạng 1–32.
- Điểm World Cup mặc định: 120/80/55/40/30/18/8 trước hệ số cho vô địch, á quân, hạng ba, hạng tư, tứ kết, vòng 16 và vòng 32.
- Migration tự bổ sung kết quả và điểm tiến sâu cho các World Cup cũ đã chốt nếu dữ liệu nhánh còn đầy đủ.
- Danh hiệu cá nhân tự động của World Cup được ghi đúng phạm vi quốc gia.

## 6. An toàn tài chính và dữ liệu

- Tiền chỉ được chuyển khi FIFA chốt giải.
- Backend khóa ví FIFA và từng ví cầu thủ trong transaction.
- Nếu quỹ FIFA không đủ, toàn bộ thao tác được hoàn tác.
- Giải đã chi thưởng không thể reset hoặc sửa tỷ số, ngăn trả tiền trùng.
- Giải chưa chốt có thể reset nhánh; danh sách 32 đại diện và cấu hình tiền thưởng được giữ lại.
- Mọi thao tác tạo giải, tính hạn ngạch, lưu đội, bốc thăm, nhập tỷ số, sửa thưởng, reset và chốt giải đều ghi audit.

## Cách cập nhật database đang chạy

1. Sao lưu database online.
2. Mở `UPDATE_V2_0_15_NATIONAL_TOURNAMENTS.sql` trong MySQL Workbench.
3. Chạy toàn bộ bằng `Ctrl + Shift + Enter`.
4. Dòng cuối phải trả về `NATIONAL_TOURNAMENTS_V2_0_15_READY`.
5. Không chạy lại `database.sql` trên database đang có dữ liệu.

## Cập nhật mã nguồn

Giải nén gói update và chạy `APPLY_UPDATE.cmd`.

- Script tự tìm dự án ở các đường dẫn phổ biến hoặc dùng đường dẫn đã lưu từ lần trước.
- Nếu chưa xác định được, script chỉ hỏi đường dẫn một lần rồi lưu vào `TARGET_PROJECT_PATH.txt`.
- `.env`, `node_modules`, `dist` và dữ liệu cá nhân không bị ghi đè.
- Script tạo thư mục sao lưu các tệp bị thay đổi trước khi chép bản mới.

Sau khi cập nhật, chạy `START_ALL.cmd`, nhấn `Ctrl + F5`, rồi chạy `CHECK_ALL.cmd`.
