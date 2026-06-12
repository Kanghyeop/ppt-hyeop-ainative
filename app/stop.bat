@echo off
if exist .server.pid (
  for /f %%i in (.server.pid) do taskkill /PID %%i /F >nul 2>&1
  del .server.pid >nul 2>&1
  echo 서버 종료됨
) else (
  echo 실행 중인 서버 없음
)
