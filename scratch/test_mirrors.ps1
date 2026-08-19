$headers = @{
    "User-Agent" = "AI-Transportation-System-Diagnosis/1.0 (contact@aitransport.local)"
    "Accept" = "application/json"
}

Write-Host "=== TEST: Multiple Overpass Mirrors for 'KLN' or 'K.L.N.' ==="
$query = @"
[out:json][timeout:10];
(
  nwr["amenity"="college"]["name"~"KLN|K\.?L\.?N\.?",i];
  nwr["amenity"="university"]["name"~"KLN|K\.?L\.?N\.?",i];
  nwr["name"~"KLN College|K\.L\.N\. College|K L N College",i];
);
out center 10;
"@

$mirrors = @(
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
)

foreach ($m in $mirrors) {
    Write-Host "Testing mirror: $m"
    try {
        $body = "data=" + [System.Uri]::EscapeDataString($query)
        $res = Invoke-RestMethod -Uri $m -Method Post -Body $body -ContentType "application/x-www-form-urlencoded" -Headers $headers -TimeoutSec 8
        Write-Host "SUCCESS from $m! Count: $($res.elements.Count)"
        $res.elements | ForEach-Object {
            $lat = if ($_.lat) { $_.lat } else { $_.center.lat }
            $lon = if ($_.lon) { $_.lon } else { $_.center.lon }
            Write-Host " -> Match: $($_.tags.name) | Lat: $lat | Lon: $lon | Tags: $($_.tags | ConvertTo-Json -Compress)"
        }
        break
    } catch {
        Write-Host "Failed mirror $m : $_"
    }
}

Write-Host "`n=== TEST: Nominatim Structured & Alternative Queries ==="
$testQueries = @(
    "K.L.N. College of Engineering",
    "K.L.N College of Engineering",
    "KLN College of Engineering",
    "KLNCE",
    "KLN College Pottapalayam",
    "K.L.N. College Pottapalayam",
    "KLN Engineering College",
    "K.L.N. Engineering College",
    "K L N College",
    "Pottapalayam Sivagangai",
    "Pottapalayam Tamil Nadu"
)

foreach ($tq in $testQueries) {
    try {
        $url = "https://nominatim.openstreetmap.org/search?q=" + [System.Uri]::EscapeDataString($tq) + "&format=json&addressdetails=1&limit=3"
        $res = Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 5
        Write-Host "Nominatim for '$tq': Count = $($res.Count)"
        $res | ForEach-Object {
            Write-Host "   -> $($_.display_name) (Lat: $($_.lat), Lon: $($_.lon))"
        }
        Start-Sleep -Milliseconds 600
    } catch {
        Write-Host "Nominatim Error for '$tq': $_"
    }
}
