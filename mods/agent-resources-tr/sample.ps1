param([Parameter(Mandatory=$true)][string]$RootIds)
$ErrorActionPreference = 'Stop'
if ($RootIds -notmatch '^[1-9][0-9]*(,[1-9][0-9]*)*$' -or $RootIds.Length -gt 4096) { throw 'Invalid process IDs' }
$roots = @($RootIds.Split(',') | ForEach-Object { [int]$_ } | Select-Object -Unique)
$snapshot = @(Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId,CreationDate,KernelModeTime,UserModeTime,WorkingSetSize)
$byId = @{}
foreach ($proc in $snapshot) { $byId[[int]$proc.ProcessId] = $proc }
$selected = [Collections.Generic.HashSet[int]]::new()
foreach ($rootId in $roots) { if ($byId.ContainsKey($rootId)) { [void]$selected.Add($rootId) } }
do {
  $added = $false
  foreach ($proc in $snapshot) {
    $parentId = [int]$proc.ParentProcessId
    if ($selected.Contains($parentId) -and $byId.ContainsKey($parentId) -and $proc.CreationDate -ge $byId[$parentId].CreationDate) {
      if ($selected.Add([int]$proc.ProcessId)) { $added = $true }
    }
  }
} while ($added)
$rows = @(
  foreach ($proc in $snapshot) {
    if (-not $selected.Contains([int]$proc.ProcessId)) { continue }
    [pscustomobject]@{
      pid = [int]$proc.ProcessId
      parent = [int]$proc.ParentProcessId
      started = ([DateTimeOffset]$proc.CreationDate).ToUnixTimeMilliseconds()
      cpu = ([double]$proc.KernelModeTime + [double]$proc.UserModeTime) / 10000000
      ram = [double]$proc.WorkingSetSize
    }
  }
)
[pscustomobject]@{ at = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); cores = [Environment]::ProcessorCount; processes = $rows } | ConvertTo-Json -Depth 4 -Compress
