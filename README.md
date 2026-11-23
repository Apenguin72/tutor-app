# 家教排課

給家教老師一個人在 iPhone 上用的排課 app（PWA）。

**網址：https://apenguin72.github.io/tutor-app/**

## 安裝到 iPhone

1. 用 Safari 打開上面的網址。
2. 點下方的「分享」按鈕 →「加入主畫面」。
3. 之後從主畫面的圖示開啟，會以全螢幕執行，沒有網路也能用。

> 資料只存在這支手機（localStorage）。刪除主畫面圖示或清除 Safari 資料，資料就會消失，請到「設定」定期備份。

## 功能

| 分頁 | 用途 |
|---|---|
| 訊息 | 貼上家長的訊息、輸入學生代號，分析出要怎麼改課（請假、改課、延後、遲到、加課、補課、停課…），回答追問後確認寫入 |
| 課表 | 週課表，點課程可以請假、改時間、延長、標記遲到；點空白格子可以加課或補課 |
| 學生 | 學生資料與每週固定時段，可匯出 CSV |
| 設定（右上角齒輪） | 顯示的星期、時間範圍、備份與還原 |

## 開發

純靜態網頁（HTML、CSS、原生 JavaScript ES modules），不需要建置步驟。

```
index.html            # 頁面骨架
manifest.webmanifest  # PWA 設定
sw.js                 # service worker（網路優先、離線退回快取）
css/style.css
js/app.js             # 路由
js/views/*.js         # 各頁畫面
js/store.js           # 資料讀寫、備份還原、版本遷移
js/schedule.js        # 由固定課表與異動算出某一週的課
js/actions.js         # 寫入異動（課表與訊息頁共用）
js/parser.js          # 訊息分析引擎（純函式）
js/commit.js          # 把分析結果寫入資料
tests/                # node --test
tools/make-icons.mjs  # 產生 app 圖示
```

- 規格：[SPEC.md](SPEC.md)、訊息分析例句：[docs/parser-cases.md](docs/parser-cases.md)
- 執行測試：`node --test`（需要 Node 20 以上）
- 本機預覽：在專案資料夾執行任一個靜態伺服器，例如 `npx serve` 或 `python -m http.server`，再打開 `http://localhost:<port>/`
- 發版時更新 `sw.js` 的 `VERSION` 和 `js/version.js` 的 `APP_VERSION`
