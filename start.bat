@echo off
title HamidEduApp — Starting...

echo ============================================
echo   HamidEduApp Local Stack
echo   UI + Ingest Server + RAG Embedder
echo ============================================
echo.

:: ── Check Node ───────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org
    pause & exit /b 1
)

:: ── Check Python ─────────────────────────────
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python not found. Install from https://python.org
    pause & exit /b 1
)

:: ── Install Python deps if needed ────────────
python -c "import sentence_transformers" >nul 2>&1
if %errorlevel% neq 0 (
    echo [SETUP] Installing Python dependencies...
    pip install sentence-transformers supabase python-dotenv
)

:: ── Install Node deps if needed ──────────────
if not exist "node_modules" (
    echo [SETUP] Installing Node dependencies...
    npm install
)

:: ── Launch ───────────────────────────────────
echo [START] Launching all services...
echo.
npm run start
