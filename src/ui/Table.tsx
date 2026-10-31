import { AnimatePresence, animate, motion, useMotionValue } from 'framer-motion';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Card, levelLabel, SUIT_GLYPH, SUIT_NAME } from '../game/cards';
import { DeclareOption, GameEvent, TrumpSuit } from '../game/engine';
import { decompose, effSuit, trickWinner, TrumpCtx, validateFollow, validateLead } from '../game/rules';
import { Action, PlayerView, SeatView } from '../net/protocol';
import { CardBack, CardFace } from './Card';
import { Avatar, copyText, Pos, posOf, sideOf, towards } from './common';
import { Hand } from './Hand';
import { RulesModal } from './Home';
import { NetBadge } from './Lobby';
import { Modal } from './Modal';
import { useStage } from './stage';
import { setMuted, sfx, useMuted } from './sound';

interface Props {
  view: PlayerView;
  send: (a: Action) => void;
  onLeave: () => void;
  netState: string;
  netDetail: string;
}

const EMOTES = ['👍', '😂', '😮', '😭', '🔥', '🎉'];

function trumpGlyph(suit: TrumpSuit | null) {
  if (suit === null) return '?';
  if (suit === 'NT') return '★';
  return SUIT_GLYPH[suit];
}
const redSuit = (s: TrumpSuit | null) => s === 'H' || s === 'D';

function useSize(ref: React.RefObject<HTMLElement>) {
  const [size, setSize] = useState({ w: 800, h: 400 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

export function Table({ view, send, onLeave, netState, netDetail }: Props) {
  const ctx: TrumpCtx = { suit: view.trumpSuit, rank: view.trumpRank };
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showLast, setShowLast] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const size = useSize(wrapRef);
  const name = (seat: number) => (seat === view.you ? 'You' : view.seats[seat]?.name ?? `Seat ${seat + 1}`);
  const me = view.you;

  // Drop selections for cards that left the hand; adopt hints from the host.
  useEffect(() => {
    const ids = new Set(view.hand.map((c) => c.id));
    setSelected((prev) => {
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [view.hand]);
  const hintId = view.hint?.id;
  const [hintPending, setHintPending] = useState(false);
  useEffect(() => {
    setHintPending(false);
    if (view.hint) setSelected(new Set(view.hint.cardIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintId]);
  // A hint for an old turn is dropped by the host; don't leave the button spinning.
  useEffect(() => setHintPending(false), [view.turn, view.tricksPlayed, view.phase]);
  const askHint = () => {
    setHintPending(true);
    send({ type: 'hint' });
    setTimeout(() => setHintPending(false), 6000);
  };
  useEffect(() => setSelected(new Set()), [view.phase, view.round]);

  const myTurn =
    me !== null && view.phase === 'playing' && view.turn === me && view.trick !== null && view.trick.winner === null;
  const iBury = me !== null && view.phase === 'burying' && view.dealer === me;
  useSounds(view, myTurn);
  const selCards = view.hand.filter((c) => selected.has(c.id));

  let playError: string | null = null;
  if (myTurn && view.trick) {
    playError =
      view.trick.plays.length === 0
        ? validateLead(selCards, ctx)
        : validateFollow(selCards, view.hand, view.trick.plays[0].cards, ctx);
  }
  const isThrow = myTurn && view.trick?.plays.length === 0 && !playError && decompose(selCards, ctx).length > 1;

  const doPlay = () => {
    if (myTurn && !playError) {
      send({ type: 'play', cardIds: [...selected] });
      setSelected(new Set());
    } else if (iBury && selected.size === 8) {
      send({ type: 'bury', cardIds: [...selected] });
      setSelected(new Set());
    }
  };
  const doPlayRef = useRef(doPlay);
  doPlayRef.current = doPlay;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') doPlayRef.current();
      if (e.key === 'Escape') setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const meSeat = me !== null ? view.seats[me] : null;

  return (
    <div className="game">
      <Hud view={view} onLast={() => setShowLast(true)} onRules={() => setShowRules(true)} onLeave={onLeave} send={send} />
      {view.online && netState !== 'online' && (
        <div className="conn-banner">
          <NetBadge state={netState} detail={netDetail} />
        </div>
      )}

      <div className="table-wrap" ref={wrapRef}>
        <motion.div className="oval" initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6 }}>
          <div className="watermark">升级</div>
        </motion.div>
        {view.seats.map((seat, i) =>
          seat && i !== me ? <SeatBox key={i} seatIdx={i} seat={seat} view={view} send={send} /> : null,
        )}
        <DealAnimation view={view} size={size} />
        <TrickArea view={view} ctx={ctx} size={size} />
        <DeclareSplash view={view} name={name} />
        <RoundSplash view={view} />
        <ThrowSplash view={view} name={name} />
        <Emotes view={view} size={size} />
      </div>

      <Toasts view={view} />

      <div className="bottom">
        <div className="bar-row">
          {meSeat && me !== null && (
            <div className={`plate me-plate seat-plate ${myTurn || iBury ? 'active' : ''}`}>
              <Avatar seat={meSeat} side="us" dealer={view.dealer === me} />
              <div>
                <div className="nm">You</div>
                <div className="sub">
                  <span className="cc">{view.hand.length}</span>
                  {view.phase === 'playing' && <Voids voids={view.voids[me] ?? []} inline />}
                </div>
              </div>
            </div>
          )}
          <ActionBar
            view={view}
            ctx={ctx}
            send={send}
            name={name}
            myTurn={myTurn}
            iBury={iBury}
            selectedCount={selected.size}
            playError={playError}
            isThrow={isThrow}
            onPlay={doPlay}
            onClear={() => setSelected(new Set())}
            onHint={askHint}
            hintPending={hintPending}
          />
        </div>
        <Hand cards={view.hand} ctx={ctx} selected={selected} onChange={setSelected} dealing={view.phase === 'dealing'} />
      </div>

      <AnimatePresence>
        {showRules && <RulesModal onClose={() => setShowRules(false)} />}
        {showLast && view.tricks.length > 0 && (
          <TrickHistory view={view} name={name} onClose={() => setShowLast(false)} />
        )}
        {(view.phase === 'roundEnd' || view.phase === 'gameOver') && view.result && (
          <RoundEnd key={`r${view.round}`} view={view} send={send} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

function Hud({
  view,
  onLast,
  onRules,
  onLeave,
  send,
}: {
  view: PlayerView;
  onLast: () => void;
  onRules: () => void;
  onLeave: () => void;
  send: (a: Action) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [emotes, setEmotes] = useState(false);
  const iconsRef = useRef<HTMLDivElement>(null);
  // Close the emoji bar / menu on a click or tap anywhere outside them, or on Escape.
  useEffect(() => {
    if (!menu && !emotes) return;
    const close = () => {
      setMenu(false);
      setEmotes(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!iconsRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu, emotes]);
  const [copied, setCopied] = useState(false);
  const usTeam = (view.you ?? 0) % 2;
  const d = view.declaration;

  let detail: React.ReactNode;
  if (d) {
    const who = d.seat === view.you ? 'You' : view.seats[d.seat]?.name ?? '';
    const what =
      d.suit === 'NT'
        ? `pair of ${d.strength === 4 ? 'big' : 'small'} jokers`
        : `${d.cards.length > 1 ? 'pair of ' : ''}${levelLabel(view.trumpRank)}${SUIT_GLYPH[d.suit]}`;
    detail = (
      <>
        Declared by <b>{who}</b> · {what}
      </>
    );
  } else if (view.trumpSuit) detail = 'No one declared · set by kitty flip';
  else detail = `Show a ${levelLabel(view.trumpRank)} to declare · joker pair for no trump`;

  return (
    <div className="hud">
      <TeamPanel view={view} team={usTeam} />
      <div className="center">
        <motion.div className="plate trump-pill" layout>
          <motion.div
            key={String(view.trumpSuit)}
            className={`medallion ${redSuit(view.trumpSuit) ? 'red' : ''}`}
            initial={{ scale: 0.3, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14 }}
          >
            {trumpGlyph(view.trumpSuit)}
          </motion.div>
          <div>
            <div className="t1">
              <span className="zh">主</span>
              {view.trumpSuit === null ? 'Trump undecided' : view.trumpSuit === 'NT' ? 'No trump' : `Trump ${SUIT_GLYPH[view.trumpSuit]}`}
              <span style={{ opacity: 0.6 }}>·</span> level {levelLabel(view.trumpRank)}
            </div>
            <div className="t2">{detail}</div>
          </div>
        </motion.div>
      </div>
      <div className="right">
        <TeamPanel view={view} team={1 - usTeam} />
        <div className="icons" ref={iconsRef}>
          <MuteButton />
          <button className="btn icon-btn" title="React" onClick={() => {
              setEmotes((x) => !x);
              setMenu(false);
            }}
          >
            ☺
          </button>
          <button className="btn icon-btn" title="Tricks played this round" onClick={onLast} disabled={view.tricks.length === 0}>
            ↺
          </button>
          <button className="btn icon-btn" title="How to play" onClick={onRules}>
            ?
          </button>
          <button className="btn icon-btn" title="Menu" onClick={() => {
              setMenu((m) => !m);
              setEmotes(false);
            }}
          >
            ⋯
          </button>
          <AnimatePresence>
            {emotes && (
              <motion.div
                className="plate emote-bar"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
              >
                {EMOTES.map((e) => (
                  <button
                    key={e}
                    onClick={() => {
                      send({ type: 'emote', emoji: e });
                      setEmotes(false);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </motion.div>
            )}
            {menu && (
              <motion.div
                className="panel menu"
                initial={{ opacity: 0, y: -8, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.96 }}
              >
                {view.online && (
                  <>
                    <div className="label" style={{ padding: '6px 12px' }}>
                      Table {view.roomCode}
                    </div>
                    <button
                      className="btn ghost small"
                      onClick={async () => {
                        await copyText(`${location.origin}${location.pathname}?room=${view.roomCode}`);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      }}
                    >
                      {copied ? '✓ Copied' : 'Copy invite link'}
                    </button>
                  </>
                )}
                {view.isHost && (
                  <button className="btn ghost small" onClick={() => (send({ type: 'newGame' }), setMenu(false))}>
                    End game, back to lobby
                  </button>
                )}
                <button className="btn ghost small" onClick={onLeave}>
                  Leave table
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function TeamPanel({ view, team }: { view: PlayerView; team: number }) {
  const usTeam = (view.you ?? 0) % 2;
  const isUs = team === usTeam;
  const dealerTeam = view.dealer === null ? null : view.dealer % 2;
  const attacking = dealerTeam !== null && dealerTeam !== team;
  const defending = dealerTeam === team;
  const members = [team, team + 2].map((s) => (s === view.you ? 'You' : view.seats[s]?.name ?? '—')).join(' & ');
  const inRound = view.phase === 'playing' || view.phase === 'roundEnd' || view.phase === 'gameOver';
  const blocked = Math.max(0, view.pointsPlayed - view.attackerPoints);
  const need = Math.max(0, 80 - view.attackerPoints);
  const count = (rank: number) => view.capturedCards.filter((c) => c.rank === rank).length;

  return (
    <div className={`plate team-panel ${isUs ? 'us' : 'them'} ${attacking ? 'attacking' : ''}`}>
      <div className="lvl-badge">
        <span className="k">Level</span>
        <motion.span
          key={view.levels[team]}
          className="v"
          initial={{ y: 12, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        >
          {levelLabel(view.levels[team])}
        </motion.span>
      </div>
      <div className="body">
        <div className="top">
          <div style={{ minWidth: 0 }}>
            <div className="ttl">
              {isUs ? 'Your team' : 'Opponents'}
              {attacking && <span className="tag gold">Attacking</span>}
              {defending && <span className="tag green">庄 Defending</span>}
            </div>
            <div className="members">
              {members}
              {attacking && (
                <span className="counts">
                  5×{count(5)} · 10×{count(10)} · K×{count(13)}
                </span>
              )}
            </div>
          </div>
          <div className="pts">
            <span className="n">
              {attacking ? <AnimatedNumber value={view.attackerPoints} /> : defending && inRound ? <AnimatedNumber value={blocked} /> : '—'}
            </span>
            <span className="k">{attacking ? 'Points won' : defending ? 'Points blocked' : 'Points'}</span>
          </div>
        </div>
        <div className="foot-line">
          {attacking && (
            <div className="track" title="80 points takes the deal; every 40 more is a level">
              <motion.div
                className="fill"
                animate={{ width: `${Math.min(100, (view.attackerPoints / 200) * 100)}%` }}
                transition={{ type: 'spring', stiffness: 90, damping: 18 }}
              />
              {[40, 80, 120, 160].map((at) => (
                <div key={at} className={`tick ${at === 80 ? 'flip' : ''}`} style={{ left: `${(at / 200) * 100}%` }} />
              ))}
            </div>
          )}
          {defending && inRound && (
            <div className="caption">
              {need > 0 ? (
                <>
                  Attackers need <b>{need}</b> more to take the deal
                </>
              ) : (
                'Attackers have taken the deal'
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AnimatedNumber({ value }: { value: number }) {
  const mv = useMotionValue(value);
  const [display, setDisplay] = useState(value);
  useEffect(() => mv.on('change', (v) => setDisplay(Math.round(v))), [mv]);
  useEffect(() => {
    const c = animate(mv, value, { duration: 0.8, ease: 'easeOut' });
    return () => c.stop();
  }, [mv, value]);
  return (
    <motion.span
      key={value}
      style={{ display: 'inline-block' }}
      initial={{ scale: 1.5, color: '#fbe3a0' }}
      animate={{ scale: 1, color: '#f7ead3' }}
      transition={{ duration: 0.6 }}
    >
      {display}
    </motion.span>
  );
}

// ---------------------------------------------------------------------------------------------

function SeatBox({ seatIdx, seat, view, send }: { seatIdx: number; seat: SeatView; view: PlayerView; send: (a: Action) => void }) {
  const pos = posOf(seatIdx, view.you);
  const side = sideOf(seatIdx, view.you);
  const active =
    (view.phase === 'playing' && view.turn === seatIdx && view.trick?.winner === null) ||
    (view.phase === 'burying' && view.dealer === seatIdx);
  const backs = Math.min(seat.cardCount, 13);
  const declaring = ['dealing', 'declaring', 'burying'].includes(view.phase);
  const decl = view.declaration?.seat === seatIdx ? view.declaration : null;

  const fan =
    backs > 0 ? (
      <div className="backs">
        {Array.from({ length: backs }, (_, i) => {
          const t = backs === 1 ? 0 : i / (backs - 1) - 0.5;
          return (
            <motion.div
              key={i}
              className="back-slot"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1, rotate: t * 46, x: t * backs * 7.5, y: Math.abs(t) * 7 }}
              transition={{ type: 'spring', stiffness: 300, damping: 22 }}
            >
              <CardBack />
            </motion.div>
          );
        })}
      </div>
    ) : null;

  return (
    <div className={`seat ${pos}`}>
    <motion.div className="seat-inner" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}>
      {pos !== 'top' && fan}
      <div className={`plate seat-plate ${active ? 'active' : ''}`}>
        <Avatar seat={seat} side={side} dealer={view.dealer === seatIdx} />
        <div>
          <div className="nm">
            {seat.name}
            {seat.isBot && <span className="tag">bot</span>}
            {side === 'us' && <span className="tag gold">partner</span>}
          </div>
          <div className="sub">
            <span className="cc">{seat.cardCount}</span>
            {decl && <span className="decl" style={{ color: 'var(--gold-hi)' }}>declared {decl.suit === 'NT' ? '★' : SUIT_GLYPH[decl.suit]}</span>}
            {!seat.online && <span className="tag">offline</span>}
            {view.isHost && !seat.isHost && !seat.online && (
              <button className="btn ghost small" style={{ padding: '1px 8px' }} onClick={() => send({ type: 'botify', seat: seatIdx })}>
                Bot takeover
              </button>
            )}
          </div>
        </div>
      </div>
      {pos === 'top' && fan}
      <Voids voids={view.phase === 'playing' ? view.voids[seatIdx] ?? [] : []} />
      <AnimatePresence>
        {decl && declaring && (
          <motion.div
            className="decl-cards"
            initial={{ opacity: 0, y: 10, scale: 0.7 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
          >
            {decl.cards.map((c) => (
              <CardFace key={c.id} card={c} className="tiny" />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------

type Size = { w: number; h: number };

/** Where cards fly from / to for a seat: just past the table edge. */
function seatPoint(pos: Pos, size: Size) {
  const p = towards(pos, size.w, size.h, pos === 'left' || pos === 'right' ? 1.3 : 1.05);
  return pos === 'bottom' ? { x: 0, y: p.y + 120 } : p;
}

function DealAnimation({ view, size }: { view: PlayerView; size: Size }) {
  if (view.phase !== 'dealing') return null;
  const dealtCount = 100 - view.deckRemaining;
  const first = view.dealer ?? 0;
  const flights = [0, 1, 2].map((k) => dealtCount - k).filter((d) => d > 0);
  return (
    <>
      <div className="deck-stack">
        {Array.from({ length: Math.min(7, Math.ceil(view.deckRemaining / 14) + 1) }, (_, i) => (
          <CardBack key={i} style={{ marginLeft: -i * 0.8, marginTop: -i * 1.4 }} />
        ))}
      </div>
      {flights.map((d) => {
        const seat = (first + d - 1) % 4;
        if (seat === view.you) return null;
        const to = seatPoint(posOf(seat, view.you), size);
        return (
          <motion.div
            key={d}
            className="deck-stack"
            style={{ zIndex: 4 }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
            animate={{ x: to.x * 0.9, y: to.y * 0.9, opacity: 0, rotate: 200, scale: 0.6 }}
            transition={{ duration: 0.42, ease: [0.3, 0.7, 0.4, 1] }}
          >
            <CardBack />
          </motion.div>
        );
      })}
    </>
  );
}

function TrickArea({ view, ctx, size }: { view: PlayerView; ctx: TrumpCtx; size: Size }) {
  const trick = view.trick;
  if (!trick || trick.plays.length === 0) return null;
  const leading = trickWinner(trick.plays, ctx);
  const done = trick.winner !== null;
  const winPos = done ? posOf(trick.winner!, view.you) : null;
  return (
    <div className="trick-area">
      {trick.plays.map((p) => {
        const pos = posOf(p.seat, view.you);
        const side = pos === 'left' || pos === 'right';
        const at = towards(pos, size.w, size.h, side ? (size.w < 500 ? 0.46 : 0.48) : 0.34);
        const from = seatPoint(pos, size);
        const gone = winPos ? seatPoint(winPos, size) : null;
        return (
          // Outer layer: sweeps the finished trick to the winner after a pause.
          <motion.div
            key={`${view.tricksPlayed}-${p.seat}`}
            className="trick-anchor"
            initial={{ x: 0, y: 0, opacity: 1 }}
            animate={gone ? { x: gone.x * 0.85 - at.x, y: gone.y * 0.85 - at.y, opacity: 0 } : { x: 0, y: 0, opacity: 1 }}
            transition={gone ? { delay: 0.8, duration: 0.5, ease: [0.5, 0, 0.75, 0] } : { duration: 0 }}
          >
            {/* Inner layer: every card, including the last one, flies in from its player and lands. */}
            <motion.div
              className="trick-anchor"
              initial={{ x: from.x, y: from.y, opacity: 0, scale: 0.75, rotate: pos === 'left' ? -25 : pos === 'right' ? 25 : 0 }}
              animate={{ x: at.x, y: at.y, opacity: 1, scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            >
              <div className={`trick-play ${p.seat === leading ? 'winner' : ''} ${p.cards.length > 5 ? 'huge' : p.cards.length > 3 ? 'many' : ''}`}>
                {p.cards.map((c, i) => (
                  <motion.div
                    key={c.id}
                    // a gap where the play switches suit, so off-suit filler cards stand apart
                    className={i > 0 && effSuit(c, ctx) !== effSuit(p.cards[i - 1], ctx) ? 'suit-break' : undefined}
                    initial={{ rotateY: pos === 'bottom' ? 0 : 90 }}
                    animate={{ rotateY: 0 }}
                    transition={{ delay: 0.08 + i * 0.03, duration: 0.3 }}
                  >
                    <CardFace card={c} />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
}

function DeclareSplash({ view, name }: { view: PlayerView; name: (s: number) => string }) {
  const d = view.declaration;
  const key = d ? `${view.round}-${d.seat}-${d.strength}` : null;
  const [shown, setShown] = useState<string | null>(null);
  const seen = useRef(key);
  useEffect(() => {
    if (!key) return;
    // Only announce declarations made while we're watching, during the deal — never on mount/reconnect.
    if (key === seen.current) return;
    seen.current = key;
    if (view.phase !== 'dealing' && view.phase !== 'declaring') return;
    setShown(key);
    const t = setTimeout(() => setShown(null), 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="splash">
    <AnimatePresence>
      {d && shown === key && (
        <motion.div
          key={key}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.4 }}
          transition={{ type: 'spring', stiffness: 260, damping: 16 }}
        >
          <div className={`big ${redSuit(d.suit) ? 'red' : ''}`}>{trumpGlyph(d.suit)}</div>
          <div className="cap">
            {name(d.seat)} {d.strength >= 2 ? 'locked in' : 'declared'} {d.suit === 'NT' ? 'no trump' : SUIT_NAME[d.suit]}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}

function RoundSplash({ view }: { view: PlayerView }) {
  const [shown, setShown] = useState<number | null>(null);
  const lastRound = useRef(view.phase === 'dealing' ? 0 : view.round);
  useEffect(() => {
    if (view.phase !== 'dealing' || lastRound.current === view.round) return;
    lastRound.current = view.round;
    setShown(view.round);
    setTimeout(() => setShown(null), 1600);
  }, [view.round, view.phase]);
  return (
    <div className="splash" style={{ top: '30%' }}>
    <AnimatePresence>
      {shown === view.round && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20 }}
        >
          <div className="cap" style={{ fontSize: 36 }}>
            Round {view.round}
          </div>
          <div className="sub2">Playing {levelLabel(view.trumpRank)}s</div>
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}

function Toasts({ view }: { view: PlayerView }) {
  const seen = useRef<number>(view.events.length ? view.events[view.events.length - 1].id : 0);
  const [items, setItems] = useState<{ id: string; kind: string; text: string }[]>([]);
  useEffect(() => {
    const fresh = view.events.filter((e) => e.id > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].id;
    const add = fresh.filter((e) => e.kind !== 'throwFail').map((e) => ({ id: `e${e.id}`, kind: e.kind, text: e.text }));
    setItems((xs) => [...xs, ...add].slice(-3));
    for (const a of add) setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== a.id)), 2800);
  }, [view.events]);
  const errId = view.error?.id;
  const firstErr = useRef(errId);
  useEffect(() => {
    if (!view.error || errId === firstErr.current) return;
    const item = { id: `x${errId}`, kind: 'throwFail', text: view.error.text };
    setItems((xs) => [...xs, item].slice(-3));
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== item.id)), 2800);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errId]);
  return (
    <div className="toasts">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            className={`toast ${t.kind}`}
            initial={{ opacity: 0, y: -16, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

function Emotes({ view, size }: { view: PlayerView; size: Size }) {
  const seen = useRef<number>(view.emotes.length ? view.emotes[view.emotes.length - 1].id : 0);
  const [items, setItems] = useState<{ id: number; seat: number; emoji: string }[]>([]);
  useEffect(() => {
    const fresh = view.emotes.filter((e) => e.id > seen.current);
    if (!fresh.length) return;
    seen.current = fresh[fresh.length - 1].id;
    setItems((xs) => [...xs, ...fresh]);
    for (const f of fresh) setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== f.id)), 2200);
  }, [view.emotes]);
  return (
    <AnimatePresence>
      {items.map((e) => {
        const p = towards(posOf(e.seat, view.you), size.w, size.h, 0.75);
        return (
          <motion.div
            key={e.id}
            className="emote-bubble"
            style={{ left: size.w / 2 + p.x - 18, top: size.h / 2 + p.y - 18 }}
            initial={{ opacity: 0, scale: 0.3, y: 20 }}
            animate={{ opacity: 1, scale: [0.3, 1.5, 1], y: -30 }}
            exit={{ opacity: 0, y: -70 }}
            transition={{ duration: 0.6 }}
          >
            {e.emoji}
          </motion.div>
        );
      })}
    </AnimatePresence>
  );
}

// ---------------------------------------------------------------------------------------------

interface BarProps {
  view: PlayerView;
  ctx: TrumpCtx;
  send: (a: Action) => void;
  name: (s: number) => string;
  myTurn: boolean;
  iBury: boolean;
  selectedCount: number;
  playError: string | null;
  isThrow: boolean;
  onPlay: () => void;
  onClear: () => void;
  onHint: () => void;
  hintPending: boolean;
}

function declareLabel(o: DeclareOption) {
  if (o.suit === 'NT') return o.strength === 4 ? 'No trump · big joker pair' : 'No trump · small joker pair';
  const g = SUIT_GLYPH[o.suit];
  return o.strength === 2 ? `Lock in ${g}${g}` : `Declare ${g}`;
}

function describeLead(lead: Card[], ctx: TrumpCtx): string {
  const comps = decompose(lead, ctx);
  const suit = effSuit(lead[0], ctx);
  const where = suit === 'T' ? 'trump' : SUIT_GLYPH[suit];
  if (comps.length > 1) return `Follow a ${lead.length}-card throw in ${where}`;
  const c = comps[0];
  const shape = c.kind === 'single' ? 'a single' : c.kind === 'pair' ? 'a pair' : `a ${c.len}-pair tractor`;
  return `Follow ${shape} in ${where}`;
}

function ActionBar({ view, ctx, send, name, myTurn, iBury, selectedCount, playError, isThrow, onPlay, onClear, onHint, hintPending }: BarProps) {
  const me = view.you;
  let status: React.ReactNode = null;
  let buttons: React.ReactNode = null;

  const declareButtons = view.declareOptions.map((o) => (
    <motion.button
      key={o.cardIds.join()}
      className="btn primary small"
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      whileHover={{ scale: 1.06 }}
      onClick={() => send({ type: 'declare', cardIds: o.cardIds })}
    >
      {declareLabel(o)}
    </motion.button>
  ));

  if (view.phase === 'dealing') {
    status = (
      <>
        <div className="spinner" /> Dealing · {view.deckRemaining} left
        {view.declareOptions.length > 0 && <span style={{ opacity: 0.7 }}>· you can declare trump</span>}
      </>
    );
    buttons = declareButtons;
  } else if (view.phase === 'declaring') {
    const passed = me !== null && view.passed[me];
    status = (
      <>
        <Countdown ms={view.declareRemainingMs} keyId={`${view.round}-${view.declaration?.strength ?? 0}`} />
        {passed ? 'Waiting for others…' : 'Last chance to declare trump'}
      </>
    );
    buttons = (
      <>
        {declareButtons}
        {!passed && (
          <button className="btn small" onClick={() => send({ type: 'pass' })}>
            {view.declaration ? 'Pass' : 'No declaration'}
          </button>
        )}
      </>
    );
  } else if (view.phase === 'burying') {
    if (iBury) {
      status = (
        <>
          Bury <b>8</b> cards into the kitty · {selectedCount}/8
        </>
      );
      buttons = (
        <>
          <button className="btn small" onClick={() => send({ type: 'hint' })}>
            Suggest
          </button>
          <button className="btn small" onClick={onClear} disabled={selectedCount === 0}>
            Clear
          </button>
          <button className="btn primary small" disabled={selectedCount !== 8} onClick={onPlay}>
            Bury
          </button>
        </>
      );
    } else {
      status = (
        <>
          <div className="spinner" /> <b>{name(view.dealer!)}</b> is burying the kitty
        </>
      );
    }
  } else if (view.phase === 'playing' && view.trick) {
    if (myTurn) {
      const leading = view.trick.plays.length === 0;
      const lead = view.trick.plays[0]?.cards;
      const need = lead?.length;
      status = (
        <>
          <span>
            {leading
              ? isThrow
                ? 'Throw — blocked if anyone can beat or trump any part; then just the weakest part is played'
                : 'Your lead — a single, pair, tractor, or throw'
              : describeLead(lead!, ctx)}
            <span style={{ opacity: 0.7 }}> · {need ? `${selectedCount}/${need}` : `${selectedCount} selected`}</span>
          </span>
          {selectedCount > 0 && playError && (!need || selectedCount >= need) && <span className="err-inline">— {playError}</span>}
        </>
      );
      buttons = (
        <>
          <button className="btn small" onClick={onHint} disabled={hintPending} title="What a bot would play here">
            {hintPending ? (
              <>
                <span className="spinner" /> Thinking
              </>
            ) : (
              'Hint'
            )}
          </button>
          <button className="btn small" onClick={onClear} disabled={selectedCount === 0}>
            Clear
          </button>
          <motion.button
            className="btn primary small"
            disabled={!!playError}
            onClick={onPlay}
            animate={{ scale: playError ? 1 : [1, 1.06, 1] }}
            transition={{ duration: 0.4 }}
          >
            {isThrow ? 'Throw' : 'Play'}
          </motion.button>
        </>
      );
    } else if (view.trick.winner !== null) {
      status = (
        <>
          <b>{name(view.trick.winner)}</b> {view.trick.winner === me ? 'win' : 'wins'} the trick
          {view.trick.points > 0 && <span style={{ color: 'var(--gold-hi)' }}> · {view.trick.points} pts</span>}
        </>
      );
    } else {
      status = (
        <>
          <div className="spinner" /> Waiting for <b>{name(view.turn)}</b>
        </>
      );
    }
  } else {
    status = <>Round over</>;
  }

  return (
    <div className="plate action-bar">
      <div className="status">{status}</div>
      <div className="buttons">{buttons}</div>
    </div>
  );
}

function Countdown({ ms, keyId }: { ms: number; keyId: string }) {
  const total = 8000;
  return (
    <svg className="countdown" viewBox="0 0 36 36" key={keyId}>
      <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
      <motion.circle
        cx="18"
        cy="18"
        r="15"
        fill="none"
        stroke="#e8b64c"
        strokeWidth="4"
        strokeLinecap="round"
        transform="rotate(-90 18 18)"
        initial={{ pathLength: Math.min(1, ms / total) }}
        animate={{ pathLength: 0 }}
        transition={{ duration: ms / 1000, ease: 'linear' }}
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------------------------

function CountUp({ to, delay }: { to: number; delay: number }) {
  const mv = useMotionValue(0);
  const [v, setV] = useState(0);
  useEffect(() => mv.on('change', (x) => setV(Math.round(x))), [mv]);
  useEffect(() => {
    const c = animate(mv, to, { duration: 1.2, delay, ease: [0.2, 0.8, 0.2, 1] });
    return () => c.stop();
  }, [mv, to, delay]);
  return <>{v}</>;
}

function RoundEnd({ view, send }: { view: PlayerView; send: (a: Action) => void }) {
  const r = view.result!;
  const usTeam = (view.you ?? 0) % 2;
  const weWon = r.winnerTeam === usTeam;
  const over = view.phase === 'gameOver';
  const dealerTeam = view.dealer! % 2;
  const defendersHeld = r.winnerTeam === dealerTeam;
  const title = over ? (weWon ? 'Your team wins the game!' : 'Opponents win the game') : weWon ? 'Your team wins the round' : 'Opponents win the round';
  const plural = r.levelsGained > 1 ? 's' : '';
  const subtitle = defendersHeld
    ? `Defenders held the deal${r.levelsGained ? ` · +${r.levelsGained} level${plural}` : ''}`
    : `Attackers take the deal${r.levelsGained ? ` · +${r.levelsGained} level${plural}` : ''}`;

  return (
    <Modal>
      {over && weWon && <Confetti />}
      <motion.h2 initial={{ scale: 0.7 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 200, damping: 12 }}>
        {title}
      </motion.h2>
      <div className="sub">{subtitle}</div>
      <div>
        <div className="label">Attackers scored</div>
        <div className="big-num" style={{ color: r.attackerPoints >= 80 ? 'var(--gold-hi)' : 'var(--ink)' }}>
          <CountUp to={r.attackerPoints} delay={0.3} />
        </div>
        {r.kittyBonus > 0 && (
          <motion.div className="sub" style={{ marginTop: 6 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }}>
            includes kitty {r.kittyPoints} × {r.kittyMultiplier} = {r.kittyBonus}
          </motion.div>
        )}
      </div>
      <div>
        <div className="label" style={{ marginBottom: 8 }}>
          Kitty
        </div>
        <div className="kitty-row">
          {r.kitty.map((c: Card, i: number) => (
            <motion.div
              key={c.id}
              initial={{ rotateY: 180, opacity: 0, y: 10 }}
              animate={{ rotateY: 0, opacity: 1, y: 0 }}
              transition={{ delay: 0.5 + i * 0.08, duration: 0.45 }}
            >
              <CardFace card={c} />
            </motion.div>
          ))}
        </div>
      </div>
      <div className="level-row">
        {[usTeam, 1 - usTeam].map((team) => {
          const gained = r.newLevels[team] !== r.prevLevels[team];
          return (
            <div className="level-box" key={team}>
              <span className="label">{team === usTeam ? 'Your team' : 'Opponents'}</span>
              <div className="lvl">
                <span style={{ opacity: gained ? 0.4 : 1 }}>{levelLabel(r.prevLevels[team])}</span>
                {gained && (
                  <>
                    <span style={{ fontSize: 16, opacity: 0.6 }}>→</span>
                    <motion.span
                      style={{ color: 'var(--gold-hi)', display: 'inline-block' }}
                      initial={{ scale: 0 }}
                      animate={{ scale: [0, 1.5, 1] }}
                      transition={{ delay: 1.6, duration: 0.6 }}
                    >
                      {levelLabel(r.newLevels[team])}
                    </motion.span>
                  </>
                )}
              </div>
              {r.nextDealer % 2 === team && !over && <span className="gain">庄 deals next</span>}
            </div>
          );
        })}
      </div>
      {view.isHost ? (
        <button className="btn primary" onClick={() => send({ type: over ? 'newGame' : 'nextRound' })}>
          {over ? 'Back to lobby' : 'Next round'}
        </button>
      ) : (
        <div className="status-pill">
          <div className="spinner" /> Waiting for the host
        </div>
      )}
    </Modal>
  );
}

function Confetti() {
  const stage = useStage();
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * stage.w,
        up: 300 + Math.random() * 200,
        rot: Math.random() * 720 - 360,
        delay: Math.random() * 0.4,
        color: ['#fbe3a0', '#e8b64c', '#ff6b6b', '#fff4dc', '#f08a7a'][i % 5],
        glyph: ['♠', '♥', '♣', '♦', '★'][i % 5],
      })),
    [stage],
  );
  return (
    <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 80, overflow: 'hidden' }}>
      {pieces.map((p) => (
        <motion.div
          key={p.id}
          style={{ position: 'absolute', left: '50%', top: '40%', color: p.color, fontSize: 22 }}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
          animate={{ x: p.x, y: [0, -p.up, stage.h], rotate: p.rot, opacity: [1, 1, 0] }}
          transition={{ duration: 2.6, delay: p.delay, ease: 'easeOut' }}
        >
          {p.glyph}
        </motion.div>
      ))}
    </div>
  );
}

function MuteButton() {
  const muted = useMuted();
  return (
    <button className="btn icon-btn" title={muted ? 'Sound off' : 'Sound on'} onClick={() => setMuted(!muted)}>
      {muted ? '🔇' : '🔊'}
    </button>
  );
}

/** Plays sound effects as the game state changes. Nothing plays for the state we mount into. */
function useSounds(view: PlayerView, myTurn: boolean) {
  const prev = useRef({
    trickKey: `${view.tricksPlayed}`,
    plays: view.trick?.plays.length ?? 0,
    winner: view.trick?.winner ?? null,
    decl: view.declaration ? `${view.round}-${view.declaration.seat}-${view.declaration.strength}` : '',
    myTurn,
    hand: view.hand.length,
    phase: view.phase,
    error: view.error?.id,
    event: view.events[view.events.length - 1]?.id,
  });
  useEffect(() => {
    const p = prev.current;
    const trick = view.trick;
    const trickKey = `${view.tricksPlayed}`;
    const plays = trick?.plays.length ?? 0;
    if (trick && (trickKey !== p.trickKey ? plays > 0 : plays > p.plays)) {
      sfx.card();
    }
    const winner = trick?.winner ?? null;
    if (trick && winner !== null && (p.winner === null || trickKey !== p.trickKey)) {
      setTimeout(() => sfx.sweep(), 850);
      const attackers = view.dealer !== null && winner % 2 !== view.dealer % 2;
      if (attackers && trick.points > 0) setTimeout(() => sfx.coin(), 1050);
    }
    const decl = view.declaration ? `${view.round}-${view.declaration.seat}-${view.declaration.strength}` : '';
    if (decl && decl !== p.decl) sfx.declare();
    if (myTurn && !p.myTurn) setTimeout(() => sfx.turn(), 250);
    if (view.phase === 'dealing' && view.hand.length > p.hand) sfx.deal();
    if ((view.phase === 'roundEnd' || view.phase === 'gameOver') && p.phase !== view.phase && view.result) {
      const won = view.result.winnerTeam === (view.you ?? 0) % 2;
      setTimeout(() => (won ? sfx.win() : sfx.lose()), 300);
    }
    if (view.error && view.error.id !== p.error) sfx.error();
    const lastEvent = view.events[view.events.length - 1];
    if (lastEvent?.kind === 'throwFail' && lastEvent.id !== p.event) sfx.error();
    prev.current = {
      trickKey,
      plays,
      winner,
      decl,
      myTurn,
      hand: view.hand.length,
      phase: view.phase,
      error: view.error?.id,
      event: view.events[view.events.length - 1]?.id,
    };
  }, [view, myTurn]);
}

const VOID_ORDER = ['S', 'H', 'C', 'D', 'T'];
const SUIT_WORD: Record<string, string> = { S: 'spades', H: 'hearts', C: 'clubs', D: 'diamonds', T: 'trump' };

/** Suits a player has revealed they're out of (by failing to follow). */
function Voids({ voids, inline }: { voids: string[]; inline?: boolean }) {
  if (voids.length === 0) return null;
  const sorted = [...voids].sort((a, b) => VOID_ORDER.indexOf(a) - VOID_ORDER.indexOf(b));
  return (
    <div
      className={`voids ${inline ? 'inline' : 'plate'}`}
      style={inline ? undefined : { padding: '3px 8px', borderRadius: 999 }}
      title={inline ? 'Suits the other players know you are out of' : undefined}
    >
      <span>out of</span>
      <AnimatePresence initial={false}>
        {sorted.map((v) => (
          <motion.span
            key={v}
            className={`void ${v === 'H' || v === 'D' ? 'red' : ''} ${v === 'T' ? 'zh' : ''}`}
            title={`Out of ${SUIT_WORD[v]}`}
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          >
            {v === 'T' ? '主' : `${SUIT_GLYPH[v as keyof typeof SUIT_GLYPH]}\uFE0E`}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

/** Center announcement when a throw is blocked, showing the cards the leader had to take back. */
function ThrowSplash({ view, name }: { view: PlayerView; name: (s: number) => string }) {
  const latest = [...view.events].reverse().find((e) => e.kind === 'throwFail');
  const seen = useRef(latest?.id ?? 0);
  const [shown, setShown] = useState<GameEvent | null>(null);
  // Keyed on the event id, not the event object: online players get a fresh copy of every event on each update,
  // and re-running here used to cancel the hide timer, leaving the panel stuck on screen.
  const latestId = latest?.id;
  useEffect(() => {
    if (!latest || latest.id <= seen.current) return;
    seen.current = latest.id;
    setShown(latest);
    const t = setTimeout(() => setShown(null), 2600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestId]);
  return (
    <div className="splash" style={{ top: '30%' }}>
      <AnimatePresence>
        {shown && (
          <motion.div
            key={shown.id}
            className="plate throw-splash"
            initial={{ opacity: 0, y: 16, scale: 0.85 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 260, damping: 20 }}
          >
            <div className="t">Throw blocked</div>
            <div className="s">
              {shown.seat !== undefined ? name(shown.seat) : 'Leader'} {shown.seat === view.you ? 'take' : 'takes'} back:
            </div>
            <div className="cards">
              {shown.cards?.map((c) => (
                <CardFace key={c.id} card={c} />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Every trick played this round, newest first: who led, each player's cards, the winner and the points. */
function TrickHistory({ view, name, onClose }: { view: PlayerView; name: (s: number) => string; onClose: () => void }) {
  const usTeam = (view.you ?? 0) % 2;
  const tricks = view.tricks.map((t, i) => ({ t, n: i + 1 })).reverse();
  const histCtx: TrumpCtx = { suit: view.trumpSuit, rank: view.trumpRank };
  return (
    <Modal onClose={onClose} className="history">
      <h2>Tricks this round</h2>
      <div className="sub">
        {view.tricks.length} played · newest first
      </div>
      <div className="history-list">
        {tricks.map(({ t, n }) => (
          <motion.div
            key={n}
            className="history-row"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(0.3, (view.tricks.length - n) * 0.03) }}
          >
            <div className="history-head">
              <span className="num">#{n}</span>
              <span>
                <b>{name(t.winner!)}</b> {t.winner === view.you ? 'win' : 'wins'}
              </span>
              {t.points > 0 && (
                <span className={`pts ${t.winner! % 2 === usTeam ? 'us' : 'them'}`}>{t.points} pts</span>
              )}
            </div>
            <div className="history-plays">
              {t.plays.map((p, i) => (
                <div key={p.seat} className={`history-play ${p.seat === t.winner ? 'won' : ''}`}>
                  <div className="who">
                    {name(p.seat)}
                    {i === 0 && <span className="tag">led</span>}
                  </div>
                  <div className="cards">
                    {p.cards.map((c, i) => (
                      <div key={c.id} className={`fan-slot ${i > 0 && effSuit(c, histCtx) !== effSuit(p.cards[i - 1], histCtx) ? 'suit-break' : ''}`}>
                        <CardFace card={c} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        ))}
      </div>
      <button className="btn" onClick={onClose}>
        Close
      </button>
    </Modal>
  );
}
