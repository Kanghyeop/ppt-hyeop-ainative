@echo off
cd /d "%~dp0"

rem 내부 파일은 탐색기에서 숨김 - 사용자에게는 start.bat / README / 발표 폴더만 보이게
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
echo [ERROR] Server did not start. Run "node app\server.js" manually to see the error.
pause
:done
