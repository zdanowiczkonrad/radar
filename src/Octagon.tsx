import { useEffect, useRef, useState } from "react";
import type { Bet, Board, Cursor, ScopeLevel } from "./types";
import { fteForScope, SCOPE_LABELS } from "./types";

/* Fixed square viewBox; the SVG scales via CSS inside an aspect-ratio 1/1 box. */
const SIZE = 820;
const CX = 410;
const CY = 410;
const OUTER_R = 232;
const INNER_R = 96; // parked radius / meter edge
const METER_R = 82;

/* Initiative colors are deliberately grayscale — bets read by name + position, not hue. */
export const AXIS_COLORS = [
  "#2E2A25", "#847C71", "#47423B", "#A39B8F",
  "#38332E", "#6B645B", "#938B80", "#514B43",
];

export type BalanceStatus = "balanced" | "free" | "over";

export function statusOf(balance: number): BalanceStatus {
  return balance === 0 ? "balanced" : balance > 0 ? "free" : "over";
}

/* Semantic status color — the one place hue carries meaning ("free" is deliberately grey). */
export function statusColor(s: BalanceStatus): string {
  return s === "balanced" ? "#3E7A5A" : s === "free" ? "#5C574F" : "#B23A32";
}

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Spring-lerp an array of values toward their targets every frame. */
function useAnimatedValues(targets: number[]): number[] {
  const [vals, setVals] = useState(targets);
  const ref = useRef(targets);
  const key = targets.join(",");
  useEffect(() => {
    if (reducedMotion()) {
      ref.current = targets;
      setVals(targets);
      return;
    }
    let raf = 0;
    const tick = () => {
      const cur = ref.current;
      let settled = true;
      const next = targets.map((t, i) => {
        const c = cur[i] ?? t;
        const d = t - c;
        if (Math.abs(d) < 0.2) return t;
        settled = false;
        return c + d * 0.2;
      });
      ref.current = next;
      setVals(next);
      if (!settled) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return vals;
}

/** Ease a single number toward its target (count-up effect). */
export function useAnimatedNumber(target: number, dur = 450): number {
  const [val, setVal] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    if (start === target) return;
    if (reducedMotion()) {
      from.current = target;
      setVal(target);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      const v = start + (target - start) * e;
      from.current = v;
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return val;
}

const truncate = (s: string, n: number) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);

interface Props {
  board: Board;
  cursors: Cursor[];
  selectedBetId: string | null;
  onSelectBet: (id: string) => void;
  onExpandBet: (id: string) => void;
  onSetScope: (betId: string, scope: ScopeLevel) => void;
  onAddBet: () => void;
  onCursor: (x: number, y: number) => void;
}

export default function Octagon({
  board,
  cursors,
  selectedBetId,
  onSelectBet,
  onExpandBet,
  onSetScope,
  onAddBet,
  onCursor,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  /* Bets occupy dense slots in axis order; the shape has a variable number of
     vertices: one per bet plus one "+ empty axis" slot, min 3, max 8. */
  const bets = [...board.bets].sort((a, b) => a.axis - b.axis);
  const vertices = bets.length >= 8 ? 8 : Math.max(3, bets.length + 1);

  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / vertices;
  const pt = (r: number, i: number): [number, number] => {
    const a = angleFor(i);
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  };
  const ringPath = (r: number) => {
    let d = "";
    for (let i = 0; i < vertices; i++) {
      const [x, y] = pt(r, i);
      d += `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)} `;
    }
    return d + "Z";
  };

  /* FTE maps onto [INNER_R, OUTER_R] with a shared global max so axes compare. */
  const globalMax = Math.max(1, ...bets.map((b) => b.fullFte));
  const radiusFor = (fte: number) => INNER_R + (fte / globalMax) * (OUTER_R - INNER_R);
  const betRadius = (b: Bet) => (b.scope === 0 ? INNER_R : radiusFor(fteForScope(b, b.scope)));

  const targetRadii = Array.from({ length: vertices }, (_, i) =>
    bets[i] ? betRadius(bets[i]) : INNER_R,
  );
  const radii = useAnimatedValues(targetRadii);

  const balance = board.balance;
  const status = statusOf(balance);
  const sc = statusColor(status);

  const allocAnim = useAnimatedNumber(board.allocatedFte);
  const stratAnim = useAnimatedNumber(Math.max(0, board.strategicFte));
  const balAnim = useAnimatedNumber(balance);
  const fracTarget =
    board.strategicFte > 0
      ? Math.min(1, board.allocatedFte / board.strategicFte)
      : board.allocatedFte > 0
        ? 1
        : 0;
  const fracAnim = useAnimatedNumber(fracTarget);

  function toSvg(clientX: number, clientY: number): [number, number] {
    const rect = svgRef.current!.getBoundingClientRect();
    return [
      ((clientX - rect.left) / rect.width) * SIZE,
      ((clientY - rect.top) / rect.height) * SIZE,
    ];
  }

  function handleDrag(slot: number, bet: Bet, e: React.PointerEvent) {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    const a = angleFor(slot);
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    const snaps: { scope: ScopeLevel; r: number }[] = [
      { scope: 0, r: INNER_R },
      { scope: 1, r: radiusFor(bet.bareBoneFte) },
      { scope: 2, r: radiusFor(bet.widerFte) },
      { scope: 3, r: radiusFor(bet.fullFte) },
    ];
    let current = bet.scope;

    const move = (ev: PointerEvent) => {
      const [sx, sy] = toSvg(ev.clientX, ev.clientY);
      const proj = (sx - CX) * ux + (sy - CY) * uy;
      let best = snaps[0];
      for (const s of snaps) if (Math.abs(s.r - proj) < Math.abs(best.r - proj)) best = s;
      if (best.scope !== current) {
        current = best.scope;
        onSetScope(bet.id, best.scope); // commit live while dragging
      }
    };
    const up = (ev: PointerEvent) => {
      (e.target as Element).releasePointerCapture?.(ev.pointerId);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  const rings = [0.25, 0.5, 0.75, 1].map((f) => INNER_R + (OUTER_R - INNER_R) * f);

  let poly = "";
  radii.forEach((r, i) => {
    const [x, y] = pt(r, i);
    poly += `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
  });
  poly += "Z";

  /* center meter */
  const ARC_R = METER_R - 12;
  const CIRC = 2 * Math.PI * ARC_R;
  const verdict = status === "balanced" ? "BALANCED" : status === "free" ? "FTE FREE" : "OVER";
  const big =
    status === "balanced" ? "0" : `${balance > 0 ? "+" : ""}${Math.round(balAnim)}`;

  return (
    <div
      ref={boxRef}
      className="oct-box"
      onPointerMove={(e) => {
        const rect = boxRef.current!.getBoundingClientRect();
        onCursor((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
      }}
    >
      <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} className="octagon">
        <defs>
          <linearGradient id="octfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={sc} stopOpacity="0.2" />
            <stop offset="100%" stopColor={sc} stopOpacity="0.08" />
          </linearGradient>
        </defs>

        {/* grid rings + spokes */}
        {rings.map((r, k) => (
          <path
            key={k}
            d={ringPath(r)}
            fill={k === 0 ? "rgba(0,0,0,.02)" : "none"}
            stroke={`rgba(0,0,0,${k === 3 ? 0.16 : 0.09})`}
            strokeWidth={1}
          />
        ))}
        {Array.from({ length: vertices }, (_, i) => {
          const [x, y] = pt(OUTER_R, i);
          return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="rgba(0,0,0,.09)" strokeWidth={1} />;
        })}

        {/* portfolio shape */}
        <path d={poly} fill="url(#octfill)" stroke={sc} strokeWidth={2.5} strokeLinejoin="round" className="portfolio" />

        {/* axes */}
        {Array.from({ length: vertices }, (_, i) => {
          const bet = bets[i];
          const cos = Math.cos(angleFor(i));
          const [lx, ly] = pt(OUTER_R + 22, i);
          const anchor = Math.abs(cos) < 0.34 ? "middle" : cos > 0 ? "start" : "end";

          if (!bet) {
            const [ix, iy] = pt(INNER_R, i);
            return (
              <g key={`empty${i}`} className="axis-empty" onClick={onAddBet}>
                <circle cx={ix} cy={iy} r={5} fill="none" stroke="rgba(0,0,0,.2)" strokeWidth={1.3} strokeDasharray="2 3" />
                <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className="axis-empty-label">
                  + empty axis
                </text>
              </g>
            );
          }

          const color = AXIS_COLORS[bet.axis % AXIS_COLORS.length];
          const selected = bet.id === selectedBetId;
          const [hx, hy] = pt(radii[i] ?? INNER_R, i);
          const sub =
            bet.scope === 0
              ? `${bet.owner || "—"} · parked`
              : `${bet.owner || "—"} · ${SCOPE_LABELS[bet.scope]} · ${fteForScope(bet, bet.scope)} FTE`;

          return (
            <g key={bet.id} className={selected ? "axis selected" : "axis"}>
              {([1, 2, 3] as ScopeLevel[]).map((lvl) => {
                const fte = fteForScope(bet, lvl);
                const [nx, ny] = pt(radiusFor(fte), i);
                const filled = bet.scope >= lvl;
                return (
                  <circle
                    key={lvl}
                    cx={nx}
                    cy={ny}
                    r={filled ? 4.6 : 3.4}
                    fill={filled ? color : "#fff"}
                    stroke={color}
                    strokeWidth={1.6}
                    opacity={filled ? 1 : 0.6}
                    className="notch"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSetScope(bet.id, bet.scope === lvl ? 0 : lvl);
                    }}
                  >
                    <title>{`${SCOPE_LABELS[lvl]} — ${fte} FTE`}</title>
                  </circle>
                );
              })}
              <circle
                cx={hx}
                cy={hy}
                r={selected ? 12 : 10}
                fill={color}
                className="handle"
                onPointerDown={(e) => {
                  onSelectBet(bet.id);
                  handleDrag(i, bet, e);
                }}
              >
                <title>{`${bet.name}: drag to change scope`}</title>
              </circle>
              <text
                x={lx}
                y={ly - 7}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="axis-name"
                onClick={() => onExpandBet(bet.id)}
              >
                {truncate(bet.name, 22)}
              </text>
              <text
                x={lx}
                y={ly + 9}
                textAnchor={anchor}
                dominantBaseline="middle"
                className="axis-sub"
                fill={bet.scope === 0 ? "#A59F98" : color}
              >
                {sub}
              </text>
            </g>
          );
        })}

        {/* center balance meter */}
        <g>
          <circle cx={CX} cy={CY} r={METER_R + 6} fill="#fff" stroke="rgba(0,0,0,.10)" strokeWidth={1} />
          <circle cx={CX} cy={CY} r={ARC_R} fill="none" stroke="rgba(0,0,0,.08)" strokeWidth={7} />
          <circle
            cx={CX}
            cy={CY}
            r={ARC_R}
            fill="none"
            stroke={sc}
            strokeWidth={7}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - Math.min(1, fracAnim))}
            transform={`rotate(-90 ${CX} ${CY})`}
            className="meter-arc"
          />
          {status === "balanced" && (
            <circle cx={CX} cy={CY} r={ARC_R + 9} fill="none" stroke={sc} strokeWidth={1.5} className="meter-pulse" />
          )}
          <text x={CX} y={CY - 15} textAnchor="middle" className="meter-verdict" fill={sc}>
            {verdict}
          </text>
          <text x={CX} y={CY + 19} textAnchor="middle" className="meter-big">
            {big}
          </text>
          <text x={CX} y={CY + 42} textAnchor="middle" className="meter-sub">
            {Math.round(allocAnim)} / {Math.round(stratAnim)} FTE
          </text>
        </g>
      </svg>

      {/* live cursors (people are the only color) */}
      <div className="cursor-layer">
        {cursors.map((c) => (
          <div key={c.userId} className="cursor" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%` }}>
            <svg width={18} height={18} viewBox="0 0 24 24">
              <path d="M4 2 L20 12 L13 13 L11 20 Z" fill={c.color} stroke="#fff" strokeWidth={1.2} />
            </svg>
            <span className="cursor-tag" style={{ background: c.color }}>
              {c.name}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
