import { useCallback, useEffect, useState } from "react";
import { api, hasParentToken, OFFLINE_MESSAGE, setParentToken, useAction, useLiveState } from "./api.js";
import Child from "./Child.jsx";
import Parent from "./Parent.jsx";
import { SketchDefs } from "./Bear.jsx";
import { Icon } from "./Icons.jsx";

function initialRole() {
  const q = new URLSearchParams(location.search).get("role");
  return q === "parent" && hasParentToken() ? "parent" : q === "parent" ? "pin" : "child";
}

export default function App() {
  const [role, setRole] = useState(initialRole);
  const [toasts, setToasts] = useState([]);
  const [updated, setUpdated] = useState(false);
  const [parentOffline, setParentOffline] = useState(false);
  const toast = useCallback((text, tone = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  useEffect(() => {
    const url = new URL(location.href);
    if (role === "parent" || role === "pin") url.searchParams.set("role", "parent");
    else url.searchParams.delete("role");
    history.replaceState(null, "", url);
  }, [role]);
  const lock = useCallback(() => { setParentToken(null); setRole("pin"); }, []);
  const kidView = () => { setParentToken(null); setRole("child"); };
  useEffect(() => {
    window.addEventListener("mq:unauthorized", lock);
    const onUpdate = () => setUpdated(true);
    navigator.serviceWorker?.addEventListener("controllerchange", onUpdate);
    return () => {
      window.removeEventListener("mq:unauthorized", lock);
      navigator.serviceWorker?.removeEventListener("controllerchange", onUpdate);
    };
  }, [lock]);

  return (
    <div className={`app role-${role}`}>
      <SketchDefs />
      <a className="skip" href="#main">Skip to content</a>
      {role !== "child" && (
        <header className="appbar">
          <div className="brand">
            <img className="brand-mark" src="/bear/poses/bear_front.png" alt="" />
            <span>MoneyQuest</span>
            <span className="brand-sub">for grown-ups</span>
          </div>
          {role === "parent" && parentOffline && <span className="offline-pill" role="status">Offline</span>}
          {role === "parent" && <button className="pbtn" onClick={lock}>Lock</button>}
          <button className="pbtn" onClick={kidView}>Back to kid view</button>
        </header>
      )}
      {role === "child" && <ChildRoot toast={toast} onGrownUps={lock} />}
      {role === "parent" && <ParentRoot toast={toast} onConnection={setParentOffline} />}
      {role === "pin" && <PinGate onOk={() => setRole("parent")} onCancel={kidView} />}
      <div className="toasts" aria-live="polite">
        {updated && <button className="toast ok" onClick={() => location.reload()}>Updated! Tap to reload</button>}
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.tone === "ok" && <Icon name="sparkle" size={18} />}{t.text}</div>)}
      </div>
    </div>
  );
}

function Loading({ error }) {
  return <div className="loading"><img className="loading-bear" src="/bear/poses/bear_front.png" alt="" />{error ? "Can't reach MoneyQuest right now. Check your connection and try again." : "Packing the backpack…"}</div>;
}

function ChildRoot({ toast, onGrownUps }) {
  const { state, error, offline } = useLiveState("child");
  const hasState = Boolean(state);
  useEffect(() => {
    if (offline && hasState) toast(OFFLINE_MESSAGE);
  }, [offline, hasState, toast]);
  if (!state) return <Loading error={error} />;
  return <Child state={state} toast={toast} offline={offline} onGrownUps={onGrownUps} />;
}

function ParentRoot({ toast, onConnection }) {
  const { state, error, offline } = useLiveState("parent");
  useEffect(() => {
    onConnection(offline);
  }, [offline, onConnection]);
  if (!state) return <Loading error={error?.status === 401 ? null : error} />;
  return <Parent state={state} toast={toast} />;
}

function PinGate({ onOk, onCancel }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [run, busy] = useAction((message) => setErr(message === "Wrong PIN" ? "That PIN doesn't match. The demo PIN is 1234." : message));
  const submit = (e) => {
    e.preventDefault();
    run(async () => {
      const { token } = await api("parent/login", { pin });
      setParentToken(token);
      onOk();
    });
  };
  return (
    <main className="pin-page" id="main">
      <form onSubmit={submit} className="pin-card">
        <h1>Grown-ups only</h1>
        <p>Enter the parent PIN to manage allowance, goals and approvals.</p>
        <label>Parent PIN<input type="password" inputMode="numeric" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} maxLength={8} /></label>
        {err && <p className="err">{err}</p>}
        <div className="row">
          <button type="button" className="pbtn" onClick={onCancel}>Back to kid view</button>
          <button className="pbtn primary" disabled={busy}>Unlock</button>
        </div>
        <small>Demo PIN: 1234</small>
      </form>
    </main>
  );
}
