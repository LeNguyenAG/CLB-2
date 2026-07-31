@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Dang cai thu vien Frontend...
  call npm install
  if errorlevel 1 pause & exit /b 1
)
if not exist .env copy /Y .env.example .env >nul
echo Frontend se chay tai http://localhost:5173
call npm run dev
