@echo off
cd /d "%~dp0"

if exist .server.pid (
  for /f %%i in (.server.pid) do taskkill /PID %%i /F >nul 2>&1
  del .server.pid >nul 2>&1
)

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
echo [ERROR] Server did not start. Run "node server.js" manually to see the error.
pause
:done
