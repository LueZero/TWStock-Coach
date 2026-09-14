<#
.SYNOPSIS
    台灣股票投資助手 - Windows 一鍵安裝
.DESCRIPTION
    安裝 Hermes Agent 並設定專案環境
    所有設定存在專案的 .hermes/ 目錄下
#>
param(
    [switch]$SkipHermes,    # 跳過 hermes 安裝（已安裝時）
    [switch]$Force          # 強制重新安裝
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot
$ProjectHermesDir = Join-Path $ProjectRoot ".hermes"

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

if (-not $hermesExe) {
    $knownPath = "$env:LOCALAPPDATA\hermes\hermes-agent\venv\Scripts\hermes.exe"
    if (Test-Path $knownPath) {
        $hermesExe = $knownPath
    } else {
        Write-Host "  找不到 Hermes 執行檔，無法安裝分析套件" -ForegroundColor Red
        exit 1
    }
}

# --- Step 2: 設定 .hermes/.env ---
Write-Host "[2/4] 設定 API Token..." -ForegroundColor Yellow

$envFile = Join-Path $ProjectHermesDir ".env"
if (-not (Test-Path $envFile)) {
    $ghToken = $null
    try {
        $candidateToken = (gh auth token 2>$null).Trim()
        if ($candidateToken -match '^gho_') {
            $ghToken = $candidateToken
        }
    } catch {}

    if ($ghToken) {
        "GITHUB_TOKEN=$ghToken" | Set-Content $envFile -Encoding UTF8
        Write-Host "  已設定 GitHub Copilot OAuth token" -ForegroundColor Green
    } else {
        Copy-Item (Join-Path $ProjectHermesDir ".env.example") $envFile
        Write-Host "  已建立 .hermes/.env（需手動填入 API key）" -ForegroundColor Yellow
        Write-Host "  編輯: $envFile" -ForegroundColor Yellow
    }
} else {
    Write-Host "  .env 已存在，跳過" -ForegroundColor Green
}

# --- Step 3: 安裝 Python 依賴 ---
Write-Host "[3/4] 安裝 Python 分析套件..." -ForegroundColor Yellow

$reqFile = Join-Path $ProjectRoot "requirements.txt"
if (Test-Path $reqFile) {
    $hermesPython = Join-Path (Split-Path $hermesExe) "python.exe"
    if (-not (Test-Path $hermesPython)) {
        Write-Host "  找不到 Hermes Python: $hermesPython" -ForegroundColor Red
        exit 1
    }
    & $hermesPython -m pip install -r $reqFile --quiet
    Write-Host "  依賴已安裝 (Hermes Python)" -ForegroundColor Green
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

if (-not (Test-Path $envFile) -or -not (Get-Content $envFile | Select-String "^[A-Z_]+=.+$").Count) {
    Write-Host "⚠️  記得設定 API key: 編輯 .hermes/.env" -ForegroundColor Yellow
}

