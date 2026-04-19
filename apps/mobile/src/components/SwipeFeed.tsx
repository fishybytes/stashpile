import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  getAllAskRedditComments,
  getAllAskRedditPosts,
  hasAskRedditComments,
  recordCommentView,
  upsertAskRedditComments,
  upsertAskRedditPosts,
} from '../db';
import { fetchAskRedditBatch } from '../services/askreddit';
import { AskRedditComment, AskRedditPost } from '../types';
import { CommentCard } from './CommentCard';

function weightedRandom(comments: AskRedditComment[]): AskRedditComment | null {
  if (comments.length === 0) return null;
  const weights = comments.map(c => Math.log(Math.max(c.score, 0) + 2));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < comments.length; i++) {
    r -= weights[i];
    if (r <= 0) return comments[i];
  }
  return comments[comments.length - 1];
}

export function SwipeFeed() {
  const [allComments, setAllComments] = useState<AskRedditComment[]>([]);
  const [postsById, setPostsById] = useState<Map<string, AskRedditPost>>(new Map());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  // refs survive re-renders without causing them
  const seenIds = useRef(new Set<string>());
  const history = useRef<string[]>([]);
  const viewStart = useRef(0);
  const currentIdRef = useRef<string | null>(null);
  const allCommentsRef = useRef<AskRedditComment[]>([]);

  // keep refs in sync
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);
  useEffect(() => { allCommentsRef.current = allComments; }, [allComments]);

  const commentsById = useMemo(
    () => new Map(allComments.map(c => [c.commentId, c])),
    [allComments]
  );

  function getAvailable(postId?: string): AskRedditComment[] {
    return allCommentsRef.current.filter(c =>
      !seenIds.current.has(c.commentId) &&
      (postId === undefined || c.postId === postId)
    );
  }

  function flushCurrentView() {
    const cid = currentIdRef.current;
    if (!cid) return;
    const c = allCommentsRef.current.find(x => x.commentId === cid);
    if (!c) return;
    const elapsed = Date.now() - viewStart.current;
    if (elapsed > 500) recordCommentView(c.commentId, c.postId, elapsed);
  }

  function showComment(commentId: string) {
    flushCurrentView();
    seenIds.current.add(commentId);
    viewStart.current = Date.now();
    setCurrentId(commentId);
  }

  // These are defined fresh each render so handlersRef always calls the latest version
  const handlers = {
    nextGlobal() {
      const next = weightedRandom(getAvailable());
      if (next) { history.current.push(next.commentId); showComment(next.commentId); }
    },
    nextInThread() {
      const cid = currentIdRef.current;
      const current = cid ? allCommentsRef.current.find(c => c.commentId === cid) : null;
      if (!current) { handlers.nextGlobal(); return; }
      const next = weightedRandom(getAvailable(current.postId));
      if (next) { history.current.push(next.commentId); showComment(next.commentId); }
      else handlers.nextGlobal();
    },
    goBack() {
      if (history.current.length < 2) return;
      history.current.pop();
      const prev = history.current[history.current.length - 1];
      showComment(prev);
    },
  };

  // Stable ref updated every render — PanResponder reads from it
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, { dx, dy }) =>
        Math.abs(dx) > Math.abs(dy) * 1.5 || Math.abs(dy) > 50,
      onPanResponderRelease: (_, { dx, dy }) => {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        if (ady > adx && ady > 50) {
          dy < 0 ? handlersRef.current.nextGlobal() : handlersRef.current.goBack();
        } else if (adx > ady && adx > 40) {
          handlersRef.current.nextInThread();
        }
      },
    })
  ).current;

  function loadFromDb() {
    const comments = getAllAskRedditComments();
    const posts = getAllAskRedditPosts();
    setAllComments(comments);
    setPostsById(new Map(posts.map(p => [p.postId, p])));
    return comments;
  }

  async function handleSync() {
    setSyncing(true);
    try {
      const { posts, comments } = await fetchAskRedditBatch(20);
      upsertAskRedditPosts(posts);
      upsertAskRedditComments(comments);
      const fresh = loadFromDb();
      // Start the feed if not already running
      if (!currentIdRef.current) {
        const first = weightedRandom(fresh.filter(c => !seenIds.current.has(c.commentId)));
        if (first) {
          history.current = [first.commentId];
          seenIds.current.add(first.commentId);
          viewStart.current = Date.now();
          setCurrentId(first.commentId);
        }
      }
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    const comments = loadFromDb();
    if (hasAskRedditComments()) {
      const first = weightedRandom(comments);
      if (first) {
        history.current = [first.commentId];
        seenIds.current.add(first.commentId);
        viewStart.current = Date.now();
        setCurrentId(first.commentId);
      }
    }
    setLoading(false);
  }, []);

  // Derive display data from currentId
  const current = currentId ? commentsById.get(currentId) ?? null : null;
  const currentPost = current ? postsById.get(current.postId) ?? null : null;
  const parentComment = current?.parentId ? commentsById.get(current.parentId) ?? null : null;

  const previews = useMemo(() => {
    if (!current) return [];
    const pool = allComments.filter(c =>
      c.postId === current.postId &&
      c.commentId !== current.commentId &&
      !seenIds.current.has(c.commentId)
    );
    const replies = pool.filter(c => c.parentId === current.commentId);
    const others = pool.filter(c => c.parentId !== current.commentId);
    return [...replies, ...others].sort((a, b) => b.score - a.score).slice(0, 3);
  }, [currentId, allComments]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#ff4500" size="large" />
      </View>
    );
  }

  if (!current || !currentPost) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No content yet</Text>
        <Text style={styles.emptySubtitle}>Fetch the latest r/AskReddit posts to start reading</Text>
        <Pressable style={[styles.syncBtn, syncing && styles.syncBtnDisabled]} onPress={handleSync} disabled={syncing}>
          {syncing
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.syncBtnText}>Fetch content</Text>
          }
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container} {...panResponder.panHandlers}>
      <CommentCard
        comment={current}
        post={currentPost}
        parentComment={parentComment}
        previews={previews}
        onPreviewTap={(commentId) => {
          history.current.push(commentId);
          showComment(commentId);
        }}
        onParentTap={() => {
          if (parentComment) {
            history.current.push(parentComment.commentId);
            showComment(parentComment.commentId);
          }
        }}
      />
      {/* Sync button overlay — top right */}
      <Pressable style={styles.syncOverlay} onPress={handleSync} disabled={syncing}>
        {syncing
          ? <ActivityIndicator color="#8b949e" size="small" />
          : <Text style={styles.syncOverlayText}>↻</Text>
        }
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  center: {
    flex: 1,
    backgroundColor: '#0d1117',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#e6edf3',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#8b949e',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 28,
  },
  syncBtn: {
    backgroundColor: '#ff4500',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
    minWidth: 160,
    alignItems: 'center',
  },
  syncBtnDisabled: {
    opacity: 0.6,
  },
  syncBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  syncOverlay: {
    position: 'absolute',
    top: 52,
    right: 16,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  syncOverlayText: {
    fontSize: 20,
    color: '#484f58',
  },
});
