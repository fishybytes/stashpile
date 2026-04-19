import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { initDb } from './src/db';
import { SwipeFeed } from './src/components/SwipeFeed';

export default function App() {
  useEffect(() => {
    initDb();
  }, []);

  return (
    <>
      <StatusBar style="light" />
      <SwipeFeed />
    </>
  );
}
