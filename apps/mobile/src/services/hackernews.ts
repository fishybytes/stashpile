import { Article } from '../types';

const BASE = 'https://hacker-news.firebaseio.com/v0';

export async function fetchHackerNews(feed: 'top' | 'best' | 'new' = 'top', limit = 25): Promise<Article[]> {
  const idsRes = await fetch(`${BASE}/${feed}stories.json`);
  const ids: number[] = await idsRes.json();
  const now = new Date().toISOString();

  const articles = await Promise.all(
    ids.slice(0, limit).map(async (id): Promise<Article | null> => {
      const res = await fetch(`${BASE}/item/${id}.json`);
      const item = await res.json();
      if (!item || item.type !== 'story') return null;
      return {
        id: `hn-${item.id}`,
        source: 'hackernews',
        title: item.title,
        url: item.url ?? `https://news.ycombinator.com/item?id=${item.id}`,
        body: item.text ?? null,
        author: item.by,
        score: item.score,
        commentCount: item.descendants ?? 0,
        publishedAt: new Date(item.time * 1000).toISOString(),
        fetchedAt: now,
        read: false,
      };
    })
  );

  return articles.filter(Boolean) as Article[];
}
