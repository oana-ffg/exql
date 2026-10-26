using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace Exql.Desktop;

internal static class WindowTheme
{
    public static void ApplyDarkTitleBar(Window window)
    {
        window.SourceInitialized += (_, _) =>
        {
            // These documented DWM attributes are available on Windows 11.
            if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000)) return;
            var handle = new WindowInteropHelper(window).Handle;
            SetAttribute(handle, 20, 1); // DWMWA_USE_IMMERSIVE_DARK_MODE
            SetAttribute(handle, 35, 0x00251b14); // DWMWA_CAPTION_COLOR, COLORREF for #141b25
            SetAttribute(handle, 36, 0x00e7dcd5); // DWMWA_TEXT_COLOR, COLORREF for #d5dce7
        };
    }

    private static void SetAttribute(IntPtr window, int attribute, int value) =>
        Marshal.ThrowExceptionForHR(DwmSetWindowAttribute(window, attribute, ref value, sizeof(int)));

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr window, int attribute, ref int value, int size);
}
