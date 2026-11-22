import SwiftUI
import WebKit

struct ContentView: View {
    @StateObject private var model = PetWebModel()
    @Environment(\.scenePhase) private var scenePhase
    @State private var showLoginHelp = false
    @State private var showPipHelp = false

    var body: some View {
        VStack(spacing: 0) {
            WebViewContainer(webView: model.webView)
                .ignoresSafeArea(edges: .bottom)
            HStack(spacing: 10) {
                PipHost(floating: model.floating).frame(width: 4, height: 4)
                Circle()
                    .fill(model.linked ? Color.green : Color.orange)
                    .frame(width: 8, height: 8)
                Text(model.status)
                    .font(.footnote)
                    .lineLimit(1)
                Spacer()
                PipButton(floating: model.floating) { model.requestPush() }
                Menu {
                    Button("回到默默", systemImage: "house") { model.goHome() }
                    Button("重新整理", systemImage: "arrow.clockwise") { model.webView.reload() }
                    PipAutoToggle(floating: model.floating)
                    Button("懸浮小窗說明", systemImage: "pip") { showPipHelp = true }
                    Button("貼上登入連結", systemImage: "link") { model.pasteLoginLink() }
                    Button("登入說明", systemImage: "questionmark.circle") { showLoginHelp = true }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .frame(width: 44, height: 44)
                }
            }
            .padding(.horizontal, 12)
            .background(.bar)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { model.requestPush() }
            if phase == .inactive { model.requestPush(); model.floating.render() }
        }
        .alert("用 Email 登入 Claude", isPresented: $showLoginHelp) {
            Button("知道了", role: .cancel) {}
        } message: {
            Text("在登入畫面選擇用 Email 繼續。\n\n收到的信如果有驗證碼，直接在這裡輸入。\n\n如果信裡只有登入連結：在郵件 App 長按連結選「拷貝連結」，回到這裡按右下角「⋯」→「貼上登入連結」。\n\n請不要用 Google 登入，Google 不允許在 App 內嵌的網頁登入。")
        }
        .alert("懸浮小窗", isPresented: $showPipHelp) {
            Button("知道了", role: .cancel) {}
        } message: {
            Text("按「懸浮小窗」或直接回到主畫面，默默就會變成浮在所有 App 上面的小窗。\n\n・拖曳可以移動，兩指捏合可以放大縮小\n・拖到螢幕邊邊可以先收起來\n・小窗上的快轉／倒轉鍵：切換全身和臉部特寫\n・播放／暫停鍵：休息模式\n・點小窗再按右上角的按鈕：回到默默\n\niPad 也可以把默默拉成 Slide Over 或台前調度的小視窗，跟其他 App 並排。")
        }
        .alert(model.alertText ?? "", isPresented: Binding(get: { model.alertText != nil }, set: { if !$0 { model.alertText = nil } })) {
            Button("好", role: .cancel) {}
        }
    }
}

struct PipButton: View {
    @ObservedObject var floating: FloatingPet
    var beforeStart: () -> Void
    var body: some View {
        if floating.supported {
            Button {
                beforeStart(); floating.toggle()
            } label: {
                Label(floating.active ? "收回小窗" : "懸浮小窗", systemImage: floating.active ? "pip.exit" : "pip.enter")
                    .font(.footnote.weight(.semibold))
            }
            .buttonStyle(.bordered)
            .disabled(!floating.possible && !floating.active)
        }
    }
}

struct PipAutoToggle: View {
    @ObservedObject var floating: FloatingPet
    var body: some View {
        if floating.supported {
            Toggle("回到主畫面時自動變成小窗", isOn: Binding(get: { floating.autoStart }, set: { floating.autoStart = $0 }))
        }
    }
}

struct WebViewContainer: UIViewRepresentable {
    let webView: WKWebView
    func makeUIView(context: Context) -> WKWebView { webView }
    func updateUIView(_ uiView: WKWebView, context: Context) {}
}
