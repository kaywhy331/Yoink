# Windows notification capture prototype

This standalone app records **native Discord desktop notifications already delivered to Windows** so we can assess their usefulness as Yoink signals. It needs no Discord bot, Discord token, server membership beyond your own account, or Yoink server connection. It does not read Discord history or activate purchases.

## Run the prebuilt package

Requirements: an x64 PC with Windows 10 version 2004 or newer (including Windows 11), Discord desktop, and permission to enable Developer Mode. The self-contained package includes its .NET runtime. Node is needed only for the optional analysis command.

1. Extract `yoink-windows-capture-x64.zip` into a permanent folder on the PC showing your Discord notifications. Keep the extracted folder there while the app is installed.
2. Enable **Developer Mode** in Windows Settings (search for that phrase). This is required to register this unsigned development app with its notification-listener capability. The installer does not change this setting or install a signing certificate.
3. Open **Windows PowerShell** in the extracted folder and run:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\Install.ps1
   ```

   This invocation permits the installer for that process only; it does not change the machine's execution policy. An administrator PowerShell window is not required. Organization policy may prevent development registration.

4. In the window that opens, choose **Allow access and start**, then approve Windows' notification-access prompt. If you previously denied it, use **Notification access settings** to enable access before starting again.
5. Leave the capture window open or minimized while normal Discord alerts arrive. Use **Stop** when you have a useful sample, then **Open logs**.

Launch it again from Start → **Yoink Notification Capture**. Do not launch the EXE directly: it needs its registered Windows package identity. Closing the window stops capture. There is no startup task or background service.

## First live capture check

Before leaving it running for hours:

1. Enable Discord's desktop notifications and the desired channels' notification settings. Enable notifications for Discord in Windows. Avoid quiet modes while checking delivery.
2. Put Discord in the background, then wait for a real alert. An open, focused channel may suppress its own alerts.
3. Confirm that the alert reaches **Windows Notification Center**, that the app's saved-sample count increases, and that a `notification` record appears in today's log.
4. Compare several notifications with their original Discord messages: plain text, rich embeds, links, price changes, restocks, and grouped alerts. Record any messages that had no Windows notification separately. The capture app cannot measure these omissions by itself.
5. Stop and restart capture. Current notifications should appear as `existing`; they are distinguished from newly observed `added` samples. The analyzer removes repeated identical snapshots across sessions.

The app checks current Windows notifications every 500 ms. It filters by known Discord Stable/PTB/Canary app IDs or exact display names before reading text. Discord in Chrome or another browser is outside this first version. Unknown Discord app identities may not match. A failure stops recording and leaves a visible error, rather than silently continuing with an empty log.

## Logs

Default location (also displayed in the window):

```text
%USERPROFILE%\Yoink\notification-capture\logs\capture-YYYY-MM-DD.jsonl
```

Files rotate by **UTC date**. Each UTF-8 JSONL line is an independently readable record, flushed to disk after writing. A 50 MB daily limit stops capture with a visible message; archive that day's file outside the active log folder before restarting. Logs are never automatically deleted or uploaded and remain after app removal. They can include private sender/channel names and product-link query parameters, because this experiment preserves what the notification actually contains. Review them before sharing.

Every record contains `schemaVersion: 1`, `eventType`, a random `sessionId`, `capturedAt` (UTC observation time), and `details`:

| Event | Contents |
| --- | --- |
| `session_started` | Capture version, OS version, filter, and polling interval. |
| `notification` | Windows notification ID, app ID/name, Windows creation time, content fingerprint, observation kind, and all readable text elements grouped by binding template/language. |
| `heartbeat` | Once per minute: successful polls, saved samples, and current Discord notification count. |
| `access_lost` | Permission was revoked; capture stops. |
| `capture_error` | Exception type and Windows HRESULT when it is possible to write the error. |
| `session_stopped` | Stop reason and saved count. An abrupt process exit may have no stop record. |

The first snapshot is `existing`. Subsequent new Windows identities are `added`; changed text for the same identity is `updated`. Unchanged polling does not write duplicates. IDs can be reused, so the deduplication identity includes app ID and creation time. These are **Windows IDs and timestamps, not Discord message IDs or send times**. Binding text is preserved without guessing which field is a server, channel, sender, or product.

No image downloads, screenshot capture, hidden Discord API calls, notification dismissal, or full Discord message bodies are involved. Images, embed fields, and URLs absent from the text are unavailable. Notifications removed between polls, suppressed by Discord, or missed while this PC/app is off will not appear. Grouped notification text may represent multiple Discord messages.

## Analyze the samples

With Node 22 or newer, from the extracted folder:

```powershell
node .\analyze.mjs "$env:USERPROFILE\Yoink\notification-capture\logs"
node .\analyze.mjs "$env:USERPROFILE\Yoink\notification-capture\logs" --json
```

From the repository, use `node apps/windows-capture/analyze.mjs "path/to/logs"`. You can also pass one JSONL file. Stop capture first for a stable report; a read racing with an append may see an incomplete final line. The analyzer reports malformed lines and exits with code 2 if any lines are malformed or unsupported while still summarizing valid records.

The report counts unique notification snapshots with URLs, price-like text, availability words, empty text, and trailing ellipses (a possible truncation hint). It also shows field counts, template names, URL hosts, capture errors, and gaps between observed log records. These are exploratory hints, not verified retailer identities, measured Discord delivery latency, or proof of complete coverage. Updates count as distinct snapshots. Analyze each Windows device separately because Windows IDs are device-local.

The summary omits raw message text and URL paths/query strings. It is the useful first artifact for discussing which signal types can be matched automatically and which require a product mapping or manual review. Raw samples remain available locally for inspecting unusual layouts.

## Build and verify

Source builds require the .NET 8 SDK (or a later compatible SDK). On Windows, run `Install.ps1 -Rebuild`. The script publishes self-contained x64 binaries, copies the manifest/assets, registers the app, and launches it.

Cross-compilation and platform-independent checks can run on Linux:

```sh
dotnet publish apps/windows-capture/Yoink.NotificationCapture.csproj -c Release -r win-x64 --self-contained true -o apps/windows-capture/package
dotnet run --project apps/windows-capture/tests/Yoink.Capture.Tests.csproj -c Release
node --import tsx --test test/windows-notification-analysis.test.ts
node apps/windows-capture/package.mjs
```

The last command creates `release/yoink-windows-capture-x64.zip` using the published files. It requires Python 3 for ZIP creation. Build output and raw JSONL files under this app are ignored by Git.

The automated checks cover filtering, duplicate polling, updates, Windows ID reuse, daily rotation, Unicode/multiline text, interrupted writes, analyzer validation, and capture-health summaries. **A cross-build cannot verify Windows registration, the consent prompt, or real Discord delivery. Use the live capture check above on the Windows PC.**

## Remove the prototype

Close the capture window, then use Windows PowerShell:

```powershell
Get-AppxPackage -Name Yoink.NotificationCapture | Remove-AppxPackage
```

You can then remove its extracted folder. Logs under your user profile remain until you choose to delete them. Developer Mode can be disabled separately in Windows Settings.

Windows API reference: [Notification listener](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/app-notifications/notification-listener).
