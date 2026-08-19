$headers = @{
    "User-Agent" = "AI-Transportation-System-Inspection/1.0"
    "Accept" = "application/json"
}

Write-Host "=== Search OSM for objects around Pottapalayam / Madurai coords (9.8, 78.1) ==="
# Bounding box around Pottapalayam / Sivaganga: minLon, minLat, maxLon, maxLat
# 78.10, 9.75, 78.25, 9.90
$osmUrl = "https://api.openstreetmap.org/api/0.6/map?bbox=78.15,9.78,78.22,9.85"

try {
    $res = Invoke-RestMethod -Uri $osmUrl -Headers $headers -TimeoutSec 15
    Write-Host "OSM Map XML retrieved successfully"
    # Find all nodes and ways with 'kln' or 'college' or 'engineering'
    $nodes = $res.osm.node | Where-Object { 
        $n = $_
        $hasTag = $false
        if ($n.tag) {
            $tags = @($n.tag)
            foreach ($t in $tags) {
                if ($t.k -eq "name" -or $t.v -match "kln|engineering|college|pottapalayam") {
                    Write-Host "Node $($n.id): k=$($t.k), v=$($t.v) (lat=$($n.lat), lon=$($n.lon))"
                    $hasTag = $true
                }
            }
        }
        $hasTag
    }
    
    $ways = $res.osm.way | Where-Object {
        $w = $_
        if ($w.tag) {
            $tags = @($w.tag)
            foreach ($t in $tags) {
                if ($t.k -eq "name" -or $t.v -match "kln|engineering|college|pottapalayam") {
                    Write-Host "Way $($w.id): k=$($t.k), v=$($t.v)"
                }
            }
        }
    }
} catch {
    Write-Host "OSM API Map Error: $_"
}
