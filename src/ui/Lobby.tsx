import { AnimatePresence } from 'framer-motion';
import { motion } from './motion';
import { useState } from 'react';
import { Action, PlayerView } from '../net/protocol';
import { Avatar, copyText, posOf, sideOf } from './common';
import { DECK_OPTIONS, DifficultyPicker, LengthPicker, lengthName, PACES, Segmented } from './Home';

const SPOT: Record<string, { left: string; top: string }> = {
  bottom: { left: '50%', top: '100%' },
  top: { left: '50%', top: '0%' },
  left: { left: '4%', top: '50%' },
  right: { left: '96%', top: '50%' },
};

interface Props {
  view: PlayerView;
  send: (a: Action) => void;
  onLeave: () => void;
  netState: string;
  netDetail: string;
}

export function Lobby({ view, send, onLeave, netState, netDetail }: Props) {
  const [copied, setCopied] = useState(false);
  const full = view.seats.every(Boolean);
  // the seat across from you is your partner's
  const partnerSeat = view.you === null ? null : (view.you + 2) % 4;
  const link = `${location.origin}${location.pathname}?room=${view.roomCode}`;

  const copy = async () => {
    if (await copyText(link)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  return (
    <div className="lobby">
      <div className="lobby-inner">
        <div className="label">Table code</div>
        <div className="room-code">
          {view.roomCode.split('').map((ch, i) => (
            <motion.div
              key={i}
              className="ch"
              initial={{ rotateY: 90, opacity: 0 }}
              animate={{ rotateY: 0, opacity: 1 }}
              transition={{ delay: 0.1 + i * 0.09, type: 'spring', stiffness: 200, damping: 15 }}
            >
              {ch}
            </motion.div>
          ))}
        </div>
        {view.isHost && (
          <div className="row" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn small" onClick={copy}>
              {copied ? '✓ Link copied' : 'Copy invite link'}
            </button>
            <NetBadge state={netState} detail={netDetail} />
          </div>
        )}

        <div className="lobby-table">
          <div className="oval">
            <div className="watermark">升级</div>
          </div>
          {view.seats.map((seat, i) => {
            const pos = posOf(i, view.you);
            const side = sideOf(i, view.you);
            return (
              <div key={i} className={`lobby-seat ${seat ? 'plate' : 'empty'}`} style={SPOT[pos]}>
                <AnimatePresence mode="popLayout" initial={false}>
                  {seat ? (
                    <motion.div
                      // keyed by seat occupant type, not name: renaming must not replay the enter/exit animation
                      key={seat.isBot ? 'bot' : 'person'}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      <Avatar seat={seat} side={side} />
                      {i === view.you ? (
                        <NameEditor name={seat.name} onSave={(name) => send({ type: 'rename', name })} />
                      ) : (
                        <div className="nm">{seat.name}</div>
                      )}
                      <div className="team-tag" style={{ color: side === 'us' ? 'var(--us)' : 'var(--them)' }}>
                        {side === 'us' ? 'Your team' : 'Opponents'}
                        {seat.isBot && ' · bot'}
                        {!seat.online && ' · offline'}
                      </div>
                      {view.isHost && !seat.isHost && (
                        <div className="actions">
                          {partnerSeat !== null && i !== partnerSeat && (
                            <button className="btn small" onClick={() => send({ type: 'swap', a: i, b: partnerSeat })}>
                              Make partner
                            </button>
                          )}
                          <button className="btn small ghost" onClick={() => send({ type: 'removeSeat', seat: i })}>
                            Remove
                          </button>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
                    >
                      <div style={{ color: 'var(--ink-dim)', fontSize: 13 }}>
                        {i === partnerSeat ? 'Partner seat' : 'Open seat'}
                      </div>
                      <div className="actions">
                        {view.isHost && (
                          <button className="btn small" onClick={() => send({ type: 'addBot', seat: i })}>
                            + Bot
                          </button>
                        )}

                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>

        {/* phones: the oval has no room for four seat cards, so seats are a list grouped by team */}
        <SeatList view={view} send={send} partnerSeat={partnerSeat} />

        {view.isHost ? (
          <div className="plate settings-row">
            <LengthPicker id="lobby-len" value={view.settings.startLevel} onChange={(startLevel) => send({ type: 'settings', settings: { startLevel } })} />
            <div className="opt-row">
              <span className="label">Decks</span>
              <Segmented
                id="lobby-decks"
                options={DECK_OPTIONS.map((d) => ({ value: d.decks, label: d.label }))}
                value={view.settings.decks ?? 2}
                onChange={(decks) => send({ type: 'settings', settings: { decks } })}
              />
            </div>
            <div className="opt-note">{DECK_OPTIONS.find((d) => d.decks === (view.settings.decks ?? 2))!.note}</div>
            <DifficultyPicker id="lobby-diff" value={view.settings.difficulty ?? 'hard'} onChange={(difficulty) => send({ type: 'settings', settings: { difficulty } })} />
            <div className="opt-row">
              <span className="label">Pace</span>
              <Segmented
                id="lobby-pace"
                options={PACES.map((p) => ({ value: p.pace, label: p.label }))}
                value={view.settings.pace}
                onChange={(pace) => send({ type: 'settings', settings: { pace } })}
              />
            </div>
          </div>
        ) : (
          <div className="foot">
            {lengthName(view.settings.startLevel)} · {view.rules.decks} decks · {view.settings.difficulty ?? 'hard'} bots · {view.settings.pace} pace
          </div>
        )}

        <div className="row">
          <button className="btn" onClick={onLeave}>
            Leave
          </button>
          {view.isHost ? (
            <button className="btn primary" disabled={!full} onClick={() => send({ type: 'start' })}>
              {full ? 'Deal the cards' : 'Fill all four seats to deal'}
            </button>
          ) : (
            <div className="status-pill">
              <div className="spinner" /> Waiting for the host to deal
            </div>
          )}
        </div>
        {view.error && <div className="err">{view.error.text}</div>}
      </div>
    </div>
  );
}

export function NetBadge({ state, detail }: { state: string; detail: string }) {
  const label =
    state === 'online' ? 'Live — friends can join' : state === 'connecting' ? detail || 'Opening table…' : detail || 'Offline';
  return (
    <div className="status-pill" style={{ padding: '6px 12px', fontSize: 13 }}>
      <span className="dot" style={{ background: state === 'online' ? '#7ee08f' : state === 'error' ? '#ff8f80' : '#f5cf5b' }} />
      {label}
    </div>
  );
}

/** Your own name in the lobby, editable until the cards are dealt. */
function NameEditor({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const save = () => {
    const n = draft.trim();
    if (n && n !== name) onSave(n);
    setEditing(false);
  };
  if (!editing) {
    return (
      <button
        className="nm name-edit"
        title="Change your name"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
      >
        {name} <span className="you">(you)</span> <span className="pen">✎</span>
      </button>
    );
  }
  return (
    <form
      className="name-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <input
        className="input"
        value={draft}
        maxLength={16}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
      />
    </form>
  );
}

function SeatList({ view, send, partnerSeat }: { view: PlayerView; send: (a: Action) => void; partnerSeat: number | null }) {
  const you = view.you ?? 0;
  const groups = [
    { label: 'Your team', seats: [you, (you + 2) % 4], side: 'us' as const },
    { label: 'Opponents', seats: [(you + 1) % 4, (you + 3) % 4], side: 'them' as const },
  ];
  return (
    <div className="seat-list">
      {groups.map((g) => (
        <div key={g.label} className="seat-group">
          <div className="team-tag" style={{ color: g.side === 'us' ? 'var(--us)' : 'var(--them)' }}>
            {g.label}
          </div>
          {g.seats.map((i) => {
            const seat = view.seats[i];
            return (
              <div key={i} className={`seat-row ${seat ? 'plate' : 'empty'}`}>
                {seat ? (
                  <>
                    <Avatar seat={seat} side={g.side} size={34} />
                    <div className="who">
                      {i === view.you ? (
                        <NameEditor name={seat.name} onSave={(name) => send({ type: 'rename', name })} />
                      ) : (
                        <div className="nm">{seat.name}</div>
                      )}
                      <div className="meta">
                        {i === partnerSeat ? 'partner' : i === view.you ? 'tap your name to change it' : 'opponent'}
                        {seat.isBot && ' · bot'}
                        {!seat.online && ' · offline'}
                      </div>
                    </div>
                    {view.isHost && !seat.isHost && (
                      <div className="actions">
                        {partnerSeat !== null && i !== partnerSeat && (
                          <button className="btn small" onClick={() => send({ type: 'swap', a: i, b: partnerSeat })}>
                            Make partner
                          </button>
                        )}
                        <button className="btn small ghost" title="Remove" onClick={() => send({ type: 'removeSeat', seat: i })}>
                          ✕
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="who">
                      <div className="nm" style={{ color: 'var(--ink-dim)', fontWeight: 500 }}>
                        {i === partnerSeat ? 'Partner seat' : 'Open seat'}
                      </div>
                    </div>
                    {view.isHost && (
                      <div className="actions">
                        <button className="btn small" onClick={() => send({ type: 'addBot', seat: i })}>
                          + Bot
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
