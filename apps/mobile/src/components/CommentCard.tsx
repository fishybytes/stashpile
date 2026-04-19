import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AskRedditComment, AskRedditPost } from '../types';

interface Props {
  comment: AskRedditComment;
  post: AskRedditPost;
  parentComment: AskRedditComment | null;
  onParentTap: () => void;
  replies: (AskRedditComment & { seen: boolean })[];
  onReplyTap: (commentId: string) => void;
}

export function CommentCard({ comment, post, parentComment, onParentTap, replies, onReplyTap }: Props) {
  const [parentExpanded, setParentExpanded] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);

  const bodyTruncated = comment.body.length > 400 && !bodyExpanded;

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

      <View style={styles.commentArea}>
        <Text style={styles.commentScore}>↑{comment.score.toLocaleString()}</Text>
        <Text style={styles.commentBody} numberOfLines={bodyTruncated ? 12 : undefined}>
          {comment.body}
        </Text>
        {comment.body.length > 400 && (
          <Pressable onPress={() => setBodyExpanded(e => !e)}>
            <Text style={styles.expandBtn}>{bodyExpanded ? 'Show less' : 'Read more'}</Text>
          </Pressable>
        )}
      </View>

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
        <Text style={styles.hintText}>↑ new  ·  ← → same thread  ·  ↓ back</Text>
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
    paddingTop: 56,
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
  commentScore: {
    fontSize: 13,
    color: '#ff4500',
    fontWeight: '600',
    marginBottom: 10,
  },
  commentBody: {
    fontSize: 17,
    color: '#e6edf3',
    lineHeight: 26,
  },
  expandBtn: {
    marginTop: 10,
    fontSize: 13,
    color: '#58a6ff',
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
