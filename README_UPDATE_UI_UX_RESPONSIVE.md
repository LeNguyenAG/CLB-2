# Cập nhật UI/UX responsive cho Football Rank Manager

## Phạm vi

- Tối ưu giao diện công khai và Portal trên máy tính, máy tính bảng, điện thoại.
- Sửa riêng trang bảng xếp hạng công khai: trên điện thoại chuyển từng dòng thành thẻ gọn, không còn ép bảng rộng 720 px.
- Danh sách dạng bảng cuộn trong khung, có tiêu đề cột cố định, không kéo trang dài vô hạn.
- Tối ưu menu mobile, lớp phủ, khóa cuộn nền và vùng bấm.
- Tối ưu toolbar, biểu mẫu, modal, khoảng cách, cỡ chữ và hiệu ứng cho màn hình nhỏ.
- Không thay đổi API, backend, database, cách tính điểm, dữ liệu hoặc phân quyền.

## Cách cập nhật dự án đang dùng

1. Giải nén gói cập nhật.
2. Chạy `APPLY_UPDATE.cmd`.
3. Nhập hoặc kéo thả thư mục gốc của dự án vào cửa sổ CMD.
4. Khởi động lại bằng `START_ALL.cmd`.

File CMD tự tạo bản sao lưu trong `_backups` trước khi chép file mới.

## Kiểm tra

- Source check: đạt.
- Vite production build: đạt.
- Không có migration SQL vì cập nhật chỉ liên quan frontend.

