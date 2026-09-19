<#
.SYNOPSIS
    台灣股票投資助手 - 啟動腳本 (Windows)
.PARAMETER Query
    單次查詢模式（不進互動）
.PARAMETER Tools
    指定工具集，預設 terminal,skills,web,delegation
.EXAMPLE
    .\run.ps1
    .\run.ps1 -Query "查台積電股價"
    .\run.ps1 -Query "分析 2330 技術指標" -Tools "terminal,skills,web,delegation"
#>
param(
    [string]$Query,
    [string]$Tools = "terminal,skills,web,delegation"
)

$ProjectRoot = $PSScriptRoot
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

if ($Query) {
    # 單次查詢模式
    # 單輪退出可能中止非同步子代理；單次查詢採角色規範循序執行。
    $queryTools = (($Tools -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "delegation" }) -join ",")
    & $hermesExe chat -q $Query -t $queryTools -Q
} else {
    # 互動模式
    & $hermesExe chat -t $Tools
}
exit $LASTEXITCODE
