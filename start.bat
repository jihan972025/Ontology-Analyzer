@echo off
title Ontology Analyzer
echo ============================================
echo   Ontology Analyzer - Starting...
echo ============================================
echo.

:: 프로젝트 루트 경로
set "ROOT=%~dp0"

:: Python 경로 결정 (util/python 우선 → 시스템 python 폴백)
set "PYTHON=%ROOT%util\python\python.exe"
if not exist "%PYTHON%" (
    where python >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python not found.
        echo         util\python\ 폴더가 없고, 시스템 Python도 없습니다.
        pause
        exit /b 1
    )
    set "PYTHON=python"
    echo [INFO] Using system Python
)

:: Node.js 경로 결정 (util/node 우선 → 시스템 node 폴백)
set "NODE_DIR=%ROOT%util\node"
if exist "%NODE_DIR%\node.exe" (
    set "PATH=%NODE_DIR%;%PATH%"
) else (
    where node >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Node.js not found.
        echo         util\node\ 폴더가 없고, 시스템 Node.js도 없습니다.
        pause
        exit /b 1
    )
    echo [INFO] Using system Node.js
)

:: PYTHONPATH 설정 (vendor/ 패키지 사용 — pip install 불필요)
set "PYTHONPATH=%ROOT%vendor;%ROOT%;%PYTHONPATH%"

:: 기존 프로세스 정리
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8766 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

:: Backend 시작
echo [1/2] Starting Backend (port 8766)...
start "" /B "%PYTHON%" -m uvicorn backend.main:app --host 127.0.0.1 --port 8766

:: Backend 준비 대기
echo       Waiting for backend...
:wait_backend
timeout /t 1 /nobreak >nul
curl -s http://127.0.0.1:8766/api/health >nul 2>&1
if errorlevel 1 goto wait_backend
echo       Backend ready!
echo.

:: Electron 시작
echo [2/2] Starting Electron app...
echo.
echo ============================================
echo   Electron app launching...
echo   Press Ctrl+C to stop
echo ============================================
echo.
npm run electron:dev
