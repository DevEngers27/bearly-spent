import { useCallback, useEffect, useRef, useState } from "react";
import { api, cachedChildSession, clearSessionCache, OFFLINE_MESSAGE, rememberSession, setSelectedChild, useAction, useLiveState } from "./api.js";
import Child, { Sheet } from "./Child.jsx";
import Parent from "./Parent.jsx";
import { SketchDefs } from "./Bear.jsx";
import { Icon } from "./Icons.jsx";

export default function App() {
  const [me, setMe] = useState(null);
  const [view, setView] = useState("loading");
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [updated, setUpdated] = useState(false);
  const [parentOffline, setParentOffline] = useState(false);
  const authVersion = useRef(0);
  const toast = useCallback((text, tone = "ok") => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  const acceptSession = useCallback((next, restoring = false) => {
    let selected, savedMode;
    try {
      selected = localStorage.getItem("mq_selected_child");
      if (restoring) savedMode = localStorage.getItem("mq_parent_mode");
    } catch {}
    clearSessionCache();
    const activeChild = next.children.find((c) => c.id === selected) || next.activeChild;
    next = { ...next, activeChild };
    setSelectedChild(activeChild.id);
    rememberSession(next);
    try { localStorage.setItem("mq_selected_child", activeChild.id); } catch {}
    setMe(next);
    setError(null);
    const kidMode = next.role === "parent" && savedMode === "kid";
    const locked = next.role === "parent" && !kidMode && next.family.pinSet && (next.unlockedUntil <= Date.now() || savedMode === "locked");
    setPinOpen(locked);
    setView(next.role === "child" || locked || kidMode ? "kid" : "parent");
    if (next.demo === true) setDemo(true);
  }, []);
  const welcome = useCallback(() => {
    authVersion.current++;
    clearSessionCache();
    setMe(null);
    setPinOpen(false);
    setView("welcome");
  }, []);
  useEffect(() => {
    const unauthorized = () => welcome();
    const locked = () => { setView("kid"); setPinOpen(true); };
    const limited = (event) => toast(event.message, "error");
    const onUpdate = () => setUpdated(true);
    window.addEventListener("mq:unauthorized", unauthorized);
    window.addEventListener("mq:locked", locked);
    window.addEventListener("mq:rate-limit", limited);
    navigator.serviceWorker?.addEventListener("controllerchange", onUpdate);
    return () => {
      window.removeEventListener("mq:unauthorized", unauthorized);
      window.removeEventListener("mq:locked", locked);
      window.removeEventListener("mq:rate-limit", limited);
      navigator.serviceWorker?.removeEventListener("controllerchange", onUpdate);
    };
  }, [welcome, toast]);
  useEffect(() => {
    let active = true;
    const version = authVersion.current;
    api("auth/me").then((next) => {
      if (!active || version !== authVersion.current) return;
      if (next.demo === true) setDemo(true);
      if (!next.role) { welcome(); return; }
      acceptSession(next, true);
    }).catch((err) => {
      if (!active) return;
      if (err.demo) setDemo(true);
      if (err.status === 401) { setView("welcome"); return; }
      if (version !== authVersion.current) return;
      const cached = !err.status && cachedChildSession();
      if (cached) {
        setSelectedChild(cached.activeChild.id);
        setMe(cached);
        setView("kid");
      } else { setError(err); setView("welcome"); }
    });
    return () => { active = false; };
  }, [acceptSession, welcome]);
  useEffect(() => {
    const url = new URL(location.href);
    if (view === "parent" || pinOpen) url.searchParams.set("role", "parent");
    else url.searchParams.delete("role");
    history.replaceState(null, "", url);
    if (me?.role === "parent") {
      try { localStorage.setItem("mq_parent_mode", pinOpen ? "locked" : view === "kid" ? "kid" : "parent"); } catch {}
    }
  }, [view, pinOpen, me?.role]);
  const signOut = async () => {
    await api("auth/logout", {});
    welcome();
  };
  const enterParent = () => {
    if (me?.role !== "parent") return;
    if (me.family.pinSet) { setView("kid"); setPinOpen(true); }
    else { setView("parent"); toast("Set a PIN in Security for quick grown-up switches."); }
  };
  const selectChild = (id) => {
    const activeChild = me.children.find((c) => c.id === id);
    if (!activeChild) return;
    setSelectedChild(id);
    try { localStorage.setItem("mq_selected_child", id); } catch {}
    setMe({ ...me, activeChild });
    setParentOffline(false);
  };
  const refreshMe = async () => {
    const next = await api("auth/me");
    setMe(next);
    rememberSession(next);
  };

  return (
    <div className={`app role-${view === "kid" ? "child" : view}`}>
      <SketchDefs />
      <a className="skip" href="#main">Skip to content</a>
      {me?.role === "parent" && view === "parent" && (
        <header className="appbar">
          <div className="brand"><img className="brand-mark" src="/bear/poses/bear_front.png" alt="" /><span>MoneyQuest</span><span className="brand-sub">for grown-ups</span></div>
          <label className="child-switcher">Child<select value={me.activeChild.id} onChange={(e) => selectChild(e.target.value)}>{me.children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</select></label>
          {parentOffline && <span className="offline-pill" role="status">Offline</span>}
          {me.family.pinSet && <button className="pbtn" onClick={enterParent}>Lock</button>}
          <button className="pbtn" onClick={() => setView("kid")}>Kid mode</button>
          <SignOut onSignOut={signOut} toast={toast} />
        </header>
      )}
      {view === "loading" && <Loading />}
      {!me && view !== "loading" && <AuthScreen key={view} screen={view} navigate={setView} demo={demo} onSession={acceptSession} error={error} />}
      {me && view === "kid" && <ChildRoot key={me.activeChild.id} childId={me.activeChild.id} toast={toast} onGrownUps={me.role === "parent" ? enterParent : undefined} onSignOut={me.role === "child" ? signOut : undefined} />}
      {me?.role === "parent" && view === "parent" && <ParentRoot key={me.activeChild.id} childId={me.activeChild.id} me={me} refreshMe={refreshMe} onSignOut={signOut} toast={toast} onConnection={setParentOffline} />}
      {me?.role === "parent" && pinOpen && <PinGate onOk={(result) => { setMe({ ...me, unlockedUntil: result.unlockedUntil }); setPinOpen(false); setView("parent"); }} onCancel={() => { setPinOpen(false); setView("kid"); }} />}
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

function SignOut({ onSignOut, toast }) {
  const [run, busy] = useAction(toast);
  return <button className="pbtn" disabled={busy} onClick={() => run(onSignOut)}>Sign out</button>;
}

function ChildRoot({ childId, toast, onGrownUps, onSignOut }) {
  const { state, error, offline } = useLiveState("child", childId);
  const hasState = Boolean(state);
  useEffect(() => {
    if (offline && hasState) toast(OFFLINE_MESSAGE);
  }, [offline, hasState, toast]);
  if (!state) return <Loading error={error} />;
  return <><Child state={state} toast={toast} offline={offline} onGrownUps={onGrownUps} />{onSignOut && <div className="kid-signout"><SignOut onSignOut={onSignOut} toast={toast} /></div>}</>;
}

function ParentRoot({ childId, me, refreshMe, onSignOut, toast, onConnection }) {
  const { state, error, offline } = useLiveState("parent", childId);
  useEffect(() => { onConnection(offline); }, [offline, onConnection]);
  if (!state) return <Loading error={error} />;
  return <Parent state={state} me={me} refreshMe={refreshMe} onSignOut={onSignOut} toast={toast} offline={offline} />;
}

function AuthScreen({ screen, navigate, demo, onSession, error }) {
  const [fields, setFields] = useState({ parentName: "", email: "", password: "", childName: "", childAge: "9", bearName: "", code: "" });
  const [err, setErr] = useState("");
  const [run, busy] = useAction((message) => setErr(message));
  const field = (key) => ({ value: fields[key], onChange: (e) => setFields({ ...fields, [key]: e.target.value }) });
  const login = async (path, body) => {
    setErr("");
    const result = await run(path, body);
    if (result) onSession(result);
  };
  const submit = (event) => {
    event.preventDefault();
    if (screen === "create") {
      const { code, ...body } = fields;
      return login("auth/register", { ...body, childAge: Number(fields.childAge), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    } else if (screen === "link") return login("auth/link", { code: fields.code.toUpperCase() });
    else return login("auth/login", { email: fields.email, password: fields.password });
  };
  return (
    <main className="pin-page auth-page" id="main">
      <section className="pin-card auth-card">
        <img className="auth-bear" src="/bear/poses/bear_front.png" alt="" />
        <h1>{screen === "welcome" ? "Welcome to MoneyQuest" : screen === "create" ? "Create your family" : screen === "link" ? "Your adventure starts here" : "Welcome back"}</h1>
        {screen === "welcome" ? <>
          <p>Save a little. Learn a lot. Grow together.</p>
          {error && <p role="alert">Can't connect right now. Check your connection and try again.</p>}
          <button className="btn honey wide" onClick={() => navigate("signin")}>Sign in</button>
          <button className="btn sage wide" onClick={() => navigate("create")}>Create family</button>
          <button className="btn wide" onClick={() => navigate("link")}>I have a kid code</button>
          {demo && <button className="link" disabled={busy} onClick={() => login("demo/login", {})}>Try the demo family</button>}
        </> : <form className="auth-form" onSubmit={submit}>
          {screen === "create" && <label>Your name<input autoComplete="name" required maxLength={64} {...field("parentName")} /></label>}
          {screen !== "link" && <>
            <label>Email<input type="email" autoComplete="username" required maxLength={254} {...field("email")} /></label>
            <label>Password<input type="password" autoComplete={screen === "create" ? "new-password" : "current-password"} required minLength={screen === "create" ? 8 : undefined} maxLength={1024} {...field("password")} /></label>
          </>}
          {screen === "create" && <>
            <p>Let's meet your first saver. You can add more children later.</p>
            <label>Child's name<input required maxLength={24} {...field("childName")} /></label>
            <label>Age<select {...field("childAge")}>{[7, 8, 9, 10, 11, 12].map((age) => <option key={age} value={age}>{age}</option>)}</select></label>
            <label>Bear's name<input required maxLength={24} {...field("bearName")} /></label>
          </>}
          {screen === "link" && <>
            <p>Ask your grown-up for your six-character kid code.</p>
            <label>Kid code<input className="kid-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} required minLength={6} maxLength={6} value={fields.code} onChange={(e) => setFields({ ...fields, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) })} /></label>
            <div className="code-keys" aria-label="Code keyboard">{"BCDFGHJKMNPQRTVWXY346789".split("").map((key) => <button className="pbtn" type="button" key={key} disabled={busy || fields.code.length === 6} onClick={() => setFields({ ...fields, code: fields.code + key })}>{key}</button>)}<button className="pbtn" type="button" disabled={busy} onClick={() => setFields({ ...fields, code: fields.code.slice(0, -1) })}>Delete</button></div>
          </>}
          <button className="btn honey wide" disabled={busy}>{screen === "create" ? "Create family" : screen === "link" ? "Let's go!" : "Sign in"}</button>
          <button className="link" type="button" disabled={busy} onClick={() => navigate("welcome")}>Back to welcome</button>
        </form>}
        {err && <p className="err" role="alert">{err}</p>}
      </section>
    </main>
  );
}

function PinGate({ onOk, onCancel }) {
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [run, busy] = useAction((message) => setErr(message));
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    const result = await run("parent/unlock", { pin });
    if (result) onOk(result);
  };
  return (
    <Sheet title="Grown-ups only" onClose={onCancel}>
      <form onSubmit={submit} className="pform">
        <p>Enter your PIN to manage allowance, goals and approvals.</p>
        <label>Parent PIN<input type="password" inputMode="numeric" autoComplete="off" autoFocus required pattern="[0-9]{4,8}" minLength={4} maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)} /></label>
        {err && <p className="neg" role="alert">{err}</p>}
        <div className="row"><button type="button" className="pbtn" onClick={onCancel}>Back to kid view</button><button className="pbtn primary" disabled={busy}>Unlock</button></div>
      </form>
    </Sheet>
  );
}
