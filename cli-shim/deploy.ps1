# Push cli-shim into the installed Quire app and restart it.
#
# The desktop app does not run this folder — it runs its own copy under the
# packaged app's LocalCache, so an edit here changes nothing until it is copied
# across. That is why a fixed shim can appear not to work: the running process
# is the old one, from the other path.
#
# ponytail: copy + restart, no build step. This repo IS the source; the app dir
# is a deploy target and must never be edited directly.
$src = Split-Path -Parent $MyInvocation.MyCommand.Path
# The install folder is named after productName. That becomes "Quire" only on
# the next build, so both names are accepted while the old build is installed.
$base = Join-Path $env:LOCALAPPDATA "Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local"
$dst = @("$base\Quire\cli-shim", "$base\InkDesk\cli-shim") | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not (Test-Path $dst)) { Write-Error "Quire is not installed at $dst"; exit 1 }

# Stop whatever is serving 8787 so the files are not in use and the new code
# actually takes effect — a running Node holds its modules in memory.
$conns = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  Write-Output "stopping shim pid $($c.OwningProcess)"
  Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
}
if ($conns) { Start-Sleep -Milliseconds 600 }

# node_modules and any local state stay put; only source is overwritten.
foreach ($item in @("*.mjs", "*.html", "affinity", "studio-patch", "assets")) {
  Copy-Item "$src\$item" $dst -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output "deployed $src -> $dst"

$node = (Get-Command node).Source
Start-Process -FilePath $node -ArgumentList "$dst\server.mjs" -WindowStyle Hidden
Start-Sleep -Seconds 2
try {
  $r = Invoke-RestMethod -Uri "http://127.0.0.1:8787/mcp/servers" -TimeoutSec 5
  $n = $r.servers.PSObject.Properties.Count
  Write-Output "shim restarted - $n MCP servers discovered"
} catch {
  $msg = $_.Exception.Message
  Write-Output "shim restarted, but /mcp/servers did not answer yet: $msg"
}
