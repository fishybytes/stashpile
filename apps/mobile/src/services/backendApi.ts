import { AskRedditComment, AskRedditPost } from '../types';

const BASE_URL = 'https://api.dev.stashpile.click';

export interface BackendComment {
  comment_id: string;
  post_id: string;
  post_title: string;
  author: string;
  body: string;
  score: number;
  depth: number;
}

export async function fetchFeed(
  userId = 'default',
  seenIds: string[] = [],
  limit = 50,
): Promise<{ comments: AskRedditComment[]; posts: AskRedditPost[] }> {
  const seen = seenIds.join(',');
  const url = `${BASE_URL}/feed?user_id=${encodeURIComponent(userId)}&limit=${limit}${seen ? `&seen=${seen}` : ''}`;
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  const data: { comments: BackendComment[] } = await res.json();

  const now = Date.now();
  const postsMap = new Map<string, AskRedditPost>();
  const comments: AskRedditComment[] = data.comments.map((c) => {
    if (!postsMap.has(c.post_id)) {
      postsMap.set(c.post_id, {
        postId: c.post_id,
        title: c.post_title,
        score: c.score,
        numComments: 0,
        fetchedAt: now,
      });
    }
    return {
      commentId: c.comment_id,
      postId: c.post_id,
      parentId: null,
      author: c.author,
      body: c.body,
      score: c.score,
      depth: c.depth,
      fetchedAt: now,
    };
  });

  return { comments, posts: Array.from(postsMap.values()) };
}

export async function ingestComments(
  comments: AskRedditComment[],
  postTitles: Map<string, string>,
): Promise<void> {
  if (!comments.length) return;
  const body = {
    comments: comments.map(c => ({
      comment_id: c.commentId,
      post_id:    c.postId,
      post_title: postTitles.get(c.postId) ?? '',
      author:     c.author,
      body:       c.body,
      score:      c.score,
      depth:      c.depth,
    })),
  };
  await fetch(`${BASE_URL}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function postEvent(
  commentId: string,
  eventType: 'view' | 'save' | 'skip',
  durationMs = 0,
  userId = 'default',
): Promise<void> {
  try {
    await fetch(`${BASE_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, comment_id: commentId, event_type: eventType, duration_ms: durationMs }),
    });
  } catch {
    // Non-fatal — events are best-effort
  }
}
