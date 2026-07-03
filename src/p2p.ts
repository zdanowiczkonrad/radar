/* WebRTC transport for the no-backend P2P mode.

   Topology: star. The host tab is authoritative; each guest holds one
   RTCPeerConnection + DataChannel to the host. Signaling is manual — the
   SDP offer/answer travel as copy-paste invite codes (compressed + base64url),
   so no signaling server, no STUN/TURN. This works on a shared LAN/Wi-Fi
   (same-room workshop); networks with AP/client isolation will block it. */

export type P2PMessage = { type: string; data?: any };

const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

/* ---- invite codes: JSON → deflate → base64url ---- */

const b64url = (bytes: Uint8Array): string => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (s: string): Uint8Array => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream as any));
  return new Uint8Array(await out.arrayBuffer());
}

export async function encodeSignal(desc: RTCSessionDescriptionInit): Promise<string> {
  const raw = new TextEncoder().encode(JSON.stringify({ type: desc.type, sdp: desc.sdp }));
  if (typeof CompressionStream !== "undefined") {
    return "z." + b64url(await pipe(raw, new CompressionStream("deflate-raw")));
  }
  return "r." + b64url(raw);
}

export async function decodeSignal(code: string): Promise<RTCSessionDescriptionInit> {
  const trimmed = code.trim();
  const dot = trimmed.indexOf(".");
  if (dot !== 1) throw new Error("That doesn't look like an Octagon code.");
  const kind = trimmed[0];
  const bytes = unb64url(trimmed.slice(2));
  const raw =
    kind === "z" ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes;
  const parsed = JSON.parse(new TextDecoder().decode(raw));
  if (parsed?.type !== "offer" && parsed?.type !== "answer") {
    throw new Error("That doesn't look like an Octagon code.");
  }
  return parsed;
}

/** Resolve once ICE gathering finishes so the SDP carries all candidates
    (single copy-paste — no trickle). */
function waitIce(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener("icegatheringstatechange", check);
      clearTimeout(timer);
      resolve();
    };
    const check = () => pc.iceGatheringState === "complete" && done();
    const timer = setTimeout(done, timeoutMs);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

/* ---- host side ---- */

interface HostPeer {
  pc: RTCPeerConnection;
  channel: RTCDataChannel;
}

export class HostNet {
  private peers = new Map<string, HostPeer>();
  private pending: { id: string; pc: RTCPeerConnection } | null = null;

  onMessage: (peerId: string, msg: P2PMessage) => void = () => {};
  onJoin: (peerId: string) => void = () => {};
  onLeave: (peerId: string) => void = () => {};

  /** Start a new invite; returns the offer code to hand to one guest. */
  async createInvite(peerId: string): Promise<string> {
    this.pending?.pc.close();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const channel = pc.createDataChannel("octagon");
    channel.onopen = () => {
      this.peers.set(peerId, { pc, channel });
      if (this.pending?.id === peerId) this.pending = null;
      this.onJoin(peerId);
    };
    channel.onmessage = (e) => {
      try {
        this.onMessage(peerId, JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    channel.onclose = () => {
      if (this.peers.delete(peerId)) this.onLeave(peerId);
    };
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc);
    this.pending = { id: peerId, pc };
    return encodeSignal(pc.localDescription!);
  }

  /** Complete the pending invite with the guest's reply code. */
  async acceptAnswer(code: string): Promise<void> {
    if (!this.pending) throw new Error("No invite waiting for a reply.");
    const desc = await decodeSignal(code);
    if (desc.type !== "answer") throw new Error("That's an invite code — paste the reply code.");
    await this.pending.pc.setRemoteDescription(desc);
  }

  send(peerId: string, msg: P2PMessage): void {
    const p = this.peers.get(peerId);
    if (p?.channel.readyState === "open") p.channel.send(JSON.stringify(msg));
  }

  broadcast(msg: P2PMessage, exceptId?: string): void {
    const raw = JSON.stringify(msg);
    this.peers.forEach((p, id) => {
      if (id !== exceptId && p.channel.readyState === "open") p.channel.send(raw);
    });
  }

  peerIds(): string[] {
    return [...this.peers.keys()];
  }

  close(): void {
    this.pending?.pc.close();
    this.peers.forEach((p) => p.pc.close());
    this.peers.clear();
  }
}

/* ---- guest side ---- */

export class GuestNet {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;

  onMessage: (msg: P2PMessage) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};

  /** Consume the host's invite code; returns the reply code to send back. */
  async answer(offerCode: string): Promise<string> {
    const desc = await decodeSignal(offerCode);
    if (desc.type !== "offer") throw new Error("That's a reply code — paste the host's invite code.");
    this.pc?.close();
    const pc = new RTCPeerConnection(RTC_CONFIG);
    this.pc = pc;
    pc.ondatachannel = (e) => {
      this.channel = e.channel;
      e.channel.onopen = () => this.onOpen();
      e.channel.onmessage = (ev) => {
        try {
          this.onMessage(JSON.parse(ev.data));
        } catch {
          /* ignore malformed frames */
        }
      };
      e.channel.onclose = () => this.onClose();
    };
    await pc.setRemoteDescription(desc);
    await pc.setLocalDescription(await pc.createAnswer());
    await waitIce(pc);
    return encodeSignal(pc.localDescription!);
  }

  send(msg: P2PMessage): void {
    if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(msg));
  }

  get open(): boolean {
    return this.channel?.readyState === "open";
  }

  close(): void {
    this.pc?.close();
    this.pc = null;
    this.channel = null;
  }
}
