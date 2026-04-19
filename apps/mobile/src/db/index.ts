import * as SQLite from 'expo-sqlite';
import { Article, FeedConfig } from '../types';

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
  `);
}

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
