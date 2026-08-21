"use client";
// Sign-language panel (?sign=asl). Keeps the signer ALWAYS on screen:
//  - a neutral idle loop plays underneath continuously (never blank),
//  - each agent turn's text is sent to /api/sign -> a signing clip,
//  - a signing clip fades in over the idle (same pose = seamless).
//
// Responsiveness model (dump-backlog, start-fast):
//  - Clips are tagged with their turn_id.
//  - Within ONE turn, delta clips play in order (a turn is never chopped).
//  - When a NEWER turn's clip is ready, we INTERRUPT whatever older turn is
//    playing and jump straight to the newest, DROPPING any stale backlog. This
//    keeps the signer tracking the live conversation instead of falling further
//    behind (a sign clip runs ~2-3x longer than the spoken answer, so a strict
//    play-everything queue only grows).
//
// Transcript handling: the Agora toolkit (AUTO mode) can report a single agent
// turn incrementally — in "text mode" every update to a turn_id is marked END
// while the text keeps growing. So we never sign-and-forget: we track how many
// chars of each turn we've already signed and dispatch only the new part. A
// short debounce coalesces streaming updates into one clip.
import { useEffect, useRef, useState, useCallback } from "react";

type Msg = { turn_id: number; uid: string; text: string; status: number };
type Clip = { url: string; turn: number; seq: number };

const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
// How long a turn's text must stay unchanged before we flush its trailing part.
// Kept small so signing starts quickly; generation (~5s) dominates start latency.
const SETTLE_MS = 400;

export function SignPanel({
  messages,
  isAgent,
}: {
  messages: Msg[];
  isAgent: (uid: string) => boolean;
}) {
  // Per agent turn_id: chars already sent to Signapse, latest cleaned text, and
  // a pending settle-timer (refs — mutating must not re-render).
  const dispatchedRef = useRef<Map<number, number>>(new Map());
  const latestRef = useRef<Map<number, string>>(new Map());
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Monotonic stamp per request, used only to order deltas WITHIN a turn.
  const seqRef = useRef(0);

  const [queue, setQueue] = useState<Clip[]>([]);
  const [current, setCurrent] = useState<Clip | null>(null);
  const [clipReady, setClipReady] = useState(false);
  const [idleUrl, setIdleUrl] = useState<string | null>(null);

  const clean = (t: string) =>
    (t || "").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim();

  // Fire the request in parallel; when the clip URL comes back, drop it straight
  // into the play queue. No global ordering gate — a slow/failed request can
  // never block later clips (that head-of-line stall showed the PREVIOUS response
  // long after it should have moved on). Ordering that matters (deltas of one
  // turn) is handled by seq in the player.
  const enqueueSign = useCallback((text: string, turn: number) => {
    const t = text.trim();
    if (!t) return;
    const seq = seqRef.current;
    seqRef.current += 1;
    fetch(`${BASE}/api/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t, turn }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d?.url) setQueue((q) => [...q, { url: d.url as string, turn, seq }]);
      })
      .catch(() => {});
  }, []);

  // Send whatever part of this turn we haven't signed yet.
  const flushTurn = useCallback(
    (turnId: number) => {
      const full = latestRef.current.get(turnId) ?? "";
      const already = dispatchedRef.current.get(turnId) ?? 0;
      if (full.length <= already) return;
      enqueueSign(full.slice(already), turnId);
      dispatchedRef.current.set(turnId, full.length);
    },
    [enqueueSign],
  );

  useEffect(() => {
    // Fresh session — reset all per-turn bookkeeping and buffers.
    if (messages.length === 0) {
      timersRef.current.forEach((t) => clearTimeout(t));
      timersRef.current.clear();
      dispatchedRef.current.clear();
      latestRef.current.clear();
      seqRef.current = 0;
      setQueue([]);
      return;
    }

    let maxAgentTurn = -Infinity;
    for (const m of messages) {
      if (isAgent(m.uid)) maxAgentTurn = Math.max(maxAgentTurn, m.turn_id);
    }

    for (const m of messages) {
      if (!isAgent(m.uid)) continue;
      const full = clean(m.text);
      if (!full) continue;
      latestRef.current.set(m.turn_id, full);

      const existing = timersRef.current.get(m.turn_id);
      if (existing) clearTimeout(existing);

      if (m.turn_id < maxAgentTurn) {
        // A newer turn exists -> this one is finished. Flush it now, in full.
        timersRef.current.delete(m.turn_id);
        flushTurn(m.turn_id);
      } else {
        timersRef.current.set(
          m.turn_id,
          setTimeout(() => {
            timersRef.current.delete(m.turn_id);
            flushTurn(m.turn_id);
          }, SETTLE_MS),
        );
      }
    }
  }, [messages, isAgent, flushTurn]);

  // Idle loop — fetch once, refresh before the ~15 min presign expiry.
  const loadIdle = useCallback(() => {
    fetch(`${BASE}/api/sign?idle=1`)
      .then((r) => r.json())
      .then((d) => d?.url && setIdleUrl(d.url as string))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadIdle();
    const t = setInterval(loadIdle, 12 * 60 * 1000);
    return () => clearInterval(t);
  }, [loadIdle]);

  // Player: start the newest turn fast, dropping stale backlog.
  //  - nothing playing        -> play the newest queued turn's first clip
  //  - a NEWER turn is queued  -> interrupt current, jump to it (dump older)
  //  - same turn as current    -> leave queued; it chains after current ends
  useEffect(() => {
    if (queue.length === 0) return;
    const maxTurn = queue.reduce((mx, c) => Math.max(mx, c.turn), -Infinity);
    // Something is playing and nothing newer has arrived: let it finish. Clips of
    // the SAME turn (deltas) stay queued and chain via advance() on ended.
    if (current && maxTurn <= current.turn) return;
    // Newest turn wins: play its clips in seq order, drop every older turn.
    const keep = queue
      .filter((c) => c.turn === maxTurn)
      .sort((a, b) => a.seq - b.seq);
    setClipReady(false);
    setCurrent(keep[0]);
    setQueue(keep.slice(1));
  }, [queue, current]);

  const advance = useCallback(() => {
    setClipReady(false);
    setCurrent(null); // effect chains the next clip, or the idle shows through
  }, []);

  return (
    <div className="relative h-full w-full bg-black overflow-hidden">
      {/* Idle loop — always underneath */}
      {idleUrl && (
        <video
          src={idleUrl}
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-contain"
        />
      )}
      {/* Signing clip — fades in over the idle once buffered, so pose is continuous */}
      {current && (
        <video
          key={current.url}
          src={current.url}
          autoPlay
          muted
          playsInline
          onCanPlayThrough={() => setClipReady(true)}
          onEnded={advance}
          onError={advance}
          className="absolute inset-0 h-full w-full object-contain transition-opacity duration-200"
          style={{ opacity: clipReady ? 1 : 0 }}
        />
      )}
      {!idleUrl && !current && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/40">
          <span className="text-4xl">🤟</span>
          <span className="text-sm">ASL sign avatar</span>
        </div>
      )}
      <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wider text-white/40 bg-white/10 rounded px-2 py-0.5">
        Signapse ASL
      </span>
    </div>
  );
}
