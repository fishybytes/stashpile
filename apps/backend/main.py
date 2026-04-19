"""
stashpile backend API

GET  /health
GET  /ingest/cursor
GET  /feed?user_id=default&limit=50&seen=id1,id2,...
GET  /profile?user_id=default
POST /events  {"user_id":"default","comment_id":"...","event_type":"view|save|skip","duration_ms":0}
POST /ingest  {"comments":[{"comment_id":"...","post_id":"...","post_title":"...","author":"...","body":"...","score":0,"depth":0},...]}
"""

import asyncio
import json
import logging
import math
import os
import sqlite3
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import numpy as np
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

DB_PATH = os.environ.get("DB_PATH", "/var/lib/stashpile/stashpile.db")
_db_lock = threading.Lock()

TOPICS = [
    "technology & software",
    "science & research",
    "politics & government",
    "history & culture",
    "philosophy & ethics",
    "personal advice",
    "relationships & family",
    "career & workplace",
    "finance & investing",
    "health & medicine",
    "humor & jokes",
    "gaming",
    "movies & TV",
    "music",
    "sports",
    "food & cooking",
    "travel & places",
    "environment & climate",
    "education & learning",
    "law & justice",
    "space & astronomy",
    "psychology & behavior",
    "business & startups",
    "art & design",
    "news & current events",
]

# ─── DB ───────────────────────────────────────────────────────────────────────

def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS comments (
                comment_id  TEXT PRIMARY KEY,
                post_id     TEXT NOT NULL,
                post_title  TEXT NOT NULL DEFAULT '',
                author      TEXT NOT NULL DEFAULT '',
                body        TEXT NOT NULL,
                score       INTEGER DEFAULT 0,
                depth       INTEGER DEFAULT 0,
                fetched_at  REAL NOT NULL DEFAULT (unixepoch()),
                embedding   TEXT,
                top_topic   TEXT,
                topic_score REAL
            );
            CREATE INDEX IF NOT EXISTS idx_comments_fetched ON comments (fetched_at DESC);

            CREATE TABLE IF NOT EXISTS events (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     TEXT NOT NULL DEFAULT 'default',
                comment_id  TEXT NOT NULL,
                event_type  TEXT NOT NULL,
                duration_ms INTEGER DEFAULT 0,
                created_at  REAL NOT NULL DEFAULT (unixepoch())
            );
            CREATE INDEX IF NOT EXISTS idx_events_user ON events (user_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS user_profiles (
                user_id     TEXT PRIMARY KEY,
                embedding   TEXT,
                event_count REAL DEFAULT 0,
                updated_at  REAL NOT NULL DEFAULT (unixepoch())
            );
        """)
        # Migrate existing schema (no-op if columns already exist)
        for col in [
            "ALTER TABLE comments ADD COLUMN top_topic TEXT",
            "ALTER TABLE comments ADD COLUMN topic_score REAL",
        ]:
            try:
                conn.execute(col)
            except Exception:
                pass
        conn.commit()
    log.info("DB initialised at %s", DB_PATH)

# ─── Model ────────────────────────────────────────────────────────────────────

model: SentenceTransformer | None = None
topic_embeddings: np.ndarray | None = None   # shape (n_topics, 384)

def load_model():
    global model, topic_embeddings
    log.info("Loading all-MiniLM-L6-v2...")
    model = SentenceTransformer("all-MiniLM-L6-v2")
    log.info("Embedding %d topic labels...", len(TOPICS))
    topic_embeddings = model.encode(
        TOPICS, batch_size=64, show_progress_bar=False, normalize_embeddings=True
    )
    log.info("Model ready")

def embed_texts(texts: list[str]) -> np.ndarray:
    return model.encode(texts, batch_size=64, show_progress_bar=False, normalize_embeddings=True)

def classify_comment(emb: np.ndarray) -> tuple[str, float]:
    """Returns (top_topic, score) for a normalised comment embedding."""
    if topic_embeddings is None:
        return ("", 0.0)
    sims = topic_embeddings @ emb
    idx = int(np.argmax(sims))
    return (TOPICS[idx], float(sims[idx]))

# ─── Embed + store ────────────────────────────────────────────────────────────

def store_comments(records: list[dict]):
    if not records:
        return

    with _db_lock:
        with get_conn() as conn:
            placeholders = ",".join("?" * len(records))
            existing = {
                row[0] for row in conn.execute(
                    f"SELECT comment_id FROM comments WHERE comment_id IN ({placeholders})",
                    [r["comment_id"] for r in records],
                )
            }

    new = [r for r in records if r["comment_id"] not in existing]
    if not new:
        log.info("No new comments to store")
        return

    log.info("Embedding %d new comments...", len(new))
    embeddings = embed_texts([r["body"] for r in new])
    topics = [classify_comment(emb) for emb in embeddings]

    with _db_lock:
        with get_conn() as conn:
            conn.executemany(
                """
                INSERT INTO comments
                    (comment_id, post_id, post_title, author, body, score, depth,
                     fetched_at, embedding, top_topic, topic_score)
                VALUES (?,?,?,?,?,?,?,unixepoch(),?,?,?)
                ON CONFLICT (comment_id) DO UPDATE SET
                    score = excluded.score, fetched_at = unixepoch()
                """,
                [
                    (r["comment_id"], r["post_id"], r["post_title"], r["author"],
                     r["body"], r["score"], r["depth"],
                     json.dumps(emb.tolist()), topic, score)
                    for r, emb, (topic, score) in zip(new, embeddings, topics)
                ],
            )
    log.info("Stored %d comments", len(new))

# ─── User profile ─────────────────────────────────────────────────────────────

EVENT_WEIGHTS = {"view": 1.0, "save": 3.0, "skip": -0.3}

def update_profile(user_id: str, comment_id: str, event_type: str, duration_ms: int):
    weight = EVENT_WEIGHTS.get(event_type, 0.0)
    if event_type == "view" and duration_ms > 0:
        weight *= min(4.0, math.log(duration_ms / 1000 + 1) + 1)

    with _db_lock:
        with get_conn() as conn:
            row = conn.execute(
                "SELECT embedding FROM comments WHERE comment_id = ?", (comment_id,)
            ).fetchone()
            if not row or not row["embedding"]:
                return
            c_emb = np.array(json.loads(row["embedding"]), dtype=np.float32)

            profile = conn.execute(
                "SELECT embedding, event_count FROM user_profiles WHERE user_id = ?", (user_id,)
            ).fetchone()

            if profile and profile["embedding"]:
                u_emb = np.array(json.loads(profile["embedding"]), dtype=np.float32)
                n = float(profile["event_count"])
                effective = max(weight, 0.0)
                new_emb = u_emb * n + c_emb * effective
                new_n = n + effective
            else:
                new_emb = c_emb * max(weight, 0.0)
                new_n = max(weight, 0.0)

            norm = np.linalg.norm(new_emb)
            if norm > 0:
                new_emb /= norm

            conn.execute(
                """
                INSERT INTO user_profiles (user_id, embedding, event_count, updated_at)
                VALUES (?,?,?,unixepoch())
                ON CONFLICT (user_id) DO UPDATE SET
                    embedding   = excluded.embedding,
                    event_count = excluded.event_count,
                    updated_at  = excluded.updated_at
                """,
                (user_id, json.dumps(new_emb.tolist()), new_n),
            )

# ─── Feed ranking ─────────────────────────────────────────────────────────────

def build_feed(user_id: str, seen_ids: set[str], limit: int) -> list[dict]:
    now_ts = datetime.now(timezone.utc).timestamp()

    with get_conn() as conn:
        profile = conn.execute(
            "SELECT embedding FROM user_profiles WHERE user_id = ?", (user_id,)
        ).fetchone()
        u_emb = (
            np.array(json.loads(profile["embedding"]), dtype=np.float32)
            if profile and profile["embedding"] else None
        )

        cutoff = now_ts - 48 * 3600
        rows = conn.execute(
            """
            SELECT comment_id, post_id, post_title, author, body, score, depth,
                   fetched_at, embedding, top_topic, topic_score
            FROM   comments
            WHERE  fetched_at > ?
            ORDER  BY fetched_at DESC
            LIMIT  2000
            """,
            (cutoff,),
        ).fetchall()

    scored = []
    for row in rows:
        if row["comment_id"] in seen_ids:
            continue
        hours_old = (now_ts - row["fetched_at"]) / 3600
        recency    = 1.0 / math.sqrt(hours_old + 1)
        score_norm = math.log(max(row["score"], 1) + 1) / math.log(10001)
        baseline   = score_norm * recency

        if u_emb is not None and row["embedding"]:
            c_emb = np.array(json.loads(row["embedding"]), dtype=np.float32)
            sim   = float(np.dot(u_emb, c_emb))
            rank  = 0.7 * (sim + 1) / 2 + 0.3 * baseline
        else:
            sim  = None
            rank = baseline

        scored.append((rank, sim, dict(row)))

    scored.sort(key=lambda x: x[0], reverse=True)
    result = []
    for _, sim, row in scored[:limit]:
        row.pop("embedding", None)
        row.pop("fetched_at", None)
        # user_similarity: map [-1,1] → [0,1] for easier display
        row["user_similarity"] = round((sim + 1) / 2, 3) if sim is not None else None
        result.append(row)
    return result

# ─── App ──────────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, load_model)
    await loop.run_in_executor(None, init_db)
    yield

app = FastAPI(title="stashpile API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

# ─── Routes ───────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    return {"ok": True, "model_loaded": model is not None}

class IngestComment(BaseModel):
    comment_id: str
    post_id:    str
    post_title: str = ""
    author:     str = ""
    body:       str
    score:      int = 0
    depth:      int = 0

class IngestRequest(BaseModel):
    comments: list[IngestComment]

@app.post("/ingest")
async def ingest(req: IngestRequest, bg: BackgroundTasks):
    bg.add_task(store_comments, [c.model_dump() for c in req.comments])
    return {"ok": True, "queued": len(req.comments)}

@app.get("/ingest/cursor")
def get_ingest_cursor():
    with get_conn() as conn:
        row = conn.execute("SELECT MAX(fetched_at) AS latest FROM comments").fetchone()
        cursor = row["latest"] if row and row["latest"] else 0
    return {"cursor": cursor}  # unix seconds; 0 means no data yet

class EventIn(BaseModel):
    user_id:     str = "default"
    comment_id:  str
    event_type:  str   # view | save | skip
    duration_ms: int = 0

@app.post("/events")
async def post_event(req: EventIn, bg: BackgroundTasks):
    with _db_lock:
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO events (user_id, comment_id, event_type, duration_ms, created_at) VALUES (?,?,?,?,unixepoch())",
                (req.user_id, req.comment_id, req.event_type, req.duration_ms),
            )
    bg.add_task(update_profile, req.user_id, req.comment_id, req.event_type, req.duration_ms)
    return {"ok": True}

@app.get("/feed")
def get_feed(user_id: str = "default", limit: int = 50, seen: str = ""):
    seen_ids = set(seen.split(",")) if seen else set()
    comments = build_feed(user_id, seen_ids, min(limit, 200))
    return {"comments": comments, "count": len(comments)}

@app.get("/profile")
def get_profile(user_id: str = "default"):
    with get_conn() as conn:
        profile = conn.execute(
            "SELECT embedding, event_count FROM user_profiles WHERE user_id = ?", (user_id,)
        ).fetchone()

    if not profile or not profile["embedding"] or topic_embeddings is None:
        return {"top_topics": [], "event_count": 0}

    u_emb = np.array(json.loads(profile["embedding"]), dtype=np.float32)
    sims = topic_embeddings @ u_emb   # shape (n_topics,)

    # Sort all topics by similarity, return top 10 with positive scores
    order = np.argsort(sims)[::-1]
    top_topics = [
        {"topic": TOPICS[i], "score": round(float(sims[i]), 3)}
        for i in order[:10]
        if sims[i] > 0
    ]

    return {
        "top_topics": top_topics,
        "event_count": int(profile["event_count"]),
    }
