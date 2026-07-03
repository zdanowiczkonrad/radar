export type ScopeLevel = 0 | 1 | 2 | 3; // none, bare-bone, wider, full

export const SCOPE_LABELS: Record<ScopeLevel, string> = {
  0: "Parked",
  1: "Bare-bone",
  2: "Wider",
  3: "Full",
};

export interface Bet {
  id: string;
  name: string;
  owner: string;
  axis: number; // 0..7
  bareBoneFte: number;
  widerFte: number;
  fullFte: number;
  scope: ScopeLevel;
  bareBoneDesc: string;
  widerDesc: string;
  fullDesc: string;
}

export interface Board {
  id: string;
  title: string;
  totalFte: number; // total engineering FTE
  coreFte: number;
  parityChurnFte: number;
  ktloFte: number;
  bets: Bet[];
  version: number;
  updatedAt: string;
  allocatedFte: number;
  strategicFte: number; // total - core - parity - ktlo  → the octagon pool
  balance: number; // strategic - allocated
}

export interface Envelopes {
  totalFte: number;
  coreFte: number;
  parityChurnFte: number;
  ktloFte: number;
}

export interface Cursor {
  userId: string;
  name: string;
  color: string;
  x: number;
  y: number;
}

export interface Person {
  userId: string;
  name: string;
  color: string;
}

/** One live multiplayer session — implemented by the WebSocket transport
    (Go backend) and by the P2P host/guest transports (no backend). */
export interface Session {
  connected: boolean;
  board: Board | null;
  cursors: Record<string, Cursor>;
  people: Person[];
  myUserId: string;
  error: string | null;
  setName: (name: string) => void;
  setScope: (betId: string, scope: ScopeLevel) => void;
  updateBet: (bet: Bet) => void;
  addBet: () => void;
  removeBet: (betId: string) => void;
  setEnvelopes: (e: Envelopes) => void;
  setTitle: (title: string) => void;
  sendCursor: (x: number, y: number) => void;
}

export function fteForScope(bet: Bet, s: ScopeLevel): number {
  switch (s) {
    case 1:
      return bet.bareBoneFte;
    case 2:
      return bet.widerFte;
    case 3:
      return bet.fullFte;
    default:
      return 0;
  }
}

export function descForScope(bet: Bet, s: ScopeLevel): string {
  switch (s) {
    case 1:
      return bet.bareBoneDesc;
    case 2:
      return bet.widerDesc;
    case 3:
      return bet.fullDesc;
    default:
      return "";
  }
}
