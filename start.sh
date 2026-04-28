#!/bin/bash
# ── HamidEduApp — start all services ──────────────────────────────────────────

echo "============================================"
echo "  HamidEduApp Local Stack"
echo "  UI + Ingest Server + RAG Embedder"
echo "============================================"
echo

# ── Check Node ────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js not found. Install from https://nodejs.org"
  exit 1
fi

# ── Check Python ──────────────────────────────
if ! command -v python3 &>/dev/null; then
  echo "[ERROR] Python 3 not found. Install from https://python.org"
  exit 1
fi

# ── Install Python deps if needed ─────────────
if ! python3 -c "import sentence_transformers" &>/dev/null; then
  echo "[SETUP] Installing Python dependencies..."
  pip3 install sentence-transformers supabase python-dotenv
fi

# ── Install Node deps if needed ───────────────
if [ ! -d "node_modules" ]; then
  echo "[SETUP] Installing Node dependencies..."
  npm install
fi

# ── Launch ────────────────────────────────────
echo "[START] Launching all services..."
echo
npm run start
