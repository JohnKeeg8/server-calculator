@echo off
title Server Calculator
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js was not found on this PC.
  echo   Install the LTS version from https://nodejs.org then run this file again.
  echo.
  pause
  exit /b 1
)

node server.js
echo.
echo   The server stopped.
pause
