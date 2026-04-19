import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

function capitalize(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
import { AskRedditComment, AskRedditPost } from '../types';

const PAGE = 220;

interface Props {
  comment: AskRedditComment;
  post: AskRedditPost;
  parentComment: AskRedditComment | null;
  onParentTap: () => void;
  replies: (AskRedditComment & { seen: boolean })[];
  onReplyTap: (commentId: string) => void;
  fontSize: number;
  isSaved: boolean;
  onSave: () => void;
}

export function CommentCard({ comment, post, parentComment, onParentTap, replies, onReplyTap, fontSize, isSaved, onSave }: Props) {
  const [parentExpanded, setParentExpanded] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const areaHeight = useRef(0);
  const lastTapTime = useRef(0);
  const lastTapY = useRef(0);
  const tapTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveFlashOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    scrollY.current = 0;
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    if (tapTimeout.current) clearTimeout(tapTimeout.current);
    lastTapTime.current = 0;
    setInfoVisible(false);
  }, [comment.commentId]);

  function flashSaveIndicator() {
    saveFlashOpacity.setValue(1);
    Animated.sequence([
      Animated.delay(500),
      Animated.timing(saveFlashOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();
  }

  function handleTap(locationY: number) {
    const now = Date.now();
    if (now - lastTapTime.current < 300) {
      if (tapTimeout.current) { clearTimeout(tapTimeout.current); tapTimeout.current = null; }
      lastTapTime.current = 0;
      onSave();
      flashSaveIndicator();
    } else {
      lastTapTime.current = now;
      lastTapY.current = locationY;
      tapTimeout.current = setTimeout(() => {
        tapTimeout.current = null;
        if (lastTapY.current < areaHeight.current / 2) {
          scrollRef.current?.scrollTo({ y: Math.max(0, scrollY.current - PAGE), animated: true });
        } else {
          scrollRef.current?.scrollTo({ y: scrollY.current + PAGE, animated: true });
        }
      }, 300);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.titleBar}>
        <Text style={styles.postTitle} numberOfLines={2}>{post.title}</Text>
        <Text style={styles.postScore}>↑{post.score.toLocaleString()}</Text>
      </View>

      {parentComment && (
        <View style={styles.parentBar}>
          <Text style={styles.parentLabel}>↳ replying to</Text>
          <Pressable onPress={() => setParentExpanded(e => !e)}>
            <Text style={styles.parentBody} numberOfLines={parentExpanded ? 6 : 2}>
              {parentComment.body}
            </Text>
          </Pressable>
          <Pressable style={styles.parentViewBtn} onPress={onParentTap}>
            <Text style={styles.parentViewBtnText}>View full →</Text>
          </Pressable>
        </View>
      )}

      <Pressable
        style={styles.commentArea}
        onLayout={e => { areaHeight.current = e.nativeEvent.layout.height; }}
        onPress={e => handleTap(e.nativeEvent.locationY)}
      >
        <ScrollView
          ref={scrollRef}
          scrollEnabled={false}
          showsVerticalScrollIndicator={false}
          onScroll={e => { scrollY.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
        >
          <View style={styles.commentMeta}>
            <Text style={styles.commentScore}>↑{comment.score.toLocaleString()}</Text>
            {comment.author ? <Text style={styles.commentAuthor}>u/{comment.author}</Text> : null}
            <View style={styles.metaSpacer} />
            {comment.topTopic && (
              <Pressable style={styles.infoBtn} onPress={() => setInfoVisible(v => !v)} hitSlop={8}>
                <Text style={[styles.infoBtnText, infoVisible && styles.infoBtnActive]}>ⓘ</Text>
              </Pressable>
            )}
          </View>

          {infoVisible && comment.topTopic && (
            <View style={styles.infoPanel}>
              <View style={styles.infoPanelRow}>
                <Text style={styles.infoPanelLabel}>Topic</Text>
                <Text style={styles.infoPanelValue}>{capitalize(comment.topTopic)}</Text>
              </View>
              {comment.userSimilarity != null && (
                <View style={styles.infoPanelRow}>
                  <Text style={styles.infoPanelLabel}>Taste match</Text>
                  <View style={styles.matchBarWrap}>
                    <View style={[styles.matchBar, { width: `${Math.round(comment.userSimilarity * 100)}%` as any }]} />
                  </View>
                  <Text style={styles.infoPanelValue}>{Math.round(comment.userSimilarity * 100)}%</Text>
                </View>
              )}
            </View>
          )}
          <Text style={[styles.commentBody, { fontSize, lineHeight: fontSize * 1.55 }]}>{comment.body}</Text>
        </ScrollView>
        <Animated.Text style={[styles.saveFlash, { opacity: saveFlashOpacity }]}>
          {isSaved ? '♥' : '♡'}
        </Animated.Text>
      </Pressable>

      {replies.length > 0 && (
        <View style={styles.repliesSection}>
          <Text style={styles.repliesLabel}>top replies</Text>
          {replies.map(reply => (
            <Pressable key={reply.commentId} style={[styles.replyRow, reply.seen && styles.replyRowSeen]} onPress={() => onReplyTap(reply.commentId)}>
              <Text style={[styles.replyScore, reply.seen && styles.replyScoreSeen]}>
                {reply.seen ? '✓' : '↑'}{reply.score.toLocaleString()}
              </Text>
              <Text style={styles.replyBody} numberOfLines={2}>
                {reply.body.length > 120 ? reply.body.slice(0, 120) + '…' : reply.body}
              </Text>
              <Text style={styles.replyArrow}>›</Text>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.hints}>
        <Text style={styles.hintText}>tap = scroll  ·  ↑ next  ·  ↓ back</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d1117',
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 100,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#30363d',
    gap: 8,
  },
  postTitle: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#ff4500',
    lineHeight: 18,
  },
  postScore: {
    fontSize: 12,
    color: '#8b949e',
    marginTop: 1,
  },
  parentBar: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 10,
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#30363d',
  },
  parentLabel: {
    fontSize: 11,
    color: '#8b949e',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  parentBody: {
    fontSize: 13,
    color: '#8b949e',
    lineHeight: 18,
  },
  parentViewBtn: {
    marginTop: 6,
    alignSelf: 'flex-start',
  },
  parentViewBtnText: {
    fontSize: 12,
    color: '#58a6ff',
  },
  commentArea: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 8,
  },
  commentMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  commentScore: {
    fontSize: 13,
    color: '#ff4500',
    fontWeight: '600',
  },
  commentAuthor: {
    fontSize: 12,
    color: '#8b949e',
  },
  commentBody: {
    color: '#e6edf3',
  },
  metaSpacer: {
    flex: 1,
  },
  infoBtn: {
    paddingHorizontal: 4,
  },
  infoBtnText: {
    fontSize: 16,
    color: '#484f58',
  },
  infoBtnActive: {
    color: '#58a6ff',
  },
  infoPanel: {
    marginTop: 4,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#161b22',
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
    gap: 8,
  },
  infoPanelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  infoPanelLabel: {
    fontSize: 12,
    color: '#8b949e',
    width: 82,
  },
  infoPanelValue: {
    fontSize: 13,
    color: '#e6edf3',
    fontWeight: '500',
  },
  matchBarWrap: {
    flex: 1,
    height: 4,
    backgroundColor: '#21262d',
    borderRadius: 2,
    overflow: 'hidden',
  },
  matchBar: {
    height: 4,
    backgroundColor: '#ff4500',
    borderRadius: 2,
  },
  saveFlash: {
    position: 'absolute',
    alignSelf: 'center',
    top: '40%',
    fontSize: 64,
    color: '#ff4500',
    pointerEvents: 'none',
  },
  repliesSection: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderLeftWidth: 2,
    borderLeftColor: '#21262d',
    paddingLeft: 12,
  },
  repliesLabel: {
    fontSize: 10,
    color: '#484f58',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 7,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#21262d',
  },
  replyRowSeen: {
    opacity: 0.4,
  },
  replyScore: {
    fontSize: 11,
    color: '#ff4500',
    minWidth: 36,
    paddingTop: 1,
  },
  replyScoreSeen: {
    color: '#484f58',
  },
  replyBody: {
    flex: 1,
    fontSize: 13,
    color: '#8b949e',
    lineHeight: 18,
  },
  replyArrow: {
    fontSize: 18,
    color: '#30363d',
    lineHeight: 20,
  },
  hints: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  hintText: {
    fontSize: 11,
    color: '#484f58',
    letterSpacing: 0.3,
  },
});
