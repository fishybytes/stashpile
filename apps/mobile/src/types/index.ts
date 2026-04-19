export type Source = 'reddit' | 'hackernews' | 'rss';

export interface Article {
  id: string;
  source: Source;
  title: string;
  url: string;
  body: string | null;
  author: string | null;
  score: number | null;
  commentCount: number | null;
  publishedAt: string;
  fetchedAt: string;
  read: boolean;
}

export interface FeedConfig {
  id: string;
  source: Source;
  name: string;
  // subreddit name, HN feed type, or RSS URL
  target: string;
  enabled: boolean;
}
