$headers = @{
    "User-Agent" = "AI-Transportation-Test/1.0"
    "Accept" = "application/json"
}

Write-Host "=== TEST 1: Nominatim for 'K.L.N. College of Engineering' ==="
try {
    $url1 = "https://nominatim.openstreetmap.org/search?q=K.L.N.+College+of+Engineering&format=json&addressdetails=1&limit=5"
    $r1 = Invoke-RestMethod -Uri $url1 -Headers $headers -TimeoutSec 10
    $r1 | ForEach-Object { Write-Host ("Name: " + $_.display_name + " | Lat: " + $_.lat + " | Lon: " + $_.lon) }
} catch {
    Write-Host "Error: $_"
}

Write-Host "`n=== TEST 2: Nominatim for 'KLN College of Engineering' ==="
try {
    $url2 = "https://nominatim.openstreetmap.org/search?q=KLN+College+of+Engineering&format=json&addressdetails=1&limit=5"
    $r2 = Invoke-RestMethod -Uri $url2 -Headers $headers -TimeoutSec 10
    $r2 | ForEach-Object { Write-Host ("Name: " + $_.display_name + " | Lat: " + $_.lat + " | Lon: " + $_.lon) }
} catch {
    Write-Host "Error: $_"
}

Write-Host "`n=== TEST 3: Nominatim for 'KLN College' ==="
try {
    $url3 = "https://nominatim.openstreetmap.org/search?q=KLN+College&format=json&addressdetails=1&limit=5"
    $r3 = Invoke-RestMethod -Uri $url3 -Headers $headers -TimeoutSec 10
    $r3 | ForEach-Object { Write-Host ("Name: " + $_.display_name + " | Lat: " + $_.lat + " | Lon: " + $_.lon) }
} catch {
    Write-Host "Error: $_"
}

Write-Host "`n=== TEST 4: Nominatim for 'Pottapalayam' ==="
try {
    $url4 = "https://nominatim.openstreetmap.org/search?q=Pottapalayam&format=json&addressdetails=1&limit=5"
    $r4 = Invoke-RestMethod -Uri $url4 -Headers $headers -TimeoutSec 10
    $r4 | ForEach-Object { Write-Host ("Name: " + $_.display_name + " | Lat: " + $_.lat + " | Lon: " + $_.lon) }
} catch {
    Write-Host "Error: $_"
}

Write-Host "`n=== TEST 5: Nominatim for 'IIT Madras' ==="
try {
    $url5 = "https://nominatim.openstreetmap.org/search?q=IIT+Madras&format=json&addressdetails=1&limit=5"
    $r5 = Invoke-RestMethod -Uri $url5 -Headers $headers -TimeoutSec 10
    $r5 | ForEach-Object { Write-Host ("Name: " + $_.display_name + " | Lat: " + $_.lat + " | Lon: " + $_.lon) }
} catch {
    Write-Host "Error: $_"
}

Write-Host "`n=== TEST 6: Nominatim for 'Chennai Central' ==="
try {
    $url6 = "https://nominatim.openstreetmap.org/search?q=Chennai+Central&format=json&addressdetails=1&limit=5"
    $r6 = Invoke-RestMethod -Uri $url6 -Headers $headers -TimeoutSec 10
    $r6 | ForEach-Object { Write-Host ("Name: " + $_.display_name + " | Lat: " + $_.lat + " | Lon: " + $_.lon) }
} catch {
    Write-Host "Error: $_"
}
