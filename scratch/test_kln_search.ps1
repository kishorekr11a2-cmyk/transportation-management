$headers = @{
    "User-Agent" = "AI-Transportation-System-Auditor/2.0 (contact@aitransport.local)"
    "Accept" = "application/json"
}

Write-Host "=== Nominatim Search for variations of KLN & Pottapalayam ==="
$variations = @(
    "KLN College of Engineering",
    "K.L.N. College of Engineering",
    "K.L.N College of Engineering",
    "KLN College",
    "K.L.N. College",
    "K.L.N.",
    "KLNCE",
    "Pottapalayam",
    "Pottapalayam Sivagangai",
    "Pottapalayam Tamil Nadu",
    "Pottapalayam Madurai",
    "K.L.N. Vidyalaya",
    "KLN Polytechnic",
    "K.L.N. College of Information Technology"
)

foreach ($v in $variations) {
    try {
        $url = "https://nominatim.openstreetmap.org/search?q=" + [System.Uri]::EscapeDataString($v) + "&format=json&addressdetails=1&limit=3&accept-language=en"
        $res = Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 6
        Write-Host "`nQuery: '$v' -> Count: $($res.Count)"
        $res | ForEach-Object {
            Write-Host "   * Name: $($_.name) | Display: $($_.display_name) | Lat: $($_.lat) | Lon: $($_.lon) | Type: $($_.type)/$($_.class)"
        }
    } catch {
        Write-Host "`nQuery '$v' failed: $_"
    }
    Start-Sleep -Milliseconds 1200 # Respect Nominatim 1 request per sec rule!
}
