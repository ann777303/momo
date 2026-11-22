import WidgetKit
import SwiftUI
import UIKit

struct PetEntry: TimelineEntry {
    let date: Date
    let info: WidgetInfo?
    let image: UIImage?
}

struct PetProvider: TimelineProvider {
    func placeholder(in context: Context) -> PetEntry {
        PetEntry(date: .now, info: WidgetInfo(name: "小米", color: "#f49ac1", openCount: 2,
                                              nextTitle: "小米 的提醒", nextBody: "「期末報告」還有 3 天", nextDate: .now.addingTimeInterval(3 * 86400), updated: .now),
                 image: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (PetEntry) -> Void) {
        completion(context.isPreview ? placeholder(in: context) : current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PetEntry>) -> Void) {
        let entry = current()
        var refresh = Date().addingTimeInterval(30 * 60)
        if let next = entry.info?.nextDate, next > .now, next < refresh { refresh = next.addingTimeInterval(60) }
        completion(Timeline(entries: [entry], policy: .after(refresh)))
    }

    private func current() -> PetEntry {
        PetEntry(date: .now, info: WidgetInfo.load(), image: UIImage(contentsOfFile: SharedStore.imageURL.path))
    }
}

struct PetFace: View {
    let image: UIImage?
    var body: some View {
        if let image {
            Image(uiImage: image).resizable().scaledToFit()
        } else {
            Image(systemName: "face.smiling.inverse").resizable().scaledToFit().foregroundStyle(.secondary).padding(8)
        }
    }
}

struct PetWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: PetEntry

    private var tint: Color { Color(hex: entry.info?.color ?? "#f49ac1") }
    private var name: String { entry.info?.name ?? "默默" }
    private var nextBody: String { entry.info?.nextBody ?? (entry.info == nil ? "打開 App 登入後開始同步" : "目前沒有要提醒的事") }

    var body: some View {
        switch family {
        case .accessoryInline:
            Text(nextBody)
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text("\(entry.info?.openCount ?? 0)").font(.title2.bold())
                    Text("待辦").font(.caption2)
                }
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 1) {
                Text(name).font(.headline).widgetAccentable()
                Text(nextBody).font(.caption).lineLimit(2)
                if let d = entry.info?.nextDate, d > .now {
                    Text(d, style: .relative).font(.caption2)
                }
            }
        case .systemMedium:
            HStack(spacing: 12) {
                PetFace(image: entry.image).frame(maxHeight: .infinity)
                VStack(alignment: .leading, spacing: 6) {
                    Text(name).font(.headline)
                    Text(nextBody).font(.subheadline).lineLimit(3)
                    if let d = entry.info?.nextDate, d > .now {
                        Text(d, style: .relative).font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 0)
                    Text("未完成待辦 \(entry.info?.openCount ?? 0)").font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
            }
        default:
            VStack(spacing: 4) {
                PetFace(image: entry.image).frame(maxWidth: .infinity, maxHeight: .infinity)
                Text(nextBody).font(.caption2).lineLimit(2).multilineTextAlignment(.center)
            }
        }
    }
}

struct PetWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "PetWidget", provider: PetProvider()) { entry in
            PetWidgetView(entry: entry)
                .containerBackground(for: .widget) {
                    Color(hex: entry.info?.color ?? "#f49ac1").opacity(0.22)
                }
        }
        .configurationDisplayName("默默")
        .description("角色和下一個提醒")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryCircular, .accessoryInline])
    }
}

@main
struct PetWidgetBundle: WidgetBundle {
    var body: some Widget { PetWidget() }
}
