@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "backend\package.json" (
  echo [LOI] Khong tim thay backend\package.json
  pause
  exit /b 1
)
if not exist "frontend\package.json" (
  echo [LOI] Khong tim thay frontend\package.json
  pause
  exit /b 1
)
if not exist "backend\.env" (
  echo [LOI] Chua co backend\.env. Hay chay SETUP_FIRST_TIME.cmd truoc.
  pause
  exit /b 1
)
if not exist "frontend\.env" copy /Y "frontend\.env.example" "frontend\.env" >nul
if not exist "backend\node_modules" (
  echo [LOI] Backend chua npm install. Hay chay SETUP_FIRST_TIME.cmd.
  pause
  exit /b 1
)
if not exist "frontend\node_modules" (
  echo [LOI] Frontend chua npm install. Hay chay SETUP_FIRST_TIME.cmd.
  pause
  exit /b 1
)

start "Football Rank Backend" /D "%~dp0backend" cmd /k npm run dev

echo Dang cho Backend va MySQL san sang...
set BACKEND_READY=0
for /L %%I in (1,1,20) do (
  powershell -NoProfile -Command "try { $r=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 2; if($r.StatusCode -eq 200){exit 0}else{exit 1} } catch { exit 1 }" >nul 2>&1
  if not errorlevel 1 (
    set BACKEND_READY=1
    goto :BACKEND_OK
  )
  timeout /t 1 /nobreak >nul
)

:BACKEND_OK
if "%BACKEND_READY%"=="0" (
  echo [LOI] Backend chua san sang. Xem cua so "Football Rank Backend" de doc loi MySQL.
  pause
  exit /b 1
)

echo Backend da san sang. Dang mo Frontend...
start "Football Rank Frontend" /D "%~dp0frontend" cmd /k npm run dev
timeout /t 3 /nobreak >nul
start "" http://localhost:5173

echo.
echo ============================================================
echo Backend:  http://127.0.0.1:3000/api/health
echo Frontend: http://localhost:5173
echo ============================================================
echo Giu nguyen ca hai cua so CMD dang chay.
pause
