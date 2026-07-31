# Football Rank Manager Backend

Backend **Node.js + Express + MySQL** dành cho website quản lý CLB, cầu thủ, ví tiền, chuyển nhượng, giải đấu, vòng bảng, nhánh đấu, danh hiệu và bảng xếp hạng.

Mã nguồn được chia gọn thành 3 file route lớn thay vì tách controller/model/router cho từng bảng:

```text
football-rank-backend/
├── server.js
├── src/
│   ├── db.js
│   ├── auth.js
│   ├── routes-core.js
│   ├── routes-football.js
│   └── routes-competitions.js
├── database/
│   └── football_rank_manager_full_v3.sql
├── scripts/
│   ├── schema-sync-check.js
│   └── smoke-test.js
├── vue-example/
│   ├── src/services/api.js
│   └── vite.config.example.js
├── .env.example
└── package.json
```

## 1. Yêu cầu

- Node.js 20 trở lên.
- MySQL Server 8.0.16 trở lên.
- Database `football_rank_manager` đã cài từ file SQL V3.
- MySQL Workbench chỉ là giao diện quản lý; MySQL Server phải đang chạy.

## 2. Cài đặt

Mở CMD/PowerShell tại thư mục backend:

```bash
npm install
copy .env.example .env
```

Mở `.env` và sửa:

```env
DB_USER=root
DB_PASSWORD=mat_khau_mysql_cua_ban
DB_NAME=football_rank_manager
JWT_SECRET=mot_chuoi_bi_mat_dai_va_kho_doan
```

Chạy kiểm tra code và đồng bộ schema:

```bash
npm run check
npm run schema-check
```

Khởi động backend:

```bash
npm run dev
```

API mặc định chạy tại:

```text
http://localhost:3000/api
```

Kiểm tra:

```text
GET http://localhost:3000/api/health
```

## 3. Tài khoản mẫu

Admin FIFA:

```text
username: admin_fifa
password: Admin@123
```

Tài khoản CLB mẫu:

```text
username: dragon_fc
password: Club@123
```

Các mật khẩu mẫu trong database dùng `SHA256_DEMO`. Khi người dùng đổi mật khẩu qua API, backend tự chuyển sang `BCRYPT`.

## 4. Nguyên tắc dữ liệu tiền

Các trường tiền MySQL dùng `DECIMAL(20,0)`. Backend trả số tiền dưới dạng **chuỗi** để không mất độ chính xác của JavaScript.

Ví dụ request đúng:

```json
{
  "amount": "500000000",
  "transaction_type": "WITHDRAWAL",
  "direction": "DEBIT",
  "note": "Cầu thủ yêu cầu rút tiền trực tiếp"
}
```

Không cập nhật trực tiếp `wallets.balance`. Mọi thay đổi số dư phải qua stored procedure và tạo lịch sử giao dịch.

## 5. Đăng nhập Vue

```js
import { login, api } from './services/api';

const session = await login('admin_fifa', 'Admin@123');
console.log(session.user);

const dashboard = await api('/dashboard');
console.log(dashboard.data);
```

Sao chép file:

```text
vue-example/src/services/api.js
```

vào dự án Vue. Có thể dùng file `vite.config.example.js` để proxy `/api` sang Express.

## 6. Định dạng phản hồi

Thành công:

```json
{
  "success": true,
  "data": {},
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100
  }
}
```

Thất bại:

```json
{
  "success": false,
  "error": {
    "message": "Nội dung lỗi",
    "code": null,
    "details": null
  }
}
```

## 7. API chính

### Xác thực

| Method | API | Quyền |
|---|---|---|
| POST | `/auth/register-club` | Công khai |
| POST | `/auth/login` | Công khai |
| GET | `/auth/me` | Đã đăng nhập |
| PUT | `/auth/password` | Đã đăng nhập |

### Dashboard, mùa giải và CLB

| Method | API | Quyền |
|---|---|---|
| GET | `/dashboard` | Admin/CLB |
| GET | `/seasons` | Công khai |
| POST | `/seasons` | Admin |
| PATCH | `/seasons/:id` | Admin |
| POST | `/seasons/:id/activate` | Admin |
| POST | `/seasons/:id/close` | Admin |
| GET | `/clubs` | Admin/CLB |
| POST | `/clubs` | Admin |
| PATCH | `/clubs/:id` | Admin/CLB sở hữu |
| POST | `/clubs/:id/approval` | Admin |
| PUT | `/clubs/:id/account` | Admin |

### Ví tiền

| Method | API | Quyền |
|---|---|---|
| GET | `/wallets` | Admin/CLB |
| GET | `/wallets/:id` | Admin/CLB sở hữu |
| GET | `/wallets/:id/transactions` | Admin/CLB sở hữu |
| POST | `/wallets/:id/actions` | Admin |
| POST | `/wallet-transactions/:id/reverse` | Admin |
| PATCH | `/wallets/:id/status` | Admin |
| GET | `/finance/summary` | Admin |

### Cầu thủ và ban huấn luyện

| Method | API | Quyền |
|---|---|---|
| GET | `/public/players` | Công khai |
| GET | `/public/players/:id` | Công khai |
| GET | `/players` | Công khai/Admin/CLB |
| POST | `/players` | Admin/CLB |
| PATCH | `/players/:id` | Admin/CLB sở hữu |
| POST | `/players/:id/market-value` | Admin |
| POST | `/players/:id/release` | Admin/CLB sở hữu |
| POST | `/player-contracts` | Admin/CLB |
| PATCH | `/player-contracts/:id` | Admin/CLB sở hữu |
| GET | `/staff` | Admin/CLB |
| POST | `/staff` | Admin/CLB |
| PATCH | `/staff/:id` | Admin/CLB sở hữu |
| GET | `/salary-payments` | Admin/CLB |

### Chuyển nhượng

| Method | API | Quyền |
|---|---|---|
| GET | `/transfer-offers` | Admin/CLB liên quan |
| POST | `/transfer-offers` | Admin/CLB mua |
| PATCH | `/transfer-offers/:id/status` | Admin/CLB liên quan |
| POST | `/transfer-offers/:id/complete` | Admin |
| GET | `/transfers/history` | Công khai/Admin/CLB |

### Giải đấu

| Method | API | Quyền |
|---|---|---|
| GET | `/competition-series` | Công khai |
| POST | `/competition-series` | Admin |
| GET | `/competitions` | Công khai/Admin/CLB |
| GET | `/competitions/:id` | Công khai/Admin/CLB |
| POST | `/competitions` | Admin |
| PATCH | `/competitions/:id` | Admin |
| POST | `/competitions/:id/participants` | Admin/CLB |
| PATCH | `/competition-participants/:id` | Admin |
| PUT | `/competitions/:id/rosters/:clubId` | Admin/CLB sở hữu |

### Vòng bảng

| Method | API | Quyền |
|---|---|---|
| GET | `/competitions/:id/groups` | Công khai |
| PUT | `/competitions/:id/groups` | Admin |
| POST | `/competitions/:id/groups/generate-matches` | Admin |
| GET | `/competitions/:id/standings` | Công khai |
| POST | `/competitions/:id/groups/finalize` | Admin |

### Nhánh đấu

| Method | API | Quyền |
|---|---|---|
| GET | `/competitions/:id/bracket` | Công khai |
| POST | `/competitions/:id/bracket` | Admin |
| PUT | `/competitions/:id/pairing-rules` | Admin |
| POST | `/competitions/:id/pairing-rules/auto-cross` | Admin |
| POST | `/competitions/:id/bracket/seed-from-groups` | Admin |
| POST | `/competitions/:id/bracket/seed-participants` | Admin |
| POST | `/matches/:id/teams` | Admin |

Nhánh hỗ trợ:

```text
2, 4, 8, 16, 32, 64 và 128 đội
```

`seed-participants` có ba chế độ:

```text
SEED         Theo seed_no
RANDOM       Xáo ngẫu nhiên
MANUAL_ORDER Theo thứ tự club_ids Admin gửi lên
```

### Trận đấu và thống kê cầu thủ

| Method | API | Quyền |
|---|---|---|
| GET | `/competitions/:id/matches` | Công khai |
| PATCH | `/matches/:id` | Admin |
| POST | `/matches/:id/result` | Admin |
| POST | `/matches/:id/reset` | Admin |
| GET | `/matches/:matchId/player-stats` | Công khai |
| PUT | `/matches/:matchId/player-stats/:playerId` | Admin/CLB sở hữu |
| POST | `/player-match-stats/:id/verify` | Admin |

CLB nhập thống kê ở trạng thái `PENDING`. Admin xác nhận thành `VERIFIED`; khi kết thúc giải, hệ thống khóa thành `LOCKED`.

### Tiền thưởng và kết thúc giải

| Method | API | Quyền |
|---|---|---|
| PUT | `/competitions/:id/prize-rules` | Admin |
| PUT | `/competitions/:id/special-reward-rule` | Admin |
| PUT | `/competitions/:id/results` | Admin |
| POST | `/competitions/:id/results/derive-knockout` | Admin |
| GET | `/competitions/:id/upset-rewards` | Công khai |
| POST | `/competitions/:id/finalize` | Admin |

`finalize` tự động:

- Chuyển tiền thưởng giải từ ví FIFA sang ví CLB.
- Cộng điểm hệ số CLB.
- Ghi thành tích và huy chương CLB.
- Chuyển tiền thưởng đánh bại đương kim vô địch/á quân.
- Tạo ảnh chụp bảng xếp hạng CLB.

### Danh hiệu và xếp hạng

| Method | API | Quyền |
|---|---|---|
| GET | `/award-types` | Công khai |
| POST | `/award-types` | Admin |
| POST | `/player-awards` | Admin/CLB |
| POST | `/competitions/:id/lock-player-awards` | Admin |
| GET | `/rankings/clubs` | Công khai |
| GET | `/rankings/players` | Công khai |
| GET | `/rankings/player-value-changes` | Công khai |
| POST | `/rankings/snapshot` | Admin |

Ví dụ bảng xếp hạng cầu thủ:

```text
GET /rankings/players?category=OVERALL
GET /rankings/players?category=GOALS
GET /rankings/players?category=GOALKEEPER
GET /rankings/players?category=WEALTH
GET /rankings/players?category=MARKET_VALUE
GET /rankings/players?category=OVERALL&club_id=1
```

Snapshot theo CLB để hiển thị mũi tên tăng/giảm trong nội bộ đội:

```json
POST /rankings/snapshot
{
  "season_id": 2,
  "entity": "PLAYER",
  "club_id": 1
}
```

## 8. Quy trình test nhanh

Sau khi server đang chạy:

```bash
npm run smoke
```

Script sẽ kiểm tra:

- Kết nối API và MySQL.
- Đăng nhập Admin FIFA.
- Dashboard.
- Mùa giải.
- Xếp hạng CLB.
- Xếp hạng cầu thủ.
- Danh sách giải đấu.

Kết quả cuối đúng:

```text
SMOKE_TEST_OK
```

## 9. Trình tự sử dụng giải đấu

```text
1. Tạo mùa giải
2. Tạo hệ giải và giải đấu
3. Thêm/duyệt CLB tham dự
4. Đăng ký cầu thủ cho từng CLB
5. Chia bảng
6. Tạo lịch vòng bảng
7. Admin nhập tỷ số
8. CLB nhập thống kê cầu thủ
9. Admin xác nhận thống kê
10. Chốt vòng bảng
11. Tạo nhánh đấu
12. Xếp cặp tự động hoặc nhập tay
13. Nhập kết quả loại trực tiếp
14. Tạo kết quả chung cuộc
15. Kết thúc giải
16. CLB phân bổ huy chương tập thể cho cầu thủ
17. Admin khóa danh hiệu
18. Kết thúc toàn bộ mùa để trả lương
```

## 10. Lưu ý triển khai thật

- Đổi `JWT_SECRET`.
- Đổi mật khẩu mẫu.
- Chỉ cho phép domain Vue thật trong `CORS_ORIGINS`.
- Không mở MySQL trực tiếp ra Internet.
- Sao lưu database trước khi kết thúc giải hoặc kết thúc mùa.
- Ảnh logo/cầu thủ nên lưu trên Cloudinary/S3 hoặc thư mục tĩnh; MySQL chỉ lưu URL.
