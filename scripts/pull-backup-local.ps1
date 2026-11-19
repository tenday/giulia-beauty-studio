param(
  [switch]$Fresh,
  [string]$OutDir = (Join-Path $env:USERPROFILE 'Backups\giulia-beauty-studio'),
  [string]$SshKey = (Join-Path $env:USERPROFILE '.ssh\id_ed25519_github_deploy'),
  [string]$RemoteHost = 'giulusyu@199.188.200.110',
  [int]$Port = 21098
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
}

if ($Fresh) {
  Write-Host "[1/3] Generazione backup MySQL fresco sul server..."
  & ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i $SshKey -p $Port $RemoteHost "bash ~/giulia-beauty-studio/scripts/server-backup.sh manual"
  if ($LASTEXITCODE -ne 0) { throw "Generazione backup remoto fallita." }
}

Write-Host "[2/3] Ricerca ultimo dump MySQL sul server..."
$latestPath = (& ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i $SshKey -p $Port $RemoteHost "ls -1t ~/backups/mysql/*/*.sql.gz 2>/dev/null | head -n 1").Trim()
if (-not $latestPath) {
  throw "Nessun backup trovato in ~/backups/mysql/ sul server. Riprova con -Fresh."
}

$fileName = [System.IO.Path]::GetFileName($latestPath)
$localFile = Join-Path $OutDir $fileName
$localSha = "$localFile.sha256"

Write-Host "[3/3] Download off-site di $fileName in $OutDir..."
& scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i $SshKey -P $Port "${RemoteHost}:${latestPath}" $localFile
if ($LASTEXITCODE -ne 0) { throw "Download SCP del dump fallito." }

& scp -o BatchMode=yes -o StrictHostKeyChecking=accept-new -i $SshKey -P $Port "${RemoteHost}:${latestPath}.sha256" $localSha 2>$null
if ((Test-Path $localSha)) {
  $expected = ((Get-Content -Raw $localSha).Trim() -split '\s+')[0].ToLower()
  $actual = (Get-FileHash -Path $localFile -Algorithm SHA256).Hash.ToLower()
  if ($expected -ne $actual) {
    Remove-Item $localFile -Force
    throw "Verifica SHA-256 FALLITA! Atteso=$expected Attuale=$actual"
  }
  Write-Host "SHA-256 OK ($actual)"
}

$sizeKb = [Math]::Round((Get-Item $localFile).Length / 1KB, 1)
Write-Host "OFFSITE_BACKUP_OK file=$localFile size=${sizeKb}KB"
