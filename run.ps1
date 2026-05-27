<#
.SYNOPSIS
    台灣股票投資助手 - 啟動腳本 (Windows)
.PARAMETER Query
    單次查詢模式（不進互動）
.PARAMETER Tools
    指定工具集，預設 terminal,skills
.EXAMPLE
    .\run.ps1
    .\run.ps1 -Query "查台積電股價"
    .\run.ps1 -Query "分析 2330 技術指標" -Tools "terminal,skills"
#>
param(
    [string]$Query,
    [string]$Tools = "terminal,skills"
)

$ProjectRoot = $PSScriptRoot
$env:HERMES_HOME = Join-Path $ProjectRoot ".hermes"
Set-Location $ProjectRoot

# Windows: 指定 Git Bash 作為 terminal shell（避免 WSL 錯誤）
$gitBash = "C:\Program Files\Git\bin\bash.exe"
if (Test-Path $gitBash) {
    $env:HERMES_GIT_BASH_PATH = $gitBash
}

# 確認 hermes 存在
$hermesExe = (Get-Command hermes -ErrorAction SilentlyContinue).Source
if (-not $hermesExe) {
    $knownPath = "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\hermes.exe"
    if (Test-Path $knownPath) {
        $hermesExe = $knownPath
    } else {
        Write-Host "hermes 未安裝，請先執行: .\setup.ps1" -ForegroundColor Red
        exit 1
    }
}

# 確認 .env 存在
if (-not (Test-Path "$env:HERMES_HOME\.env")) {
    Write-Host "API key 未設定，請先執行: .\setup.ps1" -ForegroundColor Red
    exit 1
}

if ($Query) {
    # 單次查詢模式
    & $hermesExe chat -q $Query -t $Tools -Q
} else {
    # 互動模式
    & $hermesExe
}
