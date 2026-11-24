import AVFoundation
import AVKit
import CoreMedia
import SwiftUI
import UIKit

/// 網頁傳來、懸浮小窗要顯示的即時資料
struct PetLive {
    var name = "默默"
    var color = "#f49ac1"
    var bubble = ""
    var bubbleAt = Date.distantPast
    var line = ""
    var nextTitle: String?
    var nextDate: Date?
    var open = 0
    var timerMode = "down"
    var timerRun = false
    var timerStart: Double = 0
    var timerAcc: Double = 0
    var timerDur: Double = 0
    var timerActive = false
    var mood = "neutral"
    var amb = ""
    var fx = ""
    var fxAt = Date.distantPast
}

/// 用「子母畫面」做成浮在所有 App 上面的小窗：
/// 把小窗畫面一張張畫成影格送進 AVSampleBufferDisplayLayer，系統就會讓它浮在桌面和其他 App 上，
/// 可以拖曳、縮放、收到邊邊。iPhone 和 iPad 都能用。
@MainActor
final class FloatingPet: NSObject, ObservableObject {
    @Published var active = false
    @Published var possible = false
    let supported = AVPictureInPictureController.isPictureInPictureSupported()

    let hostView = UIView(frame: CGRect(x: 0, y: 0, width: 4, height: 4))
    private let displayLayer = AVSampleBufferDisplayLayer()
    private var pip: AVPictureInPictureController?
    private var possibleObs: NSKeyValueObservation?
    private var tick: Timer?
    private var silence: AVAudioPlayer?
    private var paused = false
    private var closeUp = false
    private var image: UIImage?
    private var imageStamp: Date?
    private var roomImage: UIImage?
    private var roomStamp: Date?
    private var lastFmode = ""
    var live = PetLive()

    static let size = CGSize(width: 360, height: 480)

    override init() {
        super.init()
        hostView.isUserInteractionEnabled = false
        hostView.alpha = 0.02
        displayLayer.frame = hostView.bounds
        displayLayer.videoGravity = .resizeAspect
        hostView.layer.addSublayer(displayLayer)
        UIDevice.current.isBatteryMonitoringEnabled = true
        guard supported else { return }
        let source = AVPictureInPictureController.ContentSource(sampleBufferDisplayLayer: displayLayer, playbackDelegate: self)
        let c = AVPictureInPictureController(contentSource: source)
        c.delegate = self
        c.canStartPictureInPictureAutomaticallyFromInline = UserDefaults.standard.object(forKey: "pipAuto") as? Bool ?? true
        c.requiresLinearPlayback = false
        pip = c
        possibleObs = c.observe(\.isPictureInPicturePossible, options: [.initial, .new]) { [weak self] ctl, _ in
            Task { @MainActor in self?.possible = ctl.isPictureInPicturePossible }
        }
        startAudio()
        render()
        tick = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.render() }
        }
    }

    var autoStart: Bool {
        get { pip?.canStartPictureInPictureAutomaticallyFromInline ?? false }
        set { pip?.canStartPictureInPictureAutomaticallyFromInline = newValue; UserDefaults.standard.set(newValue, forKey: "pipAuto"); objectWillChange.send() }
    }

    func toggle() {
        guard let pip else { return }
        if pip.isPictureInPictureActive { pip.stopPictureInPicture() } else { startAudio(); render(); pip.startPictureInPicture() }
    }

    /// 背景播放無聲音訊，讓小窗在回到桌面後還能每秒更新時間與倒數
    private func startAudio() {
        let s = AVAudioSession.sharedInstance()
        try? s.setCategory(.playback, mode: .moviePlayback, options: [.mixWithOthers])
        try? s.setActive(true)
        if silence == nil {
            let sr = 8000, n = sr
            var wav = Data()
            func u32(_ v: UInt32) { var x = v.littleEndian; wav.append(Data(bytes: &x, count: 4)) }
            func u16(_ v: UInt16) { var x = v.littleEndian; wav.append(Data(bytes: &x, count: 2)) }
            wav.append("RIFF".data(using: .ascii)!); u32(UInt32(36 + n * 2)); wav.append("WAVEfmt ".data(using: .ascii)!)
            u32(16); u16(1); u16(1); u32(UInt32(sr)); u32(UInt32(sr * 2)); u16(2); u16(16)
            wav.append("data".data(using: .ascii)!); u32(UInt32(n * 2)); wav.append(Data(count: n * 2))
            silence = try? AVAudioPlayer(data: wav)
            silence?.numberOfLoops = -1
            silence?.volume = 0
        }
        silence?.play()
    }

    func update(_ p: PetPayload) {
        live.name = p.name
        live.color = p.c1
        live.open = p.open
        if let b = p.bubble, !b.isEmpty, let at = p.bubbleAt {
            live.bubble = b
            live.bubbleAt = Date(timeIntervalSince1970: at / 1000)
        }
        if let l = p.line { live.line = l }
        live.nextTitle = p.next?.title
        live.nextDate = p.next.flatMap { LocalTime.parse($0.at) }
        if let m = p.mood { live.mood = m }
        if let a = p.amb { live.amb = a }
        if let f = p.fx, !f.isEmpty, let at = p.fxAt { live.fx = f; live.fxAt = Date(timeIntervalSince1970: at / 1000) }
        if let fm = p.fmode, fm != lastFmode { lastFmode = fm; closeUp = fm == "close" }
        if let t = p.timer {
            live.timerMode = t.mode; live.timerRun = t.run; live.timerStart = t.start
            live.timerAcc = t.acc; live.timerDur = t.dur; live.timerActive = t.active
        }
        render()
    }

    // MARK: - 畫一張小窗畫面

    private func petImage() -> UIImage? {
        let url = SharedStore.imageURL
        let stamp = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate]) as? Date
        if stamp != imageStamp {
            imageStamp = stamp
            image = stamp == nil ? nil : UIImage(contentsOfFile: url.path)
        }
        return image
    }

    private func timerText() -> String? {
        guard live.timerActive else { return nil }
        let now = Date().timeIntervalSince1970 * 1000
        let el = live.timerAcc + (live.timerRun ? now - live.timerStart : 0)
        let ms = live.timerMode == "up" ? el : max(0, live.timerDur - el)
        let s = Int(live.timerMode == "up" ? floor(ms / 1000) : ceil(ms / 1000))
        let h = s / 3600, mm = (s / 60) % 60, ss = s % 60
        let t = h > 0 ? String(format: "%d:%02d:%02d", h, mm, ss) : String(format: "%02d:%02d", mm, ss)
        return (live.timerMode == "up" ? "正計時 " : "倒計時 ") + t + (live.timerRun ? "" : "（暫停）")
    }

    private func draw() -> UIImage {
        let W = Self.size.width, H = Self.size.height
        let fmt = UIGraphicsImageRendererFormat(); fmt.scale = 2; fmt.opaque = true
        return UIGraphicsImageRenderer(size: Self.size, format: fmt).image { ctx in
            let g = ctx.cgContext
            let ink = UIColor(red: 0.15, green: 0.14, blue: 0.39, alpha: 1)
            let accent = UIColor(Color(hex: live.color))
            let pink = accent.withAlphaComponent(0.35)
            UIColor.white.setFill(); g.fill(CGRect(origin: .zero, size: Self.size))
            pink.setFill(); g.fill(CGRect(x: 0, y: 0, width: W, height: H))
            // 外框（像素風雙線）
            ink.setStroke(); g.setLineWidth(6); g.stroke(CGRect(x: 3, y: 3, width: W - 6, height: H - 6))
            UIColor.white.setStroke(); g.setLineWidth(3); g.stroke(CGRect(x: 9, y: 9, width: W - 18, height: H - 18))
            // 標題列
            let bar = CGRect(x: 14, y: 14, width: W - 28, height: 40)
            accent.setFill(); g.fill(bar); ink.setStroke(); g.setLineWidth(3); g.stroke(bar)
            let dot = CGRect(x: 24, y: 29, width: 10, height: 10)
            (Int(Date().timeIntervalSince1970) % 2 == 0 ? UIColor(red: 1, green: 0.36, blue: 0.58, alpha: 1) : UIColor.white).setFill(); g.fill(dot)
            let title: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 22), .foregroundColor: ink]
            (live.name as NSString).draw(in: CGRect(x: 44, y: 20, width: W - 170, height: 30), withAttributes: title)
            let tf = DateFormatter(); tf.dateFormat = "HH:mm"
            var right = tf.string(from: Date())
            let lv = UIDevice.current.batteryLevel
            if lv >= 0 { right += "  \(Int(round(lv * 100)))%" + (UIDevice.current.batteryState == .charging || UIDevice.current.batteryState == .full ? "⚡︎" : "") }
            let rs: [NSAttributedString.Key: Any] = [.font: UIFont.monospacedDigitSystemFont(ofSize: 18, weight: .semibold), .foregroundColor: ink]
            let rw = (right as NSString).size(withAttributes: rs).width
            (right as NSString).draw(at: CGPoint(x: W - 24 - rw, y: 23), withAttributes: rs)
            // 房間：網頁畫好的像素房間（含自己佈置的家具）
            let room = CGRect(x: 14, y: 62, width: W - 28, height: H - 150)
            UIColor(white: 1, alpha: 0.85).setFill(); g.fill(room)
            pink.setFill()
            var yy = room.minY + 6
            while yy < room.maxY { var xx = room.minX + 6; while xx < room.maxX { g.fill(CGRect(x: xx, y: yy, width: 3, height: 3)); xx += 18 }; yy += 18 }
            g.saveGState(); g.clip(to: room.insetBy(dx: 2, dy: 2))
            let now = Date().timeIntervalSince1970
            var feet = CGPoint(x: room.midX, y: room.maxY - 4)
            var charH = room.height * 0.92
            if !closeUp, let r = roomPic(), r.size.width > 0 {
                let rw = room.width * 0.96, rh = rw * r.size.height / r.size.width
                let rr = CGRect(x: room.midX - rw / 2, y: room.maxY - room.height * 0.03 - rh, width: rw, height: rh)
                g.interpolationQuality = .none
                r.draw(in: rr)
                g.interpolationQuality = .default
                feet = CGPoint(x: room.midX, y: room.maxY - room.height * 0.04)
                charH = room.height * 0.76
            }
            if live.amb == "wisp" || ["snow", "rain", "blossoms", "leaves", "stars"].contains(live.amb) { drawWeather(g, room, now, behind: true) }
            // 角色
            if let img = petImage(), img.size.width > 0 {
                let breathe = 1 + 0.012 * sin(now * 2)
                if closeUp {
                    let s = max(room.width / img.size.width, room.height * 2.2 / img.size.height)
                    let w = img.size.width * s, h = img.size.height * s
                    img.draw(in: CGRect(x: room.midX - w / 2, y: room.minY - h * 0.05, width: w, height: h))
                } else {
                    let s = min(room.width * 0.92 / img.size.width, charH / img.size.height)
                    let w = img.size.width * s, h = img.size.height * s * breathe
                    img.draw(in: CGRect(x: feet.x - w / 2, y: feet.y - h, width: w, height: h))
                    head = CGPoint(x: feet.x, y: feet.y - h)
                    charW = w
                }
            } else {
                let face = CGRect(x: room.midX - 70, y: room.midY - 90, width: 140, height: 180)
                UIColor.white.setFill(); g.fillEllipse(in: face); ink.setStroke(); g.setLineWidth(5); g.strokeEllipse(in: face)
                ink.setFill(); g.fillEllipse(in: CGRect(x: face.midX - 32, y: face.midY - 30, width: 14, height: 14)); g.fillEllipse(in: CGRect(x: face.midX + 18, y: face.midY - 30, width: 14, height: 14))
                head = CGPoint(x: face.midX, y: face.minY); charW = face.width
            }
            if ["butterfly"].contains(live.amb) { drawWeather(g, room, now, behind: false) }
            drawReaction(g, now)
            g.restoreGState()
            ink.setStroke(); g.setLineWidth(3); g.stroke(room)
            if !closeUp { drawDateCard(g, room, ink: ink, accent: accent) }
            // 對話泡泡（最近 25 秒內說的話）
            if !live.bubble.isEmpty, Date().timeIntervalSince(live.bubbleAt) < 25 {
                let bs: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 18, weight: .medium), .foregroundColor: ink]
                let text = String(live.bubble.prefix(60)) as NSString
                let bw = room.width - 20
                let bh = min(110, text.boundingRect(with: CGSize(width: bw - 20, height: 200), options: .usesLineFragmentOrigin, attributes: bs, context: nil).height + 18)
                let br = CGRect(x: room.minX + 10, y: room.maxY - bh - 10, width: bw, height: bh)
                UIColor(white: 1, alpha: 0.95).setFill(); g.fill(br); ink.setStroke(); g.setLineWidth(3); g.stroke(br)
                text.draw(with: br.insetBy(dx: 10, dy: 8), options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], attributes: bs, context: nil)
            }
            // 下方資訊列
            let info = CGRect(x: 14, y: H - 82, width: W - 28, height: 68)
            UIColor.white.setFill(); g.fill(info); ink.setStroke(); g.setLineWidth(3); g.stroke(info)
            let small: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 17, weight: .semibold), .foregroundColor: ink]
            var l1 = live.line
            if let t = timerText() { l1 = t }
            else if l1.isEmpty, let n = live.nextTitle { l1 = "下一件：" + n }
            if l1.isEmpty { l1 = "陪你中～" }
            (l1 as NSString).draw(with: CGRect(x: 24, y: info.minY + 8, width: info.width - 20, height: 24), options: [.truncatesLastVisibleLine, .usesLineFragmentOrigin], attributes: small, context: nil)
            var l2 = "待辦 \(live.open) 件"
            if let d = live.nextDate {
                let f = DateFormatter(); f.dateFormat = Calendar.current.isDateInToday(d) ? "今天 HH:mm" : "M/d HH:mm"
                l2 += "・下個提醒 " + f.string(from: d)
            }
            let s2: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 15), .foregroundColor: ink.withAlphaComponent(0.75)]
            (l2 as NSString).draw(with: CGRect(x: 24, y: info.minY + 38, width: info.width - 20, height: 22), options: [.truncatesLastVisibleLine, .usesLineFragmentOrigin], attributes: s2, context: nil)
            if paused {
                UIColor(white: 0, alpha: 0.35).setFill(); g.fill(CGRect(origin: .zero, size: Self.size))
                let ps: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 30), .foregroundColor: UIColor.white]
                ("休息中" as NSString).draw(at: CGPoint(x: W / 2 - 45, y: H / 2 - 20), withAttributes: ps)
            }
        }
    }

    // MARK: - 房間、日期小卡、特效

    private var head = CGPoint.zero
    private var charW: CGFloat = 120

    private func roomPic() -> UIImage? {
        let url = SharedStore.roomURL
        let stamp = (try? FileManager.default.attributesOfItem(atPath: url.path)[.modificationDate]) as? Date
        if stamp != roomStamp {
            roomStamp = stamp
            roomImage = stamp == nil ? nil : UIImage(contentsOfFile: url.path)
        }
        return roomImage
    }

    /// 跟電腦版懸浮視窗一樣的日期小卡：上面日期、下面時段
    private func drawDateCard(_ g: CGContext, _ room: CGRect, ink: UIColor, accent: UIColor) {
        let d = Date(), cal = Calendar.current
        let wk = ["日", "一", "二", "三", "四", "五", "六"][cal.component(.weekday, from: d) - 1]
        let line1 = "\(cal.component(.month, from: d)) 月 \(cal.component(.day, from: d)) 日（\(wk)）" as NSString
        let h = cal.component(.hour, from: d)
        let tod = (h < 5 ? "深夜" : h < 11 ? "朝" : h < 17 ? "昼" : h < 19 ? "夕" : "夜") as NSString
        let f1: [NSAttributedString.Key: Any] = [.font: UIFont.systemFont(ofSize: 13, weight: .medium), .foregroundColor: ink]
        let hot = UIColor(red: 1, green: 0.36, blue: 0.58, alpha: 1)
        let f2: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 26), .foregroundColor: hot]
        let f2s: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: 26), .foregroundColor: ink]
        let s1 = line1.size(withAttributes: f1), s2 = tod.size(withAttributes: f2)
        let w = max(s1.width, s2.width) + 20, hh = s1.height + s2.height + 8
        let r = CGRect(x: room.minX + 12, y: room.minY + 12, width: w, height: hh)
        ink.withAlphaComponent(0.3).setFill(); g.fill(r.offsetBy(dx: 4, dy: 4))
        UIColor.white.setFill(); g.fill(r)
        accent.withAlphaComponent(0.5).setStroke(); g.setLineWidth(2); g.stroke(r.insetBy(dx: 3, dy: 3))
        ink.setStroke(); g.setLineWidth(3); g.stroke(r)
        line1.draw(at: CGPoint(x: r.midX - s1.width / 2, y: r.minY + 4), withAttributes: f1)
        let p2 = CGPoint(x: r.midX - s2.width / 2, y: r.minY + 2 + s1.height)
        tod.draw(at: CGPoint(x: p2.x + 1.5, y: p2.y + 1.5), withAttributes: f2s)
        tod.draw(at: p2, withAttributes: f2)
    }

    private static func rnd(_ i: Int, _ s: Int) -> CGFloat {
        var x = UInt32(truncatingIfNeeded: i &* 374761393 &+ s &* 668265263)
        x = (x ^ (x >> 13)) &* 1274126177
        x ^= x >> 16
        return CGFloat(x & 0xFFFF) / 65535
    }

    /// 背景天氣：跟網頁一樣依季節和時間（雪、櫻花、落葉、雨、流星、蝴蝶、夜晚的小火光）
    private func drawWeather(_ g: CGContext, _ room: CGRect, _ t: Double, behind: Bool) {
        let R = Self.rnd
        switch live.amb {
        case "snow", "blossoms", "leaves", "rain":
            let n = live.amb == "rain" ? 26 : 18
            for i in 0..<n {
                let sp = live.amb == "rain" ? 160.0 : 26.0 + Double(R(i, 2)) * 22
                let y = room.minY + CGFloat((Double(R(i, 1)) * Double(room.height) + t * sp).truncatingRemainder(dividingBy: Double(room.height)))
                let x = room.minX + R(i, 3) * room.width + CGFloat(sin(t * 1.3 + Double(i))) * (live.amb == "rain" ? 0 : 8)
                switch live.amb {
                case "snow": UIColor.white.setFill(); g.fill(CGRect(x: x, y: y, width: 4, height: 4))
                case "rain": UIColor(red: 0.55, green: 0.7, blue: 0.95, alpha: 0.8).setFill(); g.fill(CGRect(x: x, y: y, width: 2, height: 9))
                case "blossoms": UIColor(red: 1, green: 0.72, blue: 0.82, alpha: 1).setFill(); g.fill(CGRect(x: x, y: y, width: 5, height: 4)); UIColor.white.setFill(); g.fill(CGRect(x: x + 1, y: y + 1, width: 2, height: 2))
                default: (i % 2 == 0 ? UIColor(red: 0.93, green: 0.55, blue: 0.2, alpha: 1) : UIColor(red: 0.85, green: 0.35, blue: 0.2, alpha: 1)).setFill(); g.fill(CGRect(x: x, y: y, width: 5, height: 5))
                }
            }
        case "stars":
            for i in 0..<14 {
                let on = (Int(t * 2) + i) % 5 != 0
                if on { UIColor(red: 1, green: 0.95, blue: 0.6, alpha: 1).setFill(); g.fill(CGRect(x: room.minX + R(i, 4) * room.width, y: room.minY + R(i, 5) * room.height * 0.5, width: 3, height: 3)) }
            }
        case "wisp":
            let c = CGPoint(x: head.x - charW * 0.55 + CGFloat(sin(t * 0.8)) * 10, y: head.y + 40 + CGFloat(sin(t * 1.7)) * 8)
            UIColor(red: 0.45, green: 0.95, blue: 0.95, alpha: 0.25).setFill(); g.fillEllipse(in: CGRect(x: c.x - 22, y: c.y - 22, width: 44, height: 44))
            UIColor(red: 0.55, green: 1, blue: 0.95, alpha: 0.9).setFill(); g.fillEllipse(in: CGRect(x: c.x - 11, y: c.y - 11, width: 22, height: 22))
        case "butterfly":
            let c = CGPoint(x: head.x + charW * 0.45 + CGFloat(sin(t * 0.9)) * 18, y: head.y + 30 + CGFloat(cos(t * 1.3)) * 12)
            let open = Int(t * 4) % 2 == 0
            UIColor(red: 1, green: 0.82, blue: 0.4, alpha: 1).setFill()
            g.fill(CGRect(x: c.x - (open ? 9 : 5), y: c.y - 6, width: open ? 8 : 4, height: 10)); g.fill(CGRect(x: c.x + 1, y: c.y - 6, width: open ? 8 : 4, height: 10))
            UIColor(red: 0.15, green: 0.14, blue: 0.39, alpha: 1).setFill(); g.fill(CGRect(x: c.x - 1, y: c.y - 7, width: 2, height: 12))
        default: break
        }
    }

    /// 心情反應特效（愛心、睡覺 Z、驚嘆號、彩紙）：觸發後 3 秒內顯示
    private func drawReaction(_ g: CGContext, _ t: Double) {
        let age = Date().timeIntervalSince(live.fxAt)
        guard age >= 0, age < 3, !live.fx.isEmpty else { return }
        let R = Self.rnd
        func glyph(_ s: String, _ p: CGPoint, _ size: CGFloat, _ c: UIColor) {
            let a: [NSAttributedString.Key: Any] = [.font: UIFont.boldSystemFont(ofSize: size), .foregroundColor: c]
            (s as NSString).draw(at: p, withAttributes: a)
        }
        let hot = UIColor(red: 1, green: 0.36, blue: 0.58, alpha: 1)
        switch live.fx {
        case "charmed", "heart":
            for i in 0..<4 { glyph("♥", CGPoint(x: head.x - charW * 0.4 + R(i, 7) * charW * 0.8, y: head.y + 30 - CGFloat(age) * 26 - CGFloat(i) * 8), 18 + R(i, 8) * 8, hot) }
        case "sleep":
            for i in 0..<3 { glyph("Z", CGPoint(x: head.x + charW * 0.25 + CGFloat(i) * 12, y: head.y + 10 - CGFloat(age) * 14 - CGFloat(i) * 16), 16 + CGFloat(i) * 5, UIColor(red: 0.45, green: 0.5, blue: 0.95, alpha: 1)) }
        case "exclaim":
            glyph("！", CGPoint(x: head.x + charW * 0.2, y: head.y - 4 - CGFloat(min(age, 0.3)) * 20), 30, hot)
        default:
            let cols: [UIColor] = [hot, UIColor(red: 1, green: 0.82, blue: 0.4, alpha: 1), UIColor(red: 0.62, green: 0.85, blue: 0.9, alpha: 1), UIColor.white]
            for i in 0..<22 {
                cols[i % cols.count].setFill()
                let x = head.x - charW * 0.7 + R(i, 9) * charW * 1.4
                let y = head.y - 20 + CGFloat(age) * (60 + R(i, 10) * 80) - 30 * CGFloat(max(0, 1 - age))
                g.fill(CGRect(x: x, y: y, width: 5, height: 5))
            }
        }
    }

    func render() {
        guard supported else { return }
        guard let buffer = Self.sampleBuffer(from: draw()) else { return }
        if displayLayer.status == .failed { displayLayer.flush() }
        displayLayer.enqueue(buffer)
    }

    private static func sampleBuffer(from image: UIImage) -> CMSampleBuffer? {
        guard let cg = image.cgImage else { return nil }
        let w = cg.width, h = cg.height
        var pb: CVPixelBuffer?
        let attrs = [kCVPixelBufferCGImageCompatibilityKey: true, kCVPixelBufferCGBitmapContextCompatibilityKey: true, kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary
        guard CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_32BGRA, attrs, &pb) == kCVReturnSuccess, let px = pb else { return nil }
        CVPixelBufferLockBaseAddress(px, [])
        if let ctx = CGContext(data: CVPixelBufferGetBaseAddress(px), width: w, height: h, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(px),
                               space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue) {
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        CVPixelBufferUnlockBaseAddress(px, [])
        var fd: CMVideoFormatDescription?
        guard CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: px, formatDescriptionOut: &fd) == noErr, let desc = fd else { return nil }
        var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 1), presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        var sb: CMSampleBuffer?
        guard CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: px, formatDescription: desc, sampleTiming: &timing, sampleBufferOut: &sb) == noErr, let s = sb else { return nil }
        if let arr = CMSampleBufferGetSampleAttachmentsArray(s, createIfNecessary: true), CFArrayGetCount(arr) > 0 {
            let dict = unsafeBitCast(CFArrayGetValueAtIndex(arr, 0), to: CFMutableDictionary.self)
            CFDictionarySetValue(dict, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(), Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
        }
        return s
    }
}

extension FloatingPet: AVPictureInPictureSampleBufferPlaybackDelegate {
    nonisolated func pictureInPictureController(_ c: AVPictureInPictureController, setPlaying playing: Bool) {
        Task { @MainActor in self.paused = !playing; self.render() }
    }
    nonisolated func pictureInPictureControllerTimeRangeForPlayback(_ c: AVPictureInPictureController) -> CMTimeRange {
        CMTimeRange(start: .negativeInfinity, duration: .positiveInfinity)
    }
    nonisolated func pictureInPictureControllerIsPlaybackPaused(_ c: AVPictureInPictureController) -> Bool {
        MainActor.assumeIsolated { paused }
    }
    nonisolated func pictureInPictureController(_ c: AVPictureInPictureController, didTransitionToRenderSize newRenderSize: CMVideoDimensions) {}
    /// 子母畫面上的快轉／倒轉鍵：切換全身和臉部特寫
    nonisolated func pictureInPictureController(_ c: AVPictureInPictureController, skipByInterval skipInterval: CMTime, completion: @escaping () -> Void) {
        Task { @MainActor in self.closeUp.toggle(); self.render(); completion() }
    }
}

extension FloatingPet: AVPictureInPictureControllerDelegate {
    nonisolated func pictureInPictureControllerDidStartPictureInPicture(_ c: AVPictureInPictureController) {
        Task { @MainActor in self.active = true }
    }
    nonisolated func pictureInPictureControllerDidStopPictureInPicture(_ c: AVPictureInPictureController) {
        Task { @MainActor in self.active = false }
    }
    nonisolated func pictureInPictureController(_ c: AVPictureInPictureController, failedToStartPictureInPictureWithError error: Error) {
        Task { @MainActor in self.active = false }
    }
    nonisolated func pictureInPictureController(_ c: AVPictureInPictureController, restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
        completionHandler(true)
    }
}

/// 把 AVSampleBufferDisplayLayer 放進畫面（子母畫面需要它在視窗裡）
struct PipHost: UIViewRepresentable {
    let floating: FloatingPet
    func makeUIView(context: Context) -> UIView { floating.hostView }
    func updateUIView(_ uiView: UIView, context: Context) {}
}
