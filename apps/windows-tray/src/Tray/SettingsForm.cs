using Yoink.Tray.Core;

namespace Yoink.Tray;

/// <summary>Port, data folder and startup choices. Returns the edited settings; saving is the caller's.</summary>
internal sealed class SettingsForm : Form
{
    private readonly NumericUpDown port = new() { Minimum = 1024, Maximum = 65535, Width = 100 };
    private readonly TextBox dataDirectory = new() { Width = 360 };
    private readonly CheckBox startWithWindows = new() { Text = "Start Yoink when I sign in to Windows", AutoSize = true };
    private readonly CheckBox startServerOnLaunch = new() { Text = "Start the server when the tray app starts", AutoSize = true };
    private readonly TraySettings original;
    private readonly string defaultDataDirectory;

    public TraySettings Result { get; private set; }

    public SettingsForm(TraySettings settings, YoinkPaths paths)
    {
        original = settings;
        Result = settings;
        defaultDataDirectory = paths.DefaultDataDirectory;
        Text = "Yoink settings";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        AutoSize = true;
        AutoSizeMode = AutoSizeMode.GrowAndShrink;
        Padding = new Padding(12);
        Font = SystemFonts.MessageBoxFont ?? Font;

        port.Value = settings.Port;
        dataDirectory.Text = settings.ResolvedDataDirectory(paths);
        startWithWindows.Checked = settings.StartWithWindows;
        startServerOnLaunch.Checked = settings.StartServerOnLaunch;

        var browse = new Button { Text = "Browse…", AutoSize = true };
        browse.Click += (_, _) =>
        {
            using var dialog = new FolderBrowserDialog { SelectedPath = dataDirectory.Text, Description = "Folder for Yoink's database and keys" };
            if (dialog.ShowDialog(this) == DialogResult.OK) dataDirectory.Text = dialog.SelectedPath;
        };
        var save = new Button { Text = "Save", DialogResult = DialogResult.None, AutoSize = true };
        var cancel = new Button { Text = "Cancel", DialogResult = DialogResult.Cancel, AutoSize = true };
        save.Click += (_, _) => Save();
        AcceptButton = save;
        CancelButton = cancel;

        var layout = new TableLayoutPanel { ColumnCount = 3, AutoSize = true, Dock = DockStyle.Fill };
        layout.Controls.Add(new Label { Text = "Port", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 0);
        layout.Controls.Add(port, 1, 0);
        layout.Controls.Add(new Label { Text = "Data folder", AutoSize = true, Anchor = AnchorStyles.Left }, 0, 1);
        layout.Controls.Add(dataDirectory, 1, 1);
        layout.Controls.Add(browse, 2, 1);
        layout.Controls.Add(new Label
        {
            Text = "Changing the data folder does not move existing data. The Chrome companion uses port 32991; change the port only if you also change the companion.",
            AutoSize = true,
            MaximumSize = new Size(480, 0),
            ForeColor = SystemColors.GrayText
        }, 1, 2);
        layout.SetColumnSpan(layout.GetControlFromPosition(1, 2)!, 2);
        layout.Controls.Add(startWithWindows, 1, 3);
        layout.SetColumnSpan(startWithWindows, 2);
        layout.Controls.Add(startServerOnLaunch, 1, 4);
        layout.SetColumnSpan(startServerOnLaunch, 2);
        var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill };
        buttons.Controls.Add(cancel);
        buttons.Controls.Add(save);
        layout.Controls.Add(buttons, 1, 5);
        layout.SetColumnSpan(buttons, 2);
        Controls.Add(layout);
    }

    private void Save()
    {
        var folder = dataDirectory.Text.Trim();
        var candidate = original with
        {
            Port = (int)port.Value,
            DataDirectory = string.Equals(folder, defaultDataDirectory, StringComparison.OrdinalIgnoreCase) ? "" : folder,
            StartWithWindows = startWithWindows.Checked,
            StartServerOnLaunch = startServerOnLaunch.Checked
        };
        var problems = candidate.Problems();
        if (problems.Count > 0)
        {
            MessageBox.Show(this, string.Join(Environment.NewLine, problems), "Yoink settings", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        Result = candidate;
        DialogResult = DialogResult.OK;
        Close();
    }
}
