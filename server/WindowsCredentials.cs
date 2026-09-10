using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

namespace Exql;

// Generic credentials are encrypted by Windows and scoped to the signed-in user's vault.
internal static class WindowsCredentials
{
    private const uint Generic = 1;
    private const int NotFound = 1168;
    private static string Target(string id) => $"ExQL/connection/{id}";

    public static void Write(string id, string username, string password)
    {
        var bytes = Encoding.Unicode.GetBytes(password);
        if (bytes.Length > 2560) throw new InputException("Credential exceeds the Windows Credential Manager limit of 1,280 UTF-16 characters. Shorten the connection string or connect without saving.");
        var pointer = Marshal.AllocHGlobal(Math.Max(bytes.Length, 1));
        try
        {
            Marshal.Copy(bytes, 0, pointer, bytes.Length);
            var credential = new Credential { Type = Generic, TargetName = Target(id), CredentialBlobSize = (uint)bytes.Length, CredentialBlob = pointer, Persist = 2, UserName = username };
            if (!CredWrite(ref credential, 0)) throw Failure();
        }
        finally
        {
            for (var i = 0; i < bytes.Length; i++) Marshal.WriteByte(pointer, i, 0);
            Marshal.FreeHGlobal(pointer);
            Array.Clear(bytes);
        }
    }
    public static string Read(string id)
    {
        if (!CredRead(Target(id), Generic, 0, out var pointer))
        {
            if (Marshal.GetLastWin32Error() == NotFound) throw new InputException("The saved credential is missing. Edit this connection and enter its password again.");
            throw Failure();
        }
        try
        {
            var credential = Marshal.PtrToStructure<Credential>(pointer);
            return Marshal.PtrToStringUni(credential.CredentialBlob, (int)credential.CredentialBlobSize / 2) ?? "";
        }
        finally { CredFree(pointer); }
    }
    public static void Delete(string id)
    {
        if (!CredDelete(Target(id), Generic, 0) && Marshal.GetLastWin32Error() != NotFound) throw Failure();
    }
    private static InputException Failure() => new($"Windows Credential Manager could not complete the operation: {new Win32Exception(Marshal.GetLastWin32Error()).Message}");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct Credential
    {
        public uint Flags;
        public uint Type;
        [MarshalAs(UnmanagedType.LPWStr)] public string? TargetName;
        [MarshalAs(UnmanagedType.LPWStr)] public string? Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        [MarshalAs(UnmanagedType.LPWStr)] public string? TargetAlias;
        [MarshalAs(UnmanagedType.LPWStr)] public string? UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CredWrite(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CredRead(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CredDelete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] private static extern void CredFree(IntPtr credential);
}
