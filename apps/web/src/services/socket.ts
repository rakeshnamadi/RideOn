import { useEffect, useRef, useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import { refreshAccessToken, tokenStore } from './api';

let socket: Socket | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** Connect (or reconnect with a fresh token). Real-time is an enhancement: every screen also polls. */
export function connectSocket() {
  const token = tokenStore.get();
  if (!token) return;
  socket?.disconnect();
  socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'], reconnectionDelayMax: 10_000 });
  socket.on('connect', notify);
  socket.on('disconnect', notify);
  socket.on('connect_error', async (err) => {
    notify();
    if (err.message === 'unauthorized' && (await refreshAccessToken()) && socket) {
      socket.auth = { token: tokenStore.get() };
    }
  });
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
  notify();
}

export function useSocketConnected() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => socket?.connected ?? false,
  );
}

export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  const connected = useSocketConnected();
  useEffect(() => {
    if (!socket) return;
    const fn = (p: T) => ref.current(p);
    socket.on(event, fn);
    return () => {
      socket?.off(event, fn);
    };
  }, [event, connected]);
}

/** Polling interval: relaxed while the socket is live, tighter when it is not. */
export function useLiveInterval(baseMs: number) {
  return useSocketConnected() ? baseMs * 3 : baseMs;
}
