@echo off
cd /d "%~dp0"

rem Hide internal files - users only see start.bat / README / deck folders
attrib +h app >nul 2>&1
attrib +h CLAUDE.md >nul 2>&1
attrib +h .git >nul 2>&1
attrib +h .gitignore >nul 2>&1
attrib +h .obsidianignore >nul 2>&1

cd app

if not exist node_modules (
  echo First run: installing dependencies...
  call npm install --no-fund --no-audit
)

rem Stop old server - kill whatever holds port 7744 even if .server.pid is stale
if exist .server.pid (
  for /f %%i in (.server.pid) do taskkill /PID %%i /F >nul 2>&1
  del .server.pid >nul 2>&1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":7744 .*LISTENING"') do taskkill /PID %%p /F >nul 2>&1

start "ppt-hyeop-ainative" cmd /k node server.js

echo Starting slide server...
for /L %%i in (1,1,10) do (
  ping -n 2 127.0.0.1 >nul
  if exist .server.pid (
    echo Opening http://localhost:7744
    start "" "http://localhost:7744"
    goto :done
  )
)
echo [ERROR] Server did not start. Run "node app\server.js" manually to see the error.
pause
:done
