$headers = @{
    "User-Agent" = "AI-Transportation-Test/1.0"
    "Accept" = "application/json"
}

$url = "https://nominatim.openstreetmap.org/reverse?lat=9.8335&lon=78.1872&format=json&accept-language=en"
try {
    $res = Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 10
    Write-Host "Reverse Geocode at (9.8335, 78.1872):"
    $res | ConvertTo-Json
} catch {
    Write-Host "Reverse geocode error: $_"
}
