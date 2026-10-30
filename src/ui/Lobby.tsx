import { AnimatePresence, motion } from 'framer-motion';
import { useState } from 'react';
import { Action, PlayerView } from '../net/protocol';
import { Avatar, copyText, posOf, sideOf } from './common';
import { LENGTHS, PACES, Segmented } from './Home';

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
                      key={seat.name + seat.isBot}
                      initial={{ scale: 0.6, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 260, damping: 18 }}
                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, width: '100%' }}
                    >
                      <Avatar seat={seat} side={side} />
                      <div className="nm">
                        {seat.name}
                        {i === view.you ? ' (you)' : ''}
                      </div>
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

        {view.isHost ? (
          <div className="plate settings-row">
            <div className="opt-row">
              <span className="label">Length</span>
              <Segmented
                id="lobby-len"
                options={LENGTHS.map((l) => ({ value: l.level, label: l.label }))}
                value={view.settings.startLevel}
                onChange={(startLevel) => send({ type: 'settings', settings: { startLevel } })}
              />
            </div>
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
            {LENGTHS.find((l) => l.level === view.settings.startLevel)?.label} game · {view.settings.pace} pace
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
