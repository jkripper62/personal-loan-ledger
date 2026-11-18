param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$loanRoot = Split-Path -Parent $PSScriptRoot
$loanData = Join-Path $loanRoot '.data'
$loanEntry = Join-Path $loanRoot 'server-dist\server\index.js'
$loanPort = if ($env:PORT) { $env:PORT } else { '4310' }
$loanUrl = "http://127.0.0.1:$loanPort"
if (-not (Test-Path -LiteralPath $loanEntry)) { throw 'App build is missing. Run npm.cmd install and npm.cmd run build in this project.' }
$loanNode = Join-Path $loanRoot '.runtime\node.exe'
if (-not (Test-Path -LiteralPath $loanNode)) {
  $loanNode = (Get-Command node.exe -ErrorAction Stop).Source
}
function Test-LoanServer {
  try { $loanHealth = Invoke-RestMethod -Uri "$loanUrl/api/health" -TimeoutSec 2; return ($loanHealth.ok -eq $true -and $loanHealth.app -eq 'personal-loan-ledger') } catch { return $false }
}
if (-not (Test-LoanServer)) {
  New-Item -ItemType Directory -Path $loanData -Force | Out-Null
  $loanArgs = @('--disable-warning=ExperimentalWarning', ('"' + $loanEntry + '"'))
  $loanProc = Start-Process -FilePath $loanNode -ArgumentList $loanArgs -WorkingDirectory $loanRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $loanData 'server-output.log') -RedirectStandardError (Join-Path $loanData 'server-error.log')
  Set-Content -LiteralPath (Join-Path $loanData 'server.pid') -Value $loanProc.Id -Encoding ascii
  for ($loanAttempt = 0; $loanAttempt -lt 40; $loanAttempt++) { if (Test-LoanServer) { break }; if ($loanProc.HasExited) { break }; Start-Sleep -Milliseconds 250; $loanProc.Refresh() }
  if (-not (Test-LoanServer)) { throw "App could not start. Read $loanData\server-error.log" }
}
if (-not $NoBrowser) { Start-Process -FilePath $loanUrl }
