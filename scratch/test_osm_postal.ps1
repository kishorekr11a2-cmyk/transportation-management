$headers = @{
    "User-Agent" = "AI-Transportation-System-Auditor/2.0"
    "Accept" = "application/json"
}

$postalUrl = "https://nominatim.openstreetmap.org/search?postalcode=630612&country=India&format=json&addressdetails=1"
try {
    $res = Invoke-RestMethod -Uri $postalUrl -Headers $headers -TimeoutSec 10
    Write-Host "Postal search count: $($res.Count)"
    $res | ForEach-Object {
        Write-Host "   -> $($_.display_name) | Lat: $($_.lat) | Lon: $($_.lon)"
    }
} catch {
    Write-Host "Postal search error: $_"
}

$pottUrl = "https://nominatim.openstreetmap.org/search?q=Pottapalayam+630612&format=json&addressdetails=1"
try {
    $res2 = Invoke-RestMethod -Uri $pottUrl -Headers $headers -TimeoutSec 10
    Write-Host "Pottapalayam 630612 search count: $($res2.Count)"
    $res2 | ForEach-Object {
        Write-Host "   -> $($_.display_name) | Lat: $($_.lat) | Lon: $($_.lon)"
    }
} catch {
    Write-Host "Pottapalayam search error: $_"
}
