import Foundation
import SwiftUI
import UIKit
import WebKit
import WidgetKit
import UserNotifications

/// 網頁傳給 App 的資料
struct PetPayload: Decodable {
    struct Item: Decodable {
        let id: String
        let at: String
        let title: String
        let body: String
    }
    let v: Int
    let name: String
    let c1: String
    let img: String?
    let open: Int
    let next: Item?
    let schedule: [Item]
    struct Timer: Decodable { let mode: String; let run: Bool; let start: Double; let acc: Double; let dur: Double; let active: Bool }
    let bubble: String?
    let bubbleAt: Double?
    let line: String?
    let timer: Timer?
}

/// 避免 WKUserContentController 強參照造成記憶體循環
@MainActor
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ target: WKScriptMessageHandler) { self.target = target }
    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        target?.userContentController(c, didReceive: m)
    }
}

@MainActor
final class PetWebModel: NSObject, ObservableObject {
    static let home = URL(string: "https://claude.ai/artifact/6PUxrm536NpmWUss4AqBKr")!

    let webView: WKWebView
    let floating = FloatingPet()
    @Published var status = "載入中…"
    @Published var linked = false
    @Published var alertText: String?

    private var bridgeFrame: WKFrameInfo?
    private var lastImageHash: Int?

    /// 注入到每一個 frame：找到桌寵網頁的 __petBridge 後，把提醒排程傳回 App
    private static let bridgeJS = """
    (function(){
      if (window.__petNativeHooked) return; window.__petNativeHooked = true;
      if (!window.webkit || !window.webkit.messageHandlers || !window.webkit.messageHandlers.pet) return;
      var busy = false;
      async function push(){
        if (busy || !window.__petBridge || !window.__petBridge.native) return;
        busy = true;
        try { var d = await window.__petBridge.native(); window.webkit.messageHandlers.pet.postMessage(JSON.stringify(d)); }
        catch (e) {} finally { busy = false; }
      }
      window.__petNativePush = push;
      var n = 0, t = setInterval(function(){
        if (window.__petBridge) {
          clearInterval(t); push(); setInterval(push, 60000);
          document.addEventListener('visibilitychange', function(){ if (!document.hidden) push(); });
        } else if (++n > 90) { clearInterval(t); }
      }, 1000);
    })();
    """

    override init() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()          // 登入狀態會保留
        config.applicationNameForUserAgent = "Version/18.0 Mobile/15E148 Safari/604.1"
        config.allowsInlineMediaPlayback = true
        let controller = WKUserContentController()
        controller.addUserScript(WKUserScript(source: Self.bridgeJS, injectionTime: .atDocumentEnd, forMainFrameOnly: false))
        config.userContentController = controller

        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = true

        controller.add(WeakHandler(self), name: "pet")
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.load(URLRequest(url: Self.home))
    }

    func goHome() { webView.load(URLRequest(url: Self.home)) }

    func requestPush() {
        guard let frame = bridgeFrame else { return }
        webView.evaluateJavaScript("window.__petNativePush && window.__petNativePush(); 0", in: frame, in: .page) { _ in }
    }

    /// 從剪貼簿讀 claude.ai 的登入連結並開啟
    func pasteLoginLink() {
        let pb = UIPasteboard.general
        let url = pb.url ?? pb.string.flatMap { URL(string: $0.trimmingCharacters(in: .whitespacesAndNewlines)) }
        guard let url, let host = url.host, host == "claude.ai" || host.hasSuffix(".claude.ai") || host.hasSuffix("anthropic.com") else {
            alertText = "剪貼簿裡沒有 claude.ai 的登入連結。請先在郵件裡長按連結，選「拷貝連結」。"
            return
        }
        webView.load(URLRequest(url: url))
    }

    // MARK: - 收到網頁資料

    fileprivate func handle(_ body: Any, frame: WKFrameInfo) {
        guard let text = body as? String, let data = text.data(using: .utf8),
              let payload = try? JSONDecoder().decode(PetPayload.self, from: data) else { return }
        bridgeFrame = frame
        linked = true
        Task { await apply(payload) }
    }

    private func apply(_ p: PetPayload) async {
        let count = await scheduleNotifications(p.schedule)
        saveWidget(p)
        floating.update(p)
        let f = DateFormatter()
        f.dateFormat = "HH:mm"
        status = "已同步 \(f.string(from: Date()))・排好 \(count) 則提醒"
    }

    private func scheduleNotifications(_ items: [PetPayload.Item]) async -> Int {
        let center = UNUserNotificationCenter.current()
        let pending = await center.pendingNotificationRequests()
        center.removePendingNotificationRequests(withIdentifiers: pending.map(\.identifier).filter { $0.hasPrefix("pet-") })

        let now = Date()
        let upcoming = items
            .compactMap { item -> (PetPayload.Item, Date)? in
                guard let d = LocalTime.parse(item.at), d > now else { return nil }
                return (item, d)
            }
            .sorted { $0.1 < $1.1 }
            .prefix(60) // iOS 最多保留 64 則排程通知

        var added = 0
        for (item, date) in upcoming {
            let content = UNMutableNotificationContent()
            content.title = item.title
            content.body = item.body
            content.sound = .default
            let comps = Calendar.current.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            let request = UNNotificationRequest(identifier: "pet-" + item.id, content: content,
                                                trigger: UNCalendarNotificationTrigger(dateMatching: comps, repeats: false))
            do { try await center.add(request); added += 1 } catch {}
        }
        return added
    }

    private func saveWidget(_ p: PetPayload) {
        let info = WidgetInfo(name: p.name, color: p.c1, openCount: p.open,
                              nextTitle: p.next?.title, nextBody: p.next?.body,
                              nextDate: p.next.flatMap { LocalTime.parse($0.at) }, updated: Date())
        info.save()

        // 只在立繪換掉時才重寫圖片；小工具的圖要縮小，否則會顯示不出來
        if let img = p.img, img.hashValue != lastImageHash {
            lastImageHash = img.hashValue
            if let comma = img.firstIndex(of: ","), img[..<comma].contains(";base64"),
               let data = Data(base64Encoded: String(img[img.index(after: comma)...])),
               let image = UIImage(data: data) {
                let maxSide: CGFloat = 500
                let scale = min(1, maxSide / max(image.size.width, image.size.height))
                let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                let format = UIGraphicsImageRendererFormat()
                format.scale = 1
                let small = UIGraphicsImageRenderer(size: size, format: format).image { _ in
                    image.draw(in: CGRect(origin: .zero, size: size))
                }
                try? small.pngData()?.write(to: SharedStore.imageURL, options: .atomic)
            } else {
                try? FileManager.default.removeItem(at: SharedStore.imageURL) // 預設角色：小工具用內建圖示
            }
        }
        WidgetCenter.shared.reloadAllTimelines()
    }
}

// MARK: - WebKit delegates

extension PetWebModel: WKScriptMessageHandler {
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        handle(message.body, frame: message.frameInfo)
    }
}

extension PetWebModel: WKNavigationDelegate, WKUIDelegate {
    private static func isClaude(_ url: URL) -> Bool {
        guard let host = url.host else { return true }
        return host == "claude.ai" || host.hasSuffix(".claude.ai") || host.hasSuffix("anthropic.com")
            || host.hasSuffix("claudeusercontent.com") || host.hasSuffix("claude.com")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard let url = action.request.url else { return .allow }
        let scheme = url.scheme ?? ""
        // 子框架（桌寵網頁本體）、內部資料一律放行
        if action.targetFrame?.isMainFrame == false || ["about", "data", "blob"].contains(scheme) { return .allow }
        if scheme == "https", Self.isClaude(url) { return .allow }
        // 其他網站交給 Safari
        if ["http", "https", "mailto", "tel"].contains(scheme) { _ = await UIApplication.shared.open(url) }
        return .cancel
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url {
            if Self.isClaude(url) { webView.load(action.request) } else { UIApplication.shared.open(url) }
        }
        return nil
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) {
        if !linked { status = "載入中…" }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard !linked else { return }
        let path = webView.url?.path ?? ""
        status = path.contains("artifact") ? "等待桌寵連線…" : "請先用 Email 登入 Claude"
        // 登入後被導到 Claude 首頁時，自動帶回默默
        if !path.contains("artifact"), path == "/" || path.hasPrefix("/new") || path.hasPrefix("/chat") || path.hasPrefix("/recents") {
            goHome()
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        status = "連線失敗，請按 ⋯ 重新整理"
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code != NSURLErrorCancelled { status = "連線失敗，請按 ⋯ 重新整理" }
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }
}
