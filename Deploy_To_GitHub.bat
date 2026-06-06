@echo off
chcp 65001 > nul
title Toyoko Tracker 一鍵上傳工具
echo 正在準備啟動 PowerShell 上傳指令...
powershell -ExecutionPolicy Bypass -File "%~dp0deploy_to_github.ps1"
pause
