#!/usr/bin/env bash
# 台灣股票投資助手 - 啟動腳本 (Linux/macOS)
# 用法:
#   ./run.sh              # 互動模式
#   ./run.sh "查台積電股價"  # 單次查詢

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT" || exit 1

# 確認 hermes 存在
HERMES_EXE=""
if command -v hermes &>/dev/null; then
    HERMES_EXE="hermes"
elif [ -x "$HOME/.local/bin/hermes" ]; then
    HERMES_EXE="$HOME/.local/bin/hermes"
elif [ -x "$HOME/.hermes/hermes-agent/venv/bin/hermes" ]; then
    HERMES_EXE="$HOME/.hermes/hermes-agent/venv/bin/hermes"
else
    echo "hermes 未安裝，請先執行: ./setup.sh"
    exit 1
fi

if [ -n "$1" ]; then
    # 單輪退出可能中止非同步委派，改依角色規範循序執行
    "$HERMES_EXE" chat -q "$1" -t "terminal,skills,web" -Q
else
    # 互動模式
    "$HERMES_EXE" chat -t "terminal,skills,web,delegation"
fi
