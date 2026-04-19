import { useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { initDb } from './src/db';
import { SwipeFeed } from './src/components/SwipeFeed';

export default function App() {
  const initialized = useRef(false);
  if (!initialized.current) {
    initDb();
    initialized.current = true;
  }

  return (
    <>
      <StatusBar style="light" />
      <SwipeFeed />
    </>
  );
}
