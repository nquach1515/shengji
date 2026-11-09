import { AnimatePresence } from 'framer-motion';
import { motion } from './motion';
import { useEffect, useMemo, useState } from 'react';
import { Card, levelLabel } from '../game/cards';
import { loadSavedHost } from '../net/host';
import { Pace, Settings } from '../net/protocol';
import type { Difficulty } from '../game/live';
import type { StartMode } from './App';
import { CardBack, CardFace } from './Card';
import { Back, Background, Felt, useDisplay } from './display';
import { Modal } from './Modal';

const FAN: Card[] = [
  { id: 'a', suit: 'S', rank: 14 },
  { id: 'b', suit: 'H', rank: 13 },
  { id: 'c', suit: 'J', rank: 16 },
  { id: 'd', suit: 'D', rank: 10 },
  { id: 'e', suit: 'C', rank: 12 },
];

export const LENGTHS: { level: number; label: string; note: string }[] = [
  { level: 2, label: 'Classic', note: 'Traditional: start at 2, climb to Ace · a long game' },
  { level: 7, label: 'Shorter', note: 'Start at 7 · about half the rounds' },
  { level: 10, label: 'Quick', note: 'Start at 10 · a game in a few rounds' },
];
export const DECK_OPTIONS: { decks: number; label: string; note: string }[] = [
  { decks: 2, label: '2 decks', note: '25 cards each · 8-card kitty · 80 to win' },
  { decks: 3, label: '3 decks', note: '38 cards each · 10-card kitty · triples · 120 to win' },
];
/**
 * Game length: the presets, or Custom to start both teams at any level from 2 to A. Shows the preset's note, or a
 * stepper for the custom level, on one line under the row (`note` false leaves the preset note out).
 */
export function LengthPicker({ id, value, onChange, note = true }: { id: string; value: number; onChange: (level: number) => void; note?: boolean }) {
  const preset = LENGTHS.find((l) => l.level === value);
  const [custom, setCustom] = useState(!preset);
  return (
    <>
      <div className="opt-row">
        <span className="label">Length</span>
        <Segmented
          id={id}
          options={[...LENGTHS.map((l) => ({ value: l.level, label: l.label })), { value: 0, label: 'Custom' }]}
          value={custom ? 0 : value}
          onChange={(v) => {
            setCustom(v === 0);
            if (v !== 0) onChange(v);
          }}
        />
      </div>
      {/* the custom stepper sits in the note's one-line slot, so switching to Custom doesn't move the rows below */}
      {custom ? (
        <div className="opt-note start-at">
          Start at
          <button className="step" aria-label="Lower start level" disabled={value <= 2} onClick={() => onChange(value - 1)}>
            −
          </button>
          <b>{levelLabel(value)}</b>
          <button className="step" aria-label="Higher start level" disabled={value >= 14} onClick={() => onChange(value + 1)}>
            +
          </button>
          · climb to Ace
        </div>
      ) : (
        note && preset && <div className="opt-note">{preset.note}</div>
      )}
    </>
  );
}

/** "Classic", "Shorter", "Quick", or "Starts at 5" for a custom level. */
export function lengthName(level: number) {
  return LENGTHS.find((l) => l.level === level)?.label ?? `Starts at ${levelLabel(level)}`;
}

export const DIFFICULTIES: { value: Difficulty; label: string; note: string }[] = [
  { value: 'easy', label: 'Easy', note: 'Rule-based bots that slip up now and then' },
  { value: 'normal', label: 'Normal', note: 'Trained bots, without the look-ahead' },
  { value: 'hard', label: 'Hard', note: 'Trained bots that simulate the rest of the round' },
];

/** Bot strength; hints are always full strength. */
export function DifficultyPicker({ id, value, onChange }: { id: string; value: Difficulty; onChange: (d: Difficulty) => void }) {
  return (
    <>
      <div className="opt-row">
        <span className="label">Bots</span>
        <Segmented id={id} options={DIFFICULTIES} value={value} onChange={onChange} />
      </div>
      <div className="opt-note">{DIFFICULTIES.find((d) => d.value === value)!.note}</div>
    </>
  );
}

export const PACES: { pace: Pace; label: string }[] = [
  { pace: 'relaxed', label: 'Relaxed' },
  { pace: 'normal', label: 'Normal' },
  { pace: 'fast', label: 'Fast' },
];

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  id,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  id: string;
}) {
  // Show a pick at once and keep it until `value` catches up: in the lobby the value comes back from the host a
  // moment later, and in between the pill used to jump back to the old choice first.
  const [picked, setPicked] = useState<T | null>(null);
  useEffect(() => {
    if (picked === null) return;
    if (picked === value) return setPicked(null);
    const t = setTimeout(() => setPicked(null), 1500);
    return () => clearTimeout(t);
  }, [picked, value]);
  const shown = picked ?? value;
  return (
    <div className="seg">
      {options.map((o) => (
        <button
          key={String(o.value)}
          className={o.value === shown ? 'on' : ''}
          onClick={() => {
            setPicked(o.value);
            onChange(o.value);
          }}
        >
          {o.value === shown && (
            <motion.div layoutId={`seg-${id}`} className="pill" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
          )}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/** introLogo: the iOS launch intro is running (LaunchIntro.tsx) — the logo starts in its final place, hidden, and the
 *  intro's moving picture lands exactly on it */
export function Home({ onStart, introLogo }: { onStart: (mode: StartMode, name: string) => void; introLogo?: 'hidden' | 'shown' }) {
  const urlCode = useMemo(() => new URL(window.location.href).searchParams.get('room') ?? '', []);
  const saved = useMemo(() => loadSavedHost(), []);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [settings, setSettings] = useState<Settings>({ startLevel: 2, pace: 'normal', decks: 2, difficulty: 'hard' });
  const [rules, setRules] = useState(false);
  const [news, setNews] = useState(false);
  const [display, setDisplay] = useState(false);
  useEffect(() => {
    if (!newsPending) return;
    newsPending = false;
    setNews(true);
  }, []);
  const inviteCode = /^[a-z]{4}$/i.test(urlCode) ? urlCode.toUpperCase() : '';
  const [showInvite, setShowInvite] = useState(!!inviteCode);

  // the host refreshed their own table's page: go straight back in instead of showing them an invite to it
  const ownTable = !!inviteCode && saved?.code === inviteCode;
  useEffect(() => {
    if (ownTable) onStart({ kind: 'resume' }, 'Player');
  }, []);

  const go = (mode: StartMode) => {
    onStart(mode, name.trim().slice(0, 16) || 'Player');
  };

  const join = () => {
    const c = code.trim().toUpperCase();
    if (c.length !== 4) {
      setErr('Room codes are 4 letters');
      return;
    }
    go({ kind: 'join', code: c });
  };


  if (showInvite) {
    return (
      <InviteJoin
        code={inviteCode}
        onJoin={(n) => onStart({ kind: 'join', code: inviteCode }, n.trim().slice(0, 16) || 'Player')}
        onHome={() => {
          const url = new URL(window.location.href);
          url.searchParams.delete('room');
          window.history.replaceState(null, '', url);
          setCode('');
          setShowInvite(false);
        }}
      />
    );
  }

  return (
    <div className="home">
      <div className="home-inner">
        <div className="logo-fan" style={introLogo === 'hidden' ? { visibility: 'hidden' } : undefined}>
          {FAN.map((card, i) => {
            const mid = (FAN.length - 1) / 2;
            return (
              <motion.div
                key={card.id}
                style={{ position: 'absolute', bottom: 0, transformOrigin: '50% 135%' }}
                initial={introLogo ? false : { rotate: 0, y: 60, opacity: 0 }}
                animate={{ rotate: (i - mid) * 15, y: Math.abs(i - mid) * 8, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.08, type: 'spring', stiffness: 150, damping: 15 }}
                whileHover={{ y: Math.abs(i - mid) * 8 - 18, transition: { duration: 0.2 } }}
              >
                <CardFace card={card} style={{ ['--cw' as string]: '92px' }} />
              </motion.div>
            );
          })}
        </div>

        <motion.div
          className="wordmark"
          initial={introLogo ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.35, type: 'spring', stiffness: 120, damping: 14 }}
        >
          <div className="zh" style={introLogo === 'hidden' ? { visibility: 'hidden' } : undefined}>
            升级
          </div>
          <div className="en">Sheng Ji · Tractor</div>
        </motion.div>
        <motion.div className="tagline" initial={{ opacity: 0 }} animate={{ opacity: 0.85 }} transition={{ delay: 0.55 }}>
          The classic Chinese partnership card game. Two or three decks, four players, one climb from 2 to Ace.
        </motion.div>

        <motion.div className="name-row" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }}>
          <span>Your name</span>
          <input
            className="input"
            value={name}
            maxLength={16}
            placeholder="Player"
            onChange={(e) => {
              setName(e.target.value);
              setErr('');
            }}
          />
        </motion.div>
        {err && <div className="err">{err}</div>}

        <div className="mode-cards">
          <motion.div
            className="panel mode-card"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, type: 'spring', stiffness: 120, damping: 18 }}
          >
            <h3>Play with bots</h3>
            <p>You and a bot partner against two bots.</p>
            <LengthPicker id="len" value={settings.startLevel} onChange={(startLevel) => setSettings((s) => ({ ...s, startLevel }))} />
            <div className="opt-row">
              <span className="label">Decks</span>
              <Segmented
                id="decks"
                options={DECK_OPTIONS.map((d) => ({ value: d.decks, label: d.label }))}
                value={settings.decks}
                onChange={(decks) => setSettings((s) => ({ ...s, decks }))}
              />
            </div>
            <div className="opt-note">{DECK_OPTIONS.find((d) => d.decks === settings.decks)!.note}</div>
            <DifficultyPicker id="diff" value={settings.difficulty ?? 'hard'} onChange={(difficulty) => setSettings((s) => ({ ...s, difficulty }))} />
            <div className="opt-row">
              <span className="label">Pace</span>
              <Segmented
                id="pace"
                options={PACES.map((p) => ({ value: p.pace, label: p.label }))}
                value={settings.pace}
                onChange={(pace) => setSettings((s) => ({ ...s, pace }))}
              />
            </div>
            <button className="btn primary" style={{ marginTop: 6 }} onClick={() => go({ kind: 'practice', settings })}>
              Deal me in
            </button>
          </motion.div>

          <motion.div
            className="panel mode-card"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8, type: 'spring', stiffness: 120, damping: 18 }}
          >
            <h3>Play with friends</h3>
            <p>Host a table and share the code — bots can fill any empty seat.</p>
            <button className="btn primary" onClick={() => go({ kind: 'host' })}>
              Host a table
            </button>
            {saved && (
              <button className="btn small" onClick={() => go({ kind: 'resume' })}>
                Resume your table {saved.code}
              </button>
            )}
            <div className="divider">or join with a code</div>
            <div className="row">
                <input
                  className="input code grow"
                  value={code}
                  maxLength={4}
                  placeholder="CODE"
                  onChange={(e) => {
                    setCode(e.target.value.replace(/[^a-z]/gi, ''));
                    setErr('');
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && join()}
                />
                <button className="btn" onClick={join} disabled={code.length !== 4}>
                  Join
                </button>
            </div>
          </motion.div>
        </div>

        <div className="links">
          <button className="link" onClick={() => setRules(true)}>
            How to play
          </button>
          <button className="link" onClick={() => setNews(true)}>
            What's new
          </button>
          <button className="link" onClick={() => setDisplay(true)}>
            Display
          </button>
        </div>
        <div className="version" title={`Built ${new Date(__BUILD_TIME__).toLocaleString()}`}>
          v{__APP_VERSION__} · build {__BUILD_SHA__} ·{' '}
          {new Date(__BUILD_TIME__).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
      <AnimatePresence>{rules && <RulesModal onClose={() => setRules(false)} />}</AnimatePresence>
      <AnimatePresence>{news && <WhatsNewModal onClose={() => setNews(false)} />}</AnimatePresence>
      <AnimatePresence>{display && <DisplayModal onClose={() => setDisplay(false)} />}</AnimatePresence>
    </div>
  );
}

const FELTS: { value: Felt; label: string }[] = [
  { value: 'red', label: 'Red' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'charcoal', label: 'Charcoal' },
  { value: 'rainbow', label: 'Rainbow' },
];
const BACKS: { value: Back; label: string }[] = [
  { value: 'red', label: 'Red' },
  { value: 'blue', label: 'Blue' },
  { value: 'green', label: 'Green' },
  { value: 'black', label: 'Black' },
  { value: 'rainbow', label: 'Rainbow' },
];
const BACKGROUNDS: { value: Background; label: string }[] = [
  { value: 'cherry', label: 'Cherry' },
  { value: 'midnight', label: 'Midnight' },
  { value: 'forest', label: 'Forest' },
  { value: 'graphite', label: 'Graphite' },
  { value: 'plum', label: 'Plum' },
];
const PREVIEW: Card[] = [
  { id: 'p1', suit: 'S', rank: 10 },
  { id: 'p2', suit: 'H', rank: 9 },
  { id: 'p3', suit: 'C', rank: 8 },
  { id: 'p4', suit: 'D', rank: 7 },
];

/** Display options for this device: suit colours, card index size, page background, table and card-back colours. */
export function DisplayModal({ onClose }: { onClose: () => void }) {
  const { display, set } = useDisplay();
  return (
    <Modal onClose={onClose} className="display-opts">
      <h2>Display</h2>
      <div className="display-preview">
        {PREVIEW.map((c) => (
          <CardFace key={c.id} card={c} />
        ))}
        <CardBack />
      </div>
      <div className="opt-row">
        <span className="label">Suits</span>
        <Segmented
          id="disp-suits"
          options={[
            { value: 2, label: 'Red & black' },
            { value: 4, label: 'Four colours' },
          ]}
          value={display.fourColour ? 4 : 2}
          onChange={(v) => set({ fourColour: v === 4 })}
        />
      </div>
      <div className="opt-note">Four colours: ♦ blue and ♣ green, so no two suits look alike.</div>
      <div className="opt-row">
        <span className="label">Cards</span>
        <Segmented
          id="disp-corners"
          options={[
            { value: 0, label: 'Classic' },
            { value: 1, label: 'Large index' },
          ]}
          value={display.bigCorners ? 1 : 0}
          onChange={(v) => set({ bigCorners: v === 1 })}
        />
      </div>
      <div className="opt-note">Large index: a big rank and suit in each corner and one suit symbol in the middle.</div>
      <div className="opt-row">
        <span className="label">Background</span>
        <Segmented id="disp-bg" options={BACKGROUNDS} value={display.background} onChange={(background) => set({ background })} />
      </div>
      <div className="opt-row">
        <span className="label">Table</span>
        <Segmented id="disp-felt" options={FELTS} value={display.felt} onChange={(felt) => set({ felt })} />
      </div>
      <div className="opt-row">
        <span className="label">Backs</span>
        <Segmented id="disp-back" options={BACKS} value={display.back} onChange={(back) => set({ back })} />
      </div>
      <div className="opt-note">Saved on this device.</div>
      <button className="btn primary" onClick={onClose}>
        Done
      </button>
    </Modal>
  );
}

const SEEN_VERSION_KEY = 'sj-seen-version';

/** Show "What's new" once per version to people who have played before (a brand-new player has no client id yet). */
function shouldShowWhatsNew(): boolean {
  try {
    const seen = localStorage.getItem(SEEN_VERSION_KEY);
    localStorage.setItem(SEEN_VERSION_KEY, __APP_VERSION__);
    return seen !== __APP_VERSION__ && localStorage.getItem('sj-client-id') !== null;
  } catch {
    return false;
  }
}

/** Decided once per page load; the home screen opens the card the first time it appears. */
let newsPending = shouldShowWhatsNew();

export function WhatsNewModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="rules">
      <h2>What's new in v{__APP_VERSION__}</h2>
      <h3>Display options</h3>
      <ul>
        <li>Four-colour suits (♦ blue, ♣ green) so no two suits look alike, and a large-index card style — easier to read on a phone.</li>
        <li>Pick the background, table colour (including rainbow) and card backs. Find it under Display on the home screen or in the ⋯ menu.</li>
      </ul>
      <h3>Bot difficulty</h3>
      <ul>
        <li>Choose Easy, Normal or Hard bots when you set up a game. Hard is the full-strength bots you had before. Hints are always full strength.</li>
      </ul>
      <h3>Round review</h3>
      <ul>
        <li>At the end of each round, see your costliest plays and what would have scored more, checked by the same simulation the bots use.</li>
      </ul>
      <h3>Also new</h3>
      <ul>
        <li>Start a game at any level from 2 to A with Custom length.</li>
        <li>Smarter bots: they feed points onto a partner's trick nobody can beat, take the opponents' points when they're last to play, and break up a triple to take a trick worth points.</li>
        <li>No more flicker when the page loads.</li>
      </ul>
      <button className="btn primary" onClick={onClose}>
        Let's play
      </button>
    </Modal>
  );
}

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} className="rules">
      <h2>How to play</h2>
      <h3>Teams &amp; goal</h3>
      <ul>
        <li>Four players, partners sit across. Both teams start at a level (2 in a classic game) and climb to Ace.</li>
        <li>The dealing team defends; the other team attacks by capturing points: 5s are worth 5, 10s and Ks 10.</li>
        <li>Attackers need 80 of the 200 points to take over the deal; every 40 more is a level up for them. With 3 decks: 120 of 300.</li>
      </ul>
      <h3>Trump</h3>
      <ul>
        <li>While cards are dealt, show a card of the current level to declare its suit as trump. A pair beats a single; a pair of jokers means no trump. With 3 decks, any triple beats any pair, and no trump takes three of the same joker. In the first round, the first player to declare becomes dealer; a stronger declaration after that only changes the trump suit.</li>
        <li>Trump order: big joker, small joker, level card in trump suit, other level cards, then trump suit A down to 2.</li>
        <li>The dealer picks up the kitty (8 cards, or 10 with 3 decks) and buries the same number.</li>
      </ul>
      <h3>Playing tricks</h3>
      <ul>
        <li>Lead a single, a pair, a tractor (consecutive pairs), or several combos of one suit at once (a throw). With 3 decks there are also triples and triple tractors.</li>
        <li>A throw only stands if no one can beat any part of it, including by trumping: anyone out of that suit who holds trumps matching a part's shape blocks it. Otherwise only the beatable part is played, and the cards you take back are shown to everyone.</li>
        <li>Follow suit with the same number of cards, and match pairs/tractors when you can. A triple calls for a triple, or a pair if you have no triple; you never have to split a triple to answer a pair. If you're out of the suit, you may trump.</li>
        <li>If attackers win the last trick, they also win the kitty's points, doubled.</li>
      </ul>
      <button className="btn primary" onClick={onClose}>
        Got it
      </button>
    </Modal>
  );
}

/** Opened from an invite link: pick a name, then join that table. */
function InviteJoin({ code, onJoin, onHome }: { code: string; onJoin: (name: string) => void; onHome: () => void }) {
  const [name, setName] = useState('');
  return (
    <div className="home">
      <div className="home-inner" style={{ width: 'min(420px, 100%)' }}>
        <motion.div className="wordmark" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
          <div className="zh" style={{ fontSize: 'clamp(64px, 10cqh, 96px)' }}>升级</div>
        </motion.div>
        <motion.div
          className="panel mode-card"
          style={{ width: '100%', alignItems: 'center', textAlign: 'center' }}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, type: 'spring', stiffness: 140, damping: 18 }}
        >
          <h3>You're invited to a table</h3>
          <div className="room-code" style={{ margin: '4px 0 6px' }}>
            {code.split('').map((ch, i) => (
              <motion.div
                key={i}
                className="ch"
                initial={{ rotateY: 90, opacity: 0 }}
                animate={{ rotateY: 0, opacity: 1 }}
                transition={{ delay: 0.2 + i * 0.08, type: 'spring', stiffness: 200, damping: 15 }}
              >
                {ch}
              </motion.div>
            ))}
          </div>
          <form
            style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}
            onSubmit={(e) => {
              e.preventDefault();
              onJoin(name);
            }}
          >
            <input
              className="input"
              value={name}
              maxLength={16}
              // computers only: on a phone (and in the app) the keyboard would pop up over the invite before you've read it
              autoFocus={!matchMedia('(pointer: coarse)').matches}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
              style={{ textAlign: 'center' }}
            />
            <button className="btn primary" type="submit">
              Join table
            </button>
          </form>
          <div className="foot">You can change your name in the lobby until the cards are dealt.</div>
        </motion.div>
        <button className="link" onClick={onHome}>
          Go to the home page instead
        </button>
      </div>
    </div>
  );
}
