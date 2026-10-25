import { useCallback, useEffect, useRef, useState } from "react";
import { api, cachedChildSession, cachedParentSession, formatTime, clearSessionCache, offlineMessage, rememberSession, setSelectedChild, useAction, useLiveState } from "./api.js";
import Child, { Sheet } from "./Child.jsx";
import Parent from "./Parent.jsx";
import { SketchDefs } from "./Bear.jsx";
import { Icon } from "./Icons.jsx";

const hadControllerAtLoad = Boolean(navigator.serviceWorker?.controller);

export default function App() {
  const [welcomeHint, setWelcomeHint] = useState("");
  const [me, setMe] = useState(null);
  const [view, setView] = useState("loading");
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState(null);
  const [pinOpen, setPinOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [updated, setUpdated] = useState(false);
  const [parentOffline, setParentOffline] = useState(false);
  const authVersion = useRef(0);
  const resettingChild = useRef(false);
  const retryAuth = useRef(() => {});
  const welcomeDiscovery = useRef(false);
  const toast = useCallback((text, tone = "ok") => {
    const id = Math.random();
    setToasts([{ id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  const acceptSession = useCallback((next, restoring = false) => {
    authVersion.current++;
    let selected, savedMode;
    try {
      selected = localStorage.getItem("mq_selected_child");
      if (restoring) savedMode = localStorage.getItem("mq_parent_mode");
    } catch {}
    const activeChild = next.children.find((c) => c.id === selected) || next.activeChild;
    const previous = cachedParentSession() || cachedChildSession();
    clearSessionCache({ preserveChildPreferences: restoring && previous?.role === next.role && previous?.activeChild.id === activeChild.id });
    next = { ...next, activeChild };
    setSelectedChild(activeChild.id);
    rememberSession(next);
    try { localStorage.setItem("mq_selected_child", activeChild.id); } catch {}
    setMe(next);
    setWelcomeHint("");
    setError(null);
    const kidMode = next.role === "parent" && savedMode === "kid";
    const locked = next.role === "parent" && !kidMode && next.family.pinSet && (next.unlockedUntil <= Date.now() || savedMode === "locked");
    setPinOpen(locked);
    setView(next.role === "child" || locked || kidMode ? "kid" : "parent");
    setDemo(next.demo === true);
  }, []);
  const welcome = useCallback(() => {
    authVersion.current++;
    clearSessionCache();
    setMe(null);
    setError(null);
    setPinOpen(false);
    setView("welcome");
  }, []);
  useEffect(() => {
    const unauthorized = () => { welcomeDiscovery.current = false; welcome(); };
    const locked = () => { if (view === "parent") { setView("kid"); setPinOpen(true); } };
    const limited = (event) => toast(event.message, "error");
    const resetChild = async () => {
      if (!me || resettingChild.current) return;
      resettingChild.current = true;
      const version = authVersion.current;
      try {
        // Omitting the selection asks the server for its current first child,
        // even if the stored selection or cached children list is stale.
        const next = await api("auth/me", undefined, { includeChild: false });
        if (version !== authVersion.current) return;
        const activeChild = next.children[0];
        if (!activeChild) { setSelectedChild(null); return; }
        setSelectedChild(activeChild.id);
        try { localStorage.setItem("mq_selected_child", activeChild.id); } catch {}
        const recovered = { ...next, activeChild };
        setMe(recovered);
        rememberSession(recovered);
        setParentOffline(false);
      } catch (err) {
        if (version === authVersion.current && err.status !== 401) toast(err.message, "error");
      } finally { resettingChild.current = false; }
    };
    // A new build may ship new art under new paths; reload right away unless the kid is typing.
    const onUpdate = () => {
      if (!hadControllerAtLoad) return;
      const typing = ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName);
      if (typing || typeof location.reload !== "function") setUpdated(true);
      else setTimeout(() => location.reload(), 600);
    };
    window.addEventListener("mq:unauthorized", unauthorized);
    window.addEventListener("mq:locked", locked);
    window.addEventListener("mq:rate-limit", limited);
    window.addEventListener("mq:child-reset", resetChild);
    navigator.serviceWorker?.addEventListener("controllerchange", onUpdate);
    return () => {
      window.removeEventListener("mq:unauthorized", unauthorized);
      window.removeEventListener("mq:locked", locked);
      window.removeEventListener("mq:rate-limit", limited);
      window.removeEventListener("mq:child-reset", resetChild);
      navigator.serviceWorker?.removeEventListener("controllerchange", onUpdate);
    };
  }, [me, view, welcome, toast]);
  useEffect(() => {
    let active = true, inflight = false, done = false;
    const version = authVersion.current;
    const restore = async () => {
      if (!active || inflight || done || version !== authVersion.current) return;
      inflight = true;
      try {
        const next = await api("auth/me", undefined, { handleUnauthorized: false });
        if (!active || version !== authVersion.current) return;
        if (!["parent", "child"].includes(next.role)) throw new Error("Could not load your session. Try again.");
        done = true;
        setDemo(next.demo === true);
        welcomeDiscovery.current = true;
        acceptSession(next, true);
      } catch (err) {
        if (!active || version !== authVersion.current) return;
        if (err.status === 401) {
          done = true;
          setDemo(err.demo === true);
          welcomeDiscovery.current = true;
          welcome();
          return;
        }
        const cached = !err.status && cachedChildSession();
        if (cached) {
          setSelectedChild(cached.activeChild.id);
          setMe(cached);
          setView("kid");
        } else { setError(err); setView("loading"); }
      } finally { inflight = false; }
    };
    retryAuth.current = restore;
    restore();
    const retry = setInterval(restore, 10000);
    window.addEventListener("online", restore);
    return () => { active = false; clearInterval(retry); window.removeEventListener("online", restore); };
  }, [acceptSession, welcome]);
  const onWelcome = view === "welcome";
  useEffect(() => {
    if (!onWelcome) { welcomeDiscovery.current = false; return; }
    if (welcomeDiscovery.current) return;
    let active = true;
    api("auth/me", undefined, { handleUnauthorized: false }).then((next) => {
      if (active) setDemo(next.demo === true);
    }).catch((err) => {
      if (active) setDemo(err.demo === true);
    });
    return () => { active = false; };
  }, [onWelcome]);
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
    setWelcomeHint(me?.role === "child" ? "You signed out. Ask your grown-up for a new kid code to come back." : "");
    welcomeDiscovery.current = false;
    welcome();
  };
  const signOutAll = async () => {
    await api("auth/logout-all", {});
    welcomeDiscovery.current = false;
    welcome();
  };
  const [runLock, lockBusy] = useAction(toast);
  const leaveParent = (openPin = false) => runLock(async () => {
    if (me.family.pinSet) {
      await api("parent/lock", {});
      const locked = { ...me, unlockedUntil: 0 };
      setMe(locked);
      rememberSession(locked);
    }
    setView("kid");
    setPinOpen(openPin);
    return { ok: true };
  });
  const enterParent = () => {
    if (me?.role !== "parent") return;
    if (me.family.pinSet) {
      if (view === "parent") return leaveParent(true);
      setView("kid"); setPinOpen(true);
    } else { setView("parent"); toast("Set a PIN in Security for quick grown-up switches."); }
  };
  const backToGrownUps = () => {
    const cached = cachedParentSession();
    if (!cached) return;
    setSelectedChild(cached.activeChild.id);
    setMe(cached);
    setPinOpen(cached.family.pinSet);
    setView(cached.family.pinSet ? "kid" : "parent");
  };
  const selectChild = (id) => {
    const activeChild = me.children.find((c) => c.id === id);
    if (!activeChild) return;
    authVersion.current++;
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
          <div className="brand"><img className="brand-mark" src="/bear/w3/poses/bear_front.png" alt="" /><span>Bearly Spent</span><span className="brand-sub">for grown-ups</span><strong className="parent-account-label">{me.activeChild.name}'s account</strong></div>
          <label className={`child-switcher${me.children.length === 1 ? " only-child" : ""}`}><span>Child</span><select aria-label="Child" value={me.activeChild.id} onChange={(e) => selectChild(e.target.value)}>{me.children.map((child) => <option key={child.id} value={child.id}>{child.name}</option>)}</select></label>
          {parentOffline && <span className="offline-pill" role="status">Offline</span>}
          <div className="appbar-actions">
            <button className="pbtn" disabled={lockBusy} onClick={() => leaveParent()}>Kid mode</button>
            <SignOut onSignOut={signOut} toast={toast} />
            {me.family.pinSet && <button className="pbtn" disabled={lockBusy} onClick={enterParent}>Lock</button>}
          </div>
        </header>
      )}
      {view === "loading" && <Loading error={error} onRetry={() => retryAuth.current()} onGrownUps={cachedParentSession() ? backToGrownUps : undefined} />}
      {!me && view !== "loading" && <AuthScreen key={view} screen={view} navigate={setView} demo={demo} onSession={acceptSession} error={error} welcomeHint={welcomeHint} />}
      {me && view === "kid" && <ChildRoot key={me.activeChild.id} childId={me.activeChild.id} toast={toast} onGrownUps={me.role === "parent" ? enterParent : undefined} onSignOut={me.role === "child" ? signOut : undefined} />}
      {me?.role === "parent" && view === "parent" && <ParentRoot key={me.activeChild.id} childId={me.activeChild.id} me={me} refreshMe={refreshMe} onSignOut={signOut} onSignOutAll={signOutAll} toast={toast} onConnection={setParentOffline} />}
      {me?.role === "parent" && pinOpen && <PinGate onOk={(result) => { setMe({ ...me, unlockedUntil: result.unlockedUntil }); setPinOpen(false); setView("parent"); }} onReset={async () => { await refreshMe(); setPinOpen(false); setView("parent"); }} onCancel={() => leaveParent()} />}
      <div className="toasts" aria-live="polite">
        {updated && <div className="toast ok update-toast"><button onClick={() => location.reload()}>Updated! Tap to reload</button><button aria-label="Dismiss update" onClick={() => setUpdated(false)}>×</button></div>}
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.tone === "ok" && <Icon name="sparkle" size={18} />}{t.text}</div>)}
      </div>
    </div>
  );
}

function Loading({ error, onRetry, onGrownUps }) {
  return <div className="loading"><img className="loading-bear" src="/bear/w3/poses/bear_front.png" alt="" />{error ? <>
    <p role="alert">Can't reach Bearly Spent right now. Check your connection and try again.</p>
    <button className="btn honey" onClick={onRetry || (() => location.reload())}>Try again</button>
    {onGrownUps && <button className="btn" onClick={onGrownUps}>Back to grown-ups</button>}
  </> : "Packing the backpack…"}</div>;
}

function SignOut({ onSignOut, toast }) {
  const [run, busy] = useAction(toast);
  return <button className="pbtn" disabled={busy} onClick={() => run(onSignOut)}>Sign out</button>;
}

function ChildRoot({ childId, toast, onGrownUps, onSignOut }) {
  const { state, error, offline, refresh } = useLiveState("child", childId);
  const hasState = Boolean(state);
  const bearName = state?.child.bear.name;
  useEffect(() => {
    if (offline && hasState) toast(offlineMessage(bearName));
  }, [offline, hasState, bearName, toast]);
  if (!state) return <Loading error={error} onRetry={refresh} onGrownUps={onGrownUps} />;
  return <Child state={state} toast={toast} offline={offline} onGrownUps={onGrownUps} onSignOut={onSignOut} />;
}

function ParentRoot({ childId, me, refreshMe, onSignOut, onSignOutAll, toast, onConnection }) {
  const { state, error, offline, refresh } = useLiveState("parent", childId);
  useEffect(() => { onConnection(offline); }, [offline, onConnection]);
  if (!state) return <Loading error={error} onRetry={refresh} />;
  return <Parent state={state} me={me} refreshMe={refreshMe} onSignOut={onSignOut} onSignOutAll={onSignOutAll} toast={toast} offline={offline} />;
}

function AuthScreen({ screen, navigate, demo, onSession, error, welcomeHint }) {
  const [fields, setFields] = useState({ parentName: "", email: "", password: "", code: "" });
  const [children, setChildren] = useState([{ id: 0, name: "", age: "9", bearName: "" }]);
  const nextChildId = useRef(1);
  const [err, setErr] = useState("");
  const [run, busy] = useAction((message) => setErr(message));
  const field = (key) => ({ value: fields[key], onChange: (e) => setFields({ ...fields, [key]: e.target.value }) });
  const login = async (path, body) => {
    setErr("");
    const result = await run(async () => {
      try { return await api(path, body); }
      catch (error) {
        if (path === "auth/link" && error.reason) error.message = error.reason === "unknown" ? "That code doesn't match — check the letters and try again" : "That code was already used or expired. Ask for a new one.";
        throw error;
      }
    });
    if (result) onSession(result);
  };
  const submit = (event) => {
    event.preventDefault();
    if (screen === "create") {
      return login("auth/register", { parentName: fields.parentName, email: fields.email, password: fields.password, children: children.map(({ name, age, bearName }) => ({ name, age: Number(age), bearName })), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC" });
    } else if (screen === "link") return login("auth/link", { code: fields.code.toUpperCase() });
    else return login("auth/login", { email: fields.email, password: fields.password });
  };
  return (
    <main className="pin-page auth-page" id="main">
      <section className="pin-card auth-card">
        <img className="auth-bear" src="/bear/w3/poses/bear_front.png" alt="" />
        <h1>{screen === "welcome" ? "Welcome to Bearly Spent" : screen === "create" ? "Create your family" : screen === "link" ? "Your adventure starts here" : "Welcome back"}</h1>
        {screen === "welcome" ? <>
          <p>Save a little. Learn a lot. Grow together.</p>
          {welcomeHint && <p role="status">{welcomeHint}</p>}
          {error && <p role="alert">Can't connect right now. Check your connection and try again.</p>}
          <button className="btn honey wide" onClick={() => navigate("signin")}>Sign in</button>
          <button className="btn sage wide" onClick={() => navigate("create")}>Create family</button>
          <button className="btn wide" aria-describedby="kid-code-hint" onClick={() => navigate("link")}>I have a kid code</button>
          <p className="fine" id="kid-code-hint">Ask your grown-up for a 6-letter kid code (Parent → Kids)</p>
          {demo && <button className="link" disabled={busy} onClick={() => login("demo/login", {})}>Try the demo family</button>}
          <footer className="auth-help"><a href="/help" target="_blank" rel="noopener noreferrer">Help</a></footer>
        </> : <form className="auth-form" onSubmit={submit}>
          {screen === "create" && <label>Your name<input autoComplete="name" required maxLength={64} {...field("parentName")} /></label>}
          {screen !== "link" && <>
            <label>Email<input type="email" autoComplete="username" required maxLength={254} {...field("email")} /></label>
            <label>Password<input type="password" autoComplete={screen === "create" ? "new-password" : "current-password"} required minLength={screen === "create" ? 8 : undefined} maxLength={1024} {...field("password")} /></label>
          </>}
          {screen === "create" && <>
            <p>Let's meet your savers. Add up to four children.</p>
            {children.map((child, index) => <fieldset className="auth-child" key={child.id} disabled={busy}>
              <legend>Child {index + 1}</legend>
              {[["name", "Child's name"], ["age", "Age"], ["bearName", "Bear's name"]].map(([key, label]) => {
                const props = { value: child[key], onChange: (event) => setChildren((rows) => rows.map((row) => row.id === child.id ? { ...row, [key]: event.target.value } : row)) };
                return <label key={key}>{label}{key === "age" ? <select {...props}>{[7, 8, 9, 10, 11, 12].map((age) => <option key={age} value={age}>{age}</option>)}</select> : <input required maxLength={24} {...props} />}</label>;
              })}
              {children.length > 1 && <button type="button" className="btn" onClick={() => setChildren((rows) => rows.filter((row) => row.id !== child.id))}>Remove child {index + 1}</button>}
            </fieldset>)}
            <button type="button" className="btn sage wide" disabled={busy || children.length >= 4} onClick={() => { const id = nextChildId.current++; setChildren((rows) => rows.length < 4 ? [...rows, { id, name: "", age: "9", bearName: "" }] : rows); }}>Add another child</button>
          </>}
          {screen === "link" && <>
            <p>Ask your grown-up for your six-character kid code.</p>
            <label>Kid code<input className="kid-code" autoComplete="off" autoCapitalize="characters" spellCheck={false} required minLength={6} maxLength={6} value={fields.code} onChange={(e) => setFields({ ...fields, code: e.target.value.toUpperCase().replace(/[^BCDFGHJKMNPQRTVWXY346789]/g, "").slice(0, 6) })} /></label>
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

function PinGate({ onOk, onReset, onCancel }) {
  const [pin, setPin] = useState("");
  const [password, setPassword] = useState("");
  const [forgot, setForgot] = useState(false);
  const [err, setErr] = useState("");
  const [attemptsLeft, setAttemptsLeft] = useState(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [run, busy] = useAction((message) => setErr(message));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const locked = lockedUntil > now;
  const submit = async (e) => {
    e.preventDefault();
    setErr("");
    const result = await run(async () => {
      try { return await api(forgot ? "parent/pin/reset" : "parent/unlock", forgot ? { password } : { pin }); }
      catch (error) {
        if (!forgot) {
          if (error.attemptsLeft !== undefined) setAttemptsLeft(error.attemptsLeft);
          if (error.retryAfterSeconds) setLockedUntil(Date.now() + error.retryAfterSeconds * 1000);
        }
        throw error;
      }
    });
    if (result) {
      setAttemptsLeft(null); setLockedUntil(0);
      if (forgot) await run(onReset);
      else onOk(result);
    }
  };
  return (
    <Sheet title="Grown-ups only" onClose={onCancel}>
      <form onSubmit={submit} className="pform">
        <p>{forgot ? "Use your password to clear the PIN. You can set a new one in Security." : "Enter your PIN to manage allowance, goals and approvals."}</p>
        {forgot ? <label>Password<input type="password" autoComplete="current-password" required maxLength={1024} value={password} onChange={(e) => setPassword(e.target.value)} /></label> : <label>Parent PIN<input type="password" inputMode="numeric" autoComplete="off" autoFocus required pattern="[0-9]{4,8}" minLength={4} maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)} /></label>}
        {!forgot && attemptsLeft > 0 && <p role="status">{attemptsLeft} {attemptsLeft === 1 ? "try" : "tries"} left</p>}
        {!forgot && locked ? <p className="neg" role="alert">Locked for 15 minutes — try again at {formatTime(lockedUntil)}</p> : err && <p className="neg" role="alert">{err}</p>}
        <button className="link" type="button" disabled={busy} onClick={() => { setForgot(!forgot); setErr(""); }}>{forgot ? "Use PIN instead" : "Forgot PIN? Use your password"}</button>
        <div className="row"><button type="button" className="pbtn" disabled={busy} onClick={onCancel}>Back to kid view</button><button className="pbtn primary" disabled={busy || (!forgot && locked)}>{forgot ? "Reset PIN" : "Unlock"}</button></div>
      </form>
    </Sheet>
  );
}
