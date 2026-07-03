# Octagon — portfolio balance

A single-screen, multiplayer planning tool. A group balances up to 8 strategic
**bets** — one per axis of a radar chart — against a fixed people budget, live
on a projected screen. The goal: drive the **balance to exactly zero**.

The radar has a **variable number of vertices**: one axis per bet plus one
"+ empty axis" slot (minimum 3, maximum 8), so the shape grows from a triangle
to a full octagon as bets are added.

## Running it

Static SPA — React + TypeScript + Vite, no runtime dependencies beyond React.

```sh
npm install
npm run dev        # dev server on :5173 (proxies /ws to :8080 if you run a backend)
npm run build      # type-checks and builds to dist/
```

`dist/` is committed so the app can be hosted as-is on any static file host —
all asset paths are relative.

## Two ways to be multiplayer

1. **With a backend** — the client connects to `/ws` on its own origin and
   speaks the protocol described in [API.md](./API.md). All board math is
   server-authoritative; the client is a thin optimistic view.

2. **Without any backend (peer-to-peer)** — if `/ws` is unreachable (e.g. the
   app is on static hosting), a lobby offers **Host a session** / **Join a
   session**. The host's browser tab becomes the server: it runs the same
   board logic locally (`src/boardLogic.ts`), persists the board to
   localStorage, and talks to guests over WebRTC DataChannels. Signaling is
   manual — a one-time copy-paste invite/reply code per guest — so no
   signaling server, STUN, or TURN is needed. Peers must share a network
   (same Wi-Fi/LAN); networks with client isolation block peer connections.

   Roles can be forced with `?mode=host` / `?mode=guest`.

## Source map

```
src/
  App.tsx          mode router, lobby, invite flows, panel UI, review modal
  Octagon.tsx      the radar: variable-vertex geometry, drag/snap, center meter
  types.ts         domain model + the Session interface both transports implement
  ws.ts            WebSocket client (backend mode) — see API.md
  boardLogic.ts    authoritative board rules (P2P host mode; mirrors API.md)
  p2p.ts           WebRTC star transport + copy-paste signaling codes
  p2pSession.ts    React session hooks for P2P host/guest
  styles.css       visual system
```
