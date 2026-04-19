import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  getAllAskRedditComments,
  getAllAskRedditPosts,
  getSetting,
  hasAskRedditComments,
  isCommentSaved,
  recordCommentView,
  saveComment,
  setSetting,
  unsaveComment,
  upsertAskRedditComments,
  upsertAskRedditPosts,
} from '../db';
import { fetchAskRedditBatch } from '../services/askreddit';
import { AskRedditComment, AskRedditPost } from '../types';
import { CommentCard } from './CommentCard';
import { FONT_SIZE_VALUES, FontSizeKey, SettingsSheet } from './SettingsSheet';
import { SavedSheet } from './SavedSheet';

const { width: W, height: H } = Dimensions.get('window');
const SWIPE_THRESHOLD = 80;
const VELOCITY_THRESHOLD = 0.5;

function weightedRandom(items: AskRedditComment[]): AskRedditComment | null {
  if (!items.length) return null;
  const weights = items.map(c => Math.log(Math.max(c.score, 0) + 2));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function SwipeFeed() {
  const [allComments, setAllComments] = useState<AskRedditComment[]>([]);
  const [postsById, setPostsById] = useState<Map<string, AskRedditPost>>(new Map());
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [nextGlobalId, setNextGlobalId] = useState<string | null>(null);
  const [nextThreadId, setNextThreadId] = useState<string | null>(null);
  // dominantDir drives which peek card to show; set once per drag, cleared on release
  const [dominantDir, setDominantDir] = useState<'h' | 'v' | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [fontSizeKey, setFontSizeKey] = useState<FontSizeKey>('medium');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [savedVisible, setSavedVisible] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  // Mutable refs — safe to read from PanResponder without stale closures
  const seenIds = useRef(new Set<string>());
  const history = useRef<string[]>([]);
  const viewStart = useRef(0);
  const allCommentsRef = useRef<AskRedditComment[]>([]);
  const currentIdRef = useRef<string | null>(null);
  const dominantDirRef = useRef<'h' | 'v' | null>(null);
  const nextGlobalIdRef = useRef<string | null>(null);
  const nextThreadIdRef = useRef<string | null>(null);

  useEffect(() => { allCommentsRef.current = allComments; }, [allComments]);
  useEffect(() => { currentIdRef.current = currentId; }, [currentId]);
  useEffect(() => { nextGlobalIdRef.current = nextGlobalId; }, [nextGlobalId]);
  useEffect(() => { nextThreadIdRef.current = nextThreadId; }, [nextThreadId]);

  // Animation values
  const position = useRef(new Animated.ValueXY()).current;
  const swipeProgress = useRef(new Animated.Value(0)).current;
  const cardOpacity = useRef(new Animated.Value(1)).current;

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

  function computeNextIds(currentComment: AskRedditComment | null) {
    const nextG = weightedRandom(getAvailable());
    setNextGlobalId(nextG?.commentId ?? null);
    nextGlobalIdRef.current = nextG?.commentId ?? null;

    if (currentComment) {
      const nextT = weightedRandom(
        getAvailable(currentComment.postId).filter(c => c.commentId !== nextG?.commentId)
      );
      const tid = nextT?.commentId ?? nextG?.commentId ?? null;
      setNextThreadId(tid);
      nextThreadIdRef.current = tid;
    } else {
      setNextThreadId(nextG?.commentId ?? null);
      nextThreadIdRef.current = nextG?.commentId ?? null;
    }
  }

  function flushCurrentView() {
    const cid = currentIdRef.current;
    if (!cid) return;
    const c = allCommentsRef.current.find(x => x.commentId === cid);
    if (!c) return;
    const elapsed = Date.now() - viewStart.current;
    if (elapsed > 500) recordCommentView(c.commentId, c.postId, elapsed);
  }

  function handleFontSizeChange(key: FontSizeKey) {
    setFontSizeKey(key);
    setSetting('fontSize', key);
  }

  function handleSave() {
    if (!currentIdRef.current || !current) return;
    if (isSaved) {
      unsaveComment(currentIdRef.current);
      setIsSaved(false);
    } else {
      saveComment(currentIdRef.current, current.postId);
      setIsSaved(true);
    }
  }

  function showComment(commentId: string, addToHistory = true) {
    cardOpacity.setValue(0);
    position.setValue({ x: 0, y: 0 });
    setIsSaved(isCommentSaved(commentId));
    // swipeProgress left at its current value (1 after a swipe) so the peek card
    // stays visible as a seamless background while the new card fades in.
    // dominantDir also preserved so peekId keeps pointing at the target comment.

    flushCurrentView();
    seenIds.current.add(commentId);
    viewStart.current = Date.now();
    if (addToHistory) history.current.push(commentId);
    currentIdRef.current = commentId;
    setCurrentId(commentId);
    // computeNextIds deferred — updating it now would swap the peek card's content mid-fade

    Animated.timing(cardOpacity, { toValue: 1, duration: 160, useNativeDriver: true }).start(({ finished }) => {
      if (!finished) return;
      // Current card is now fully opaque and covers the peek card — safe to reset
      swipeProgress.setValue(0);
      dominantDirRef.current = null;
      setDominantDir(null);
      computeNextIds(allCommentsRef.current.find(c => c.commentId === commentId) ?? null);
    });
  }

  function animateOut(toX: number, toY: number, done: () => void) {
    const anims: Animated.CompositeAnimation[] = [
      Animated.timing(position, { toValue: { x: toX, y: toY }, duration: 200, useNativeDriver: true }),
      Animated.timing(swipeProgress, { toValue: 1, duration: 200, useNativeDriver: true }),
    ];
    // Fade out only on horizontal exits; vertical cards slide fully off screen
    if (toX !== 0) {
      anims.push(Animated.timing(cardOpacity, { toValue: 0, duration: 200, useNativeDriver: true }));
    }
    Animated.parallel(anims).start(done);
  }

  function springBack() {
    dominantDirRef.current = null;
    setDominantDir(null);
    Animated.parallel([
      Animated.spring(position, { toValue: { x: 0, y: 0 }, useNativeDriver: true, bounciness: 8 }),
      Animated.timing(swipeProgress, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 220, useNativeDriver: true }),
    ]).start();
  }

  // Handlers re-assigned every render so PanResponder always calls fresh versions
  const handlers = {
    nextGlobal() {
      const nid = nextGlobalIdRef.current ?? weightedRandom(getAvailable())?.commentId;
      if (nid) animateOut(0, -H * 1.5, () => showComment(nid));
      else springBack();
    },
    nextThread() {
      const nid = nextThreadIdRef.current ?? nextGlobalIdRef.current ?? weightedRandom(getAvailable())?.commentId;
      if (nid) animateOut(-W * 1.5, 0, () => showComment(nid));
      else springBack();
    },
    goBack() {
      if (history.current.length < 2) { springBack(); return; }
      const prev = history.current[history.current.length - 2];
      history.current.pop();
      animateOut(0, H * 1.5, () => showComment(prev, false));
    },
  };
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, { dx, dy }) => Math.abs(dx) > 6 || Math.abs(dy) > 6,
      onPanResponderMove: (_, { dx, dy }) => {
        // Lock direction once the user has moved enough to tell
        if (!dominantDirRef.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
          const dir: 'h' | 'v' = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
          dominantDirRef.current = dir;
          setDominantDir(dir);
        }
        // Once direction is locked, clamp the card to that axis
        const x = dominantDirRef.current === 'v' ? 0 : dx;
        const y = dominantDirRef.current === 'h' ? 0 : dy;
        position.setValue({ x, y });
        swipeProgress.setValue(Math.min(1, Math.sqrt(x * x + y * y) / 100));
        // Fade the card as it moves horizontally
        if (dominantDirRef.current === 'h') {
          cardOpacity.setValue(Math.max(0, 1 - Math.abs(x) / (W / 2)));
        }
      },
      onPanResponderRelease: (_, { dx, dy, vx, vy }) => {
        const adx = Math.abs(dx);
        const ady = Math.abs(dy);
        const speed = Math.sqrt(vx * vx + vy * vy);
        const fastEnough = speed > VELOCITY_THRESHOLD;
        if (ady > adx && (ady > SWIPE_THRESHOLD || (fastEnough && ady > 20))) {
          dy < 0 ? handlersRef.current.nextGlobal() : handlersRef.current.goBack();
        } else if (adx > ady && (adx > SWIPE_THRESHOLD || (fastEnough && adx > 20))) {
          handlersRef.current.nextThread();
        } else {
          springBack();
        }
      },
      onPanResponderTerminate: () => { springBack(); },
    })
  ).current;

  function loadFromDb() {
    const comments = getAllAskRedditComments();
    const posts = getAllAskRedditPosts();
    allCommentsRef.current = comments;
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
      if (!currentIdRef.current) {
        const first = weightedRandom(fresh.filter(c => !seenIds.current.has(c.commentId)));
        if (first) showComment(first.commentId);
      }
    } catch {
      // network unavailable — fail silently
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    const saved = getSetting('fontSize') as FontSizeKey | null;
    if (saved) setFontSizeKey(saved);

    const comments = loadFromDb();
    if (hasAskRedditComments()) {
      const first = weightedRandom(comments);
      if (first) showComment(first.commentId);
    }
    setLoading(false);
    handleSync(); // background sync on open
  }, []);

  // ─── Derived display values ───────────────────────────────────────────────

  const current = currentId ? commentsById.get(currentId) ?? null : null;
  const currentPost = current ? postsById.get(current.postId) ?? null : null;
  const parentComment = current?.parentId ? commentsById.get(current.parentId) ?? null : null;

  // Which peek card to show depends on the drag direction established so far
  const peekId = dominantDir === 'h' ? nextThreadId : nextGlobalId;
  const peekComment = peekId ? commentsById.get(peekId) ?? null : null;
  const peekPost = peekComment ? postsById.get(peekComment.postId) ?? null : null;
  const peekParent = peekComment?.parentId ? commentsById.get(peekComment.parentId) ?? null : null;

  const topReplies = useMemo(() => {
    if (!current) return [];
    return allComments
      .filter(c => c.parentId === current.commentId && c.commentId !== currentId)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(c => ({ ...c, seen: seenIds.current.has(c.commentId) }));
  }, [currentId, allComments]);

  // ─── Animated interpolations ─────────────────────────────────────────────

  // Peek card grows from 93% → 100% as drag progresses
  const peekScale = swipeProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.93, 1.0],
  });
  const peekOpacity = swipeProgress.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [0, 0.65, 1],
  });

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color="#ff4500" size="large" /></View>;
  }

  if (!current || !currentPost) {
    return (
      <View style={styles.center}>
        <Text style={styles.emptyTitle}>No content yet</Text>
        <Text style={styles.emptySub}>Fetch the latest r/AskReddit posts to start reading</Text>
        <Pressable style={[styles.syncBtn, syncing && styles.syncBtnDim]} onPress={handleSync} disabled={syncing}>
          {syncing
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.syncBtnText}>Fetch content</Text>}
        </Pressable>
      </View>
    );
  }

  const fontSize = FONT_SIZE_VALUES[fontSizeKey];

  return (
    <View style={styles.container}>
      <View style={styles.stack}>
        {peekComment && peekPost && (
          <Animated.View style={[
            StyleSheet.absoluteFill,
            { transform: [{ scale: peekScale }], opacity: peekOpacity },
          ]}>
            <CommentCard
              comment={peekComment}
              post={peekPost}
              parentComment={peekParent}
              onParentTap={() => {}}
              replies={[]}
              onReplyTap={() => {}}
              fontSize={fontSize}
            />
          </Animated.View>
        )}

        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            { transform: [{ translateX: position.x }, { translateY: position.y }], opacity: cardOpacity },
          ]}
          {...panResponder.panHandlers}
        >
          <CommentCard
            comment={current}
            post={currentPost}
            parentComment={parentComment}
            onParentTap={() => {
              if (parentComment) {
                history.current.push(parentComment.commentId);
                showComment(parentComment.commentId);
              }
            }}
            replies={topReplies}
            onReplyTap={(id) => { history.current.push(id); showComment(id); }}
            fontSize={fontSize}
          />
        </Animated.View>
      </View>

      {/* Floating top bar — pointerEvents="box-none" so swipes pass through the bg */}
      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.topBarContent}>
          <Text style={styles.topBarTitle}>stashpile</Text>
          <View style={styles.topBarActions}>
            <Pressable style={styles.topBarBtn} onPress={handleSave}>
              <Text style={[styles.topBarBtnText, isSaved && styles.topBarBtnSaved]}>
                {isSaved ? '♥' : '♡'}
              </Text>
            </Pressable>
            <Pressable style={styles.topBarBtn} onPress={handleSync} disabled={syncing}>
              {syncing
                ? <ActivityIndicator color="#8b949e" size="small" />
                : <Text style={styles.topBarBtnText}>↻</Text>}
            </Pressable>
            <Pressable style={styles.topBarBtn} onPress={() => setSettingsVisible(true)}>
              <Text style={styles.topBarBtnText}>⚙</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <SettingsSheet
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        fontSize={fontSizeKey}
        onFontSizeChange={handleFontSizeChange}
        onOpenSaved={() => { setSettingsVisible(false); setSavedVisible(true); }}
      />
      <SavedSheet
        visible={savedVisible}
        onClose={() => setSavedVisible(false)}
        onNavigate={(id) => { history.current.push(id); showComment(id); }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  stack: {
    flex: 1,
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
  emptySub: {
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
  syncBtnDim: { opacity: 0.6 },
  syncBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingTop: 48,
    backgroundColor: 'rgba(13,17,23,0.92)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#21262d',
  },
  topBarContent: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBarTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ff4500',
    letterSpacing: -0.3,
  },
  topBarActions: {
    flexDirection: 'row',
    gap: 4,
  },
  topBarBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarBtnText: {
    fontSize: 20,
    color: '#8b949e',
  },
  topBarBtnSaved: {
    color: '#ff4500',
  },
});
