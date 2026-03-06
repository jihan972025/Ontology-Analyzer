@echo off
title Ontology Analyzer - Build
echo ============================================
echo   Ontology Analyzer - Production Build
echo ============================================
echo.

cd /d "%~dp0"

:: Step 1: Backend (PyInstaller)
echo [1/4] Building Backend (PyInstaller)...
pyinstaller main.spec --noconfirm --distpath dist-backend
if errorlevel 1 (
    echo [ERROR] PyInstaller build failed!
    pause
    exit /b 1
)
echo       Backend build complete!
echo.

:: Step 2: Frontend (Vite)
echo [2/4] Building Frontend (Vite)...
call npx vite build
if errorlevel 1 (
    echo [ERROR] Vite build failed!
    pause
    exit /b 1
)
echo       Frontend build complete!
echo.

:: Step 3: Electron TypeScript
echo [3/4] Compiling Electron TypeScript...
call npx tsc -p tsconfig.electron.json
if errorlevel 1 (
    echo [ERROR] Electron TypeScript compilation failed!
    pause
    exit /b 1
)
echo       Electron compile complete!
echo.

:: Step 4: Package (electron-builder)
echo [4/4] Packaging installer (electron-builder)...
call npx electron-builder --win
if errorlevel 1 (
    echo [ERROR] electron-builder failed!
    pause
    exit /b 1
)
echo       Packaging complete!
echo.

echo ============================================
echo   Build finished!
echo   Output: release\
echo ============================================
echo.
pause
