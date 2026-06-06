# generate_icons.ps1
# Creates icon-192.png and icon-512.png using .NET System.Drawing

Add-Type -AssemblyName System.Drawing

function Create-PwaIcon {
    param(
        [string]$Path,
        [int]$Size
    )
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    
    # Enable high quality rendering
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
    
    # Draw linear gradient background
    $rect = New-Object System.Drawing.Rectangle(0, 0, $Size, $Size)
    $color1 = [System.Drawing.ColorTranslator]::FromHtml("#6366f1") # Indigo
    $color2 = [System.Drawing.ColorTranslator]::FromHtml("#ec4899") # Pink/Rose
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $color1, $color2, 45.0)
    $g.FillRectangle($brush, $rect)
    
    # Draw simple premium app graphic (Calendar outline)
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, ($Size * 0.04))
    $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
    $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
    
    # Calendar shape values
    $calX = $Size * 0.25
    $calY = $Size * 0.25
    $calW = $Size * 0.5
    $calH = $Size * 0.5
    
    # Draw calendar outline
    $g.DrawRectangle($pen, $calX, $calY, $calW, $calH)
    $g.DrawLine($pen, $calX, ($calY + $calH * 0.25), ($calX + $calW), ($calY + $calH * 0.25))
    
    # Draw calendar pins (hooks)
    $pinW = $Size * 0.04
    $pinH = $Size * 0.12
    $g.FillRectangle([System.Drawing.Brushes]::White, ($calX + $calW * 0.25 - $pinW/2), ($calY - $pinH*0.5), $pinW, $pinH)
    $g.FillRectangle([System.Drawing.Brushes]::White, ($calX + $calW * 0.75 - $pinW/2), ($calY - $pinH*0.5), $pinW, $pinH)
    
    # Draw a bold letter "T" inside the calendar
    $tBrush = [System.Drawing.Brushes]::White
    $tFont = New-Object System.Drawing.Font("Arial", ($Size * 0.22), [System.Drawing.FontStyle]::Bold)
    $tSize = $g.MeasureString("T", $tFont)
    $g.DrawString("T", $tFont, $tBrush, (($Size - $tSize.Width)/2), ($calY + $calH * 0.38))
    
    # Clean up
    $brush.Dispose()
    $pen.Dispose()
    $tFont.Dispose()
    $g.Dispose()
    
    # Save image
    $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
}

$scriptRoot = $PSScriptRoot
if ([string]::IsNullOrEmpty($scriptRoot)) {
    $scriptRoot = Get-Location
}

$icon192 = Join-Path $scriptRoot "icon-192.png"
$icon512 = Join-Path $scriptRoot "icon-512.png"

Create-PwaIcon -Path $icon192 -Size 192
Create-PwaIcon -Path $icon512 -Size 512

Write-Host "PWA Icons generated successfully: icon-192.png and icon-512.png" -ForegroundColor Green
