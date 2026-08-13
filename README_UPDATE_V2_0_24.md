# Football Rank Manager v2.0.24 — Stadium Search & Automatic Sponsorship

## Nội dung

- Bộ lọc trận đấu theo sân, giải, đội/đội tuyển, mùa, cấp trận, ngày, giá trị, quảng cáo, thương hiệu, tiêu chuẩn và cách phân sân.
- Thẻ tổng quan sân lấy dữ liệu từ hệ thống vận hành chung nên bao gồm trận CLB, World Cup và giải quốc gia.
- Sau khi một sân được phân vào giải, hệ thống tự tạo 1–4 đề nghị quảng cáo cho CLB sở hữu sân.
- Thương hiệu từng được CLB chấp nhận được cộng điểm ưu tiên; lịch sử từ chối cũng được tính để tránh đề xuất lặp thiếu thực tế.
- CLB nhận hoặc từ chối. Khoản đã nhận chỉ được trả vào ví khi giải kết thúc, có lịch sử và chống thanh toán trùng.
- Luồng random quảng cáo từng trận cũ được giữ ở backend để tương thích nhưng không còn hiển thị cho CLB.

## Cập nhật database hiện có

Chạy `UPDATE_V2_0_24_STADIUM_SEARCH_AUTO_SPONSOR.sql` trên database `football_rank_manager`. Migration có thể chạy lại và không xóa dữ liệu cũ.

Sau khi cập nhật source, khởi động lại backend và build/deploy lại frontend.

## Kích hoạt cho trận đã phân sân trước v2.0.24

FIFA mở **Trung tâm sân vận động → Phân sân & sao kê** rồi bấm **Phân sân & đề xuất quảng cáo**. Hệ thống giữ nguyên sân đã xếp và chỉ bổ sung đề nghị còn thiếu.
