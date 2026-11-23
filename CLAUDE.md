# 家教排課 App

給家教老師一個人在 iPhone 上用的排課 app。它是一個靜態網頁，老師透過 Safari 的「加入主畫面」安裝成 PWA。

- 完整規格：`SPEC.md`
- 訊息分析的測試例句：`docs/parser-cases.md`（共 120 條，全部要通過）

## 技術限制（一定要遵守）
- **純靜態網頁**：只用 HTML、CSS 和原生 JavaScript（可以用 ES modules）。不用框架，不需要建置步驟，不用 npm 套件，也不載入外部 CDN（要能離線使用）。
- **部署在 GitHub Pages**：網址是 `https://<帳號>.github.io/tutor-app/`。所有路徑都用相對路徑，不要寫死成 `/` 開頭。
- **資料只存在手機上**：用 localStorage（單一 key：`tutorApp.v1`），啟動時呼叫 `navigator.storage.persist()`。資料不送到任何伺服器。
- **iPhone 優先**：
  - 寬度以 375–430px 為主
  - 處理 safe-area（`viewport-fit=cover`、`env(safe-area-inset-*)`）
  - 加上 `apple-touch-icon`（180×180 png）和 `apple-mobile-web-app-capable`
  - 輸入框字級至少 16px，避免 iOS 自動放大畫面
- **日期一律用當地時間（Asia/Taipei）的 `YYYY-MM-DD` 字串**：不要用 `new Date('YYYY-MM-DD')`，因為它會被當成 UTC 解析。一週從星期一開始，程式內 `wd`：0＝一 … 6＝日。
- **分析引擎 `js/parser.js` 必須是純函式模組**：不碰 DOM 或 localStorage，「現在時間」由參數傳入。這樣才能用 `node --test` 跑測試。
- **介面文字一律用繁體中文（台灣用語）**。

## 檔案結構（建議）
```
index.html
manifest.webmanifest
sw.js
css/style.css
js/app.js        # 畫面、路由、事件
js/store.js      # 資料讀寫、備份還原、資料版本遷移
js/schedule.js   # 由固定課表與異動算出某一週的課
js/parser.js     # 訊息分析（純函式）
icons/           # 180、192、512 px
tests/parser.test.js
```

## 開發習慣
- 每完成一個里程碑（見 SPEC.md 第 10 節）就 commit 一次，commit 訊息用中文寫清楚。
- 修改 parser 後執行 `node --test tests/`，確認全部通過。
- service worker：HTML 和 JS 採「網路優先、離線退回快取」，這樣更新才會生效。每次發版都要更新 `sw.js` 裡的版本號。
