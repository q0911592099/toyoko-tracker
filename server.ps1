# server.ps1
# Native Windows PowerShell Web Server and Crawler for Toyoko Inn
# Runs on Port 8080. Open http://localhost:8080 in browser.

$Port = 8080
$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($scriptRoot)) {
    $scriptRoot = Get-Location
}

# Ensure configuration files exist
$configFile = Join-Path $scriptRoot "config.json"
$availabilityFile = Join-Path $scriptRoot "availability.json"
$hotelsFile = Join-Path $scriptRoot "fetched_hotels.json"

if (-not (Test-Path $configFile)) {
    $defaultConfig = @{
        hotelCode = "00078"
        hotelName = "東橫INN 東京新宿歌舞伎町"
        startDate = "2027-04-08"
        endDate = "2027-07-01"
        roomCount = 1
        peopleCount = 1
        lastUpdated = ""
        autoMonitor = $false
        telegramNotify = $false
        telegramBotToken = ""
        telegramChatId = ""
        monitorInterval = 5
    }
    $defaultConfig | ConvertTo-Json | Out-File -FilePath $configFile -Encoding utf8
}

if (-not (Test-Path $availabilityFile)) {
    "[]" | Out-File -FilePath $availabilityFile -Encoding utf8
}

# Write JS wrapper files on startup for direct file opening (file:// protocol)
if (Test-Path $configFile) {
    $configJson = Get-Content -Path $configFile -Raw -Encoding UTF8
    "window.toyokoConfig = $configJson;" | Out-File -FilePath (Join-Path $scriptRoot "config.js") -Encoding utf8
}
if (Test-Path $availabilityFile) {
    $dataJson = Get-Content -Path $availabilityFile -Raw -Encoding UTF8
    "window.toyokoData = $dataJson;" | Out-File -FilePath (Join-Path $scriptRoot "data.js") -Encoding utf8
}
if (Test-Path $hotelsFile) {
    $hotelsJson = Get-Content -Path $hotelsFile -Raw -Encoding UTF8
    "window.toyokoHotels = $hotelsJson;" | Out-File -FilePath (Join-Path $scriptRoot "hotels_db.js") -Encoding utf8
}

# Global crawl status (shared state)
$global:syncState = [hashtable]::Synchronized(@{
    state = "idle"         # "idle", "crawling", "completed", "stopped", "failed"
    progress = 0
    currentDate = ""
    message = "Idle"
    stopRequested = $false
})

# References to background thread
$global:runspace = $null
$global:powershellInstance = $null
$global:asyncResult = $null

# Initialize last vacant dates cache from current availability.json to prevent spamming notifications
$global:lastVacantDates = @()
if (Test-Path $availabilityFile) {
    try {
        $availData = Get-Content -Path $availabilityFile -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($day in $availData) {
            $hasVacancy = $false
            if ($day.rooms) {
                foreach ($room in $day.rooms) {
                    if ($room.plans) {
                        foreach ($plan in $room.plans) {
                            if ($plan.generalVacant -gt 0 -or $plan.membershipVacant -gt 0) {
                                $hasVacancy = $true
                            }
                        }
                    }
                }
            }
            if ($hasVacancy) {
                $global:lastVacantDates += $day.date
            }
        }
    } catch {}
}

$global:lastCrawlTime = [DateTime]::MinValue

function Send-Notification {
    param(
        [string]$Title,
        [string]$Message
    )
    Write-Host "[Notification] $Title - $Message" -ForegroundColor Green
    try {
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime]
        $xml = @"
<toast>
    <visual>
        <binding template="ToastGeneric">
            <text>$Title</text>
            <text>$Message</text>
        </binding>
    </visual>
</toast>
"@
        $xmlDoc = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xmlDoc.LoadXml($xml)
        $toast = New-Object Windows.UI.Notifications.ToastNotification $xmlDoc
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Windows PowerShell").Show($toast)
    } catch {
        # Fallback to Forms Balloon Tip
        try {
            [void] [System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms")
            $notification = New-Object System.Windows.Forms.NotifyIcon
            $notification.Icon = [System.Drawing.SystemIcons]::Information
            $notification.BalloonTipTitle = $Title
            $notification.BalloonTipText = $Message
            $notification.Visible = $true
            $notification.ShowBalloonTip(10000)
            Start-Sleep -Seconds 2
            $notification.Dispose()
        } catch {
            Write-Warning "Could not show desktop notification: $_"
        }
    }
}

function Send-TelegramNotification {
    param(
        [string]$Token,
        [string]$ChatId,
        [string]$Message
    )
    if ([string]::IsNullOrEmpty($Token) -or [string]::IsNullOrEmpty($ChatId)) {
        Write-Host "[Notification] Missing Telegram Bot Token or Chat ID. Skipping Telegram push." -ForegroundColor Yellow
        return
    }
    
    $url = "https://api.telegram.org/bot$Token/sendMessage"
    $body = @{
        chat_id = $ChatId
        text = $Message
        parse_mode = "HTML"
        disable_web_page_preview = $true
    } | ConvertTo-Json -Compress
    
    try {
        $response = Invoke-RestMethod -Uri $url -Method Post -Body $body -ContentType "application/json; charset=utf-8" -TimeoutSec 10
        Write-Host "[Notification] Telegram push notification sent successfully!" -ForegroundColor Green
    } catch {
        Write-Warning "Failed to send Telegram notification: $_"
    }
}

function Check-VacanciesAndNotify {
    param($Config)
    
    $availabilityPath = Join-Path $scriptRoot "availability.json"
    if (Test-Path $availabilityPath) {
        try {
            $data = Get-Content -Path $availabilityPath -Raw -Encoding UTF8 | ConvertFrom-Json
            $vacantDates = @()
            $minPrice = [double]::MaxValue
            
            foreach ($day in $data) {
                $hasVacancy = $false
                if ($day.rooms) {
                    foreach ($room in $day.rooms) {
                        if ($room.plans) {
                            foreach ($plan in $room.plans) {
                                if ($plan.generalVacant -gt 0 -or $plan.membershipVacant -gt 0) {
                                    $hasVacancy = $true
                                    if ($plan.generalPrice -lt $minPrice) {
                                        $minPrice = $plan.generalPrice
                                    }
                                }
                            }
                        }
                    }
                }
                if ($hasVacancy) {
                    $vacantDates += $day.date
                }
            }
            
            $newVacantDates = @($vacantDates)
            $oldVacantDates = @($global:lastVacantDates)
            
            # Find new vacant dates
            $addedDates = @()
            foreach ($d in $newVacantDates) {
                if ($oldVacantDates -notcontains $d) {
                    $addedDates += $d
                }
            }
            
            # Update cache
            $global:lastVacantDates = $newVacantDates
            
            if ($addedDates.Count -gt 0) {
                $hotelName = $Config.hotelName
                $addedCount = $addedDates.Count
                $priceText = if ($minPrice -ne [double]::MaxValue) { "，最便宜價格 ¥" + $minPrice.ToString("N0") + " 日圓起。" } else { "" }
                
                $title = "東橫INN 發現空房！"
                $msg = "$hotelName 新增 $addedCount 天有空房！包括 $($addedDates[0])$priceText"
                if ($addedCount -eq 1) {
                    $msg = "$hotelName 於 $($addedDates[0]) 發現空房$priceText"
                }
                
                Send-Notification -Title $title -Message $msg

                # Trigger Telegram notification if enabled
                if ($Config.telegramNotify -eq $true) {
                    $tgToken = $Config.telegramBotToken
                    $tgChatId = $Config.telegramChatId
                    
                    $tgMsg = "<b>🔔 東橫INN 發現空房！</b>`n`n" +
                             "<b>飯店：</b>$hotelName`n" +
                             "<b>新增空房：</b>$addedCount 天`n" +
                             "<b>新增日期：</b><code>$($addedDates -join ', ')</code>$priceText`n`n" +
                             "<a href='https://www.toyoko-inn.com/china/search/result/room_plan?hotel=$($Config.hotelCode)&amp;start=$($addedDates[0])'>立即前往訂房 ↗</a>"
                    
                    Send-TelegramNotification -Token $tgToken -ChatId $tgChatId -Message $tgMsg
                }
            }
        } catch {
            Write-Warning "Error checking vacancies: $_"
        }
    }
}

function Start-CrawlJob {
    param(
        $Config
    )

    if ($global:syncState.state -eq "crawling") {
        Write-Output "Crawl is already running."
        return
    }

    # Reset syncState
    $global:syncState.state = "crawling"
    $global:syncState.progress = 0
    $global:syncState.currentDate = ""
    $global:syncState.message = "Initializing crawler..."
    $global:syncState.stopRequested = $false

    # Set up Runspace for background execution
    $global:runspace = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
    $global:runspace.Open()
    $global:runspace.SessionStateProxy.SetVariable("syncState", $global:syncState)
    $global:runspace.SessionStateProxy.SetVariable("config", $Config)
    $global:runspace.SessionStateProxy.SetVariable("scriptRoot", $scriptRoot)

    # Crawl script block definition
    $crawlScript = {
        try {
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
                $syncState.state = "failed"
                $syncState.message = "Invalid date range: Start date must be before End date."
                return
            }

            $syncState.message = "Preparing download folder..."
            $crawledData = @()
            $targetPath = Join-Path $scriptRoot "availability.json"
            
            # Initialize target file as empty list
            "[]" | Out-File -FilePath $targetPath -Encoding utf8

            # Configure web session to simulate standard browser headers
            $webSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
            $webSession.UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

            for ($i = 0; $i -lt $dates.Count; $i++) {
                if ($syncState.stopRequested) {
                    $syncState.state = "stopped"
                    $syncState.message = "Crawling stopped by user."
                    return
                }

                $date = $dates[$i]
                $syncState.currentDate = $date
                $progressPercent = [Math]::Round(($i / $dates.Count) * 100)
                $syncState.progress = $progressPercent
                $syncState.message = "Crawling date $date ($($i + 1)/$($dates.Count))..."

                $checkOutDate = ([DateTime]::Parse($date)).AddDays(1).ToString("yyyy-MM-dd")
                
                # Toyoko Inn URL search parameters
                $url = "https://www.toyoko-inn.com/china/search/result/room_plan?hotel=$($config.hotelCode)&start=$date&end=$checkOutDate&room=$($config.roomCount)&people=$($config.peopleCount)"

                # Fetch page with retry logic
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
                        Start-Sleep -Milliseconds 500
                    }
                }

                if (-not $success) {
                    Write-Warning "Failed to fetch date $date after 3 attempts."
                    # Save a blank record for this day so we don't block the UI
                    $crawledData += @{
                        date = $date
                        hotelName = $config.hotelName
                        canReservation = $false
                        rooms = @()
                        error = "Network error or timeout"
                    }
                    continue
                }

                # Extract __NEXT_DATA__
                $startTag = '<script id="__NEXT_DATA__" type="application/json">'
                $endTag = '</script>'
                $startIdx = $html.IndexOf($startTag)
                
                if ($startIdx -eq -1) {
                    # Page structure changed or blocked
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
                            error = "JSON parse error: $($_.Exception.Message)"
                        }
                    }
                }

                # Save incrementally
                $crawledJson = $crawledData | ConvertTo-Json -Depth 6
                $crawledJson | Out-File -FilePath $targetPath -Encoding utf8
                
                # Write data.js for direct file mode
                "window.toyokoData = $crawledJson;" | Out-File -FilePath (Join-Path $scriptRoot "data.js") -Encoding utf8

                # Nice delay to avoid overloading Toyoko Inn
                Start-Sleep -Milliseconds 250
            }

            # If we completed without stopping
            if (-not $syncState.stopRequested) {
                $syncState.state = "completed"
                $syncState.progress = 100
                $syncState.message = "Successfully finished crawling!"
                
                # Update config with lastUpdated timestamp
                $config.lastUpdated = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                $configFile = Join-Path $scriptRoot "config.json"
                $configJson = $config | ConvertTo-Json
                $configJson | Out-File -FilePath $configFile -Encoding utf8
                
                # Update config.js
                "window.toyokoConfig = $configJson;" | Out-File -FilePath (Join-Path $scriptRoot "config.js") -Encoding utf8
            }
        } catch {
            $syncState.state = "failed"
            $syncState.message = "Crawl encountered error: $($_.Exception.Message)"
        }
    }

    $global:powershellInstance = [PowerShell]::Create()
    $global:powershellInstance.Runspace = $global:runspace
    $global:powershellInstance.AddScript($crawlScript) | Out-Null
    $global:asyncResult = $global:powershellInstance.BeginInvoke()
    Write-Output "Crawl started in the background."
}

# Start HttpListener
$Listener = New-Object System.Net.HttpListener
$Listener.Prefixes.Add("http://localhost:$Port/")
try {
    $Listener.Start()
} catch {
    Write-Error "Failed to start HttpListener on Port $Port. Is it already in use?"
    Exit
}

Write-Host "============================================================"
Write-Host "Toyoko Inn Room Dashboard Server running at: http://localhost:$Port/"
Write-Host "Keep this window open to allow background checks."
Write-Host "Close this window or press Ctrl+C to stop the server."
Write-Host "============================================================"

# Automatically open in browser
Start-Process "http://localhost:$Port/"

# Request handling loop
while ($Listener.IsListening) {
    try {
        # Check background crawl completion and clean up runspace
        if ($global:asyncResult -ne $null -and $global:asyncResult.IsCompleted) {
            $wasCrawling = ($global:syncState.state -eq "crawling")
            try {
                $global:powershellInstance.EndInvoke($global:asyncResult)
            } catch {
                $global:syncState.state = "failed"
                $global:syncState.message = $_.Exception.Message
            }
            # Clean up
            $global:powershellInstance.Dispose()
            $global:runspace.Close()
            $global:runspace.Dispose()
            $global:powershellInstance = $null
            $global:runspace = $null
            $global:asyncResult = $null
            
            if ($wasCrawling -or $global:syncState.state -eq "crawling") {
                $global:syncState.state = "completed"
                $global:syncState.progress = 100
                $global:syncState.message = "Successfully finished crawling!"
                
                # Check vacancies and trigger system toast notification
                $configObj = Get-Content -Path $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
                Check-VacanciesAndNotify -Config $configObj
            }
        }

        # Check background scheduler auto-monitoring
        if (Test-Path $configFile) {
            try {
                $configObj = Get-Content -Path $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($configObj.autoMonitor -eq $true) {
                    $intervalMin = 30
                    if ($configObj.monitorInterval) {
                        $intervalMin = [int]$configObj.monitorInterval
                    }
                    
                    $timeSinceLastCrawl = [DateTime]::Now - $global:lastCrawlTime
                    if ($timeSinceLastCrawl.TotalMinutes -ge $intervalMin -and $global:syncState.state -ne "crawling") {
                        Write-Host "[Auto Monitor] Triggering automatic room crawl..." -ForegroundColor Cyan
                        $global:lastCrawlTime = [DateTime]::Now
                        Start-CrawlJob -Config $configObj
                    }
                }
            } catch {
                # Ignore read error (file might be locked briefly during write)
            }
        }

        # Wait for HTTP request with 1-second timeout (non-blocking scheduler tick)
        $asyncRequest = $Listener.BeginGetContext($null, $null)
        if (-not $asyncRequest.AsyncWaitHandle.WaitOne(1000)) {
            # No request within 1 second. Loop again to check scheduler.
            continue
        }
        $context = $Listener.EndGetContext($asyncRequest)
        $request = $context.Request
        $response = $context.Response

        # Enable CORS
        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "Content-Type")

        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        $urlPath = $request.RawUrl.Split('?')[0] # Remove query parameters

        # Routing API endpoints
        if ($urlPath -eq "/api/config") {
            if ($request.HttpMethod -eq "GET") {
                $response.ContentType = "application/json; charset=utf-8"
                $bytes = [System.IO.File]::ReadAllBytes($configFile)
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } elseif ($request.HttpMethod -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
                $postBody = $reader.ReadToEnd()
                $reader.Close()

                # Validate JSON and write
                try {
                    $newConfig = ConvertFrom-Json $postBody
                    $postBody | Out-File -FilePath $configFile -Encoding utf8
                    
                    # Also write config.js
                    "window.toyokoConfig = $postBody;" | Out-File -FilePath (Join-Path $scriptRoot "config.js") -Encoding utf8
                    
                    # Automatically trigger crawl for the new config
                    Start-CrawlJob -Config $newConfig
                    
                    $responseJson = '{"status":"success","message":"Config saved and crawl started"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($responseJson)
                    $response.ContentType = "application/json; charset=utf-8"
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                } catch {
                    $response.StatusCode = 400
                    $responseJson = '{"status":"error","message":"Invalid JSON format"}'
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($responseJson)
                    $response.OutputStream.Write($bytes, 0, $bytes.Length)
                }
            }
        } elseif ($urlPath -eq "/api/hotels") {
            $response.ContentType = "application/json; charset=utf-8"
            if (Test-Path $hotelsFile) {
                $bytes = [System.IO.File]::ReadAllBytes($hotelsFile)
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $emptyResponse = "[]"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($emptyResponse)
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        } elseif ($urlPath -eq "/api/data") {
            $response.ContentType = "application/json; charset=utf-8"
            if (Test-Path $availabilityFile) {
                $bytes = [System.IO.File]::ReadAllBytes($availabilityFile)
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $emptyResponse = "[]"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($emptyResponse)
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        } elseif ($urlPath -eq "/api/refresh") {
            if ($request.HttpMethod -eq "POST") {
                if ($global:syncState.state -ne "crawling") {
                    $configObj = Get-Content -Path $configFile -Raw -Encoding UTF8 | ConvertFrom-Json
                    Start-CrawlJob -Config $configObj
                    $responseJson = '{"status":"success","message":"Crawl started"}'
                } else {
                    $responseJson = '{"status":"ignored","message":"Crawl already in progress"}'
                }
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($responseJson)
                $response.ContentType = "application/json; charset=utf-8"
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        } elseif ($urlPath -eq "/api/status") {
            $statusObj = @{
                state = $global:syncState.state
                progress = $global:syncState.progress
                currentDate = $global:syncState.currentDate
                message = $global:syncState.message
            }
            $responseJson = $statusObj | ConvertTo-Json
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($responseJson)
            $response.ContentType = "application/json; charset=utf-8"
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } elseif ($urlPath -eq "/api/stop") {
            if ($request.HttpMethod -eq "POST") {
                if ($global:syncState.state -eq "crawling") {
                    $global:syncState.stopRequested = $true
                    $global:syncState.message = "Stopping crawler..."
                    $responseJson = '{"status":"success","message":"Crawl stop requested"}'
                } else {
                    $responseJson = '{"status":"ignored","message":"Crawler is not running"}'
                }
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($responseJson)
                $response.ContentType = "application/json; charset=utf-8"
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        } else {
            # Static file serving
            $filePath = ""
            $contentType = "text/plain"

            if ($urlPath -eq "/" -or $urlPath -eq "/index.html") {
                $filePath = Join-Path $scriptRoot "index.html"
                $contentType = "text/html; charset=utf-8"
            } elseif ($urlPath -eq "/style.css") {
                $filePath = Join-Path $scriptRoot "style.css"
                $contentType = "text/css; charset=utf-8"
            } elseif ($urlPath -eq "/app.js") {
                $filePath = Join-Path $scriptRoot "app.js"
                $contentType = "application/javascript; charset=utf-8"
            }

            if (-not [string]::IsNullOrEmpty($filePath) -and (Test-Path $filePath)) {
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                $response.ContentType = $contentType
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $response.StatusCode = 404
                $errorMsg = "404 - Not Found"
                $bytes = [System.Text.Encoding]::UTF8.GetBytes($errorMsg)
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            }
        }
        $response.Close()
    } catch {
        # Catch unexpected listener errors
        Write-Host "Listener error: $($_.Exception.Message)"
        if ($null -ne $response) {
            try {
                $response.StatusCode = 500
                $response.Close()
            } catch {}
        }
    }
}


