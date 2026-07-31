@echo off
setlocal
cd /d "%~dp0"

echo ============================================================
echo FOOTBALL RANK MANAGER 2.0.14 - KIEM TRA DONG BO
ECHO ============================================================

echo.
echo [1/7] Kiem tra cu phap Backend...
call npm --prefix backend run check || goto :FAIL

echo.
echo [2/7] Doi chieu Backend voi database.sql...
call npm --prefix backend run schema-check || goto :FAIL

echo.
echo [3/7] Kiem tra cong thuc cham diem cau thu...
call npm --prefix backend run performance-test || goto :FAIL

echo.
echo [4/7] Kiem tra thuat toan World Cup 48...
call npm --prefix backend run world-cup-test || goto :FAIL

echo.
echo [5/7] Kiem tra cau truc Frontend...
call npm --prefix frontend run check || goto :FAIL

echo.
echo [6/7] Doi chieu API Frontend voi route Backend...
set BACKEND_DIR=%~dp0backend
call npm --prefix frontend run sync-check || goto :FAIL

echo.
echo [7/7] Kiem tra runtime Public API, dang nhap, JWT va Dashboard...
call npm --prefix frontend run smoke || goto :FAIL

echo.
echo ============================================================
echo KIEM TRA THANH CONG: Frontend - Backend - MySQL dong bo.
echo ============================================================
pause
exit /b 0

:FAIL
echo.
echo ============================================================
echo KIEM TRA THAT BAI. Doc dong loi ngay phia tren.
echo ============================================================
pause
exit /b 1
