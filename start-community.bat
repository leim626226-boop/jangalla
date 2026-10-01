@echo off
cd /d "%~dp0"
start "BMHS community server" cmd /k npm start
timeout /t 2 /nobreak >nul
start "" "http://localhost:3000"
