@echo off
title Toyoko Inn Room Dashboard Server
cd /d "%~dp0"
echo ============================================================
echo Starting Toyoko Inn Availability Web Server on Port 8080...
echo ============================================================
powershell -ExecutionPolicy Bypass -File server.ps1
pause
