# deploy_to_github.ps1
# Script to upload project files to GitHub via API (without Git installed)
$ErrorActionPreference = "Stop"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "Toyoko Tracker GitHub 一鍵部署工具" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

# Prompts
$username = Read-Host "請輸入您的 GitHub 帳號 (預設: q0911592099)"
if ([string]::IsNullOrWhiteSpace($username)) { $username = "q0911592099" }

$repo = Read-Host "請輸入您的 GitHub 儲存庫名稱 (預設: toyoko-tracker)"
if ([string]::IsNullOrWhiteSpace($repo)) { $repo = "toyoko-tracker" }

$pat = Read-Host "請貼上您的 GitHub 存取權杖 (PAT)"
if ([string]::IsNullOrWhiteSpace($pat)) {
    Write-Host "❌ 錯誤：權杖不可為空！" -ForegroundColor Red
    Exit
}

$filesToUpload = @(
    "index.html",
    "style.css",
    "app.js",
    "crawl.js",
    "config.json",
    "availability.json",
    "data.js",
    "config.js",
    "hotels_db.js",
    "manifest.json",
    "sw.js",
    "icon-192.png",
    "icon-512.png",
    ".github/workflows/crawl.yml"
)

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

foreach ($file in $filesToUpload) {
    $localPath = Join-Path $scriptRoot $file
    if (-not (Test-Path $localPath)) {
        Write-Host "⚠️ 警告：找不到本地檔案 $file，跳過。" -ForegroundColor Yellow
        continue
    }

    # Normalize path separator for GitHub API (must be forward slash)
    $githubPath = $file.Replace("\", "/")
    
    Write-Host "正在處理: $githubPath ..." -NoNewline

    # Get file content and convert to base64
    $bytes = [System.IO.File]::ReadAllBytes($localPath)
    $base64 = [System.Convert]::ToBase64String($bytes)

    # Check if file exists on GitHub to get SHA
    $sha = $null
    $getUrl = "https://api.github.com/repos/$username/$repo/contents/$githubPath"
    
    $headers = @{
        "Authorization" = "token $pat"
        "Accept"        = "application/vnd.github.v3+json"
    }

    try {
        $response = Invoke-RestMethod -Uri $getUrl -Headers $headers -Method Get
        $sha = $response.sha
    } catch {
        # File doesn't exist, which is fine (first upload)
    }

    # Prepare commit payload
    $body = @{
        message = "Upload/Update $githubPath via deploy script"
        content = $base64
    }
    if ($sha) {
        $body.sha = $sha
    }
    
    $bodyJson = $body | ConvertTo-Json

    try {
        $putRes = Invoke-RestMethod -Uri $getUrl -Headers $headers -Method Put -Body $bodyJson -ContentType "application/json"
        Write-Host " [成功]" -ForegroundColor Green
    } catch {
        Write-Host " [失敗]" -ForegroundColor Red
        Write-Error $_.Exception.Message
    }
}

Write-Host "============================================================" -ForegroundColor Green
Write-Host "🎉 恭喜！所有檔案已成功同步上傳至您的 GitHub 專案！" -ForegroundColor Green
Write-Host "請稍候 1 分鐘，即可點開您的網域開啟網頁：" -ForegroundColor Green
Write-Host "👉 https://$username.github.io/$repo/" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Green
