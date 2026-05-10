# ── Stage 1: deps ──────────────────────────────────────────────────────────────
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ── Stage 2: dev (default target) ──────────────────────────────────────────────
FROM node:20-slim AS dev
WORKDIR /app

# Python for embed-local.py (slim = Debian/glibc → pre-built wheels, no Rust needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps in a venv to avoid system conflicts
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir \
    chromadb \
    sentence-transformers \
    python-dotenv \
    supabase

COPY --from=deps /app/node_modules ./node_modules
COPY . .

EXPOSE 3001 3002

# Default: run both frontend + API (mirrors the "start" script but split via compose)
CMD ["npm", "run", "dev"]

# ── Stage 3: production build ───────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-slim AS prod
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY server.ts tsconfig.json ./
COPY src ./src
RUN npm install -g tsx
EXPOSE 3002
CMD ["tsx", "server.ts"]
