# Hermes 自訂資產（版控專用）

此目錄存放本專案自製的 Hermes skills 與 plugins，**會跟著 git repo 版控**。
執行資料位於 Windows `%LOCALAPPDATA%/hermes`、Linux/macOS `~/.hermes`，或既有 `HERMES_HOME`。

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

在系統 Hermes 的 `config.yaml` 將專案 skills 絕對路徑加入 `skills.external_dirs`，保留既有項目：

```yaml
skills:
  external_dirs:
    - D:/AI/TWStock-Coach/hermes/skills
```

clone 到其他位置時，請調整路徑。

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

並在 系統 Hermes 的 `config.yaml` 的 `plugins.enabled` 加上 plugin 名稱。

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

代理人職責定義放在專案 `agents/`，此處的 skill 只作路由。多代理人啟動與交接方式見 [操作指南](../docs/agent-guide.md)。
