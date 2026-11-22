import Foundation
import SwiftUI

/// App 與小工具共用的資料（透過 App Group 共享）
enum SharedStore {
    static let group = "group.tw.petroom"
    static let infoKey = "widgetInfo"

    static var defaults: UserDefaults { UserDefaults(suiteName: group) ?? .standard }

    static var container: URL {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
            ?? FileManager.default.temporaryDirectory
    }

    static var imageURL: URL { container.appendingPathComponent("pet.png") }
}

struct WidgetInfo: Codable {
    var name: String
    var color: String
    var openCount: Int
    var nextTitle: String?
    var nextBody: String?
    var nextDate: Date?
    var updated: Date

    static func load() -> WidgetInfo? {
        guard let data = SharedStore.defaults.data(forKey: SharedStore.infoKey) else { return nil }
        return try? JSONDecoder().decode(WidgetInfo.self, from: data)
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) {
            SharedStore.defaults.set(data, forKey: SharedStore.infoKey)
        }
    }
}

extension Color {
    /// 讀取 #RRGGBB 色碼
    init(hex: String, fallback: Color = .pink) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let v = UInt32(s, radix: 16) else { self = fallback; return }
        self = Color(red: Double((v >> 16) & 0xFF) / 255,
                     green: Double((v >> 8) & 0xFF) / 255,
                     blue: Double(v & 0xFF) / 255)
    }
}

enum LocalTime {
    /// 網頁傳來的時間格式：YYYY-MM-DDTHH:MM（台灣當地時間）
    static let formatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return f
    }()

    static func parse(_ s: String) -> Date? { formatter.date(from: s) }
}
