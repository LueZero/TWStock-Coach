#!/usr/bin/env bash
# 台灣股票投資助手 - Linux/macOS/WSL2 一鍵安裝
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"

echo ""
echo "================================================"
echo "  台灣股票投資助手 - 安裝程式"
echo "================================================"
echo ""

# --- Step 1: 檢查/安裝 Hermes Agent ---
echo "[1/4] 檢查 Hermes Agent..."

if command -v hermes &>/dev/null && [ "$1" != "--force" ]; then
    echo "  已安裝: $(which hermes)"
else
    echo "  安裝 Hermes Agent..."
    curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
    # 重新載入 PATH
    export PATH="$HOME/.local/bin:$PATH"
    source ~/.bashrc 2>/dev/null || source ~/.zshrc 2>/dev/null || true
    if command -v hermes &>/dev/null; then
        echo "  安裝完成: $(which hermes)"
    else
        echo "  ⚠️  安裝後找不到 hermes，請重新開啟 terminal 或執行: source ~/.bashrc"
        exit 1
    fi
fi

echo "[2/4] 設定系統 Hermes..."
hermes setup

# --- Step 3: 安裝 Python 依賴 ---
echo "[3/4] 安裝 Python 分析套件..."

REQ_FILE="$PROJECT_ROOT/requirements.txt"
if [ -f "$REQ_FILE" ]; then
    if command -v uv &>/dev/null; then
        uv pip install -r "$REQ_FILE" --quiet 2>/dev/null
        echo "  依賴已安裝 (uv)"
    elif command -v pip &>/dev/null; then
        pip install -r "$REQ_FILE" --quiet 2>/dev/null
        echo "  依賴已安裝 (pip)"
    else
        echo "  ⚠️  找不到 pip/uv，請手動執行: pip install -r requirements.txt"
    fi
fi

# --- Step 4: 初始化環境 ---
echo "[4/4] 初始化環境..."

mkdir -p "$PROJECT_ROOT/data"

echo "  完成"

# --- 完成 ---
echo ""
echo "================================================"
echo "  安裝完成！"
echo "================================================"
echo ""
echo "啟動方式:"
echo "  ./run.sh"
echo ""
echo "或單次查詢:"
echo "  ./run.sh \"查台積電股價\""
echo ""
