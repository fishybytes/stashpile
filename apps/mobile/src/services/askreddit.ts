import { AskRedditComment, AskRedditPost } from '../types';

const HEADERS = { 'User-Agent': 'stashpile/1.0' };

export async function fetchAskRedditBatch(limit = 20): Promise<{
  posts: AskRedditPost[];
  comments: AskRedditComment[];
}> {
  const res = await fetch(
    `https://www.reddit.com/r/askreddit/hot.json?limit=${limit}`,
    { headers: HEADERS }
  );
  const json = await res.json();
  const now = Date.now();

  const posts: AskRedditPost[] = json.data.children
    .filter((c: any) => !c.data.stickied)
    .map((c: any): AskRedditPost => ({
      postId: c.data.id,
      title: c.data.title,
      score: c.data.score,
      numComments: c.data.num_comments,
      fetchedAt: now,
    }));

  const allComments: AskRedditComment[] = [];

  await Promise.allSettled(
    posts.map(async (post) => {
      try {
        const commentsRes = await fetch(
          `https://www.reddit.com/r/askreddit/comments/${post.postId}.json?limit=100&sort=top&depth=5`,
          { headers: HEADERS }
        );
        const [, listing] = await commentsRes.json();
        const comments = flattenComments(listing.data.children, post.postId, null, 0, now);
        allComments.push(...comments);
      } catch {
        // individual post failures are non-fatal
      }
    })
  );

  return { posts, comments: allComments };
}

function flattenComments(
  children: any[],
  postId: string,
  parentId: string | null,
  depth: number,
  now: number
): AskRedditComment[] {
  const result: AskRedditComment[] = [];
  for (const child of children) {
    if (child.kind !== 't1') continue;
    const d = child.data;
    if (!d.body || d.body === '[deleted]' || d.body === '[removed]') continue;
    result.push({
      commentId: d.id,
      postId,
      parentId,
      body: d.body.trim(),
      score: d.score ?? 0,
      depth,
      fetchedAt: now,
    });
    if (d.replies?.data?.children?.length) {
      result.push(...flattenComments(d.replies.data.children, postId, d.id, depth + 1, now));
    }
  }
  return result;
}
