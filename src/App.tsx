import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import Octagon, { AXIS_COLORS, statusColor, statusOf } from "./Octagon";
import type { BalanceStatus } from "./Octagon";
import { useSession } from "./ws";
import { useP2PGuest, useP2PHost } from "./p2pSession";
import type { GuestSession, HostSession } from "./p2pSession";
import type { Bet, Board, Envelopes, ScopeLevel, Session } from "./types";
import { descForScope, fteForScope, SCOPE_LABELS } from "./types";

const ENVELOPE_COLORS = {
  strategic: "#26221E",
  core: "#57647A",
  parity: "#4A8078",
  ktlo: "#C2BBB0",
} as const;

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .2s" }}>
      <path d="M6 9 L12 15 L18 9" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseMark() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none">
      <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

function StatusMark({ status, size = 20, color }: { status: BalanceStatus; size?: number; color: string }) {
  if (status === "balanced")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <path d="M20 6 L9 17 L4 12" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (status === "free")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        <circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2.2} />
        <path d="M12 11 v5 M12 8 h.01" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path d="M12 3 L22 20 H2 Z" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      <path d="M12 10 v4 M12 17 h.01" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </svg>
  );
}

const betColor = (b: Bet) => AXIS_COLORS[b.axis % AXIS_COLORS.length];

/* ---------- mode router ----------
   auto  — talk to a backend implementing API.md over WebSocket.
   host  — no backend: this tab IS the server (P2P star).
   guest — no backend: thin client over a DataChannel to the host. */

type Mode = "auto" | "host" | "guest";

export default function App() {
  const [mode, setMode] = useState<Mode>(() => {
    const m = new URLSearchParams(location.search).get("mode");
    return m === "host" || m === "guest" ? m : "auto";
  });
  if (mode === "host") return <HostApp />;
  if (mode === "guest") return <GuestApp onBack={() => setMode("auto")} />;
  return <AutoApp onHost={() => setMode("host")} onJoin={() => setMode("guest")} />;
}

function AutoApp({ onHost, onJoin }: { onHost: () => void; onJoin: () => void }) {
  const s = useSession();
  if (s.board) return <BoardUI s={s} />;
  if (s.failed) return <Lobby onHost={onHost} onJoin={onJoin} />;
  return <div className="loading">{s.connected ? "Loading board…" : "Connecting…"}</div>;
}

function HostApp() {
  const s = useP2PHost();
  if (!s.board) return <div className="loading">Loading board…</div>;
  return <BoardUI s={s} extras={<HostInvitePanel s={s} />} />;
}

function GuestApp({ onBack }: { onBack: () => void }) {
  const s = useP2PGuest();
  if (!s.joined || !s.board) return <JoinFlow s={s} onBack={onBack} />;
  return (
    <BoardUI
      s={s}
      extras={!s.connected ? <div className="toast">Disconnected from the host.</div> : null}
    />
  );
}

/* ---------- P2P lobby & signaling UI ---------- */

function Lobby({ onHost, onJoin }: { onHost: () => void; onJoin: () => void }) {
  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="eyebrow">Octagon · Portfolio balance</div>
        <h1 className="lobby-title">No backend reachable — go peer-to-peer</h1>
        <p className="lobby-copy">
          Run the session directly between browsers instead. One person hosts — their tab keeps
          the board — and everyone else joins by exchanging a one-time invite code.
        </p>
        <div className="lobby-actions">
          <button className="btn-primary" onClick={onHost}>Host a session</button>
          <button className="btn-ghost" onClick={onJoin}>Join a session</button>
        </div>
        <p className="lobby-note">
          Peer connections need a shared network (same Wi-Fi/LAN). Networks with client
          isolation will block them.
        </p>
      </div>
    </div>
  );
}

function HostInvitePanel({ s }: { s: HostSession }) {
  const [invite, setInvite] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // a guest connected — clear the finished invite flow
  useEffect(() => {
    setInvite(null);
    setReply("");
    setNote(null);
  }, [s.peerCount]);

  const newInvite = async () => {
    setBusy(true);
    setNote(null);
    try {
      setInvite(await s.createInvite());
      setReply("");
    } catch (e) {
      setNote((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — the textarea is selectable */
    }
  };

  const accept = async () => {
    setNote(null);
    try {
      await s.acceptAnswer(reply);
      setNote("Connecting…");
    } catch (e) {
      setNote((e as Error).message || String(e));
    }
  };

  return (
    <section className="p2p">
      <div className="sec-head">
        <span>Peer-to-peer session</span>
        <span className="sec-count">{s.peerCount} connected</span>
      </div>
      {!invite ? (
        <button className="add" onClick={newInvite} disabled={busy}>
          {busy ? "Preparing invite…" : "+ Invite participant"}
        </button>
      ) : (
        <div className="p2p-flow">
          <div className="p2p-step">1 · Send this invite code to one participant</div>
          <textarea className="code-area" readOnly value={invite} onFocus={(e) => e.target.select()} />
          <button className="btn-ghost" onClick={copy}>{copied ? "✓ Copied" : "Copy invite code"}</button>
          <div className="p2p-step">2 · Paste their reply code</div>
          <textarea
            className="code-area"
            placeholder="Reply code from the participant…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <button className="btn-primary" onClick={accept} disabled={!reply.trim()}>
            Connect participant
          </button>
        </div>
      )}
      {note && <div className="p2p-note">{note}</div>}
    </section>
  );
}

function JoinFlow({ s, onBack }: { s: GuestSession; onBack: () => void }) {
  const [invite, setInvite] = useState("");
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const answer = async () => {
    setBusy(true);
    setNote(null);
    try {
      setReply(await s.answerInvite(invite));
    } catch (e) {
      setNote((e as Error).message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!reply) return;
    try {
      await navigator.clipboard.writeText(reply);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-card">
        <div className="eyebrow">Octagon · Join a session</div>
        {!reply ? (
          <>
            <h1 className="lobby-title">Paste the host's invite code</h1>
            <textarea
              className="code-area tall"
              placeholder="Invite code…"
              value={invite}
              onChange={(e) => setInvite(e.target.value)}
            />
            <div className="lobby-actions">
              <button className="btn-primary" onClick={answer} disabled={busy || !invite.trim()}>
                {busy ? "Connecting…" : "Create reply code"}
              </button>
              <button className="btn-ghost" onClick={onBack}>Back</button>
            </div>
          </>
        ) : (
          <>
            <h1 className="lobby-title">Send this reply code to the host</h1>
            <textarea className="code-area tall" readOnly value={reply} onFocus={(e) => e.target.select()} />
            <div className="lobby-actions">
              <button className="btn-primary" onClick={copy}>{copied ? "✓ Copied" : "Copy reply code"}</button>
              <button className="btn-ghost" onClick={onBack}>Cancel</button>
            </div>
            <p className="lobby-note">Waiting for the host to paste it… you'll join automatically.</p>
          </>
        )}
        {note && <div className="p2p-note">{note}</div>}
      </div>
    </div>
  );
}

/* ---------- shared board UI (transport-agnostic) ---------- */

function BoardUI({ s, extras }: { s: Session; extras?: ReactNode }) {
  const [selectedBetId, setSelectedBetId] = useState<string | null>(null);
  const [expandedBetId, setExpandedBetId] = useState<string | null>(null);
  const [name, setNameLocal] = useState(localStorage.getItem("octagon.name") || "");
  const [review, setReview] = useState(false);

  useEffect(() => {
    if (name) s.setName(name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.connected]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setReview(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, []);

  const otherCursors = Object.values(s.cursors).filter((c) => c.userId !== s.myUserId);

  const board = s.board!;
  const balance = board.balance;
  const status = statusOf(balance);
  const sc = statusColor(status);

  const pill =
    status === "balanced"
      ? { t: "Balanced", s: "strategic budget zeroed" }
      : status === "free"
        ? { t: `${balance} FTE free`, s: "room to grow a bet" }
        : { t: `${Math.abs(balance)} FTE over`, s: "trim scope to recover" };
  const hint =
    status === "balanced"
      ? "Perfectly balanced. Lock it in and review the final plan."
      : status === "free"
        ? `${balance} FTE still free — widen a bet to spend it, or bank it into KTLO.`
        : `Over by ${Math.abs(balance)} FTE — park a bet or cut scope to get back to zero.`;

  const select = (id: string) => setSelectedBetId((cur) => (cur === id ? null : id));
  const expand = (id: string) => {
    setSelectedBetId(id);
    setExpandedBetId((cur) => (cur === id ? null : id));
  };

  return (
    <div className="app">
      <div className="stage">
        <div className="stage-head">
          <div className="stage-title">
            <div className="eyebrow">Octagon · Portfolio balance</div>
            <input
              className="title-input"
              value={board.title}
              spellCheck={false}
              onChange={(e) => s.setTitle(e.target.value)}
              aria-label="Board title"
            />
          </div>
          <div className="stage-actions">
            <div className="status-pill" style={{ background: sc + "14", borderColor: sc + "3d" }}>
              <span className={`status-dot ${status === "balanced" ? "pulse" : ""}`} style={{ background: sc }} />
              <span>
                <span className="status-pill-t" style={{ color: sc }}>{pill.t}</span>
                <span className="status-pill-s">{pill.s}</span>
              </span>
            </div>
            <button className="btn-primary" onClick={() => setReview(true)}>
              Review the plan
            </button>
          </div>
        </div>

        <Octagon
          board={board}
          cursors={otherCursors}
          selectedBetId={selectedBetId}
          onSelectBet={select}
          onExpandBet={expand}
          onSetScope={s.setScope}
          onAddBet={s.addBet}
          onCursor={s.sendCursor}
        />

        <div className="hint">{hint}</div>
      </div>

      <aside className="panel">
        <section>
          <div className="sec-head">In the room</div>
          <div className="presence-row">
            <div className="avatars">
              {s.people.map((p) => (
                <span key={p.userId} className="avatar" style={{ background: p.color }} title={p.name}>
                  {(p.name || "?").slice(0, 1).toUpperCase()}
                </span>
              ))}
            </div>
            <span className="presence-count">
              {s.people.length} online{s.connected ? "" : " · reconnecting…"}
            </span>
          </div>
          <div className="you-row">
            <span className="you-dot" />
            <input
              value={name}
              placeholder="Your name"
              onChange={(e) => {
                setNameLocal(e.target.value);
                s.setName(e.target.value);
              }}
            />
          </div>
        </section>

        {extras}

        <EnvelopeEditor board={board} onCommit={s.setEnvelopes} />

        <section className="stats">
          <div className="stat">
            <div className="stat-num">{board.allocatedFte}</div>
            <div className="stat-cap">Allocated</div>
          </div>
          <div className="stat">
            <div className="stat-num" style={{ color: "#26221E" }}>{Math.max(0, board.strategicFte)}</div>
            <div className="stat-cap">Strategic</div>
          </div>
          <div className="stat">
            <div className="stat-num" style={{ color: sc }}>
              {status === "balanced" ? "0" : balance > 0 ? `+${balance}` : balance}
            </div>
            <div className="stat-cap">Balance</div>
          </div>
        </section>

        <section>
          <div className="sec-head">
            <span>Bets</span>
            <span className="sec-count">{board.bets.length} / 8</span>
          </div>
          <div className="bets">
            {board.bets.length === 0 && (
              <div className="bets-empty">No bets yet. Add one to start shaping the octagon.</div>
            )}
            {[...board.bets]
              .sort((a, b) => a.axis - b.axis)
              .map((bet) => (
                <BetCard
                  key={bet.id}
                  bet={bet}
                  color={betColor(bet)}
                  selected={bet.id === selectedBetId}
                  expanded={bet.id === expandedBetId}
                  onSelect={() => select(bet.id)}
                  onToggleExpand={() => expand(bet.id)}
                  onScope={(sc) => s.setScope(bet.id, sc)}
                  onUpdate={s.updateBet}
                  onRemove={() => {
                    if (selectedBetId === bet.id) setSelectedBetId(null);
                    if (expandedBetId === bet.id) setExpandedBetId(null);
                    s.removeBet(bet.id);
                  }}
                />
              ))}
            {board.bets.length < 8 && (
              <button className="add" onClick={s.addBet}>
                + Add bet
              </button>
            )}
          </div>
        </section>

        {s.error && <div className="toast">{s.error}</div>}
      </aside>

      {review && <ReviewModal board={board} onClose={() => setReview(false)} />}
    </div>
  );
}

/* ---------- envelope editor ---------- */

function EnvelopeEditor({ board, onCommit }: { board: Board; onCommit: (e: Envelopes) => void }) {
  const [draft, setDraft] = useState<Envelopes>({
    totalFte: board.totalFte,
    coreFte: board.coreFte,
    parityChurnFte: board.parityChurnFte,
    ktloFte: board.ktloFte,
  });
  useEffect(() => {
    setDraft({
      totalFte: board.totalFte,
      coreFte: board.coreFte,
      parityChurnFte: board.parityChurnFte,
      ktloFte: board.ktloFte,
    });
  }, [board.totalFte, board.coreFte, board.parityChurnFte, board.ktloFte]);

  const strategic = draft.totalFte - draft.coreFte - draft.parityChurnFte - draft.ktloFte;
  const denom = Math.max(1, draft.totalFte);
  const parts = [
    { k: "strategic", label: "Strategic", v: Math.max(0, strategic), color: ENVELOPE_COLORS.strategic },
    { k: "core", label: "Core", v: draft.coreFte, color: ENVELOPE_COLORS.core },
    { k: "parity", label: "Parity + churn", v: draft.parityChurnFte, color: ENVELOPE_COLORS.parity },
    { k: "ktlo", label: "KTLO", v: draft.ktloFte, color: ENVELOPE_COLORS.ktlo },
  ];

  const set = (patch: Partial<Envelopes>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onCommit(next); // re-scores instantly; server echoes authoritative state
  };

  const field = (label: string, key: keyof Envelopes) => (
    <label className="env-field">
      <span>{label}</span>
      <input
        type="number"
        min={0}
        step={0.5}
        value={draft[key]}
        onChange={(e) => set({ [key]: Math.max(0, Number(e.target.value) || 0) } as Partial<Envelopes>)}
      />
    </label>
  );

  return (
    <section>
      <div className="sec-head">Engineering envelopes</div>
      <div className="env-bar">
        {parts.map((p) => (
          <div
            key={p.k}
            className="env-seg"
            title={`${p.label} ${p.v}`}
            style={{ width: `${(Math.max(0, p.v) / denom) * 100}%`, background: p.color }}
          />
        ))}
      </div>
      <div className="env-grid">
        {field("Total", "totalFte")}
        {field("Core", "coreFte")}
        {field("Parity + churn", "parityChurnFte")}
        {field("KTLO", "ktloFte")}
      </div>
      <div className={`env-strat ${strategic < 0 ? "neg" : ""}`}>
        <span className="env-strat-dot" />
        <span>Strategic (spendable)</span>
        <b>{Math.round(strategic * 10) / 10}</b>
      </div>
    </section>
  );
}

/* ---------- bet card ---------- */

const SCOPE_FIELDS = [
  { lvl: 1 as ScopeLevel, fteKey: "bareBoneFte", descKey: "bareBoneDesc", label: "Bare-bone", short: "Bare" },
  { lvl: 2 as ScopeLevel, fteKey: "widerFte", descKey: "widerDesc", label: "Wider", short: "Wider" },
  { lvl: 3 as ScopeLevel, fteKey: "fullFte", descKey: "fullDesc", label: "Full", short: "Full" },
] as const;

function BetCard({
  bet,
  color,
  selected,
  expanded,
  onSelect,
  onToggleExpand,
  onScope,
  onUpdate,
  onRemove,
}: {
  bet: Bet;
  color: string;
  selected: boolean;
  expanded: boolean;
  onSelect: () => void;
  onToggleExpand: () => void;
  onScope: (s: ScopeLevel) => void;
  onUpdate: (b: Bet) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(bet);
  useEffect(() => {
    setDraft(bet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bet.id, bet.name, bet.owner, bet.scope,
    bet.bareBoneFte, bet.widerFte, bet.fullFte,
    bet.bareBoneDesc, bet.widerDesc, bet.fullDesc,
  ]);

  const commit = (patch: Partial<Bet>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onUpdate(next);
  };

  const activeDesc = descForScope(bet, bet.scope);

  return (
    <div
      className={`bet ${selected ? "sel" : ""}`}
      style={{ borderLeftColor: color, borderColor: selected ? color + "88" : undefined }}
      onClick={onSelect}
    >
      <div className="bet-main">
        <div className="bet-row">
          <input
            className="bet-name"
            value={draft.name}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            onBlur={() => commit({ name: draft.name })}
          />
          <span className="bet-fte">{fteForScope(bet, bet.scope)} FTE</span>
          <button
            className="chev-btn"
            aria-label={expanded ? "Collapse bet" : "Expand bet"}
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
          >
            <Chevron open={expanded} />
          </button>
        </div>
        <input
          className="bet-owner"
          placeholder="owner"
          value={draft.owner}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
          onBlur={() => commit({ owner: draft.owner })}
        />
        <div className="segs">
          {SCOPE_FIELDS.map(({ lvl, short, fteKey }) => {
            const active = bet.scope >= lvl;
            const isCur = bet.scope === lvl;
            return (
              <button
                key={lvl}
                className="seg"
                style={{
                  border: `1px solid ${isCur ? color : "transparent"}`,
                  background: active ? (isCur ? color : color + "26") : "rgba(0,0,0,.05)",
                  color: active ? (isCur ? "#fff" : color) : "#6E6A62",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onScope(bet.scope === lvl ? 0 : lvl);
                }}
              >
                {short} · {bet[fteKey]}
              </button>
            );
          })}
        </div>
        {bet.scope !== 0 && activeDesc ? (
          <div className="bet-milestone" style={{ borderLeftColor: color + "55" }}>
            {activeDesc}
          </div>
        ) : bet.scope === 0 ? (
          <div className="bet-parked">Parked · 0 FTE</div>
        ) : null}
      </div>

      <div className={`bet-detail ${expanded ? "open" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="bet-detail-inner">
          {SCOPE_FIELDS.map(({ lvl, fteKey, descKey, label }) => (
            <div key={lvl} className="cut">
              <div className="cut-head">
                <span className="cut-label">{label}</span>
                <input
                  className="cut-fte"
                  type="number"
                  min={0}
                  step={0.5}
                  value={draft[fteKey]}
                  onChange={(e) => setDraft({ ...draft, [fteKey]: Math.max(0, Number(e.target.value) || 0) })}
                  onBlur={() => commit({ [fteKey]: draft[fteKey] } as Partial<Bet>)}
                />
                <span className="cut-unit">FTE</span>
              </div>
              <textarea
                rows={2}
                maxLength={300}
                placeholder={`1–2 sentence milestone for the ${label.toLowerCase()} cut…`}
                value={draft[descKey]}
                onChange={(e) => setDraft({ ...draft, [descKey]: e.target.value })}
                onBlur={() => commit({ [descKey]: draft[descKey] } as Partial<Bet>)}
              />
            </div>
          ))}
          <button className="remove-bet" onClick={onRemove}>
            Remove bet
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- review modal ---------- */

function planMarkdown(board: Board): string {
  const balance = board.balance;
  const verdict =
    balance === 0
      ? "Balanced — strategic budget fully allocated"
      : balance > 0
        ? `${balance} FTE still free`
        : `${Math.abs(balance)} FTE over budget`;
  const committed = board.bets
    .filter((b) => b.scope > 0)
    .sort((a, b) => fteForScope(b, b.scope) - fteForScope(a, a.scope));
  const parked = board.bets.filter((b) => b.scope === 0);

  let m = `# ${board.title}\n\n**${verdict}**\n\n`;
  m += `Envelopes — Total ${board.totalFte} · Strategic ${board.strategicFte} · Core ${board.coreFte} · Parity+churn ${board.parityChurnFte} · KTLO ${board.ktloFte}\n\n`;
  m += `## Committed (${board.allocatedFte} FTE)\n`;
  for (const b of committed) {
    m += `- **${b.name}** · ${b.owner || "unowned"} · ${SCOPE_LABELS[b.scope]} · ${fteForScope(b, b.scope)} FTE\n  - ${descForScope(b, b.scope) || "—"}\n`;
  }
  if (parked.length) {
    m += `\n## Parked\n`;
    for (const b of parked) m += `- ${b.name} · ${b.owner || "unowned"}\n`;
  }
  return m;
}

function ReviewModal({ board, onClose }: { board: Board; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const balance = board.balance;
  const status = statusOf(balance);
  const sc = statusColor(status);
  const committed = board.bets
    .filter((b) => b.scope > 0)
    .sort((a, b) => fteForScope(b, b.scope) - fteForScope(a, a.scope));
  const parked = board.bets.filter((b) => b.scope === 0);
  const verdict =
    status === "balanced"
      ? { t: "Balanced", s: "Strategic budget fully allocated to zero." }
      : status === "free"
        ? { t: `${balance} FTE free`, s: "You can widen a bet or bank the remainder." }
        : { t: `${Math.abs(balance)} FTE over`, s: "Trim scope before committing this plan." };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(planMarkdown(board));
    } finally {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  const chip = (label: string, value: number) => (
    <span className="chip">
      {label} <b>{value}</b>
    </span>
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-verdict" style={{ background: sc + "10" }}>
          <span className="verdict-mark" style={{ background: sc + "1e" }}>
            <StatusMark status={status} size={22} color={sc} />
          </span>
          <span className="verdict-copy">
            <span className="verdict-title">{verdict.t}</span>
            <span className="verdict-sub">{verdict.s}</span>
          </span>
          <button className="modal-close" aria-label="Close" onClick={onClose}>
            <CloseMark />
          </button>
        </div>

        <div className="modal-body">
          <div className="eyebrow">{board.title}</div>
          <div className="chips">
            {chip("Total", board.totalFte)}
            {chip("Strategic", board.strategicFte)}
            {chip("Core", board.coreFte)}
            {chip("Parity+churn", board.parityChurnFte)}
            {chip("KTLO", board.ktloFte)}
          </div>

          <div className="sec-head">Committed · {board.allocatedFte} FTE</div>
          <div className="commit-list">
            {committed.length === 0 && <div className="muted">Nothing committed yet.</div>}
            {committed.map((b, k) => (
              <div key={b.id} className="commit-row" style={{ animationDelay: `${k * 55}ms` }}>
                <span className="commit-dot" style={{ background: betColor(b) }} />
                <div>
                  <div className="commit-title">
                    <b>{b.name}</b>
                    <span className="muted">
                      {" "}· {b.owner || "unowned"} · {SCOPE_LABELS[b.scope]} · {fteForScope(b, b.scope)} FTE
                    </span>
                  </div>
                  {descForScope(b, b.scope) && <div className="commit-desc">{descForScope(b, b.scope)}</div>}
                </div>
              </div>
            ))}
          </div>

          {parked.length > 0 && (
            <>
              <div className="sec-head">Parked</div>
              <div className="parked-list">
                {parked.map((b) => (
                  <span key={b.id} className="parked-pill">
                    {b.name}
                  </span>
                ))}
              </div>
            </>
          )}

          <div className="modal-actions">
            <button className="btn-primary grow" style={copied ? { background: "#3E7A5A", borderColor: "#3E7A5A" } : undefined} onClick={copy}>
              {copied ? "✓ Copied to clipboard" : "Copy as markdown"}
            </button>
            <button className="btn-ghost" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
