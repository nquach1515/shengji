import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';
import { Card } from '../game/cards';
import { loadSavedHost } from '../net/host';
import { Pace, Settings } from '../net/protocol';
import type { StartMode } from './App';
import { CardFace } from './Card';
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
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={String(o.value)} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.value === value && (
            <motion.div layoutId={`seg-${id}`} className="pill" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />
          )}
          <span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Home({ onStart }: { onStart: (mode: StartMode, name: string) => void }) {
  const urlCode = useMemo(() => new URL(window.location.href).searchParams.get('room') ?? '', []);
  const saved = useMemo(() => loadSavedHost(), []);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [settings, setSettings] = useState<Settings>({ startLevel: 2, pace: 'normal', decks: 2 });
  const [rules, setRules] = useState(false);
  const [news, setNews] = useState(false);
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

  const length = LENGTHS.find((l) => l.level === settings.startLevel)!;

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
        <div className="logo-fan">
          {FAN.map((card, i) => {
            const mid = (FAN.length - 1) / 2;
            return (
              <motion.div
                key={card.id}
                style={{ position: 'absolute', bottom: 0, transformOrigin: '50% 135%' }}
                initial={{ rotate: 0, y: 60, opacity: 0 }}
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
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.35, type: 'spring', stiffness: 120, damping: 14 }}
        >
          <div className="zh">升级</div>
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
            <div className="opt-row">
              <span className="label">Length</span>
              <Segmented
                id="len"
                options={LENGTHS.map((l) => ({ value: l.level, label: l.label }))}
                value={settings.startLevel}
                onChange={(startLevel) => setSettings((s) => ({ ...s, startLevel }))}
              />
            </div>
            <div className="opt-note">{length.note}</div>
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
        </div>
        <div className="version" title={`Built ${new Date(__BUILD_TIME__).toLocaleString()}`}>
          v{__APP_VERSION__} · build {__BUILD_SHA__} ·{' '}
          {new Date(__BUILD_TIME__).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        </div>
      </div>
      <AnimatePresence>{rules && <RulesModal onClose={() => setRules(false)} />}</AnimatePresence>
      <AnimatePresence>{news && <WhatsNewModal onClose={() => setNews(false)} />}</AnimatePresence>
    </div>
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
      <h3>Play with 3 decks</h3>
      <ul>
        <li>Pick 2 or 3 decks when you set up a game: 38 cards each, a 10-card kitty, and 120 of 300 points takes the deal.</li>
        <li>Triples and triple tractors: answer a triple with a triple (or a pair if you have none). You never have to split a triple to answer a pair.</li>
        <li>A triple declaration beats any pair, and no trump takes three of the same joker.</li>
      </ul>
      <h3>Online play</h3>
      <ul>
        <li>Games connect through a relay server, so they work through VPNs and many networks that used to block them.</li>
      </ul>
      <h3>Smarter bots and hints</h3>
      <ul>
        <li>Retrained bots for 2 decks and a new model trained for 3 decks.</li>
        <li>They no longer put points on a trick the opponents will probably take, lead point cards that can be beaten, or hold back an ace and let the other one win.</li>
        <li>They keep triples together, throw their cheapest cards when they can't win, and read your hands better.</li>
        <li>Bots wait until two thirds of the deck is dealt before declaring, so you get a fair chance to declare first.</li>
      </ul>
      <h3>Look and feel</h3>
      <ul>
        <li>Your hand always alternates red and black suits.</li>
        <li>Clearer blocked-throw popup that stays up longer, level badges no longer cut off, declared cards stay on screen on phones.</li>
        <li>The kitty bonus is always ×2 when the attackers win the last trick.</li>
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
        <li>While cards are dealt, show a card of the current level to declare its suit as trump. A pair beats a single; a pair of jokers means no trump. With 3 decks, any triple beats any pair, and no trump takes three of the same joker.</li>
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
              autoFocus
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
