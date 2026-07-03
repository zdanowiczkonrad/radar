import { useCallback, useEffect, useRef, useState } from "react";
import type { Board, Cursor, Person, Session } from "./types";

type Msg = { type: string; data?: any };

// People are the only saturated color in the UI.
const COLORS = ["#D1495B", "#2E77A6", "#D98A2B", "#5B8C5A", "#7B5EA7", "#C2612E", "#3E8E8E", "#B85C79"];

function wsURL(): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export interface WsSession extends Session {
  /** True once a connection attempt has failed before ever succeeding —
      i.e. there is probably no backend here (static hosting). */
  failed: boolean;
}

export function useSession(): WsSession {
  const [connected, setConnected] = useState(false);
  const [failed, setFailed] = useState(false);
  const everConnected = useRef(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [myUserId, setMyUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const nameRef = useRef<string>(localStorage.getItem("octagon.name") || "");
  const colorRef = useRef<string>(
    localStorage.getItem("octagon.color") || COLORS[Math.floor(Math.random() * COLORS.length)],
  );
  const cursorThrottle = useRef(0);

  const send = useCallback((type: string, data?: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("octagon.color", colorRef.current);
    let closed = false;
    let retry: number | undefined;

    const connect = () => {
      const ws = new WebSocket(wsURL());
      wsRef.current = ws;

      ws.onopen = () => {
        everConnected.current = true;
        setConnected(true);
        setFailed(false);
        setError(null);
        if (nameRef.current) {
          ws.send(JSON.stringify({ type: "hello", data: { name: nameRef.current, color: colorRef.current } }));
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (!everConnected.current) setFailed(true);
        if (!closed) retry = window.setTimeout(connect, 1200);
      };
      ws.onmessage = (ev) => {
        let m: Msg;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        switch (m.type) {
          case "welcome":
            setMyUserId(m.data.userId);
            break;
          case "state":
            setBoard(m.data as Board);
            break;
          case "presence":
            setPeople(m.data as Person[]);
            break;
          case "cursor": {
            const c = m.data as Cursor;
            setCursors((prev) => ({ ...prev, [c.userId]: c }));
            break;
          }
          case "left": {
            const id = m.data.userId as string;
            setCursors((prev) => {
              const next = { ...prev };
              delete next[id];
              return next;
            });
            break;
          }
          case "error":
            setError(m.data.message);
            window.setTimeout(() => setError(null), 4000);
            break;
        }
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      wsRef.current?.close();
    };
  }, []);

  const setName = useCallback(
    (name: string) => {
      nameRef.current = name;
      localStorage.setItem("octagon.name", name);
      send("hello", { name, color: colorRef.current });
    },
    [send],
  );

  const sendCursor = useCallback(
    (x: number, y: number) => {
      const now = performance.now();
      if (now - cursorThrottle.current < 40) return; // ~25fps
      cursorThrottle.current = now;
      send("cursor", { x, y });
    },
    [send],
  );

  return {
    connected,
    failed,
    board,
    cursors,
    people,
    myUserId,
    error,
    setName,
    setScope: (betId, scope) => send("setScope", { betId, scope }),
    updateBet: (bet) => send("updateBet", bet),
    addBet: () => send("addBet", {}),
    removeBet: (betId) => send("removeBet", { betId }),
    setEnvelopes: (e) => send("setEnvelopes", e),
    setTitle: (title) => send("setTitle", { title }),
    sendCursor,
  };
}
