import { Article } from '../types';

export async function fetchSubreddit(subreddit: string, limit = 25): Promise<Article[]> {
  const res = await fetch(`https://www.reddit.com/r/${subreddit}/hot.json?limit=${limit}`, {
    headers: { 'User-Agent': 'stashpile/1.0' },
  });
  const json = await res.json();
  const now = new Date().toISOString();

  return json.data.children
    .filter((c: any) => !c.data.stickied)
    .map((c: any): Article => ({
      id: `reddit-${c.data.id}`,
      source: 'reddit',
      title: c.data.title,
      url: c.data.url,
      body: c.data.selftext || null,
      author: c.data.author,
      score: c.data.score,
      commentCount: c.data.num_comments,
      publishedAt: new Date(c.data.created_utc * 1000).toISOString(),
      fetchedAt: now,
      read: false,
    }));
}
