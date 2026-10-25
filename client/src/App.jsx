import { useCallback, useEffect, useState } from "react";
import { api, hasParentToken, setParentToken, useLiveState } from "./api.js";
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
  const toast = useCallback((text, tone = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  useEffect(() => {
    const url = new URL(location.href);
    if (role === "parent") url.searchParams.set("role", "parent");
    else url.searchParams.delete("role");
    history.replaceState(null, "", url);
  }, [role]);

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
          <button className="pbtn" onClick={() => setRole("child")}>Back to kid view</button>
        </header>
      )}
      {role === "child" && <ChildRoot toast={toast} onGrownUps={() => setRole(hasParentToken() ? "parent" : "pin")} />}
      {role === "parent" && <ParentRoot toast={toast} onLocked={() => setRole("pin")} />}
      {role === "pin" && <PinGate onOk={() => setRole("parent")} onCancel={() => setRole("child")} />}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.tone === "ok" && <Icon name="sparkle" size={18} />}{t.text}</div>)}
      </div>
    </div>
  );
}

function Loading({ error }) {
  return <div className="loading"><img className="loading-bear" src="/bear/poses/bear_front.png" alt="" />{error ? `Can't reach the MoneyQuest server. Check that it's running on port 8787. (${error.message})` : "Packing the backpack…"}</div>;
}

function ChildRoot({ toast, onGrownUps }) {
  const { state, error } = useLiveState("child");
  if (!state) return <Loading error={error} />;
  return <Child state={state} toast={toast} onGrownUps={onGrownUps} />;
}

function ParentRoot({ toast, onLocked }) {
  const { state, error } = useLiveState("parent");
  useEffect(() => {
    if (error?.status === 401) {
      setParentToken(null);
      onLocked();
    }
  }, [error, onLocked]);
  if (!state) return <Loading error={error?.status === 401 ? null : error} />;
  return <Parent state={state} toast={toast} />;
}

function PinGate({ onOk, onCancel }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    try {
      const { token } = await api("parent/login", { pin });
      setParentToken(token);
      onOk();
    } catch (e2) {
      setErr(e2.message === "Wrong PIN" ? "That PIN doesn't match. The demo PIN is 1234." : e2.message);
    }
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
          <button className="pbtn primary">Unlock</button>
        </div>
        <small>Demo PIN: 1234</small>
      </form>
    </main>
  );
}
