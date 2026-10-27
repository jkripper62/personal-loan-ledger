$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$loanRoot = Split-Path -Parent $PSScriptRoot
$loanPort = if ($env:PORT) { $env:PORT } else { '4310' }

Write-Host ''
Write-Host '=== ตั้งค่าใช้แอปบนมือถือผ่าน Tailscale ===' -ForegroundColor Green
Write-Host ''

# 1. Tailscale must be installed and signed in on this PC.
$tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
$tailscalePath = if ($tailscale) { $tailscale.Source } else { Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe' }
if (-not (Test-Path -LiteralPath $tailscalePath)) {
  Write-Host 'ยังไม่ได้ติดตั้ง Tailscale บนคอมเครื่องนี้' -ForegroundColor Yellow
  Write-Host '1) กำลังเปิดหน้าดาวน์โหลด ติดตั้งแล้วเข้าสู่ระบบ (ใช้บัญชี Google ได้)'
  Write-Host '2) ติดตั้งแอป Tailscale บนมือถือ แล้วเข้าสู่ระบบด้วยบัญชีเดียวกัน'
  Write-Host '3) ดับเบิลคลิกไฟล์นี้อีกครั้ง'
  Start-Process 'https://tailscale.com/download/windows'
  exit 1
}
$status = & $tailscalePath status --json | ConvertFrom-Json
if ($status.BackendState -ne 'Running') {
  Write-Host 'Tailscale ยังไม่ได้เข้าสู่ระบบ เปิดแอป Tailscale (ไอคอนมุมขวาล่าง) แล้วกด Log in จากนั้นดับเบิลคลิกไฟล์นี้อีกครั้ง' -ForegroundColor Yellow
  exit 1
}
$phoneHost = $status.Self.DNSName.TrimEnd('.').ToLower()
if (-not $phoneHost) { throw 'อ่านชื่อเครื่องจาก Tailscale ไม่ได้ ตรวจว่าเปิด MagicDNS ในหน้า admin ของ Tailscale แล้ว' }

# 2. Publish the app to this tailnet only, over HTTPS. The app itself keeps listening on 127.0.0.1.
Write-Host "เปิดการเชื่อมต่อแบบปลอดภัยสำหรับ https://$phoneHost ..."
& $tailscalePath serve --bg $loanPort
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'Tailscale ต้องเปิดใช้ HTTPS ก่อน: เปิดลิงก์ที่แสดงด้านบน กด Enable แล้วดับเบิลคลิกไฟล์นี้อีกครั้ง' -ForegroundColor Yellow
  exit 1
}

# 3. Allow exactly this address in .env, keeping every other setting.
$envFile = Join-Path $loanRoot '.env'
if (-not (Test-Path -LiteralPath $envFile)) { Copy-Item -LiteralPath (Join-Path $loanRoot '.env.example') -Destination $envFile }
$lines = @(Get-Content -LiteralPath $envFile -Encoding UTF8 | Where-Object { $_ -notmatch '^ALLOWED_HOSTS=' })
$lines += "ALLOWED_HOSTS=$phoneHost"
[IO.File]::WriteAllLines($envFile, $lines, (New-Object Text.UTF8Encoding $false))

# 4. Restart the app so it reads the new address.
& (Join-Path $PSScriptRoot 'stop.ps1')
& (Join-Path $PSScriptRoot 'launch.ps1') -NoBrowser

$url = "https://$phoneHost/"
Set-Clipboard -Value $url
Write-Host ''
Write-Host 'เสร็จแล้ว!' -ForegroundColor Green
Write-Host "เปิดลิงก์นี้บนมือถือ (คัดลอกไว้ให้แล้ว ส่งเข้า LINE ตัวเองได้): $url" -ForegroundColor Cyan
Write-Host 'แล้วกดแชร์ > เพิ่มไปยังหน้าจอโฮม เพื่อให้มีไอคอนแอปบนมือถือ'
Write-Host 'มือถือต้องเปิดแอป Tailscale ไว้ และคอมต้องเปิดอยู่'
Write-Host ''
