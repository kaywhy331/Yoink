using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using Yoink.Tray.Core;

namespace Yoink.Tray;

/// <summary>
/// Hands-off operation: automatic updates from the development workstation's
/// depot, diagnostics sent there, a watchdog that restarts a server that stops
/// answering, and the Chrome companion kept in one folder the tray updates.
/// </summary>
internal sealed partial class TrayApp
{
    private static readonly TimeSpan UpdateInterval = TimeSpan.FromHours(1);
    private static readonly TimeSpan BusyRetryInterval = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan DiagnosticsInterval = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan WatchdogGrace = TimeSpan.FromMinutes(3);

    private readonly System.Windows.Forms.Timer updateTimer = new();
    private readonly System.Windows.Forms.Timer diagnosticsTimer = new() { Interval = (int)DiagnosticsInterval.TotalMilliseconds };
    private readonly ToolStripMenuItem updateStatusItem = new("Updates: not checked yet") { Enabled = false };
    private CompanionInstaller? companion;
    private DepotClient? depot;
    private DateTimeOffset? unreachableSince;
    private bool updating;
    private bool uploading;

    private static string PinnedReleaseKey()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("release-public-key.txt")
            ?? throw new InvalidOperationException("The release public key is missing from this build.");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd().Trim();
    }

    /// <summary>The tray's own version without build metadata ("1.28.7+abc" → "1.28.7").</summary>
    private static string TrayVersion() => Application.ProductVersion.Split('+')[0];

    private void AddHandsOffMenu(ContextMenuStrip menu, int index)
    {
        menu.Items.Insert(index, updateStatusItem);
        menu.Items.Insert(index + 1, new ToolStripMenuItem("Check for updates", null, async (_, _) => await Guard("check for updates", () => CheckForUpdatesAsync(manual: true))));
        menu.Items.Insert(index + 2, new ToolStripMenuItem("Send diagnostics", null, async (_, _) => await Guard("send diagnostics", () => SendDiagnosticsAsync("manual", manual: true))));
        menu.Items.Insert(index + 3, new ToolStripMenuItem("Set up Chrome companion…", null, (_, _) => ShowCompanionSetup()));
        menu.Items.Insert(index + 4, new ToolStripSeparator());
    }

    /// <summary>Called once the server is prepared: config, companion, timers.</summary>
    private void StartHandsOff()
    {
        CleanUpOldTrayExecutable();
        var shipped = Path.Combine(AppContext.BaseDirectory, "depot.json");
        if (DepotConfig.Adopt(paths, shipped)) trayLog.Write("[tray] update service settings adopted from depot.json");
        var config = DepotConfig.Load(paths);
        depot = config is null ? null : new DepotClient(new HttpClient { Timeout = TimeSpan.FromMinutes(5) }, config, PinnedReleaseKey());
        companion = new CompanionInstaller(paths);
        EnsureCompanion();
        updateStatusItem.Text = depot is null ? "Updates: no update service set up" : "Updates: checking soon";
        updateTimer.Interval = (int)TimeSpan.FromMinutes(1).TotalMilliseconds;
        updateTimer.Tick += async (_, _) => await CheckForUpdatesAsync(manual: false);
        updateTimer.Start();
        diagnosticsTimer.Tick += async (_, _) => await SendDiagnosticsAsync("scheduled", manual: false);
        diagnosticsTimer.Start();
    }

    /// <summary>Puts the active server's companion into the managed folder when it is missing or a different version.</summary>
    private void EnsureCompanion()
    {
        if (companion is null || manifest is null) return;
        if (companion.InstalledVersion() == manifest.Version) return;
        var zip = CompanionInstaller.PackagedZip(paths.ServerDirectory(manifest.Version), manifest.Version);
        if (zip is null) return;
        var first = companion.Install(zip);
        trayLog.Write($"[tray] companion {manifest.Version} installed in {companion.Directory}");
        if (first) ShowCompanionSetup();
    }

    private void ShowCompanionSetup()
    {
        if (companion is null) return;
        try { Clipboard.SetText(companion.Directory); } catch (System.Runtime.InteropServices.ExternalException) { /* clipboard busy */ }
        MessageBox.Show(
            "Yoink keeps the Chrome companion up to date in one folder. Load it in Chrome once:" + Environment.NewLine + Environment.NewLine
            + "1. In Chrome, open chrome://extensions and turn on Developer mode." + Environment.NewLine
            + "2. Remove any older Yoink Companion there." + Environment.NewLine
            + "3. Choose Load unpacked and paste this folder (it is on your clipboard):" + Environment.NewLine
            + "   " + companion.Directory + Environment.NewLine
            + "4. Pair it: Yoink › Settings › Chrome › Create pairing code, then enter the code in the Yoink popup." + Environment.NewLine + Environment.NewLine
            + "After this, updates reach the companion by themselves.",
            "Set up the Chrome companion", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    /// <summary>
    /// Installs a newer signed release by itself: waits while a cart add is in
    /// flight, then updates the server, the companion and the tray app.
    /// </summary>
    private async Task CheckForUpdatesAsync(bool manual)
    {
        updateTimer.Interval = (int)UpdateInterval.TotalMilliseconds;
        if (depot is null)
        {
            if (manual) throw new InvalidOperationException("No update service is set up. Install a Yoink release that includes depot.json.");
            return;
        }
        if (updating || exiting) return;
        updating = true;
        try
        {
            var release = await depot.LatestAsync();
            var checkedAt = DateTime.Now.ToString("HH:mm");
            if (release is null)
            {
                updateStatusItem.Text = $"Updates: none published · checked {checkedAt}";
                return;
            }
            var serverNewer = manifest is null || ServerVersion.Compare(release.Version, manifest.Version) > 0;
            var trayNewer = ServerVersion.Compare(release.Version, TrayVersion()) > 0;
            if (!serverNewer && !trayNewer)
            {
                updateStatusItem.Text = $"Up to date · {release.Version} · checked {checkedAt}";
                if (manual) Notify("Yoink is up to date", $"Version {release.Version} is installed.", ToolTipIcon.Info);
                return;
            }
            if (health.ActionsInFlight > 0 && !manual)
            {
                updateStatusItem.Text = $"Update {release.Version} waits for a cart add to finish";
                updateTimer.Interval = (int)BusyRetryInterval.TotalMilliseconds;
                return;
            }
            updateStatusItem.Text = $"Updating to {release.Version}…";
            trayLog.Write($"[tray] updating to {release.Version} (server {(serverNewer ? "yes" : "no")}, tray {(trayNewer ? "yes" : "no")})");
            var zip = await depot.DownloadAsync(release, paths.UpdatesDirectory);
            try
            {
                if (serverNewer)
                {
                    var wasRunning = supervisor.State != ServerProcessState.Stopped || settings.StartServerOnLaunch;
                    await supervisor.StopAsync();
                    var installed = await Task.Run(() => installer.Install(zip));
                    settings = settings with { ActiveServerVersion = installed.Version };
                    settings.Save(paths);
                    LoadManifest();
                    EnsureCompanion();
                    if (wasRunning) await StartServerAsync();
                }
                Notify("Yoink updated", $"Yoink {release.Version} is installed and running. The Chrome companion updates itself.", ToolTipIcon.Info);
                updateStatusItem.Text = $"Up to date · {release.Version}";
                if (trayNewer) await RestartIntoNewTrayAsync(zip);
            }
            finally
            {
                try { File.Delete(zip); } catch (IOException) { /* removed on the next update */ }
            }
        }
        catch (Exception error) when (!manual)
        {
            updateStatusItem.Text = "Updates: last check failed (see logs)";
            trayLog.Write($"[tray] update check failed: {error.Message}");
        }
        finally
        {
            updating = false;
        }
    }

    /// <summary>
    /// Replaces Yoink.exe from the release and starts the new one. A running
    /// executable can be renamed on Windows, so the old file moves aside and is
    /// removed on the next start; the path (and the sign-in entry) stays the same.
    /// </summary>
    private async Task RestartIntoNewTrayAsync(string releaseZip)
    {
        var current = Environment.ProcessPath ?? throw new InvalidOperationException("The tray's own path is unknown.");
        var staged = current + ".new";
        using (var archive = ZipFile.OpenRead(releaseZip))
        {
            var entry = archive.GetEntry("Yoink.exe");
            if (entry is null) return;
            entry.ExtractToFile(staged, overwrite: true);
            var shippedConfig = archive.GetEntry("depot.json");
            if (shippedConfig is not null)
            {
                var configCopy = Path.Combine(Path.GetDirectoryName(current)!, "depot.json");
                shippedConfig.ExtractToFile(configCopy, overwrite: true);
            }
        }
        var aside = current + ".old";
        if (File.Exists(aside)) File.Delete(aside);
        File.Move(current, aside);
        File.Move(staged, current);
        trayLog.Write("[tray] restarting into the updated tray app");
        exiting = true;
        healthTimer.Stop();
        updateTimer.Stop();
        diagnosticsTimer.Stop();
        await supervisor.StopAsync();
        Process.Start(new ProcessStartInfo(current, "--after-update") { UseShellExecute = false });
        ExitThread();
    }

    private static void CleanUpOldTrayExecutable()
    {
        var aside = (Environment.ProcessPath ?? "") + ".old";
        try { if (File.Exists(aside)) File.Delete(aside); } catch (IOException) { /* still exiting; next start */ } catch (UnauthorizedAccessException) { }
    }

    /// <summary>Uploads a diagnostics bundle to the depot; scheduled failures are only logged.</summary>
    private async Task SendDiagnosticsAsync(string reason, bool manual)
    {
        if (depot is null)
        {
            if (manual) throw new InvalidOperationException("No update service is set up, so diagnostics have nowhere to go.");
            return;
        }
        if (uploading) return;
        uploading = true;
        try
        {
            var sent = DiagnosticsBundle.LoadSent(paths);
            var info = new Dictionary<string, object?>
            {
                ["reason"] = reason,
                ["capturedAt"] = DateTimeOffset.Now.ToString("o"),
                ["trayVersion"] = Application.ProductVersion,
                ["serverVersion"] = manifest?.Version,
                ["companionVersion"] = companion?.InstalledVersion(),
                ["serverState"] = supervisor.State.ToString(),
                ["serverStartedAt"] = supervisor.StartedAt.ToString("o"),
                ["lastExitCode"] = supervisor.LastExitCode,
                ["lastProblem"] = supervisor.LastProblem,
                ["recentErrors"] = supervisor.RecentErrors,
                ["health"] = new { health.Health, health.Version, health.Summary, health.ActionsInFlight },
                ["updateStatus"] = updateStatusItem.Text,
                ["os"] = Environment.OSVersion.VersionString,
                ["machine"] = Environment.MachineName,
                ["diskFreeBytes"] = TryFreeBytes(paths.Root)
            };
            var bundle = await DiagnosticsBundle.BuildAsync(paths, settings, http, info, sent, DateTimeOffset.Now);
            await depot.UploadDiagnosticsAsync(bundle.Zip);
            foreach (var file in bundle.EvidenceIncluded) sent.Add(file);
            DiagnosticsBundle.SaveSent(paths, sent);
            trayLog.Write($"[tray] diagnostics sent ({reason}, {bundle.Zip.Length / 1024} KB, {bundle.EvidenceIncluded.Count} store pages)");
            if (manual) Notify("Diagnostics sent", "The development workstation has the latest logs and status.", ToolTipIcon.Info);
        }
        catch (Exception error) when (!manual)
        {
            trayLog.Write($"[tray] diagnostics upload failed: {error.Message}");
        }
        finally
        {
            uploading = false;
        }
    }

    private static long? TryFreeBytes(string path)
    {
        try { return new DriveInfo(Path.GetPathRoot(Path.GetFullPath(path))!).AvailableFreeSpace; } catch (Exception) { return null; }
    }

    /// <summary>
    /// A running server that has not answered for three minutes (and has had
    /// three minutes to start) is restarted once per episode, and diagnostics are sent.
    /// </summary>
    private async Task WatchdogAsync()
    {
        if (exiting || busy || updating || supervisor.State != ServerProcessState.Running)
        {
            unreachableSince = null;
            return;
        }
        if (health.Health != ServerHealth.Unreachable)
        {
            unreachableSince = null;
            return;
        }
        var now = DateTimeOffset.Now;
        unreachableSince ??= now;
        if (now - unreachableSince < WatchdogGrace || now - supervisor.StartedAt < WatchdogGrace) return;
        unreachableSince = null;
        trayLog.Write("[tray] watchdog: the server stopped answering for 3 minutes; restarting it");
        Notify("Yoink restarted", "Yoink stopped answering, so the tray restarted it. Diagnostics were sent.", ToolTipIcon.Warning);
        await SendDiagnosticsAsync("watchdog", manual: false);
        await supervisor.StopAsync();
        await StartServerAsync();
    }
}
