import { useEffect, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { initDb, getUnreadArticles, markRead, seedDefaultFeeds } from './src/db';
import { syncAllFeeds } from './src/services/sync';
import { Article } from './src/types';

export default function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    initDb();
    seedDefaultFeeds();
    setArticles(getUnreadArticles());
  }, []);

  async function handleSync() {
    setSyncing(true);
    await syncAllFeeds();
    setArticles(getUnreadArticles());
    setSyncing(false);
  }

  function handleRead(id: string) {
    markRead(id);
    setArticles(prev => prev.filter(a => a.id !== id));
  }

  return (
    <View style={styles.container}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.title}>stashpile</Text>
        <Pressable style={styles.syncBtn} onPress={handleSync} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#fff" /> : <Text style={styles.syncText}>Sync</Text>}
        </Pressable>
      </View>
      <FlatList
        data={articles}
        keyExtractor={a => a.id}
        renderItem={({ item }) => (
          <Pressable style={styles.card} onPress={() => handleRead(item.id)}>
            <Text style={styles.source}>{item.source} {item.score != null ? `· ${item.score}` : ''}</Text>
            <Text style={styles.cardTitle}>{item.title}</Text>
            {item.body ? <Text style={styles.body} numberOfLines={3}>{item.body}</Text> : null}
          </Pressable>
        )}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<Text style={styles.empty}>No articles — tap Sync to fetch.</Text>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f0' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, paddingTop: 56, backgroundColor: '#1a1a1a' },
  title: { fontSize: 22, fontWeight: '700', color: '#fff' },
  syncBtn: { backgroundColor: '#e05a2b', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 6 },
  syncText: { color: '#fff', fontWeight: '600' },
  list: { padding: 12 },
  card: { backgroundColor: '#fff', borderRadius: 8, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  source: { fontSize: 11, color: '#999', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: '#1a1a1a', lineHeight: 20 },
  body: { fontSize: 13, color: '#555', marginTop: 6, lineHeight: 18 },
  empty: { textAlign: 'center', color: '#999', marginTop: 60, fontSize: 15 },
});
