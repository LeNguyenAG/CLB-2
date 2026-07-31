@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist .env (
  copy .env.example .env >nul
  echo Đã tạo file .env. Hãy mở .env và nhập DB_PASSWORD trước khi tiếp tục.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Đang cài thư viện...
  call npm install
  if errorlevel 1 (
    echo Cài thư viện thất bại.
    pause
    exit /b 1
  )
)

call npm run dev
