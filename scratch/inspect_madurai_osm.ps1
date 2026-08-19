$headers = @{
    "User-Agent" = "AI-Transportation-System-Auditor/2.0"
    "Accept" = "application/json"
}

# Targeted bbox around Madurai - Sivaganga: south=9.70, west=78.00, north=10.05, east=78.35
$query = @"
[out:json][timeout:15];
(
  node(9.70,78.00,10.05,78.35)["amenity"];
  way(9.70,78.00,10.05,78.35)["amenity"];
  node(9.70,78.00,10.05,78.35)["name"];
  way(9.70,78.00,10.05,78.35)["name"];
);
out tags center;
"@

$mirrors = @(
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter"
)

foreach ($m in $mirrors) {
    try {
        Write-Host "Querying $m..."
        $body = "data=" + [System.Uri]::EscapeDataString($query)
        $res = Invoke-RestMethod -Uri $m -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -Headers $headers -TimeoutSec 15
        Write-Host "Total elements retrieved in Madurai-Sivaganga box: $($res.elements.Count)"
        
        $matches = $res.elements | Where-Object { 
            $name = $_.tags.name
            $name -match "KLN|K\.?L\.?N|Potta|Solamalai|Velammal|Engineering|College"
        }
        
        Write-Host "Matching elements: $($matches.Count)"
        $matches | ForEach-Object {
            $lat = if ($_.lat) { $_.lat } else { $_.center.lat }
            $lon = if ($_.lon) { $_.lon } else { $_.center.lon }
            Write-Host "   -> $($_.tags.name) | Amenity: $($_.tags.amenity) | Lat: $lat | Lon: $lon"
        }
        break
    } catch {
        Write-Host "Error with $m : $_"
    }
}
