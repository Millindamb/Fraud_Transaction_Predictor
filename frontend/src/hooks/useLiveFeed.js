import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

/**
 * Streams scored transactions from the backend as they clear the pipeline.
 * Falls back silently to polling-free idle state if the socket never connects.
 */
export function useLiveFeed({ limit = 25, paused = false } = {}) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL || '/', {
      path: '/socket.io',
      auth: { token: localStorage.getItem('fg_token') },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('transaction:scored', (tx) => {
      if (pausedRef.current) return;
      setEvents((prev) => [tx, ...prev].slice(0, limit));
    });

    return () => socket.close();
  }, [limit]);

  return { events, connected, clear: () => setEvents([]) };
}
