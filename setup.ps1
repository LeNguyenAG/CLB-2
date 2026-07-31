$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

Write-Host '============================================================'
Write-Host 'FOOTBALL RANK MANAGER - CAI DAT LAN DAU'
Write-Host '============================================================'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Chua cai Node.js.' }
if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Khong tim thay npm.' }

$mysqlPassword = Read-Host 'Nhap mat khau MySQL cua user root'
if ([string]::IsNullOrWhiteSpace($mysqlPassword)) { throw 'Mat khau MySQL khong duoc de trong.' }
if ($mysqlPassword.Contains("`r") -or $mysqlPassword.Contains("`n")) { throw 'Mat khau MySQL khong hop le.' }

# Tuong thich voi Windows PowerShell 5.1 va .NET Framework cu.
$bytes = New-Object byte[] 48
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try {
    $rng.GetBytes($bytes)
}
finally {
    $rng.Dispose()
}
$jwtSecret = ([System.BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()

# Bao ve cac ky tu dac biet khi ghi vao tep .env.
$escapedPassword = $mysqlPassword.Replace('\\', '\\\\').Replace('"', '\"')

$backendEnv = @"
NODE_ENV=development
PORT=3000

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD="$escapedPassword"
DB_NAME=football_rank_manager
DB_CONNECTION_LIMIT=10

JWT_SECRET=$jwtSecret
JWT_EXPIRES_IN=8h

FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
"@
Set-Content -Path (Join-Path $Root 'backend\.env') -Value $backendEnv -Encoding utf8
Copy-Item (Join-Path $Root 'frontend\.env.example') (Join-Path $Root 'frontend\.env') -Force

Write-Host "`n[1/2] Dang cai thu vien Backend..."
Push-Location (Join-Path $Root 'backend')
& npm.cmd install
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm install Backend that bai.' }
Pop-Location

Write-Host "`n[2/2] Dang cai thu vien Frontend..."
Push-Location (Join-Path $Root 'frontend')
& npm.cmd install
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm install Frontend that bai.' }
Pop-Location

Write-Host "`nCAI DAT THANH CONG." -ForegroundColor Green
Write-Host 'Chay START_ALL.cmd de mo he thong.'
