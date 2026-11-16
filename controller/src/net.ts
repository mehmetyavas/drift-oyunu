import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { encode, parseMessage, type HapticKind, type Message, type StatusMsg } from "@drift/shared";

/** The game sends status ~5x/s; silence this long means the socket is dead. */
const SILENCE_MS = 2000;

/**
 * Socket to the game server that heals itself: reconnects on close, when the app returns to the
 * foreground (iOS kills sockets silently in the background), and when the game goes silent.
 */
export function useControllerSocket(url: string | null, onHaptic: (k: HapticKind) => void) {
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<StatusMsg | null>(null);
  const ws = useRef<WebSocket | null>(null);
  const hapticRef = useRef(onHaptic);
  hapticRef.current = onHaptic;

  useEffect(() => {
    if (!url) return;
    let alive = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let lastMsg = Date.now();

    const open = () => {
      clearTimeout(retry);
      const s = new WebSocket(url);
      ws.current = s;
      lastMsg = Date.now();
      s.onopen = () => {
        // The game's QR carries its pairing code (…/?pair=XXXXXX); without one the server picks the newest game.
        const pair = /[?&]pair=([A-Z0-9]{6})\b/.exec(url)?.[1];
        s.send(encode(pair ? { t: "hello", role: "controller", pair } : { t: "hello", role: "controller" }));
        lastMsg = Date.now();
        setConnected(true);
      };
      s.onmessage = (e) => {
        lastMsg = Date.now();
        const m = parseMessage(String(e.data));
        if (m?.t === "haptic") hapticRef.current(m.kind);
        else if (m?.t === "status") setStatus(m);
      };
      s.onclose = () => {
        if (ws.current !== s) return; // replaced by a newer socket
        setConnected(false);
        if (alive) retry = setTimeout(open, 1000);
      };
      s.onerror = () => {};
    };

    /** Drop the current socket (even a zombie) and open a fresh one now. */
    const reconnect = () => {
      const old = ws.current;
      ws.current = null;
      setConnected(false);
      if (old) {
        old.onclose = null;
        old.close();
      }
      if (alive) open();
    };

    open();
    const watchdog = setInterval(() => {
      if (Date.now() - lastMsg > SILENCE_MS) reconnect();
    }, 1000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") reconnect();
    });

    return () => {
      alive = false;
      clearTimeout(retry);
      clearInterval(watchdog);
      sub.remove();
      const s = ws.current;
      ws.current = null;
      if (s) {
        s.onclose = null;
        s.close();
      }
    };
  }, [url]);

  const send = useCallback((m: Message) => {
    if (ws.current?.readyState === WebSocket.OPEN) ws.current.send(encode(m));
  }, []);

  return { connected, status, send };
}
