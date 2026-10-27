$ErrorActionPreference = 'Stop'
$loanRoot = Split-Path -Parent $PSScriptRoot
$shell = New-Object -ComObject WScript.Shell
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcut = $shell.CreateShortcut((Join-Path $desktop 'บัญชีเงินกู้.lnk'))
$shortcut.TargetPath = Join-Path $loanRoot 'เปิดแอป.cmd'
$shortcut.WorkingDirectory = $loanRoot
$shortcut.WindowStyle = 7
$shortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,47"
$shortcut.Description = 'เปิดบัญชีเงินกู้'
$shortcut.Save()
Write-Host 'สร้างไอคอน "บัญชีเงินกู้" บนหน้าจอแล้ว'
