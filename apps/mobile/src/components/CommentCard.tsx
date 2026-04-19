import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AskRedditComment, AskRedditPost } from '../types';

interface Props {
  comment: AskRedditComment;
  post: AskRedditPost;
  parentComment: AskRedditComment | null;
  previews: AskRedditComment[];
  onPreviewTap: (commentId: string) => void;
  onParentTap: () => void;
}

export function CommentCard({ comment, post, parentComment, previews, onPreviewTap, onParentTap }: Props) {
  const [parentExpanded, setParentExpanded] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);

  // rough threshold: ~400 chars tends to exceed 12 lines on most screens
  const bodyTruncated = comment.body.length > 400 && !bodyExpanded;

  return (
    <View style={styles.container}>
      {/* Post title bar */}
      <View style={styles.titleBar}>
        <Text style={styles.postTitle} numberOfLines={2}>{post.title}</Text>
        <Text style={styles.postScore}>↑{post.score.toLocaleString()}</Text>
      </View>

      {/* Parent context (shown when viewing a reply) */}
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

      {/* Main comment */}
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

      {/* Swipe hints */}
      <View style={styles.hints}>
        <Text style={styles.hintText}>↑ new  ·  ← → same thread  ·  ↓ back</Text>
      </View>

      {/* Preview strip — other comments from this thread */}
      {previews.length > 0 && (
        <View style={styles.previewStrip}>
          <Text style={styles.previewLabel}>Also in this thread</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.previewRow}>
            {previews.map(p => (
              <Pressable key={p.commentId} style={styles.previewCard} onPress={() => onPreviewTap(p.commentId)}>
                <Text style={styles.previewScore}>↑{p.score}</Text>
                <Text style={styles.previewBody} numberOfLines={3}>{p.body}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
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
  hints: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  hintText: {
    fontSize: 11,
    color: '#484f58',
    letterSpacing: 0.3,
  },
  previewStrip: {
    paddingBottom: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#21262d',
  },
  previewLabel: {
    fontSize: 11,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 12,
    marginLeft: 16,
    marginBottom: 8,
  },
  previewRow: {
    paddingHorizontal: 12,
    gap: 8,
  },
  previewCard: {
    width: 200,
    backgroundColor: '#161b22',
    borderRadius: 8,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#30363d',
  },
  previewScore: {
    fontSize: 11,
    color: '#ff4500',
    marginBottom: 4,
  },
  previewBody: {
    fontSize: 12,
    color: '#8b949e',
    lineHeight: 17,
  },
});
