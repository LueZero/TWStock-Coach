#!/usr/bin/env bash
# 台灣股票投資助手 - Linux/macOS/WSL2 一鍵安裝
set -e

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
HERMES_HOME="$PROJECT_ROOT/.hermes"

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

# --- Step 2: 設定 .hermes/.env ---
echo "[2/4] 設定 API Token..."

ENV_FILE="$HERMES_HOME/.env"
if [ ! -f "$ENV_FILE" ]; then
    GH_TOKEN=""
    if command -v gh &>/dev/null; then
        CANDIDATE_TOKEN=$(gh auth token 2>/dev/null || true)
        case "$CANDIDATE_TOKEN" in
            gho_*) GH_TOKEN="$CANDIDATE_TOKEN" ;;
        esac
    fi

    if [ -n "$GH_TOKEN" ]; then
        echo "GITHUB_TOKEN=$GH_TOKEN" > "$ENV_FILE"
        chmod 600 "$ENV_FILE"
        echo "  已設定 GitHub Copilot OAuth token"
    else
        cp "$HERMES_HOME/.env.example" "$ENV_FILE"
        chmod 600 "$ENV_FILE"
        echo "  已建立 .hermes/.env（需手動填入 API key）"
        echo "  編輯: $ENV_FILE"
    fi
else
    echo "  .env 已存在，跳過"
fi

# --- Step 3: 安裝 Python 依賴 ---
echo "[3/4] 安裝 Python 分析套件..."

REQ_FILE="$PROJECT_ROOT/requirements.txt"
if [ -f "$REQ_FILE" ]; then
    HERMES_PYTHON="$(dirname "$(command -v "$HERMES_EXE")")/python"
    if [ ! -x "$HERMES_PYTHON" ]; then
        echo "  找不到 Hermes Python: $HERMES_PYTHON"
        exit 1
    fi
    "$HERMES_PYTHON" -m pip install -r "$REQ_FILE" --quiet
    echo "  依賴已安裝 (Hermes Python)"
fi

# --- Step 4: 初始化環境 ---
echo "[4/4] 初始化環境..."

mkdir -p "$PROJECT_ROOT/data"

# Linux 不需要額外設定 shell（預設 bash 可用）
# 移除 config.yaml 中的 Windows shell 設定（如果存在）
if grep -q "shell:" "$HERMES_HOME/config.yaml" 2>/dev/null; then
    sed -i.bak '/shell:/d' "$HERMES_HOME/config.yaml"
    rm -f "$HERMES_HOME/config.yaml.bak"
fi

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

if [ ! -f "$ENV_FILE" ] || ! grep -q "^[A-Z_][A-Z_]*=.+" "$ENV_FILE" 2>/dev/null; then
    echo "⚠️  記得設定 API key: 編輯 .hermes/.env"
fi
