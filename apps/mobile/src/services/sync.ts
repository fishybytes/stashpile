import { getFeedConfigs, upsertArticles } from '../db';
import { fetchSubreddit } from './reddit';
import { fetchHackerNews } from './hackernews';
import { fetchRss } from './rss';

export async function syncAllFeeds(): Promise<void> {
  const feeds = getFeedConfigs();

  await Promise.allSettled(
    feeds.map(async (feed) => {
      let articles;
      if (feed.source === 'reddit') {
        articles = await fetchSubreddit(feed.target);
      } else if (feed.source === 'hackernews') {
        articles = await fetchHackerNews(feed.target as 'top' | 'best' | 'new');
      } else {
        articles = await fetchRss(feed.target);
      }
      upsertArticles(articles);
    })
  );
}
