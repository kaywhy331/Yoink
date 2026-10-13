// Toast payloads as Windows stores them (wpndatabase.db Notification.Payload).
import { DatabaseSync } from "node:sqlite";

/** What Discord's desktop app (Electron) hands Windows for a server message. */
export function discordDesktopToastXml(title: string, body: string): string {
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
  return `<toast><visual><binding template="ToastGeneric"><text>${escape(title)}</text><text>${escape(body)}</text>`
    + `<image id="1" placement="appLogoOverride" hint-crop="none" src="file:///C:/Users/x/AppData/Local/Temp/avatar.png"/>`
    + `</binding></visual></toast>`;
}

/** What Chromium-based browsers (Brave, Chrome, Edge) hand Windows for a site's notification. */
export function browserToastXml(title: string, body: string, site: string): string {
  return `<toast launch="0|0|Default|0|https://${site}/|p#https://${site}/#00" displayTimestamp="2026-10-13T05:00:00Z">`
    + `<visual><binding template="ToastGeneric"><text>${title}</text><text>${body}</text>`
    + `<text placement="attribution">${site}</text></binding></visual>`
    + `<actions><action content="Settings" placement="contextMenu" activationType="foreground" arguments="x"/></actions></toast>`;
}

/** Windows' FILETIME for an epoch-millisecond time. */
export function windowsFiletime(ms: number): bigint {
  return (BigInt(ms) + 11_644_473_600_000n) * 10_000n;
}

export const DISCORD_APP_ID = "com.squirrel.Discord.Discord";
export const BRAVE_APP_ID = "Brave";
export const OUTLOOK_APP_ID = "Microsoft.Office.OUTLOOK.EXE.15";

/**
 * A notification centre database with Windows' own schema (wpndatabase.db,
 * Windows 10 1607 through Windows 11), holding toasts from Discord, Brave and Outlook.
 */
export function createNotificationCentre(path: string, journal: "wal" | "delete" = "wal") {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=${journal};
    CREATE TABLE [NotificationHandler] ([RecordId] INTEGER PRIMARY KEY, [PrimaryId] TEXT NOT NULL COLLATE NOCASE,
      [WNSId] TEXT COLLATE NOCASE, [HandlerType] TEXT, [WNFEventName] INT64, [SystemDataPropertySet] BLOB,
      [CreatedTime] DATETIME, [ModifiedTime] DATETIME, [ParentId] TEXT COLLATE NOCASE, [ContainerSid] TEXT COLLATE NOCASE);
    CREATE TABLE [Notification]([Order] INTEGER NOT NULL PRIMARY KEY, [Id] INTEGER NOT NULL UNIQUE ON CONFLICT REPLACE,
      [HandlerId] INTEGER REFERENCES NotificationHandler(RecordId) ON DELETE CASCADE ON UPDATE CASCADE,
      [ActivityId] GUID, [Type] TEXT NOT NULL, [Payload] BLOB, [Tag] TEXT, [Group] TEXT, [ExpiryTime] INT64,
      [ArrivalTime] INT64, [DataVersion] INT64 DEFAULT '0', [PayloadType] TEXT NOT NULL, [BootId] INT64 DEFAULT '0',
      [ExpiresOnReboot] BOOLEAN DEFAULT 'FALSE');`);
  const handlers = new Map<string, number>();
  const handlerFor = (appId: string): number => {
    const known = handlers.get(appId);
    if (known) return known;
    const id = handlers.size + 1;
    db.prepare("INSERT INTO NotificationHandler(RecordId, PrimaryId, HandlerType, CreatedTime, ModifiedTime) VALUES (?, ?, 'app:desktop', '2026-10-01 00:00:00', '2026-10-01 00:00:00')")
      .run(id, appId);
    handlers.set(appId, id);
    return id;
  };
  for (const appId of [DISCORD_APP_ID, BRAVE_APP_ID, OUTLOOK_APP_ID]) handlerFor(appId);
  let nextId = 1000;
  return {
    db,
    add(appId: string, payload: string | Uint8Array, arrivedAt: number, type = "toast"): number {
      const handler = handlerFor(appId);
      nextId += 1;
      db.prepare(`INSERT INTO Notification(Id, HandlerId, Type, Payload, Tag, [Group], ExpiryTime, ArrivalTime, PayloadType)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'xml')`).run(nextId, handler, type,
        typeof payload === "string" ? Buffer.from(payload, "utf8") : payload, `tag${nextId}`, "group",
        windowsFiletime(arrivedAt + 3 * 86_400_000), windowsFiletime(arrivedAt));
      return nextId;
    },
    remove(id: number): void {
      db.prepare("DELETE FROM Notification WHERE Id = ?").run(id);
    },
    close(): void {
      db.close();
    }
  };
}
