# 默默 iPhone 版

## 這個 App 會做什麼

- App 裡開著你的「默默」網頁，用 Email 登入 Claude 一次後就會記住。資料、AI 聊天和同步都跟網頁版一樣。
- 網頁算好的提醒時間會交給 iPhone 排成本機通知，**App 關掉也會準時跳**，而且會同步出現在 Apple Watch 上。
- 主畫面和鎖定畫面有小工具，會顯示角色、下一個提醒和倒數時間。

提醒的排程會在每次打開 App 時更新。你在電腦或網頁新增了待辦，打開一次 iPhone App，手機就會跟著重排。

---

## 沒有 Mac 的安裝方式

整個流程是：用 GitHub 的雲端 Mac 編譯出 `PetRoom.ipa` → 在 Windows 電腦用 Sideloadly 裝到 iPhone。

### 一、在 GitHub 編譯

1. 到 https://github.com 註冊帳號，按右上角「＋」→「New repository」建一個新專案（公開或私人都可以；私人專案每月有免費的編譯時間上限，通常夠用）。
2. 在新專案頁面按「uploading an existing file」，把這個資料夾裡的**所有檔案和資料夾**拖進去上傳，再按「Commit changes」。
   - Windows 預設會隱藏 `.github` 資料夾，請在檔案總管的「檢視」裡打開「隱藏的項目」，確認 `.github` 也有一起拖進去。
3. 到專案的「Actions」分頁，會看到「編譯 iPhone App」正在執行（沒有自動開始的話，點它再按「Run workflow」）。大約 5～10 分鐘。
4. 跑完後點進那一次執行，最下面「Artifacts」下載 `PetRoom-ipa`，解壓縮會得到 `PetRoom.ipa`。

如果編譯失敗（出現紅色 ✕），點進去把錯誤訊息複製給 Claude，修好後重新上傳有改動的檔案就會再編一次。

### 二、裝到 iPhone

1. 在 Windows 電腦安裝：
   - iTunes 和 iCloud：請用 Apple 官網的版本，不要用 Microsoft Store 的版本。
   - Sideloadly：https://sideloadly.io
2. 用傳輸線把 iPhone 接上電腦，iPhone 上按「信任這部電腦」。
3. 打開 Sideloadly，把 `PetRoom.ipa` 拖進去，輸入你的 Apple ID，按「Start」。
   - Sideloadly 是第三方工具，會用你的 Apple ID 幫 App 簽名。如果不放心，可以另外申請一個免費的 Apple ID 專門拿來裝 App。
4. iPhone 上：
   - 「設定 → 隱私權與安全性 → 開發者模式」打開，手機重開機後確認。
   - 「設定 → 一般 → VPN 與裝置管理」，找到你的 Apple ID 按「信任」。
5. 打開「默默」App，允許通知。

### 三、免費 Apple ID 的限制

- **7 天要重新簽一次**，不然 App 會打不開（資料不會消失）。Sideloadly 有「自動更新」功能，電腦開著且跟手機在同一個 Wi-Fi 時會自動幫你續簽。
- 一個免費 Apple ID 最多同時裝 3 個這類 App。
- 想要長期不用續簽：可以加入 Apple 開發者計畫（每年 99 美元），之後改用 TestFlight 安裝。

---

## 第一次使用：用 Email 登入

1. 打開 App，在 Claude 的登入畫面選**用 Email 繼續**（不要用 Google，Google 不允許在 App 內嵌的網頁登入）。
2. 信裡如果有驗證碼，直接在 App 裡輸入。
3. 信裡如果只有登入連結：在郵件 App **長按連結 → 拷貝連結**，回到默默，按右下角「⋯」→「貼上登入連結」。
4. 登入後會自動回到默默。底下的狀態列出現「已同步・排好 N 則提醒」就成功了。

## 加上小工具

- **主畫面：** 長按主畫面空白處 →「編輯」→「加入小工具」→ 搜尋「默默」，有小、中兩種大小。
- **鎖定畫面：** 長按鎖定畫面 →「自訂」→ 鎖定畫面 → 加入小工具，有圓形（未完成待辦數量）、長條（下一個提醒和倒數）兩種。

## 換網址

網址寫在 `App/PetWebModel.swift` 的 `home` 那一行。
