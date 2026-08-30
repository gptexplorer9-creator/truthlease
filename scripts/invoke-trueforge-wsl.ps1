param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("setup", "run")]
  [string]$Mode
)

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$drive = [System.IO.Path]::GetPathRoot($projectRoot).Substring(0, 1).ToLowerInvariant()
$relativePath = $projectRoot.Substring(3).Replace([char]92, [char]47)
$linuxProjectRoot = "/mnt/$drive/$relativePath"
if (-not $linuxProjectRoot.StartsWith("/mnt/")) {
  throw "TruthLease must be on a Windows drive mounted under /mnt in Ubuntu WSL."
}

$script = if ($Mode -eq "setup") {
  "./scripts/setup-trueforge-wsl.sh"
} else {
  "./scripts/run-trueforge-wsl.sh"
}

& wsl.exe -d Ubuntu --cd $linuxProjectRoot bash $script
exit $LASTEXITCODE
