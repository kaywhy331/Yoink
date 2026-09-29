using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace Yoink.Tray;

/// <summary>The tray icon: a "Y" tile whose colour is the server's state.</summary>
internal static class TrayIcons
{
    public static readonly Color Running = Color.FromArgb(0x16, 0xA3, 0x4A);
    public static readonly Color Starting = Color.FromArgb(0xD9, 0x77, 0x06);
    public static readonly Color Problem = Color.FromArgb(0xDC, 0x26, 0x26);
    public static readonly Color Stopped = Color.FromArgb(0x6B, 0x72, 0x80);

    public static Icon Create(Color fill)
    {
        using var bitmap = new Bitmap(32, 32);
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.SmoothingMode = SmoothingMode.AntiAlias;
            graphics.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            using var path = new GraphicsPath();
            const int r = 8;
            path.AddArc(0, 0, r * 2, r * 2, 180, 90);
            path.AddArc(31 - r * 2, 0, r * 2, r * 2, 270, 90);
            path.AddArc(31 - r * 2, 31 - r * 2, r * 2, r * 2, 0, 90);
            path.AddArc(0, 31 - r * 2, r * 2, r * 2, 90, 90);
            path.CloseFigure();
            using var brush = new SolidBrush(fill);
            graphics.FillPath(brush, path);
            using var font = new Font("Segoe UI", 17, FontStyle.Bold, GraphicsUnit.Pixel);
            using var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center };
            graphics.DrawString("Y", font, Brushes.White, new RectangleF(0, 1, 32, 32), format);
        }
        var handle = bitmap.GetHicon();
        try
        {
            return (Icon)Icon.FromHandle(handle).Clone();
        }
        finally
        {
            DestroyIcon(handle);
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr handle);
}
