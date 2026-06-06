@echo off
title Toyoko Inn Direct Crawler (Console Mode)
cd /d "%~dp0"
echo ============================================================
echo Starting Toyoko Inn Direct Console Crawler...
echo ============================================================
powershell -ExecutionPolicy Bypass -File run_crawl.ps1
pause
