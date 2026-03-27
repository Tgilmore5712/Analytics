param([string]$Path)
$json = Get-Content -Raw -Path $Path | ConvertFrom-Json -Depth 100
$matches = New-Object System.Collections.Generic.List[object]
function Walk($node, [string]$p) {
  if ($null -eq $node) { return }
  if ($node -is [System.Collections.IEnumerable] -and -not ($node -is [string]) -and -not ($node.PSObject.Properties.Name)) {
    $i = 0
    foreach ($item in $node) {
      Walk $item ($p + '[' + $i + ']')
      $i++
    }
    return
  }
  $props = $node.PSObject.Properties
  if ($props -and $props.Count -gt 0) {
    foreach ($prop in $props) {
      $key = [string]$prop.Name
      $next = if ($p) { $p + '.' + $key } else { $key }
      if ($key.ToLower().Contains('name')) {
        $matches.Add([pscustomobject]@{ key = $key; path = $next })
      }
      Walk $prop.Value $next
    }
  }
}
Walk $json '$'
$grouped = $matches | Group-Object key | Sort-Object Name
$result = [pscustomobject]@{
  file = $Path
  totalMatches = $matches.Count
  uniqueKeys = $grouped.Count
  keys = @($grouped | ForEach-Object {
    [pscustomobject]@{
      key = $_.Name
      count = $_.Count
      samplePaths = @($_.Group | Select-Object -First 5 -ExpandProperty path)
    }
  })
}
$result | ConvertTo-Json -Depth 8
