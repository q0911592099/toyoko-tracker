# run_crawl.ps1
# Direct Toyoko Inn Crawler for Local File Mode (No Localhost Required)
# Queries Toyoko Inn directly from console and writes static data.js

$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($scriptRoot)) {
    $scriptRoot = Get-Location
}

$configFile = Join-Path $scriptRoot "config.json"
$availabilityFile = Join-Path $scriptRoot "availability.json"
$hotelsFile = Join-Path $scriptRoot "fetched_hotels.json"
$dataJsFile = Join-Path $scriptRoot "data.js"
$configJsFile = Join-Path $scriptRoot "config.js"
$hotelsJsFile = Join-Path $scriptRoot "hotels_db.js"
$htmlFile = Join-Path $scriptRoot "index.html"

# Load Config
if (-not (Test-Path $configFile)) {
    Write-Error "Config file config.json not found! Please run server first."
    Exit
}

$config = Get-Content -Path $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
$startDate = [DateTime]::Parse($config.startDate)
$endDate = [DateTime]::Parse($config.endDate)

# Generate date range list
$dates = @()
$currDate = $startDate
while ($currDate -lt $endDate) {
    $dates += $currDate.ToString("yyyy-MM-dd")
    $currDate = $currDate.AddDays(1)
}

if ($dates.Count -eq 0) {
    Write-Host "Error: Invalid date range! Start date must be before End date." -ForegroundColor Red
    Exit
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Toyoko Inn Direct Crawler (Local File Mode)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Hotel Name: $($config.hotelName)"
Write-Host "Hotel Code: $($config.hotelCode)"
Write-Host "Nights    : $($dates.Count) nights ($($config.startDate) to $($config.endDate))"
Write-Host "Rooms     : $($config.roomCount) room(s), $($config.peopleCount) guest(s)/room"
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Downloading room availability, please wait..." -ForegroundColor Yellow

$crawledData = @()
# Initialize file
"[]" | Out-File -FilePath $availabilityFile -Encoding utf8

$webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$webSession.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# Ensure hotels list javascript is up to date
if (Test-Path $hotelsFile) {
    $hotelsJson = Get-Content -Path $hotelsFile -Raw -Encoding UTF8
    "window.toyokoHotels = $hotelsJson;" | Out-File -FilePath $hotelsJsFile -Encoding utf8
}

for ($i = 0; $i -lt $dates.Count; $i++) {
    $date = $dates[$i]
    $checkOutDate = ([DateTime]::Parse($date)).AddDays(1).ToString("yyyy-MM-dd")
    
    $percent = [Math]::Round(($i / $dates.Count) * 100)
    Write-Host -NoNewline "`r[$percent%] ($($i+1)/$($dates.Count)) Downloading date $date ..."
    
    $url = "https://www.toyoko-inn.com/china/search/result/room_plan?hotel=$($config.hotelCode)&start=$date&end=$checkOutDate&room=$($config.roomCount)&people=$($config.peopleCount)"

    $html = ""
    $success = $false
    for ($retry = 1; $retry -le 3; $retry++) {
        try {
            $response = Invoke-WebRequest -Uri $url -WebSession $webSession -UseBasicParsing -TimeoutSec 10
            if ($response.StatusCode -eq 200) {
                $html = $response.Content
                $success = $true
                break
            }
        } catch {
            Start-Sleep -Milliseconds 300
        }
    }

    if (-not $success) {
        Write-Host "`n[WARN] Failed to fetch date $date. Skipping." -ForegroundColor Yellow
        $crawledData += @{
            date = $date
            hotelName = $config.hotelName
            canReservation = $false
            rooms = @()
            error = "Network error or timeout"
        }
        continue
    }

    $startTag = '<script id="__NEXT_DATA__" type="application/json">'
    $endTag = '</script>'
    $startIdx = $html.IndexOf($startTag)
    
    if ($startIdx -eq -1) {
        $crawledData += @{
            date = $date
            hotelName = $config.hotelName
            canReservation = $false
            rooms = @()
            error = "Could not parse HTML response structure"
        }
    } else {
        $contentStart = $startIdx + $startTag.Length
        $endIdx = $html.IndexOf($endTag, $contentStart)
        $jsonStr = $html.Substring($contentStart, $endIdx - $contentStart)
        
        try {
            $nextData = ConvertFrom-Json $jsonStr
            $planResponse = $nextData.props.pageProps.planResponse
            
            $rooms = @()
            if ($planResponse -and $planResponse.roomTypeList) {
                foreach ($r in $planResponse.roomTypeList) {
                    $plans = @()
                    if ($r.plans) {
                        foreach ($p in $r.plans) {
                            $plans += @{
                                planCode = $p.planCode
                                planName = $p.planName
                                generalPrice = $p.price.generalPrice
                                membershipPrice = $p.price.membershipPrice
                                generalVacant = $p.vacant.generalVacantRoom
                                membershipVacant = $p.vacant.membershipVacantRoom
                            }
                        }
                    }

                    $rooms += @{
                        roomTypeId = $r.roomTypeId
                        roomTypeName = $r.roomTypeName
                        roomTypeDescription = $r.roomTypeDescription
                        isSmoking = $r.specs.isSmoking
                        roomSize = $r.specs.roomSize
                        bedWidth = $r.specs.widthOfBedA
                        bedCount = $r.specs.numberOfBedA
                        imageUrls = $r.imageUrls
                        plans = $plans
                    }
                }
            }

            $crawledData += @{
                date = $date
                hotelName = $planResponse.hotelTitle
                canReservation = $planResponse.canReservation
                rooms = $rooms
            }
        } catch {
            $crawledData += @{
                date = $date
                hotelName = $config.hotelName
                canReservation = $false
                rooms = @()
                error = "JSON parse error"
            }
        }
    }

    # Save incrementally
    $crawledJson = $crawledData | ConvertTo-Json -Depth 6
    $crawledJson | Out-File -FilePath $availabilityFile -Encoding utf8
    "window.toyokoData = $crawledJson;" | Out-File -FilePath $dataJsFile -Encoding utf8

    Start-Sleep -Milliseconds 200
}

# Finished completely
$config.lastUpdated = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$configJson = $config | ConvertTo-Json
$configJson | Out-File -FilePath $configFile -Encoding utf8
"window.toyokoConfig = $configJson;" | Out-File -FilePath $configJsFile -Encoding utf8

Write-Host "`n============================================================" -ForegroundColor Green
Write-Host "Crawling finished! Updated: $($config.lastUpdated)" -ForegroundColor Green
Write-Host "JavaScript wrappers config.js and data.js have been saved." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

# Automatically open the html page
Write-Host "Opening local dashboard..."
Start-Process $htmlFile
Start-Sleep -Seconds 1

