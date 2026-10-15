# 發佈到 GitHub

repo 已建立:`Novie131/smart-agent-route`

---

## 推上去

在專案目錄(`~/smart-agent-route`)的終端機:

```bash
git add -A
git commit -m "smart-agent-route v0.8.0"
git push
```

repo 是 clone 下來的,`.git` 與 remote 都已設定好,不需要再 `git init` 或 `git remote add`。

---

## 驗證別人裝得起來

在**另一台機器**或另一個目錄:

```
/plugin marketplace add Novie131/smart-agent-route
/plugin install smart-agent-route@smart-agent-route
/reload-plugins
/context
```

Custom Agents 應出現 `worker`、`worker-hard`、`bulk`、`librarian`、`harvester`。

`smart-agent-route@smart-agent-route` 前面是 plugin 名稱、後面是**市集名稱**(`marketplace.json` 的 `name` 欄位)。兩者剛好同名,也和 repo 名稱相同,但 repo 名稱不影響安裝指令。

---

## repo 結構

```
smart-agent-route/
├── .claude-plugin/
│   └── marketplace.json      ← 市集目錄,必須在 repo 根目錄
├── plugins/
│   └── smart-agent-route/        ← plugin 本體
│       ├── .claude-plugin/plugin.json
│       ├── agents/
│       ├── skills/
│       ├── hooks/
│       └── templates/
├── docs/
│   ├── spec.md               ← 架構設計與實作附錄
│   ├── 部署安裝.md
│   └── 發佈到-GitHub.md
├── claude-memory/            ← 記憶庫。已被 .gitignore 排除
├── install.sh                ← 不用 marketplace 的安裝方式
├── README.md
└── LICENSE
```

`marketplace.json` 用 `"source": "./plugins/smart-agent-route"` 指向 plugin,兩者的相對位置不能亂動。

---

## 更新版本

1. 改 `plugins/smart-agent-route/.claude-plugin/plugin.json` 的 `version`
2. **同時改** `.claude-plugin/marketplace.json` 裡對應的 `version`
3. commit、push

使用者端更新:

```
/plugin marketplace update
```

**兩個 version 欄位不同步是最常見的錯誤** —— 使用者會收不到更新,而且沒有錯誤訊息,你不會發現。

檢查是否同步:

```bash
grep -h '"version"' .claude-plugin/marketplace.json plugins/smart-agent-route/.claude-plugin/plugin.json
```

---

## 發佈前驗證

```bash
claude plugin validate .                        # 驗證 marketplace
claude plugin validate ./plugins/smart-agent-route  # 驗證 plugin
```

加 `--strict` 把警告當錯誤。目前兩者皆通過 `--strict`。

---

## 之後想上官方社群市集

送審後任何人都搜得到,但要過安全掃描與人工審核,通過後會釘在特定 commit。

提交表單:

- Console(個人開發者):`platform.claude.com/plugins/submit`
- claude.ai(需 Team/Enterprise 且有目錄管理權限):`claude.ai/admin-settings/directory/submissions/plugins/new`

**建議自己實際用過一陣子再送。** 審核通過後改版要重跑流程,而這個 plugin 目前還沒經過長期使用驗證。
