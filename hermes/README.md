# Hermes 自訂資產（版控專用）

此目錄存放本專案自製的 Hermes skills 與 plugins，**會跟著 git repo 版控**。
與 `.hermes/`（runtime 目錄，含 cache/sessions/bundled skills，已 gitignore）分開管理。

## 目錄結構

```
hermes/
├── skills/                  # 自訂 skills（符合 Hermes Skills Hub tap 格式）
│   └── twstock-coach/
│       └── SKILL.md
└── plugins/                 # 自訂 plugins（Python）
    └── <plugin-name>/
        ├── plugin.yaml
        └── __init__.py
```

## 給 clone 此 repo 的開發者

### 1. 啟用自訂 skills

`.hermes/config.yaml` 已設定 `skills.external_dirs` 指向本目錄，
**clone 後 hermes 啟動時會自動掃到**，無需額外動作。

驗證：在 hermes CLI 內輸入 `/skills` 應該看到 `twstock-coach`。

### 2. 啟用自訂 plugins（若有）

Project-local plugins 預設停用，啟動前先設環境變數：

```powershell
# Windows PowerShell
$env:HERMES_ENABLE_PROJECT_PLUGINS = "true"
hermes
```

```bash
# Linux/macOS
export HERMES_ENABLE_PROJECT_PLUGINS=true
hermes
```

並在 `.hermes/config.yaml` 的 `plugins.enabled` 加上 plugin 名稱。

### 3. external_dirs 路徑說明

預設使用相對路徑 `../hermes/skills`（相對於 `.hermes/` 目錄）。
若 hermes 不認相對路徑，改成絕對路徑或用環境變數：

```yaml
skills:
  external_dirs:
    - ${WORKSPACE_ROOT}/hermes/skills
```

並設定 `$env:WORKSPACE_ROOT = "d:\stock"`。

## 公開散佈（Skills Hub Tap）

本 repo 的 `hermes/skills/` 結構符合 Hermes [Skills Hub tap 格式](https://hermes-agent.nousresearch.com/docs/zh-Hans/user-guide/features/skills#發布自定義-skill-tap)。
推到 GitHub 後，其他人可直接安裝：

```bash
# 加為 tap（非預設路徑需手動編輯 ~/.hermes/.hub/taps.json 把 path 改成 hermes/skills/）
hermes skills tap add <owner>/<repo>

# 或單獨安裝某個 skill
hermes skills install <owner>/<repo>/hermes/skills/twstock-coach
```

## 新增自己的 skill

1. 在 `hermes/skills/<分類>/<skill-name>/` 建立 `SKILL.md`
2. 開頭加 YAML frontmatter（至少 `name`、`description`）
3. 重啟 hermes 即生效

模板參考 [twstock-coach/SKILL.md](skills/twstock-coach/SKILL.md)。
