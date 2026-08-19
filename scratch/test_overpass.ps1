$headers = @{
    "User-Agent" = "AI-Transportation-Test/1.0"
    "Accept" = "application/json"
}

Write-Host "=== TEST: Overpass API for K.L.N. / KLN in OSM ==="
$overpassQuery = @"
[out:json][timeout:15];
(
  node["name"~"KLN|K.L.N|K L N",i](8.0,76.0,14.0,81.0);
  way["name"~"KLN|K.L.N|K L N",i](8.0,76.0,14.0,81.0);
  relation["name"~"KLN|K.L.N|K L N",i](8.0,76.0,14.0,81.0);
);
out center 20;
"@

try {
    $url = "https://overpass-api.de/api/interpreter"
    $body = "data=" + [System.Uri]::EscapeDataString($overpassQuery)
    $res = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -Headers $headers -TimeoutSec 15
    Write-Host "Overpass Elements Count: $($res.elements.Count)"
    $res.elements | ForEach-Object {
        $name = $_.tags.name
        $lat = if ($_.lat) { $_.lat } else { $_.center.lat }
        $lon = if ($_.lon) { $_.lon } else { $_.center.lon }
        Write-Host "Element: id=$($_.id) type=$($_.type) name='$name' lat=$lat lon=$lon amenity=$($_.tags.amenity)"
    }
} catch {
    Write-Host "Overpass Error: $_"
}

Write-Host "`n=== TEST: Overpass API without bounding box for 'K.L.N. College' ==="
$overpassGlobal = @"
[out:json][timeout:15];
(
  node["name"~"K\.?L\.?N\.?",i];
  way["name"~"K\.?L\.?N\.?",i];
  relation["name"~"K\.?L\.?N\.?",i];
);
out center 20;
"@

try {
    $body2 = "data=" + [System.Uri]::EscapeDataString($overpassGlobal)
    $res2 = Invoke-RestMethod -Uri "https://overpass-api.de/api/interpreter" -Method Post -Body $body2 -ContentType "application/x-www-form-urlencoded" -Headers $headers -TimeoutSec 15
    Write-Host "Global Overpass Elements Count: $($res2.elements.Count)"
    $res2.elements | ForEach-Object {
        $name = $_.tags.name
        $lat = if ($_.lat) { $_.lat } else { $_.center.lat }
        $lon = if ($_.lon) { $_.lon } else { $_.center.lon }
        Write-Host "Element: id=$($_.id) type=$($_.type) name='$name' lat=$lat lon=$lon tags=$($_.tags | ConvertTo-Json -Compress)"
    }
} catch {
    Write-Host "Global Overpass Error: $_"
}
