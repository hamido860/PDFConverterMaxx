import requests
import time
import os
from dotenv import load_dotenv

load_dotenv()

# ── Config ──────────────────────────────────────────────
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "AIzaSyBFN0m4hIgztO_rIXXTOpvDwC-x19OdwdI")
SUPABASE_URL   = os.getenv("SUPABASE_URL", "https://pimojkivimygenhygsto.supabase.co")
SUPABASE_KEY   = os.getenv("SUPABASE_KEY")  # Pulling directly from .env safely
# ────────────────────────────────────────────────────────

EMBED_URL = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key={GEMINI_API_KEY}"
HEADERS   = {"apikey": SUPABASE_KEY, "Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"}

def get_pending_chunks():
    res = requests.get(
        f"{SUPABASE_URL}/rest/v1/rag_chunks",
        params={"select": "id,content", "embedding_status": "eq.pending", "limit": "1000"},
        headers=HEADERS
    )
    res.raise_for_status()
    return res.json()

def embed(text):
    res = requests.post(EMBED_URL, json={
        "model": "models/gemini-embedding-001",
        "content": {"parts": [{"text": text}]},
        "taskType": "RETRIEVAL_DOCUMENT",
        "outputDimensionality": 1024
    })
    if res.status_code == 200:
        return res.json()["embedding"]["values"]
    raise Exception(f"Gemini error {res.status_code}: {res.text[:300]}")

def update_chunk(chunk_id, embedding):
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/rag_chunks",
        params={"id": f"eq.{chunk_id}"},
        headers={**HEADERS, "Prefer": "return=minimal"},
        json={"embedding": embedding, "embedding_status": "done"}
    )

def mark_failed(chunk_id):
    requests.patch(
        f"{SUPABASE_URL}/rest/v1/rag_chunks",
        params={"id": f"eq.{chunk_id}"},
        headers={**HEADERS, "Prefer": "return=minimal"},
        json={"embedding_status": "failed"}
    )

def main():
    chunks = get_pending_chunks()
    total  = len(chunks)
    print(f"Found {total} pending chunks\n")

    done = 0
    failed = 0

    for i, chunk in enumerate(chunks):
        chunk_id = chunk["id"]
        content  = chunk["content"]

        # Skip garbage chunks
        if len(content) < 100:
            mark_failed(chunk_id)
            failed += 1
            print(f"[{done+failed}/{total}] skipped (too short)")
            continue

        try:
            embedding = embed(content)
            update_chunk(chunk_id, embedding)
            done += 1
            print(f"[{done+failed}/{total}] embedded ({len(content)} chars)")
            time.sleep(0.5)  # stay within free rate limits

        except Exception as e:
            print(f"[{done+failed}/{total}] failed: {e}")
            mark_failed(chunk_id)
            failed += 1
            time.sleep(2)

    print(f"\n{'='*40}")
    print(f"✅ Done: {done} embedded, {failed} failed")

if __name__ == "__main__":
    main()
