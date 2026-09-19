<#
.SYNOPSIS
    台灣股票投資助手 - Windows 一鍵安裝
.DESCRIPTION
    安裝 Hermes Agent 並設定專案環境
    設定使用 Hermes 系統使用者目錄
#>
param(
    [switch]$SkipHermes,    # 跳過 hermes 安裝（已安裝時）
    [switch]$Force          # 強制重新安裝
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  台灣股票投資助手 - 安裝程式" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# --- Step 1: 檢查/安裝 Hermes Agent ---
Write-Host "[1/4] 檢查 Hermes Agent..." -ForegroundColor Yellow

$hermesExe = $null
# 檢查是否已安裝
$hermesInPath = Get-Command hermes -ErrorAction SilentlyContinue
if ($hermesInPath -and -not $Force) {
    $hermesExe = $hermesInPath.Source
    Write-Host "  已安裝: $hermesExe" -ForegroundColor Green
} elseif (-not $SkipHermes) {
    Write-Host "  安裝 Hermes Agent..." -ForegroundColor White
    try {
        # 用子程序執行避免變數衝突
        powershell -NoProfile -Command "iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)"
        # 刷新 PATH
        $env:PATH = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
        $hermesInPath = Get-Command hermes -ErrorAction SilentlyContinue
        if ($hermesInPath) {
            $hermesExe = $hermesInPath.Source
            Write-Host "  安裝完成: $hermesExe" -ForegroundColor Green
        } else {
            # 嘗試已知路徑
            $knownPath = "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\hermes.exe"
            if (Test-Path $knownPath) {
                $hermesExe = $knownPath
                Write-Host "  安裝完成: $hermesExe" -ForegroundColor Green
            } else {
                throw "hermes 安裝後找不到執行檔"
            }
        }
    } catch {
        Write-Host "  安裝失敗: $_" -ForegroundColor Red
        Write-Host "  請手動安裝: iex (irm https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.ps1)" -ForegroundColor Yellow
        exit 1
    }
} else {
    Write-Host "  跳過 (--SkipHermes)" -ForegroundColor Gray
}

Write-Host "[2/4] 設定系統 Hermes..."
if ($hermesExe) {
    & $hermesExe setup
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
    Write-Host "請安裝 Hermes 後執行 hermes setup"
}

# --- Step 3: 安裝 Python 依賴 ---
Write-Host "[3/4] 安裝 Python 分析套件..." -ForegroundColor Yellow

$reqFile = Join-Path $ProjectRoot "requirements.txt"
if (Test-Path $reqFile) {
    # 找到 hermes 的 python/uv
    $uvExe = Get-Command uv -ErrorAction SilentlyContinue
    $pipExe = Get-Command pip -ErrorAction SilentlyContinue

    if ($uvExe) {
        # 💡 修正：如果本地有 uv，先檢查並建立虛擬環境，避免 uv pip 報錯
        $venvDir = Join-Path $ProjectRoot ".venv"
        if (-not (Test-Path $venvDir)) {
            Write-Host "  正在建立 Python 虛擬環境 (.venv)..." -ForegroundColor White
            & uv venv --quiet
        }
        & uv pip install -r $reqFile --quiet 2>&1 | Out-Null
        Write-Host "  依賴已安裝 (uv)" -ForegroundColor Green
    } elseif ($pipExe) {
        & pip install -r $reqFile --quiet 2>&1 | Out-Null
        Write-Host "  依賴已安裝 (pip)" -ForegroundColor Green
    } else {
        Write-Host "  找不到 pip/uv，請手動執行: pip install -r requirements.txt" -ForegroundColor Yellow
    }
} else {
    Write-Host "  requirements.txt 不存在，跳過" -ForegroundColor Gray
}

# --- Step 4: 建立資料目錄 ---
Write-Host "[4/4] 初始化環境..." -ForegroundColor Yellow

$dataDir = Join-Path $ProjectRoot "data"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}

# Windows shell 設定：run.ps1 會透過 HERMES_GIT_BASH_PATH 環境變數指定 Git Bash
# 不寫入 config.yaml，保持跨平台相容

Write-Host "  完成" -ForegroundColor Green

# --- 完成 ---
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  安裝完成！" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "啟動方式:" -ForegroundColor White
Write-Host "  .\run.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "或單次查詢:" -ForegroundColor White
Write-Host "  .\run.ps1 -Query `"查台積電股價`"" -ForegroundColor Cyan
Write-Host ""

