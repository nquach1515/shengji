import { AnimatePresence } from 'framer-motion';
import { motion } from './motion';
import { DisplayProvider } from './display';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { clearSavedHost, HostController, loadSavedHost, randomCode } from '../net/host';
import { GameConnection, getClientId, LocalConnection, RemoteConnection } from '../net/client';
import { Home } from './Home';
import { StageContext, useStageSize } from './stage';
import { Settings } from '../net/protocol';
import { Lobby } from './Lobby';
import { Table } from './Table';

export type StartMode =
  | { kind: 'host' }
  | { kind: 'practice'; settings: Settings }
  | { kind: 'join'; code: string }
  | { kind: 'resume' };

function useConnection(conn: GameConnection | null) {
  const subscribe = useCallback((fn: () => void) => (conn ? conn.subscribe(fn) : () => {}), [conn]);
  const view = useSyncExternalStore(subscribe, () => conn?.view() ?? null);
  const status = useSyncExternalStore(subscribe, () => {
    const s = conn?.status();
    return s ? `${s.state}|${s.detail}` : '';
  });
  const [state, detail] = status.split('|');
  return { view, status: { state, detail } };
}

export function App() {
  const [conn, setConn] = useState<GameConnection | null>(null);
  const { view, status } = useConnection(conn);
  const stage = useStageSize();

  const start = (mode: StartMode, name: string) => {
    const clientId = getClientId();
    let c: GameConnection;
    if (mode.kind === 'join') {
      c = new RemoteConnection(mode.code.toUpperCase(), clientId, name);
      setRoomInUrl(mode.code.toUpperCase());
    } else if (mode.kind === 'resume') {
      const saved = loadSavedHost()!;
      c = new LocalConnection(new HostController(saved.code, clientId, name, true, saved));
      setRoomInUrl(saved.code);
    } else if (mode.kind === 'host') {
      clearSavedHost();
      const code = randomCode();
      c = new LocalConnection(new HostController(code, clientId, name, true));
      setRoomInUrl(code);
    } else {
      const host = new HostController('SOLO', clientId, name, false, undefined, mode.settings);
      for (const seat of [1, 2, 3]) host.handle(clientId, { type: 'addBot', seat });
      host.handle(clientId, { type: 'start' });
      c = new LocalConnection(host);
    }
    setConn(c);
  };

  const leave = () => {
    if (conn instanceof LocalConnection && conn.host.online) clearSavedHost();
    conn?.leave();
    setConn(null);
    setRoomInUrl(null);
  };

  let screen: JSX.Element;
  let key: string;
  if (!conn) {
    key = 'home';
    screen = <Home onStart={start} />;
  } else if (!view) {
    key = 'connecting';
    screen = <Connecting state={status.state} detail={status.detail} onCancel={leave} />;
  } else if (view.phase === 'lobby') {
    key = 'lobby';
    screen = <Lobby view={view} send={(a) => conn.send(a)} onLeave={leave} netState={status.state} netDetail={status.detail} />;
  } else {
    key = 'table';
    screen = <Table view={view} send={(a) => conn.send(a)} onLeave={leave} netState={status.state} netDetail={status.detail} />;
  }

  return (
    <StageContext.Provider value={stage}>
      <DisplayProvider>
      <div className="felt" />
      {/* phones (scale 1) take the full height from CSS, which the browser keeps right as toolbars and the keyboard
          come and go; scaled layouts need the measured size */}
      <div className="stage" style={stage.scale === 1 ? { inset: 0 } : { width: stage.w, height: stage.h, transform: `scale(${stage.scale})` }}>
      <AnimatePresence mode="wait">
        <motion.div
          key={key}
          className="screen"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 1.02 }}
          transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
        >
          {screen}
        </motion.div>
      </AnimatePresence>
      </div>
      </DisplayProvider>
    </StageContext.Provider>
  );
}

function setRoomInUrl(code: string | null) {
  const url = new URL(window.location.href);
  if (code) url.searchParams.set('room', code);
  else url.searchParams.delete('room');
  window.history.replaceState(null, '', url);
}

function Connecting({ state, detail, onCancel }: { state: string; detail: string; onCancel: () => void }) {
  return (
    <div className="home">
      <motion.div className="panel mode-card" style={{ width: 'min(380px, 100%)', alignItems: 'center' }} initial={{ y: 20 }} animate={{ y: 0 }}>
        {state === 'rejected' || state === 'error' ? (
          <div className="err">{detail || 'Could not connect'}</div>
        ) : (
          <div className="row">
            <div className="spinner" />
            <span>{detail || 'Finding the table…'}</span>
          </div>
        )}
        <button className="btn small" onClick={onCancel}>
          Back
        </button>
      </motion.div>
    </div>
  );
}
