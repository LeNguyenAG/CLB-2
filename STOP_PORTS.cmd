@echo off
setlocal
for %%P in (3000 5173) do (
  for /f "tokens=5" %%A in ('netstat -aon ^| findstr ":%%P " ^| findstr LISTENING') do (
    echo Dang dung PID %%A tren cong %%P...
    taskkill /PID %%A /F >nul 2>nul
  )
)
echo Da giai phong cong 3000 va 5173.
pause
