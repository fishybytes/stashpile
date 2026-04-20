import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { TopicScore, UserProfile, fetchProfile } from '../services/backendApi';

interface Props {
  visible: boolean;
  onClose: () => void;
}

function TopicBar({ topic, score, maxScore, dynamic: isDynamic }: { topic: string; score: number; maxScore: number; dynamic: boolean }) {
  const pct = maxScore > 0 ? score / maxScore : 0;
  const label = topic.charAt(0).toUpperCase() + topic.slice(1);
  return (
    <View style={styles.topicRow}>
      <View style={styles.topicLabelRow}>
        <Text style={styles.topicName} numberOfLines={1}>{label}</Text>
        {isDynamic && <Text style={styles.dynamicBadge}>new</Text>}
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, isDynamic && styles.barFillDynamic, { width: `${Math.round(pct * 100)}%` as any }]} />
      </View>
      <Text style={styles.topicPct}>{Math.round(pct * 100)}%</Text>
    </View>
  );
}

export function ProfileSheet({ visible, onClose }: Props) {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setLoading(true);
    setError(false);
    fetchProfile()
      .then(p => { setProfile(p); setLoading(false); })
      .catch(() => { setError(true); setLoading(false); });
  }, [visible]);

  const topics = profile?.top_topics ?? [];
  const maxScore = topics.length > 0 ? topics[0].score : 1;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Taste Profile</Text>

          {loading && (
            <View style={styles.center}>
              <ActivityIndicator color="#ff4500" />
            </View>
          )}

          {error && !loading && (
            <View style={styles.center}>
              <Text style={styles.emptyText}>Couldn't load profile — check your connection.</Text>
            </View>
          )}

          {!loading && !error && topics.length === 0 && (
            <View style={styles.center}>
              <Text style={styles.emptyText}>Not enough data yet.</Text>
              <Text style={styles.emptySub}>Keep swiping to build your taste profile.</Text>
            </View>
          )}

          {!loading && !error && topics.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>Top interests</Text>
              {topics.map((t: TopicScore) => (
                <TopicBar key={t.topic} topic={t.topic} score={t.score} maxScore={maxScore} dynamic={t.dynamic} />
              ))}
              {profile && profile.event_count > 0 && (
                <Text style={styles.eventCount}>
                  Based on {profile.event_count} interactions
                </Text>
              )}
            </>
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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#30363d',
    minHeight: 300,
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#30363d',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#e6edf3',
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 11,
    color: '#8b949e',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 14,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  topicLabelRow: {
    width: 160,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  topicName: {
    flexShrink: 1,
    fontSize: 14,
    color: '#e6edf3',
  },
  dynamicBadge: {
    fontSize: 9,
    color: '#58a6ff',
    borderWidth: 1,
    borderColor: '#1f4e79',
    borderRadius: 3,
    paddingHorizontal: 3,
    paddingVertical: 1,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  barTrack: {
    flex: 1,
    height: 6,
    backgroundColor: '#21262d',
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    backgroundColor: '#ff4500',
    borderRadius: 3,
  },
  barFillDynamic: {
    backgroundColor: '#58a6ff',
  },
  topicPct: {
    width: 36,
    fontSize: 12,
    color: '#8b949e',
    textAlign: 'right',
  },
  eventCount: {
    marginTop: 16,
    fontSize: 12,
    color: '#484f58',
    textAlign: 'center',
  },
  center: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 8,
  },
  emptyText: {
    fontSize: 15,
    color: '#8b949e',
    textAlign: 'center',
  },
  emptySub: {
    fontSize: 13,
    color: '#484f58',
    textAlign: 'center',
  },
});
