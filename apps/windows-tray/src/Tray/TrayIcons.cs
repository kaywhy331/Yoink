using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace Yoink.Tray;

/// <summary>The tray icon: the Yoink mark on a tile whose colour is the server's state.</summary>
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
            // The Yoink mark: a script check mark with a stem down from its point,
            // drawn in the same 64-unit box as apps/web/user.js YOINK_MARK_CHECK/STEM.
            using var mark = new GraphicsPath();
            mark.AddBezier(15f, 26f, 19.5f, 28f, 23.5f, 32.5f, 27.5f, 39f);
            mark.AddBezier(27.5f, 39f, 32.5f, 27.5f, 40f, 17.5f, 50f, 10f);
            mark.StartFigure();
            mark.AddBezier(27.5f, 39f, 27.5f, 45.5f, 27f, 50.5f, 25.6f, 55f);
            using var scale = new Matrix();
            scale.Scale(0.5f, 0.5f);
            mark.Transform(scale);
            using var pen = new Pen(Color.White, 3.6f) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round };
            graphics.DrawPath(pen, mark);
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
