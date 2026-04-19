import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getSavedItems } from '../db';
import { AskRedditComment } from '../types';

interface SavedItem {
  comment: AskRedditComment;
  postTitle: string;
  postScore: number;
  savedAt: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onNavigate: (commentId: string) => void;
}

export function SavedSheet({ visible, onClose, onNavigate }: Props) {
  const [items, setItems] = useState<SavedItem[]>([]);

  useEffect(() => {
    if (visible) setItems(getSavedItems());
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Saved</Text>

          {items.length === 0 ? (
            <Text style={styles.empty}>No saved comments yet.{'\n'}Tap ♡ while reading to save one.</Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              {items.map(item => (
                <Pressable
                  key={item.comment.commentId}
                  style={styles.item}
                  onPress={() => { onClose(); onNavigate(item.comment.commentId); }}
                >
                  <Text style={styles.postTitle} numberOfLines={1}>{item.postTitle}</Text>
                  <Text style={styles.body} numberOfLines={3}>{item.comment.body}</Text>
                  <Text style={styles.score}>↑{item.comment.score.toLocaleString()}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#161b22',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 44,
    maxHeight: '80%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#30363d',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#30363d',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#e6edf3',
    marginBottom: 20,
  },
  empty: {
    fontSize: 14,
    color: '#484f58',
    lineHeight: 22,
    textAlign: 'center',
    paddingVertical: 32,
  },
  item: {
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#21262d',
    gap: 6,
  },
  postTitle: {
    fontSize: 11,
    color: '#ff4500',
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  body: {
    fontSize: 14,
    color: '#e6edf3',
    lineHeight: 20,
  },
  score: {
    fontSize: 11,
    color: '#8b949e',
  },
});
