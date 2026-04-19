"""
stashpile backend API

GET  /health
GET  /feed?user_id=default&limit=50&seen=id1,id2,...
POST /events  {"user_id":"default","comment_id":"...","event_type":"view|save|skip","duration_ms":0}
POST /admin/sync  trigger immediate content fetch
"""

import asyncio
import logging
import math
import os
import re
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import httpx
import numpy as np
import psycopg2
import psycopg2.extras
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DATABASE_URL = os.environ["DATABASE_URL"]
REDDIT_HEADERS = {"User-Agent": "stashpile/1.0"}
HTML_ENTITIES = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"',
    "&#39;": "'", "&apos;": "'", "&#x27;": "'", "&nbsp;": " ",
}

# ─── DB ───────────────────────────────────────────────────────────────────────

def get_conn():
    return psycopg2.connect(DATABASE_URL)

def init_db():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS comments (
                    comment_id  TEXT PRIMARY KEY,
                    post_id     TEXT NOT NULL,
                    post_title  TEXT NOT NULL DEFAULT '',
                    author      TEXT NOT NULL DEFAULT '',
                    body        TEXT NOT NULL,
                    score       INTEGER DEFAULT 0,
                    depth       INTEGER DEFAULT 0,
                    fetched_at  TIMESTAMP NOT NULL DEFAULT NOW(),
                    embedding   REAL[]
                );
                CREATE INDEX IF NOT EXISTS idx_comments_fetched
                    ON comments (fetched_at DESC);

                CREATE TABLE IF NOT EXISTS events (
                    id          SERIAL PRIMARY KEY,
                    user_id     TEXT NOT NULL DEFAULT 'default',
                    comment_id  TEXT NOT NULL,
                    event_type  TEXT NOT NULL,
                    duration_ms INTEGER DEFAULT 0,
                    created_at  TIMESTAMP NOT NULL DEFAULT NOW()
                );
                CREATE INDEX IF NOT EXISTS idx_events_user
                    ON events (user_id, created_at DESC);

                CREATE TABLE IF NOT EXISTS user_profiles (
                    user_id     TEXT PRIMARY KEY,
                    embedding   REAL[],
                    event_count REAL DEFAULT 0,
                    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
                );
            """)
        conn.commit()
    log.info("DB initialised")

# ─── Model ────────────────────────────────────────────────────────────────────

model: SentenceTransformer | None = None

def load_model():
    global model
    log.info("Loading all-MiniLM-L6-v2...")
    model = SentenceTransformer("all-MiniLM-L6-v2")
    log.info("Model ready")

def embed_texts(texts: list[str]) -> np.ndarray:
    return model.encode(texts, batch_size=64, show_progress_bar=False, normalize_embeddings=True)

# ─── Content fetch ────────────────────────────────────────────────────────────

def decode(text: str) -> str:
    return re.sub(r"&[a-zA-Z0-9#]+;", lambda m: HTML_ENTITIES.get(m.group(), m.group()), text)

def flatten(children, post_id, post_title, depth):
    out = []
    for child in children:
        if child.get("kind") != "t1":
            continue
        d = child["data"]
        body = d.get("body", "")
        if not body or body in ("[deleted]", "[removed]"):
            continue
        out.append({
            "comment_id": d["id"],
            "post_id":    post_id,
            "post_title": post_title,
            "author":     d.get("author", ""),
            "body":       decode(body.strip()),
            "score":      d.get("score", 0),
            "depth":      depth,
        })
        if isinstance(d.get("replies"), dict):
            out.extend(flatten(d["replies"]["data"]["children"], post_id, post_title, depth + 1))
    return out

async def fetch_reddit(client: httpx.AsyncClient, subreddit: str, limit: int = 25) -> list[dict]:
    resp = await client.get(
        f"https://www.reddit.com/r/{subreddit}/hot.json?limit={limit}",
        headers=REDDIT_HEADERS, timeout=15,
    )
    resp.raise_for_status()
    posts = [c["data"] for c in resp.json()["data"]["children"] if not c["data"].get("stickied")]

    async def fetch_post(post):
        try:
            r = await client.get(
                f"https://www.reddit.com/r/{subreddit}/comments/{post['id']}.json"
                "?limit=100&sort=top&depth=5",
                headers=REDDIT_HEADERS, timeout=15,
            )
            r.raise_for_status()
            _, listing = r.json()
            return flatten(listing["data"]["children"], post["id"], decode(post["title"]), 0)
        except Exception as e:
            log.warning("Failed fetching comments for %s: %s", post["id"], e)
            return []

    batches = await asyncio.gather(*[fetch_post(p) for p in posts])
    return [r for batch in batches for r in batch]

async def fetch_hn(client: httpx.AsyncClient, limit: int = 30) -> list[dict]:
    resp = await client.get("https://hacker-news.firebaseio.com/v0/topstories.json", timeout=10)
    resp.raise_for_status()
    story_ids = resp.json()[:limit]

    async def fetch_story(sid):
        try:
            r = await client.get(f"https://hacker-news.firebaseio.com/v0/item/{sid}.json", timeout=10)
            r.raise_for_status()
            story = r.json()
            if not story or story.get("type") != "story":
                return []
            title = story.get("title", "")
            post_id = f"hn_{sid}"
            kids = story.get("kids", [])[:20]

            async def fetch_comment(kid):
                try:
                    cr = await client.get(
                        f"https://hacker-news.firebaseio.com/v0/item/{kid}.json", timeout=10
                    )
                    cr.raise_for_status()
                    c = cr.json()
                    text = c.get("text", "") if c else ""
                    if not text or c.get("deleted") or c.get("dead"):
                        return None
                    # strip HTML tags from HN comments
                    clean = re.sub(r"<[^>]+>", " ", text).strip()
                    return {
                        "comment_id": f"hn_{kid}",
                        "post_id":    post_id,
                        "post_title": title,
                        "author":     c.get("by", ""),
                        "body":       decode(clean),
                        "score":      0,
                        "depth":      0,
                    }
                except Exception:
                    return None

            comments = await asyncio.gather(*[fetch_comment(k) for k in kids])
            return [c for c in comments if c]
        except Exception as e:
            log.warning("Failed fetching HN story %s: %s", sid, e)
            return []

    batches = await asyncio.gather(*[fetch_story(sid) for sid in story_ids])
    return [r for batch in batches for r in batch]

# ─── Embed + store ────────────────────────────────────────────────────────────

def store_comments(records: list[dict]):
    if not records:
        return
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT comment_id FROM comments WHERE comment_id = ANY(%s)",
                ([r["comment_id"] for r in records],),
            )
            existing = {row[0] for row in cur.fetchall()}

    new = [r for r in records if r["comment_id"] not in existing]
    if not new:
        log.info("No new comments to store")
        return

    log.info("Embedding %d new comments...", len(new))
    embeddings = embed_texts([r["body"] for r in new])

    with get_conn() as conn:
        with conn.cursor() as cur:
            for r, emb in zip(new, embeddings):
                cur.execute(
                    """
                    INSERT INTO comments
                        (comment_id, post_id, post_title, author, body, score, depth, embedding)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (comment_id) DO UPDATE SET
                        score = EXCLUDED.score, fetched_at = NOW()
                    """,
                    (r["comment_id"], r["post_id"], r["post_title"],
                     r["author"], r["body"], r["score"], r["depth"], emb.tolist()),
                )
        conn.commit()
    log.info("Stored %d comments", len(new))

# ─── User profile ─────────────────────────────────────────────────────────────

EVENT_WEIGHTS = {"view": 1.0, "save": 3.0, "skip": -0.3}

def update_profile(user_id: str, comment_id: str, event_type: str, duration_ms: int):
    weight = EVENT_WEIGHTS.get(event_type, 0.0)
    if event_type == "view" and duration_ms > 0:
        # scale up for longer reads, max 4×
        weight *= min(4.0, math.log(duration_ms / 1000 + 1) + 1)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT embedding FROM comments WHERE comment_id = %s", (comment_id,))
            row = cur.fetchone()
            if not row or not row[0]:
                return
            c_emb = np.array(row[0], dtype=np.float32)

            cur.execute(
                "SELECT embedding, event_count FROM user_profiles WHERE user_id = %s", (user_id,)
            )
            profile = cur.fetchone()

            if profile and profile[0]:
                u_emb = np.array(profile[0], dtype=np.float32)
                n = float(profile[1])
                effective = max(weight, 0.0)
                new_emb = u_emb * n + c_emb * effective
                new_n   = n + effective
            else:
                new_emb = c_emb * max(weight, 0.0)
                new_n   = max(weight, 0.0)

            norm = np.linalg.norm(new_emb)
            if norm > 0:
                new_emb /= norm

            cur.execute(
                """
                INSERT INTO user_profiles (user_id, embedding, event_count, updated_at)
                VALUES (%s,%s,%s,NOW())
                ON CONFLICT (user_id) DO UPDATE SET
                    embedding   = EXCLUDED.embedding,
                    event_count = EXCLUDED.event_count,
                    updated_at  = NOW()
                """,
                (user_id, new_emb.tolist(), new_n),
            )
        conn.commit()

# ─── Feed ranking ─────────────────────────────────────────────────────────────

def build_feed(user_id: str, seen_ids: set[str], limit: int) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                "SELECT embedding FROM user_profiles WHERE user_id = %s", (user_id,)
            )
            profile = cur.fetchone()
            u_emb = (
                np.array(profile["embedding"], dtype=np.float32)
                if profile and profile["embedding"] else None
            )

            # candidates: last 48h, fetch up to 2000
            cur.execute("""
                SELECT comment_id, post_id, post_title, author, body, score, depth,
                       fetched_at, embedding
                FROM   comments
                WHERE  fetched_at > NOW() - INTERVAL '48 hours'
                ORDER  BY fetched_at DESC
                LIMIT  2000
            """)
            rows = cur.fetchall()

    now = datetime.now(timezone.utc)
    scored = []
    for row in rows:
        if row["comment_id"] in seen_ids:
            continue

        ft = row["fetched_at"]
        if ft.tzinfo is None:
            ft = ft.replace(tzinfo=timezone.utc)
        hours_old = (now - ft).total_seconds() / 3600

        recency    = 1.0 / math.sqrt(hours_old + 1)
        score_norm = math.log(max(row["score"], 1) + 1) / math.log(10001)
        baseline   = score_norm * recency

        if u_emb is not None and row["embedding"]:
            c_emb = np.array(row["embedding"], dtype=np.float32)
            sim   = float(np.dot(u_emb, c_emb))          # both normalised → [-1,1]
            rank  = 0.7 * (sim + 1) / 2 + 0.3 * baseline # map to [0,1]
        else:
            rank = baseline

        scored.append((rank, dict(row)))

    scored.sort(key=lambda x: x[0], reverse=True)
    result = []
    for _, row in scored[:limit]:
        row.pop("embedding", None)
        row.pop("fetched_at", None)
        result.append(dict(row))
    return result

# ─── Sync job ─────────────────────────────────────────────────────────────────

async def sync_content():
    log.info("Content sync starting")
    try:
        async with httpx.AsyncClient() as client:
            reddit, hn = await asyncio.gather(
                fetch_reddit(client, "askreddit"),
                fetch_hn(client),
            )
        records = reddit + hn
        log.info("Fetched %d comments total", len(records))
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, store_comments, records)
    except Exception:
        log.exception("Content sync failed")

# ─── App ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, load_model)
    await loop.run_in_executor(None, init_db)

    scheduler = AsyncIOScheduler()
    scheduler.add_job(sync_content, "interval", minutes=60, next_run_time=datetime.now())
    scheduler.start()

    yield

    scheduler.shutdown()

app = FastAPI(title="stashpile API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "model_loaded": model is not None}

class EventIn(BaseModel):
    user_id:     str = "default"
    comment_id:  str
    event_type:  str   # view | save | skip
    duration_ms: int = 0

@app.post("/events")
async def post_event(req: EventIn, bg: BackgroundTasks):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO events (user_id, comment_id, event_type, duration_ms) VALUES (%s,%s,%s,%s)",
                (req.user_id, req.comment_id, req.event_type, req.duration_ms),
            )
        conn.commit()
    bg.add_task(update_profile, req.user_id, req.comment_id, req.event_type, req.duration_ms)
    return {"ok": True}

@app.get("/feed")
def get_feed(user_id: str = "default", limit: int = 50, seen: str = ""):
    seen_ids = set(seen.split(",")) if seen else set()
    comments = build_feed(user_id, seen_ids, min(limit, 200))
    return {"comments": comments, "count": len(comments)}

@app.post("/admin/sync")
async def admin_sync(bg: BackgroundTasks):
    bg.add_task(sync_content)
    return {"ok": True, "message": "sync queued"}
