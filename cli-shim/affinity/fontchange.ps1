Add-Type @"
using System; using System.Runtime.InteropServices;
public static class F {
  [DllImport("gdi32.dll", CharSet=CharSet.Unicode)] public static extern int AddFontResourceW(string f);
  [DllImport("user32.dll")] public static extern IntPtr SendMessageTimeout(IntPtr h, uint m, IntPtr w, IntPtr l, uint f, uint t, out IntPtr r);
}
"@
# Re-announces installed fonts (paths as arguments) to this session: Affinity drops per-user
# fonts across restarts and picks them up again, after a short delay, from WM_FONTCHANGE.
foreach ($p in $args) { "{0} -> {1}" -f $p, [F]::AddFontResourceW($p) }
$r = [IntPtr]::Zero
[void][F]::SendMessageTimeout([IntPtr]0xffff, 0x001D, [IntPtr]::Zero, [IntPtr]::Zero, 2, 5000, [ref]$r)
"broadcast WM_FONTCHANGE"
