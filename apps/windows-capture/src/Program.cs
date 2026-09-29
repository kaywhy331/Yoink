using System.Diagnostics;
using Windows.ApplicationModel;
using Windows.UI.Notifications;
using Windows.UI.Notifications.Management;

namespace Yoink.NotificationCapture;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var singleInstance = new Mutex(true, "Local\\Yoink.NotificationCapture", out var firstInstance);
        ApplicationConfiguration.Initialize();
        if (!firstInstance)
        {
            MessageBox.Show("Yoink Notification Capture is already running. Check its open window.");
            return;
        }
        try { _ = Package.Current.Id; }
        catch
        {
            MessageBox.Show("Run Install.ps1 first, then open Yoink Notification Capture from Start. " +
                "Windows notification access requires the registered app identity.", "Setup required");
            return;
        }
        Application.Run(new CaptureForm());
    }
}

internal sealed class CaptureForm : Form
{
    private readonly string logDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        "Yoink", "notification-capture", "logs");
    private readonly Button start = new() { Text = "Allow access and start", AutoSize = true };
    private readonly Button stop = new() { Text = "Stop", AutoSize = true, Enabled = false };
    private readonly Label status = new() { Text = "Stopped. No notifications are being recorded.", AutoSize = true, MaximumSize = new(700, 0) };
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 500 };
    private UserNotificationListener? listener;
    private DailyJsonLog? log;
    private CaptureSession? session;
    private bool running;
    private bool polling;
    private DateTimeOffset lastHeartbeat;

    public CaptureForm()
    {
        Text = "Yoink Notification Capture";
        ClientSize = new(760, 350);
        MinimumSize = new(680, 390);
        AutoScaleMode = AutoScaleMode.Dpi;
        var layout = new FlowLayoutPanel { Dock = DockStyle.Fill, Padding = new(20), FlowDirection = FlowDirection.TopDown,
            WrapContents = false, AutoScroll = true };
        layout.Controls.Add(new Label { Text = "Record Discord notifications for analysis", AutoSize = true,
            Font = new Font(Font.FontFamily, 15, FontStyle.Bold), Margin = new(0, 0, 0, 15) });
        layout.Controls.Add(new Label { AutoSize = true, MaximumSize = new(700, 0),
            Text = "Windows will ask for notification access. This app saves Discord notification text locally, " +
                "including any names and links it contains. It stays active while this window is open or minimized. " +
                "No uploads or Yoink actions are performed.", Margin = new(0, 0, 0, 15) });
        var controls = new FlowLayoutPanel { AutoSize = true, WrapContents = true, MaximumSize = new(700, 0) };
        var openLogs = new Button { Text = "Open logs", AutoSize = true };
        var settings = new Button { Text = "Notification access settings", AutoSize = true };
        controls.Controls.AddRange([start, stop, openLogs, settings]);
        layout.Controls.Add(controls);
        layout.Controls.Add(status);
        layout.Controls.Add(new TextBox { Text = logDirectory, ReadOnly = true, Width = 690, Margin = new(0, 15, 0, 10) });
        layout.Controls.Add(new Label { AutoSize = true, MaximumSize = new(700, 0),
            Text = "Captures the native Discord desktop app (Stable, PTB, Canary). Notifications that Discord " +
                "does not send to Windows cannot be recorded. A Windows notification ID is not a Discord message ID." });
        Controls.Add(layout);
        start.Click += async (_, _) => await StartCapture();
        stop.Click += (_, _) => StopCapture("user_stopped");
        openLogs.Click += (_, _) => OpenLogs();
        settings.Click += (_, _) => OpenSettings();
        timer.Tick += async (_, _) => await Poll();
        FormClosing += (_, _) => StopCapture("window_closed");
        FormClosed += (_, _) => timer.Dispose();
    }

    private async Task StartCapture()
    {
        start.Enabled = false;
        try
        {
            listener = UserNotificationListener.Current;
            // This handler runs on the WinForms UI thread, as required for the consent prompt.
            var access = await listener.RequestAccessAsync();
            if (IsDisposed || Disposing) return;
            if (access != UserNotificationListenerAccessStatus.Allowed)
            {
                status.Text = access == UserNotificationListenerAccessStatus.Denied
                    ? "Access denied. Enable Yoink in Notification access settings, then start again."
                    : "Access was not granted. Start again when ready to allow access.";
                start.Enabled = true;
                return;
            }
            log = new(logDirectory);
            session = new(log.Write);
            var now = DateTimeOffset.UtcNow;
            log.Write("session_started", now, new { captureVersion = "0.1.0", pollIntervalMs = timer.Interval,
                osVersion = Environment.OSVersion.VersionString, filter = "discord_desktop", initialSnapshot = "existing" });
            lastHeartbeat = now;
            running = true;
            stop.Enabled = true;
            timer.Start();
            await Poll();
        }
        catch (Exception error) { Fail(error); }
    }

    private async Task Poll()
    {
        if (!running || polling || listener is null || log is null || session is null) return;
        polling = true;
        try
        {
            if (listener.GetAccessStatus() != UserNotificationListenerAccessStatus.Allowed)
            {
                log.Write("access_lost", DateTimeOffset.UtcNow, new { reason = "notification_access_revoked" });
                StopCapture("access_lost");
                status.Text = "Capture stopped: notification access was revoked. Enable access and start again.";
                return;
            }
            var notifications = await listener.GetNotificationsAsync(NotificationKinds.Toast);
            if (!running || IsDisposed || Disposing) return;
            var snapshots = new List<NotificationSnapshot>();
            foreach (var notification in notifications)
            {
                // Exclude other apps before reading any notification text.
                var appId = notification.AppInfo.AppUserModelId;
                var appName = notification.AppInfo.DisplayInfo.DisplayName;
                if (!DiscordApps.Matches(appId, appName)) continue;
                var bindings = notification.Notification.Visual.Bindings.Select(binding => new TextBinding(
                    binding.Template, binding.Language, binding.GetTextElements().Select(text => text.Text).ToArray())).ToArray();
                snapshots.Add(new(notification.Id, appId, appName, notification.CreationTime, bindings));
            }
            var now = DateTimeOffset.UtcNow;
            session.Observe(snapshots, now);
            if (now - lastHeartbeat >= TimeSpan.FromMinutes(1))
            {
                log.Write("heartbeat", now, new { session.Polls, session.Written, session.CurrentDiscordNotifications });
                lastHeartbeat = now;
            }
            status.Text = $"Recording. {session.Written} samples saved this session; " +
                $"{session.CurrentDiscordNotifications} Discord notifications currently in Windows. Last check: {now.ToLocalTime():HH:mm:ss}.";
        }
        catch (Exception error) { if (!IsDisposed && !Disposing) Fail(error); }
        finally
        {
            polling = false;
            if (!running && !IsDisposed && !Disposing) start.Enabled = true;
        }
    }

    private void StopCapture(string reason)
    {
        timer.Stop();
        var wasRunning = running;
        running = false;
        stop.Enabled = false;
        start.Enabled = !polling;
        if (!wasRunning) return;
        try
        {
            log?.Write("session_stopped", DateTimeOffset.UtcNow, new { reason, written = session?.Written ?? 0 });
            status.Text = $"Stopped. {session?.Written ?? 0} samples saved this session.";
        }
        catch (Exception error) { status.Text = $"Stopped; could not write the final log entry: {error.Message}"; }
    }

    private void Fail(Exception error)
    {
        try { log?.Write("capture_error", DateTimeOffset.UtcNow, new { errorType = error.GetType().Name, hresult = error.HResult }); }
        catch { /* The status remains visible even when the disk cannot accept an error record. */ }
        StopCapture("capture_error");
        status.Text = $"Capture stopped: {error.Message} (0x{error.HResult:X8}). Check the log folder and notification access settings.";
        start.Enabled = !polling;
    }

    private void OpenLogs()
    {
        try { Directory.CreateDirectory(logDirectory); Process.Start(new ProcessStartInfo(logDirectory) { UseShellExecute = true }); }
        catch (Exception error) { MessageBox.Show(error.Message, "Could not open logs"); }
    }

    private static void OpenSettings()
    {
        try { Process.Start(new ProcessStartInfo("ms-settings:privacy-notifications") { UseShellExecute = true }); }
        catch (Exception error) { MessageBox.Show(error.Message, "Could not open settings"); }
    }
}
