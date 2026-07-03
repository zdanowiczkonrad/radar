# Octagon backend API

What a server must implement so the client's backend mode works. One endpoint,
JSON frames over WebSocket, server-authoritative state. The client never
mutates the board locally (except an optimistic drag preview) — it sends
intents and renders whatever `state` the server broadcasts back.

A reference implementation of the board rules ships inside the client itself:
`src/boardLogic.ts` (it powers the no-backend P2P host mode). A backend must
match its semantics exactly.

## Transport

- **Endpoint:** `GET /ws` → WebSocket upgrade, same origin as the app
  (`wss:` when the page is `https:`).
- **Framing:** every message both ways is one JSON object:

  ```json
  { "type": "<name>", "data": { … } }
  ```

- Unknown or malformed messages should be ignored, not fatal.
- Recommended: cap inbound frames (the reference server uses 8 KB) and ping
  idle sockets (~30 s).

## Domain model

```ts
type ScopeLevel = 0 | 1 | 2 | 3;   // 0 parked · 1 bare-bone · 2 wider · 3 full

interface Bet {
  id: string;
  name: string;
  owner: string;
  axis: number;          // 0..7 — stable slot; client compacts for display
  bareBoneFte: number;   // cost of each scope cut
  widerFte: number;
  fullFte: number;
  scope: ScopeLevel;     // 0 ⇒ costs nothing
  bareBoneDesc: string;  // 1–2 sentence milestone per cut, ≤ 300 chars
  widerDesc: string;
  fullDesc: string;
}

interface Board {
  id: string;
  title: string;
  totalFte: number;        // total engineering FTE
  coreFte: number;         // envelope splits of totalFte
  parityChurnFte: number;
  ktloFte: number;
  bets: Bet[];             // max 8
  version: number;         // bumped on every mutation
  updatedAt: string;       // ISO 8601

  // Derived — computed by the server on every snapshot, never stored:
  allocatedFte: number;    // Σ cost of each bet at its current scope
  strategicFte: number;    // totalFte − coreFte − parityChurnFte − ktloFte
  balance: number;         // strategicFte − allocatedFte (0 is the goal)
}
```

Derived math (round each to 1 decimal):

```
scopeCost(bet) = bet.scope == 0 ? 0 : bet[{1:'bareBoneFte',2:'widerFte',3:'fullFte'}[bet.scope]]
allocatedFte   = Σ scopeCost(bet)
strategicFte   = totalFte − coreFte − parityChurnFte − ktloFte   // may go negative
balance        = strategicFte − allocatedFte
```

## Server → client

| type | data | when |
|---|---|---|
| `welcome` | `{ "userId": string }` | once, immediately after connect — assigns the client its id |
| `state` | full `Board` (with derived fields) | after `welcome`, and broadcast to **all** clients after every accepted mutation |
| `presence` | `[{ "userId", "name", "color" }]` | full roster; broadcast on join, leave, and `hello` |
| `cursor` | `{ "userId", "name", "color", "x", "y" }` | relay of a client's cursor; broadcast to all (sender filters itself) |
| `left` | `{ "userId": string }` | a client disconnected |
| `error` | `{ "message": string }` | to the offending client only (e.g. board full) |

`x`/`y` are normalized 0–1 over the radar canvas.

## Client → server

| type | data | behavior |
|---|---|---|
| `hello` | `{ "name": string, "color": string }` | set display identity; empty fields keep previous values; broadcast `presence` |
| `cursor` | `{ "x": number, "y": number }` | stamp with the sender's identity and broadcast `cursor` (client sends ≤ ~25/s) |
| `setScope` | `{ "betId": string, "scope": 0\|1\|2\|3 }` | set the bet's scope; reject other values; broadcast `state` |
| `updateBet` | full `Bet` (matched by `id`) | overwrite name/owner (trimmed), the three FTE costs (clamped ≥ 0) and the three milestones (trimmed, ≤ 300 chars); `axis` and `scope` are **not** changed by this message; broadcast `state` |
| `addBet` | `{ "name"?: string, "owner"?: string }` | reject with `error` if 8 bets; assign the lowest free `axis`; defaults: name "New bet", costs 1/2/3, scope 0, empty milestones; broadcast `state` |
| `removeBet` | `{ "betId": string }` | remove; its axis becomes free for reuse; broadcast `state` |
| `setEnvelopes` | `{ "totalFte", "coreFte", "parityChurnFte", "ktloFte" }` | clamp each ≥ 0 and store; broadcast `state` |
| `setTitle` | `{ "title": string }` | trim; ignore if empty; broadcast `state` |

Mutations that reference a missing `betId` are silently ignored (no `state`
broadcast). Every accepted mutation bumps `version` and refreshes `updatedAt`.

## Authority & concurrency

- The server is the single source of truth. Do **not** apply deltas from
  clients — apply the intent to the canonical board, then broadcast the full
  snapshot. Last-write-wins per message is fine; no OT/CRDT needed.
- The client debounces text edits and sends `setScope` immediately (it is the
  primary live interaction — expect bursts while a handle is dragged).

## Persistence

Optional but recommended: persist the board (debounced — a drag burst should
be one write) and load it on boot, so a session survives restarts. Presence
and cursors are ephemeral and must not be persisted.
