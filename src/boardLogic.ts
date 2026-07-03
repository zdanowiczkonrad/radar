/* Authoritative board logic — used in P2P (no-backend) mode, where the host
   browser tab plays the role of the server. A backend implementing API.md
   must mirror these exact semantics. */

import type { Bet, Board } from "./types";
import { fteForScope } from "./types";

export const MAX_BETS = 8;

/** Stored fields only — derived fields are added by snapshot(). */
export interface CoreBoard {
  id: string;
  title: string;
  totalFte: number;
  coreFte: number;
  parityChurnFte: number;
  ktloFte: number;
  bets: Bet[];
  version: number;
  updatedAt: string;
}

export function newID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

const round1 = (f: number) => Math.round(f * 10) / 10;
const nonNeg = (f: number) => (Number.isFinite(f) && f > 0 ? f : 0);
const clampStr = (s: unknown, n: number) => String(s ?? "").trim().slice(0, n);

export function newBoard(): CoreBoard {
  return {
    id: newID(),
    title: "Portfolio workshop",
    totalFte: 40,
    coreFte: 8,
    parityChurnFte: 6,
    ktloFte: 6,
    bets: [],
    version: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function snapshot(b: CoreBoard): Board {
  const alloc = b.bets.reduce((s, bet) => s + fteForScope(bet, bet.scope), 0);
  const strategic = b.totalFte - b.coreFte - b.parityChurnFte - b.ktloFte;
  return {
    ...b,
    bets: b.bets.map((x) => ({ ...x })),
    allocatedFte: round1(alloc),
    strategicFte: round1(strategic),
    balance: round1(strategic - alloc),
  };
}

function freeAxis(bets: Bet[]): number {
  const used = new Set(bets.map((b) => b.axis));
  for (let a = 0; a < MAX_BETS; a++) if (!used.has(a)) return a;
  return -1;
}

const touch = (b: CoreBoard) => {
  b.version++;
  b.updatedAt = new Date().toISOString();
};

export interface ApplyResult {
  changed: boolean;
  error?: string;
}

/** Apply one inbound intent (same wire protocol as API.md) in place. */
export function applyIntent(b: CoreBoard, type: string, data: any): ApplyResult {
  switch (type) {
    case "setScope": {
      const scope = Number(data?.scope);
      if (![0, 1, 2, 3].includes(scope)) return { changed: false };
      const bet = b.bets.find((x) => x.id === data?.betId);
      if (!bet) return { changed: false };
      bet.scope = scope as Bet["scope"];
      touch(b);
      return { changed: true };
    }
    case "updateBet": {
      const bet = b.bets.find((x) => x.id === data?.id);
      if (!bet) return { changed: false };
      bet.name = String(data.name ?? "").trim();
      bet.owner = String(data.owner ?? "").trim();
      bet.bareBoneFte = nonNeg(Number(data.bareBoneFte));
      bet.widerFte = nonNeg(Number(data.widerFte));
      bet.fullFte = nonNeg(Number(data.fullFte));
      bet.bareBoneDesc = clampStr(data.bareBoneDesc, 300);
      bet.widerDesc = clampStr(data.widerDesc, 300);
      bet.fullDesc = clampStr(data.fullDesc, 300);
      touch(b);
      return { changed: true };
    }
    case "addBet": {
      if (b.bets.length >= MAX_BETS) {
        return { changed: false, error: `octagon is full — max ${MAX_BETS} bets` };
      }
      const axis = freeAxis(b.bets);
      if (axis < 0) return { changed: false, error: "no free axis" };
      const name = String(data?.name ?? "").trim() || "New bet";
      b.bets.push({
        id: newID(),
        name,
        owner: String(data?.owner ?? "").trim(),
        axis,
        bareBoneFte: 1,
        widerFte: 2,
        fullFte: 3,
        scope: 0,
        bareBoneDesc: "",
        widerDesc: "",
        fullDesc: "",
      });
      touch(b);
      return { changed: true };
    }
    case "removeBet": {
      const i = b.bets.findIndex((x) => x.id === data?.betId);
      if (i < 0) return { changed: false };
      b.bets.splice(i, 1);
      touch(b);
      return { changed: true };
    }
    case "setEnvelopes": {
      b.totalFte = nonNeg(Number(data?.totalFte));
      b.coreFte = nonNeg(Number(data?.coreFte));
      b.parityChurnFte = nonNeg(Number(data?.parityChurnFte));
      b.ktloFte = nonNeg(Number(data?.ktloFte));
      touch(b);
      return { changed: true };
    }
    case "setTitle": {
      const t = String(data?.title ?? "").trim();
      if (t !== "") b.title = t;
      touch(b);
      return { changed: true };
    }
    default:
      return { changed: false };
  }
}
