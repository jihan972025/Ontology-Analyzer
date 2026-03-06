@echo off
title Ontology Analyzer - Build
echo ============================================
echo   Ontology Analyzer - Production Build
echo ============================================
echo.

cd /d "%~dp0"

:: Step 1: Backend (PyInstaller)
echo [1/5] Building Backend (PyInstaller)...
pyinstaller main.spec --noconfirm --distpath dist-backend
if errorlevel 1 (
    echo [ERROR] PyInstaller backend build failed!
    pause
    exit /b 1
)
echo       Backend build complete!
echo.

:: Step 2: Semgrep (PyInstaller)
echo [2/5] Building Semgrep (PyInstaller)...
pyinstaller semgrep.spec --noconfirm --distpath dist-semgrep
if errorlevel 1 (
    echo [ERROR] PyInstaller semgrep build failed!
    pause
    exit /b 1
)
echo       Semgrep build complete!
echo.

:: Step 3: Frontend (Vite)
echo [3/5] Building Frontend (Vite)...
call npx vite build
if errorlevel 1 (
    echo [ERROR] Vite build failed!
    pause
    exit /b 1
)
echo       Frontend build complete!
echo.

:: Step 4: Electron TypeScript
echo [4/5] Compiling Electron TypeScript...
call npx tsc -p tsconfig.electron.json
if errorlevel 1 (
    echo [ERROR] Electron TypeScript compilation failed!
    pause
    exit /b 1
)
echo       Electron compile complete!
echo.

:: Step 5: Package (electron-builder)
echo [5/5] Packaging installer (electron-builder)...
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
