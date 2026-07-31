@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm run check
if errorlevel 1 pause & exit /b 1
call npm run schema-check
pause
