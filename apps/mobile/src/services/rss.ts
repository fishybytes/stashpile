import { Article } from '../types';

export async function fetchRss(feedUrl: string): Promise<Article[]> {
  const res = await fetch(feedUrl);
  const text = await res.text();
  const now = new Date().toISOString();

  // Minimal RSS/Atom parser — no native DOMParser in RN
  const items = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)];

  return items.map((match, i): Article => {
    const item = match[1];
    const title = stripCdata(first(item, 'title')) ?? '(no title)';
    const link = stripCdata(first(item, 'link')) ?? feedUrl;
    const pubDate = first(item, 'pubDate') ?? first(item, 'published') ?? now;
    const description = stripCdata(first(item, 'description')) ?? null;
    const author = stripCdata(first(item, 'dc:creator') ?? first(item, 'author')) ?? null;
    const id = `rss-${btoa(feedUrl).slice(0, 8)}-${i}-${pubDate}`;

    return {
      id,
      source: 'rss',
      title: stripHtml(title),
      url: link,
      body: description ? stripHtml(description) : null,
      author,
      score: null,
      commentCount: null,
      publishedAt: new Date(pubDate).toISOString(),
      fetchedAt: now,
      read: false,
    };
  });
}

function first(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1].trim() : null;
}

function stripCdata(s: string | null): string | null {
  if (!s) return null;
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
}
