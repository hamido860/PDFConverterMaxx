"""
embed-local.py  —  Offline-first RAG embedding job
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Model  : intfloat/multilingual-e5-base  (768 dims, 512-token context)
         Arabic + French + English — perfect for Moroccan curriculum.
         Downloaded once (~280 MB) then runs FULLY OFFLINE.

Architecture (3-phase loop):
  ┌──────────────────────────────────────────────────────────┐
  │  PHASE 1  [needs internet]                               │
  │    ↳ Upload locally-embedded chunks → Supabase           │
  │    ↳ Fetch new pending chunks from Supabase → local DB   │
  │                                                          │
  │  PHASE 2  [always — works offline]                       │
  │    ↳ Embed pending chunks from local SQLite cache        │
  │    ↳ Save embeddings locally (ready to upload later)     │
  │                                                          │
  │  PHASE 3  [repeat]                                       │
  │    ↳ If online  → go to Phase 1                         │
  │    ↳ If offline → sleep 30s, keep embedding local queue  │
  └──────────────────────────────────────────────────────────┘

Local cache : rag_cache.db  (SQLite, same folder as this script)

Usage:
    pip install sentence-transformers supabase python-dotenv
    python embed-local.py

Env (.env file):
    SUPABASE_URL=...
    SUPABASE_KEY=...
"""

import os, sys, time, json, sqlite3, socket, traceback
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Config ─────────────────────────────────────────────────────────────────────
SUPABASE_URL   = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY   = os.getenv("SUPABASE_KEY", "")
MODEL_NAME     = "intfloat/multilingual-e5-base"   # 768 dims, 512-token window
EMBED_BATCH    = 32    # chunks to embed at once  (lower = less RAM, increase if GPU)
UPLOAD_BATCH   = 20    # rows per Supabase upsert
FETCH_LIMIT    = 300   # pending chunks pulled from Supabase per sync
OFFLINE_SLEEP  = 30    # seconds to wait before retrying when offline
DB_PATH        = Path(__file__).parent / "rag_cache.db"

# ── Validate env ───────────────────────────────────────────────────────────────
if not SUPABASE_URL or not SUPABASE_KEY:
    print("❌  SUPABASE_URL and SUPABASE_KEY must be set in .env")
    sys.exit(1)

# ── Local SQLite cache ─────────────────────────────────────────────────────────
def init_db() -> sqlite3.Connection:
    con = sqlite3.connect(DB_PATH)
    con.execute("""
        CREATE TABLE IF NOT EXISTS chunks (
            id          TEXT PRIMARY KEY,
            content     TEXT NOT NULL,
            embedding   TEXT,                       -- JSON float array, NULL until embedded
            status      TEXT DEFAULT 'pending',     -- pending | embedded | uploaded
            fetched_at  TEXT DEFAULT (datetime('now'))
        )
    """)
    con.execute("CREATE INDEX IF NOT EXISTS idx_status ON chunks(status)")
    con.commit()
    return con


def local_pending_count(con) -> int:
    return con.execute("SELECT COUNT(*) FROM chunks WHERE status='pending'").fetchone()[0]

def local_embedded_count(con) -> int:
    return con.execute("SELECT COUNT(*) FROM chunks WHERE status='embedded'").fetchone()[0]

def fetch_local_pending(con, limit: int) -> list[dict]:
    rows = con.execute(
        "SELECT id, content FROM chunks WHERE status='pending' LIMIT ?", (limit,)
    ).fetchall()
    return [{"id": r[0], "content": r[1]} for r in rows]

def fetch_local_embedded(con, limit: int) -> list[dict]:
    rows = con.execute(
        "SELECT id, embedding FROM chunks WHERE status='embedded' LIMIT ?", (limit,)
    ).fetchall()
    return [{"id": r[0], "embedding": json.loads(r[1])} for r in rows]

def save_embedded_locally(con, id_: str, vector: list[float]):
    con.execute(
        "UPDATE chunks SET embedding=?, status='embedded' WHERE id=?",
        (json.dumps(vector), id_)
    )
    con.commit()

def mark_uploaded(con, ids: list[str]):
    con.executemany("UPDATE chunks SET status='uploaded' WHERE id=?", [(i,) for i in ids])
    con.commit()

def store_new_chunks(con, chunks: list[dict]):
    """Insert fetched chunks, skip already-known IDs."""
    con.executemany(
        "INSERT OR IGNORE INTO chunks (id, content, status) VALUES (?, ?, 'pending')",
        [(c["id"], c["content"]) for c in chunks]
    )
    con.commit()

# ── Connectivity ───────────────────────────────────────────────────────────────
def is_online() -> bool:
    try:
        socket.setdefaulttimeout(3)
        socket.create_connection(("8.8.8.8", 53))
        return True
    except OSError:
        return False

# ── Supabase helpers ───────────────────────────────────────────────────────────
def get_supabase():
    from supabase import create_client
    return create_client(SUPABASE_URL, SUPABASE_KEY)

def sb_fetch_pending(sb, limit: int) -> list[dict]:
    """Pull pending chunks from Supabase that we don't have locally yet."""
    res = (
        sb.table("rag_chunks")
        .select("id, content")
        .eq("embedding_status", "pending")
        .limit(limit)
        .execute()
    )
    return res.data or []

def sb_upload_embeddings(sb, rows: list[dict]):
    """
    rows = [{"id": ..., "embedding": [...], "embedding_status": "done"}]
    Upload in UPLOAD_BATCH-sized chunks.
    """
    for i in range(0, len(rows), UPLOAD_BATCH):
        batch = rows[i : i + UPLOAD_BATCH]
        sb.table("rag_chunks").upsert(batch).execute()

# ── Embedding ──────────────────────────────────────────────────────────────────
def load_model():
    print(f"⏳  Loading model: {MODEL_NAME}")
    print("    (First run downloads ~280 MB — subsequent runs are instant)")
    from sentence_transformers import SentenceTransformer
    m = SentenceTransformer(MODEL_NAME)
    print(f"✅  Model ready  ({m.get_sentence_embedding_dimension()} dims)\n")
    return m

def embed_batch(model, chunks: list[dict]) -> list[tuple[str, list[float] | None]]:
    """Returns [(id, vector_or_None), ...]"""
    results = []
    ids      = [c["id"]      for c in chunks]
    contents = [f"passage: {c['content']}" for c in chunks]   # e5 passage prefix

    for i in range(0, len(contents), EMBED_BATCH):
        sub_ids  = ids[i : i + EMBED_BATCH]
        sub_text = contents[i : i + EMBED_BATCH]
        try:
            vecs = model.encode(
                sub_text,
                batch_size=EMBED_BATCH,
                show_progress_bar=False,
                normalize_embeddings=True,
                convert_to_numpy=True,
            )
            for id_, vec in zip(sub_ids, vecs):
                results.append((id_, vec.tolist()))
        except Exception as e:
            print(f"  ⚠️  embed sub-batch failed: {e}")
            for id_ in sub_ids:
                results.append((id_, None))

    return results

# ── Phase 1: Sync with Supabase ────────────────────────────────────────────────
def sync_with_supabase(sb, con) -> dict:
    stats = {"uploaded": 0, "fetched": 0, "errors": 0}

    # 1a. Upload locally-embedded chunks
    embedded = fetch_local_embedded(con, limit=500)
    if embedded:
        print(f"  ↑  Uploading {len(embedded)} embedded chunks to Supabase…")
        upload_rows = [
            {"id": r["id"], "embedding": r["embedding"], "embedding_status": "done"}
            for r in embedded
        ]
        try:
            sb_upload_embeddings(sb, upload_rows)
            mark_uploaded(con, [r["id"] for r in embedded])
            stats["uploaded"] = len(embedded)
            print(f"  ✅  Uploaded {len(embedded)} chunks")
        except Exception as e:
            print(f"  ❌  Upload failed: {e}")
            stats["errors"] += 1

    # 1b. Fetch new pending chunks from Supabase → local cache
    local_q = local_pending_count(con)
    if local_q < FETCH_LIMIT:
        print(f"  ↓  Fetching new pending chunks from Supabase (local queue: {local_q})…")
        try:
            new_chunks = sb_fetch_pending(sb, FETCH_LIMIT)
            if new_chunks:
                store_new_chunks(con, new_chunks)
                stats["fetched"] = len(new_chunks)
                print(f"  ✅  Fetched {len(new_chunks)} new chunks → local cache")
            else:
                print("  ✅  Supabase has no new pending chunks")
        except Exception as e:
            print(f"  ❌  Fetch failed: {e}")
            stats["errors"] += 1

    return stats

# ── Phase 2: Embed local queue ─────────────────────────────────────────────────
def embed_local_queue(model, con) -> dict:
    stats = {"embedded": 0, "failed": 0}

    pending = fetch_local_pending(con, EMBED_BATCH * 4)
    if not pending:
        return stats

    print(f"  🧠  Embedding {len(pending)} chunks locally…")
    results = embed_batch(model, pending)

    for id_, vec in results:
        if vec is not None:
            save_embedded_locally(con, id_, vec)
            stats["embedded"] += 1
        else:
            stats["failed"] += 1

    print(f"  ✅  Embedded {stats['embedded']}  |  Failed {stats['failed']}")
    return stats

# ── Main loop ──────────────────────────────────────────────────────────────────
def run():
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  RAG Embedding Job  —  Offline-first mode")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    # Imports check
    try:
        import sentence_transformers
    except ImportError:
        print("❌  sentence-transformers not installed.  Run:  pip install sentence-transformers supabase python-dotenv")
        sys.exit(1)

    con   = init_db()
    model = load_model()
    sb    = None  # lazy-init when online

    total_uploaded = 0
    total_embedded = 0
    loop = 0

    while True:
        loop += 1
        ts = datetime.now().strftime("%H:%M:%S")
        local_q = local_pending_count(con)
        local_e = local_embedded_count(con)
        online  = is_online()

        print(f"[{ts}]  Loop {loop}  |  online={online}  |  local pending={local_q}  local embedded={local_e}")

        # ── Phase 1: Sync (online only) ───────────────────────────────────────
        if online:
            if sb is None:
                sb = get_supabase()
            sync_stats = sync_with_supabase(sb, con)
            total_uploaded += sync_stats["uploaded"]
        else:
            print("  📡  Offline — skipping Supabase sync")

        # ── Phase 2: Embed local queue ────────────────────────────────────────
        local_q = local_pending_count(con)
        if local_q > 0:
            embed_stats = embed_local_queue(model, con)
            total_embedded += embed_stats["embedded"]
        else:
            # Nothing left locally AND nothing from Supabase
            if online:
                print(f"\n🎉  All done!  Total uploaded: {total_uploaded}  |  Total embedded: {total_embedded}")
                break
            else:
                print(f"  💤  No local work. Waiting {OFFLINE_SLEEP}s for connection…")
                time.sleep(OFFLINE_SLEEP)
                continue

        print()  # blank line between loops

    con.close()


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        print("\n\n⏸   Stopped.  Run again to resume — progress is saved in rag_cache.db")
