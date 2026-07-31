# Football Rank Manager Frontend 2.0

Frontend Vue 3 được xây mới và đồng bộ với Backend Express tại `http://127.0.0.1:3000/api`.

## Chạy riêng Frontend

```cmd
copy .env.example .env
npm install
npm run dev
```

Backend phải đang chạy tại cổng 3000.

## Kiểm tra

```cmd
npm run check
npm run sync-check
npm run smoke
```

`sync-check` cần thư mục `backend` nằm cạnh thư mục `frontend`, như trong bộ đầy đủ.
