import * as SQLite from 'expo-sqlite';
import { Article, AskRedditComment, AskRedditPost, FeedConfig } from '../types';

const db = SQLite.openDatabaseSync('stashpile.db');

export function initDb() {
  db.execSync(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      body TEXT,
      author TEXT,
      score INTEGER,
      comment_count INTEGER,
      published_at TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS feed_configs (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      target TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS askreddit_posts (
      post_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      num_comments INTEGER DEFAULT 0,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS askreddit_comments (
      comment_id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      parent_id TEXT,
      author TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL,
      score INTEGER DEFAULT 0,
      depth INTEGER DEFAULT 0,
      fetched_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comment_reading_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      comment_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      time_spent_ms INTEGER NOT NULL,
      viewed_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS comment_topics (
      comment_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      PRIMARY KEY (comment_id, topic)
    );

    CREATE TABLE IF NOT EXISTS user_taste_profile (
      topic TEXT PRIMARY KEY,
      weight REAL NOT NULL DEFAULT 0.0,
      last_updated INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS saved_items (
      comment_id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      saved_at INTEGER NOT NULL
    );
  `);
}

// ─── Legacy article feed ──────────────────────────────────────────────────────

export function upsertArticles(articles: Article[]) {
  const stmt = db.prepareSync(`
    INSERT OR REPLACE INTO articles
      (id, source, title, url, body, author, score, comment_count, published_at, fetched_at, read)
    VALUES
      ($id, $source, $title, $url, $body, $author, $score, $commentCount, $publishedAt, $fetchedAt, 0)
  `);
  for (const a of articles) {
    stmt.executeSync({
      $id: a.id, $source: a.source, $title: a.title, $url: a.url,
      $body: a.body, $author: a.author, $score: a.score,
      $commentCount: a.commentCount, $publishedAt: a.publishedAt, $fetchedAt: a.fetchedAt,
    });
  }
  stmt.finalizeSync();
}

export function getUnreadArticles(): Article[] {
  return db.getAllSync<any>('SELECT * FROM articles WHERE read = 0 ORDER BY fetched_at DESC')
    .map(row => ({
      id: row.id, source: row.source, title: row.title, url: row.url,
      body: row.body, author: row.author, score: row.score,
      commentCount: row.comment_count, publishedAt: row.published_at,
      fetchedAt: row.fetched_at, read: row.read === 1,
    }));
}

export function markRead(id: string) {
  db.runSync('UPDATE articles SET read = 1 WHERE id = ?', id);
}

export function getFeedConfigs(): FeedConfig[] {
  return db.getAllSync<any>('SELECT * FROM feed_configs WHERE enabled = 1')
    .map(row => ({ id: row.id, source: row.source, name: row.name, target: row.target, enabled: true }));
}

export function upsertFeedConfig(config: FeedConfig) {
  db.runSync(
    'INSERT OR REPLACE INTO feed_configs (id, source, name, target, enabled) VALUES (?, ?, ?, ?, ?)',
    config.id, config.source, config.name, config.target, config.enabled ? 1 : 0
  );
}

export function seedDefaultFeeds() {
  const existing = db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM feed_configs');
  if (existing && existing.count > 0) return;

  const defaults: FeedConfig[] = [
    { id: 'hn-top', source: 'hackernews', name: 'Hacker News Top', target: 'top', enabled: true },
    { id: 'r-worldnews', source: 'reddit', name: 'r/worldnews', target: 'worldnews', enabled: true },
    { id: 'r-technology', source: 'reddit', name: 'r/technology', target: 'technology', enabled: true },
    { id: 'nyt-rss', source: 'rss', name: 'NYT Homepage', target: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml', enabled: true },
  ];

  for (const feed of defaults) upsertFeedConfig(feed);
}

// ─── AskReddit swipe feed ─────────────────────────────────────────────────────

function rowToPost(row: any): AskRedditPost {
  return {
    postId: row.post_id,
    title: row.title,
    score: row.score,
    numComments: row.num_comments,
    fetchedAt: row.fetched_at,
  };
}

function rowToComment(row: any): AskRedditComment {
  return {
    commentId: row.comment_id,
    postId: row.post_id,
    parentId: row.parent_id ?? null,
    author: row.author ?? '',
    body: row.body,
    score: row.score,
    depth: row.depth,
    fetchedAt: row.fetched_at,
  };
}

export function upsertAskRedditPosts(posts: AskRedditPost[]) {
  const stmt = db.prepareSync(`
    INSERT OR REPLACE INTO askreddit_posts (post_id, title, score, num_comments, fetched_at)
    VALUES ($postId, $title, $score, $numComments, $fetchedAt)
  `);
  for (const p of posts) {
    stmt.executeSync({
      $postId: p.postId, $title: p.title, $score: p.score,
      $numComments: p.numComments, $fetchedAt: p.fetchedAt,
    });
  }
  stmt.finalizeSync();
}

export function upsertAskRedditComments(comments: AskRedditComment[]) {
  const stmt = db.prepareSync(`
    INSERT OR REPLACE INTO askreddit_comments
      (comment_id, post_id, parent_id, author, body, score, depth, fetched_at)
    VALUES ($commentId, $postId, $parentId, $author, $body, $score, $depth, $fetchedAt)
  `);
  for (const c of comments) {
    stmt.executeSync({
      $commentId: c.commentId, $postId: c.postId, $parentId: c.parentId,
      $author: c.author, $body: c.body, $score: c.score, $depth: c.depth, $fetchedAt: c.fetchedAt,
    });
  }
  stmt.finalizeSync();
}

export function getAllAskRedditComments(): AskRedditComment[] {
  return db.getAllSync<any>('SELECT * FROM askreddit_comments').map(rowToComment);
}

export function getAllAskRedditPosts(): AskRedditPost[] {
  return db.getAllSync<any>('SELECT * FROM askreddit_posts').map(rowToPost);
}

export function hasAskRedditComments(): boolean {
  const row = db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM askreddit_comments');
  return (row?.count ?? 0) > 0;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  return db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
}

export function setSetting(key: string, value: string) {
  db.runSync('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', key, value);
}

// ─── Saved items ──────────────────────────────────────────────────────────────

export function saveComment(commentId: string, postId: string) {
  db.runSync(
    'INSERT OR REPLACE INTO saved_items (comment_id, post_id, saved_at) VALUES (?, ?, ?)',
    commentId, postId, Date.now()
  );
}

export function unsaveComment(commentId: string) {
  db.runSync('DELETE FROM saved_items WHERE comment_id = ?', commentId);
}

export function isCommentSaved(commentId: string): boolean {
  return (db.getFirstSync<{ count: number }>('SELECT COUNT(*) as count FROM saved_items WHERE comment_id = ?', commentId)?.count ?? 0) > 0;
}

export function getSavedItems(): { comment: AskRedditComment; postTitle: string; postScore: number; savedAt: number }[] {
  return db.getAllSync<any>(`
    SELECT s.saved_at,
           c.comment_id, c.post_id, c.parent_id, c.body, c.score, c.depth, c.fetched_at,
           p.title AS post_title, p.score AS post_score
    FROM saved_items s
    JOIN askreddit_comments c ON c.comment_id = s.comment_id
    JOIN askreddit_posts p ON p.post_id = s.post_id
    ORDER BY s.saved_at DESC
  `).map(row => ({
    comment: rowToComment(row),
    postTitle: row.post_title,
    postScore: row.post_score,
    savedAt: row.saved_at,
  }));
}

// ─── Reading sessions ─────────────────────────────────────────────────────────

export function recordCommentView(commentId: string, postId: string, timeSpentMs: number) {
  db.runSync(
    'INSERT INTO comment_reading_sessions (comment_id, post_id, time_spent_ms, viewed_at) VALUES (?, ?, ?, ?)',
    commentId, postId, timeSpentMs, Date.now()
  );
}
