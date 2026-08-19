$headers = @{
    "User-Agent" = "AI-Transportation-System-Inspection/1.0"
    "Accept" = "application/json"
}

$osmUrl = "https://api.openstreetmap.org/api/0.6/map?bbox=78.15,9.80,78.22,9.88"
$res = Invoke-RestMethod -Uri $osmUrl -Headers $headers -TimeoutSec 15

Write-Host "Total nodes: $($res.osm.node.Count)"
Write-Host "Total ways: $($res.osm.way.Count)"

$found = 0
foreach ($w in $res.osm.way) {
    if ($w.tag) {
        $tags = @($w.tag)
        foreach ($t in $tags) {
            if ($t.k -eq "name") {
                Write-Host "Way $($w.id) name: $($t.v)"
                $found++
            }
        }
    }
}

foreach ($n in $res.osm.node) {
    if ($n.tag) {
        $tags = @($n.tag)
        foreach ($t in $tags) {
            if ($t.k -eq "name") {
                Write-Host "Node $($n.id) name: $($t.v) (lat=$($n.lat), lon=$($n.lon))"
                $found++
            }
        }
    }
}
Write-Host "Total named features: $found"
