$headers = @{
    "User-Agent" = "AI-Transportation-System-Auditor/2.0 (contact@aitransport.local)"
    "Accept" = "application/json"
}

function Query-Photon($q) {
    try {
        $url = "https://photon.komoot.io/api/?q=" + [System.Uri]::EscapeDataString($q) + "&limit=5&lang=en"
        $res = Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 5
        return $res.features
    } catch {
        return @()
    }
}

function Query-Nominatim($q) {
    try {
        $url = "https://nominatim.openstreetmap.org/search?q=" + [System.Uri]::EscapeDataString($q) + "&format=json&addressdetails=1&limit=5&accept-language=en"
        $res = Invoke-RestMethod -Uri $url -Headers $headers -TimeoutSec 5
        return $res
    } catch {
        return @()
    }
}

$queries = @(
    "kln college of engineering",
    "kln college",
    "kln college pottapalayam",
    "kln college of engineering pottapalayam sivagangai",
    "K.L.N. College of Engineering",
    "IIT Madras",
    "Chennai Central Railway Station",
    "Chennai Airport",
    "Apollo Hospital Chennai",
    "Burj Khalifa",
    "Eiffel Tower",
    "Times Square",
    "London",
    "Mumbai",
    "Pottapalayam"
)

Write-Host "================ PHOTON RESULTS ================"
foreach ($q in $queries) {
    $features = Query-Photon $q
    Write-Host "`n[QUERY]: '$q' (Count: $($features.Count))"
    foreach ($f in $features) {
        $p = $f.properties
        $coords = $f.geometry.coordinates
        Write-Host "   * Name: '$($p.name)', City: '$($p.city)', State: '$($p.state)', Country: '$($p.country)', Lon: $($coords[0]), Lat: $($coords[1]), Type: $($p.type)/$($p.osm_value)"
    }
}
