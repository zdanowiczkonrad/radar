/* React session hooks for the no-backend P2P mode.

   useP2PHost — this tab IS the server: it owns the board (persisted to
   localStorage), applies every intent through boardLogic, and broadcasts
   authoritative `state` frames — the exact wire protocol of API.md.

   useP2PGuest — a thin client identical in behavior to the WebSocket
   session, just speaking over an RTCDataChannel. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Bet, Board, Cursor, Envelopes, Person, ScopeLevel, Session } from "./types";
import { applyIntent, newBoard, newID, snapshot } from "./boardLogic";
import type { CoreBoard } from "./boardLogic";
import { GuestNet, HostNet } from "./p2p";
import type { P2PMessage } from "./p2p";

const BOARD_KEY = "octagon.p2p.board";
const HOST_COLOR = "#D98A2B"; // amber = "you" in the people palette

const storedName = () => localStorage.getItem("octagon.name") || "";
const storedColor = () => localStorage.getItem("octagon.color") || "#2E77A6";

function loadBoard(): CoreBoard {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    if (raw) {
      const b = JSON.parse(raw) as CoreBoard;
      if (Array.isArray(b.bets)) return b;
    }
  } catch {
    /* corrupted state — start fresh */
  }
  return newBoard();
}

/* ---------------- host ---------------- */

export interface HostSession extends Session {
  createInvite: () => Promise<string>;
  acceptAnswer: (code: string) => Promise<void>;
  peerCount: number;
}

export function useP2PHost(): HostSession {
  const netRef = useRef<HostNet | null>(null);
  const coreRef = useRef<CoreBoard | null>(null);
  const metaRef = useRef(new Map<string, { name: string; color: string }>());
  const selfRef = useRef({ name: storedName() || "Host", color: HOST_COLOR });
  const saveTimer = useRef<number | undefined>(undefined);
  const cursorThrottle = useRef(0);

  const [board, setBoard] = useState<Board | null>(null);
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [peerCount, setPeerCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const net = () => {
    if (!netRef.current) netRef.current = new HostNet();
    return netRef.current;
  };
  const core = () => {
    if (!coreRef.current) coreRef.current = loadBoard();
    return coreRef.current;
  };

  const roster = useCallback((): Person[] => {
    const list: Person[] = [{ userId: "host", ...selfRef.current }];
    for (const id of net().peerIds()) {
      const m = metaRef.current.get(id) || { name: "Guest", color: "#7B5EA7" };
      list.push({ userId: id, ...m });
    }
    return list;
  }, []);

  const broadcastPresence = useCallback(() => {
    const list = roster();
    setPeople(list);
    net().broadcast({ type: "presence", data: list });
  }, [roster]);

  const commit = useCallback((type: string, data: any, fromId: string) => {
    const res = applyIntent(core(), type, data);
    if (res.error) {
      if (fromId === "host") {
        setError(res.error);
        window.setTimeout(() => setError(null), 4000);
      } else {
        net().send(fromId, { type: "error", data: { message: res.error } });
      }
      return;
    }
    if (!res.changed) return;
    const snap = snapshot(core());
    setBoard(snap);
    net().broadcast({ type: "state", data: snap });
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(
      () => localStorage.setItem(BOARD_KEY, JSON.stringify(coreRef.current)),
      500,
    );
  }, []);

  useEffect(() => {
    const n = net();
    n.onJoin = (peerId) => {
      if (!metaRef.current.has(peerId)) {
        metaRef.current.set(peerId, { name: "Guest", color: "#7B5EA7" });
      }
      n.send(peerId, { type: "welcome", data: { userId: peerId } });
      n.send(peerId, { type: "state", data: snapshot(core()) });
      broadcastPresence();
      setPeerCount(n.peerIds().length);
    };
    n.onLeave = (peerId) => {
      metaRef.current.delete(peerId);
      setCursors((prev) => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      n.broadcast({ type: "left", data: { userId: peerId } });
      broadcastPresence();
      setPeerCount(n.peerIds().length);
    };
    n.onMessage = (peerId, msg: P2PMessage) => {
      switch (msg.type) {
        case "hello": {
          const m = metaRef.current.get(peerId) || { name: "Guest", color: "#7B5EA7" };
          if (msg.data?.name) m.name = String(msg.data.name);
          if (msg.data?.color) m.color = String(msg.data.color);
          metaRef.current.set(peerId, m);
          broadcastPresence();
          break;
        }
        case "cursor": {
          const m = metaRef.current.get(peerId) || { name: "Guest", color: "#7B5EA7" };
          const cur: Cursor = {
            userId: peerId,
            name: m.name,
            color: m.color,
            x: Number(msg.data?.x) || 0,
            y: Number(msg.data?.y) || 0,
          };
          setCursors((prev) => ({ ...prev, [peerId]: cur }));
          n.broadcast({ type: "cursor", data: cur }, peerId);
          break;
        }
        default:
          commit(msg.type, msg.data, peerId);
      }
    };

    setBoard(snapshot(core()));
    setPeople(roster());

    return () => {
      window.clearTimeout(saveTimer.current);
      netRef.current?.close();
      netRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendCursor = useCallback((x: number, y: number) => {
    const now = performance.now();
    if (now - cursorThrottle.current < 40) return;
    cursorThrottle.current = now;
    net().broadcast({
      type: "cursor",
      data: { userId: "host", ...selfRef.current, x, y },
    });
  }, []);

  return {
    connected: true,
    board,
    cursors,
    people,
    myUserId: "host",
    error,
    setName: (name) => {
      localStorage.setItem("octagon.name", name);
      selfRef.current.name = name || "Host";
      broadcastPresence();
    },
    setScope: (betId, scope) => commit("setScope", { betId, scope }, "host"),
    updateBet: (bet: Bet) => commit("updateBet", bet, "host"),
    addBet: () => commit("addBet", {}, "host"),
    removeBet: (betId) => commit("removeBet", { betId }, "host"),
    setEnvelopes: (e: Envelopes) => commit("setEnvelopes", e, "host"),
    setTitle: (title) => commit("setTitle", { title }, "host"),
    sendCursor,
    createInvite: () => net().createInvite(newID()),
    acceptAnswer: (code) => net().acceptAnswer(code),
    peerCount,
  };
}

/* ---------------- guest ---------------- */

export interface GuestSession extends Session {
  joined: boolean;
  /** Consume the host's invite code; resolves to the reply code. */
  answerInvite: (code: string) => Promise<string>;
}

export function useP2PGuest(): GuestSession {
  const netRef = useRef<GuestNet | null>(null);
  const cursorThrottle = useRef(0);

  const [joined, setJoined] = useState(false);
  const [connected, setConnected] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [cursors, setCursors] = useState<Record<string, Cursor>>({});
  const [people, setPeople] = useState<Person[]>([]);
  const [myUserId, setMyUserId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const net = () => {
    if (!netRef.current) netRef.current = new GuestNet();
    return netRef.current;
  };

  useEffect(() => {
    const n = net();
    n.onOpen = () => {
      setJoined(true);
      setConnected(true);
      n.send({ type: "hello", data: { name: storedName(), color: storedColor() } });
    };
    n.onClose = () => setConnected(false);
    n.onMessage = (m: P2PMessage) => {
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
    return () => {
      netRef.current?.close();
      netRef.current = null;
    };
  }, []);

  const send = useCallback((type: string, data?: any) => net().send({ type, data }), []);

  const sendCursor = useCallback(
    (x: number, y: number) => {
      const now = performance.now();
      if (now - cursorThrottle.current < 40) return;
      cursorThrottle.current = now;
      send("cursor", { x, y });
    },
    [send],
  );

  return {
    connected,
    board,
    cursors,
    people,
    myUserId,
    error,
    setName: (name) => {
      localStorage.setItem("octagon.name", name);
      send("hello", { name, color: storedColor() });
    },
    setScope: (betId, scope: ScopeLevel) => send("setScope", { betId, scope }),
    updateBet: (bet: Bet) => send("updateBet", bet),
    addBet: () => send("addBet", {}),
    removeBet: (betId) => send("removeBet", { betId }),
    setEnvelopes: (e: Envelopes) => send("setEnvelopes", e),
    setTitle: (title) => send("setTitle", { title }),
    sendCursor,
    joined,
    answerInvite: (code) => net().answer(code),
  };
}
