import { useEffect, useMemo, useRef, useState } from "react";
import { money, moneyShort, useAction } from "./api.js";
import { BearFigure, SceneBackdrop, bearScale } from "./Bear.jsx";
import { PostcardTile, FlipPostcard, Stamp, RARITY_LABEL, storyFor } from "./Postcard.jsx";
import MapView from "./MapView.jsx";
import { Icon } from "./Icons.jsx";

const TABS = [
  { id: "home", label: "Home", icon: "home" },
  { id: "missions", label: "Missions", icon: "star" },
  { id: "map", label: "Map", icon: "mapNav" },
  { id: "album", label: "Album", icon: "album" },
  { id: "buddy", label: "Chat", icon: "chat" },
];

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

export default function Child({ state, toast, onGrownUps, offline }) {
  const [tab, setTabRaw] = useState(() => { const saved = store.get("mq_tab", "home"); return TABS.some((t) => t.id === saved) ? saved : "home"; });
  const [sheet, setSheet] = useState(null); // { type, ...props }
  const [mapFocus, setMapFocus] = useState(null);
  const setTab = (t) => { setTabRaw(t); store.set("mq_tab", t); window.scrollTo({ top: 0 }); };
  const [run, pending] = useAction(toast, offline);
  const busy = pending || offline;
  const open = (type, props = {}) => setSheet({ type, ...props });
  const close = () => setSheet(null);
  const goMap = (placeId) => { setMapFocus(placeId || null); setTab("map"); close(); };
  const talk = useMapleTalk({ state, run, busy, offline });
  const startTalk = () => { close(); setTab("home"); talk.open(); };
  const [seen, setSeen] = useState(() => {
    const ids = storedList("mq_seen_adv");
    const previous = state.adventures.find((a) => a.id === ids[0]);
    // The old app remembered only its latest reveal. Older returns were seen too.
    if (!store.get("mq_seen_adv", "[").startsWith("[") && previous) {
      return state.adventures.filter((a) => a.status === "returned" && a.returnedAt <= previous.returnedAt).map((a) => a.id);
    }
    return ids;
  });
  const albumKey = encodeURIComponent(state.child.id || state.child.name);
  const baselineKey = `mq_album_baseline:${albumKey}`;
  const openedKey = `mq_opened_cards:${albumKey}`;
  const [initialCards] = useState(() => {
    if (store.get(baselineKey, null) !== null) return storedList(baselineKey);
    const ids = state.postcards.map((p) => p.id);
    store.set(baselineKey, JSON.stringify(ids));
    return ids;
  });
  const [openedCards, setOpenedCards] = useState(() => storedList(openedKey));
  const newCards = state.postcards.filter((p) => !initialCards.includes(p.id) && !openedCards.includes(p.id));
  const openCard = (id) => {
    const next = [...new Set([...openedCards, ...state.postcards.filter((p) => p.defId === id).map((p) => p.id)])];
    store.set(openedKey, JSON.stringify(next)); setOpenedCards(next);
    open("postcard", { id });
  };
  const ctx = { state, run, busy, offline, toast, setTab, open, close, goMap, talk, startTalk, newCards, openCard };
  const latest = [...state.adventures].reverse().find((a) => a.status === "returned" && !seen.includes(a.id));
  const reveal = Boolean(latest);
  const revealId = latest?.id;
  useEffect(() => { if (revealId) { setSheet(null); talk.close(); } }, [revealId]);
  const unread = state.notifications.filter((n) => !n.read).length;

  return (
    <div className="kid-app">
      <header className="kid-head">
        <div className="hello">
          <span className="hello-small">Hi, {state.child.name}!</span>
          <div className="stat-stamps">
            <button className="stat-stamp honey" onClick={() => open("money")} aria-label={`${money(state.balances.savings)} saved. Open my money`}>
              <Icon name="honey" size={22} />{money(state.balances.savings)}
            </button>
            <span className="stat-stamp" title="Adventure points: game points for trips. Not real money.">
              <Icon name="sparkle" size={16} />{state.child.points} pts
            </span>
          </div>
        </div>
        <div className="head-actions">
          {offline && <span className="offline-pill" role="status">Offline</span>}
          <button className="round-btn" disabled={pending} onClick={() => { open("news"); if (!offline) run("child/notifications/read", {}); }} aria-label={`News${unread ? `, ${unread} new` : ""}`}>
            <Icon name="bell" size={22} />{unread > 0 && <span className="dot" />}
          </button>
          <button className="round-btn" onClick={onGrownUps} aria-label="Grown-ups">
            <Icon name="lock" size={22} />
          </button>
        </div>
      </header>

      <main className="kid-main" id="main" key={tab}>
        {tab === "home" && <Home {...ctx} />}
        {tab === "missions" && <Missions {...ctx} />}
        {tab === "map" && <MapScreen {...ctx} focus={mapFocus} clearFocus={() => setMapFocus(null)} />}
        {tab === "album" && <Album {...ctx} />}
        {tab === "buddy" && <Buddy {...ctx} />}
      </main>

      <nav className="kid-nav" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} data-nav-album={t.id === "album" ? "true" : undefined} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}>
            <Icon name={t.icon} size={24} art={false} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>

      {tab === "home" && talk.isOpen && !sheet && !reveal && <TalkBar {...ctx} />}
      {sheet && !reveal && <SheetRouter sheet={sheet} {...ctx} />}
      {reveal && <ReturnReveal key={latest.id} state={state} latest={latest} onSeen={() => { const next = [...seen, latest.id]; store.set("mq_seen_adv", JSON.stringify(next)); setSeen(next); }} onDone={() => setTab("album")} />}
    </div>
  );
}

// ------------------------------------------------------------------ sheets
function Sheet({ title, onClose, children, tall, fullscreen }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); }
      if (e.key !== "Tab") return;
      const nodes = [...ref.current.querySelectorAll('button, input, select, textarea, a[href], [tabindex]')]
        .filter((el) => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { e.preventDefault(); ref.current.focus(); }
      else if (e.shiftKey && (document.activeElement === first || !nodes.includes(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !nodes.includes(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    document.body.classList.add("sheet-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("sheet-open");
      prev?.focus?.();
    };
  }, []);
  return (
    <div className={`sheet-bg ${fullscreen ? "return-bg" : ""}`} onClick={fullscreen ? undefined : onClose}>
      <section className={`sheet ${tall ? "tall" : ""} ${fullscreen ? "return-dialog" : ""}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()} ref={ref} tabIndex="-1">
        <div className="grabber" aria-hidden="true" />
        <div className="sheet-head">
          <h2>{title}</h2>
          {!fullscreen && <button className="round-btn small" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>}
        </div>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

function SheetRouter({ sheet, ...ctx }) {
  const { state, close } = ctx;
  switch (sheet.type) {
    case "chat": return <Sheet title="Our chat" onClose={close} tall><Buddy {...ctx} transcriptOnly /></Sheet>;
    case "money": return <MoneySheet {...ctx} start={sheet.start} />;
    case "dress": return <DressSheet {...ctx} />;
    case "lesson": return <LessonSheet {...ctx} lesson={sheet.lesson} />;
    case "budget": return <BudgetSheet {...ctx} />;
    case "place": return <PlaceSheet {...ctx} id={sheet.id} />;
    case "postcard": return <PostcardSheet {...ctx} id={sheet.id} />;
    case "news":
      return (
        <Sheet title="News" onClose={close}>
          {state.notifications.length === 0 && <p className="muted">Nothing new yet.</p>}
          <ul className="news">
            {state.notifications.map((n) => (
              <li key={n.id} className={`k-${n.kind}`}>
                <span>{n.text}</span>
                <time>{new Date(n.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>
              </li>
            ))}
          </ul>
        </Sheet>
      );
    default: return null;
  }
}

// ------------------------------------------------------------------ home
function moodFor(state, now) {
  const recent = state.notifications.find((n) => now - n.ts < 45000);
  if (recent?.kind === "celebrate") return "celebrate";
  const lastSpend = state.transactions.find((t) => t.to === "merchant" && t.status === "posted");
  if (lastSpend && now - lastSpend.ts < 60000) return "eating";
  if (state.plan && now - state.plan.updatedAt < 60000) return "happy";
  const h = new Date(now).getHours();
  if (h >= 21 || h < 6) return "resting";
  return "idle";
}

function nextUp(state, now) {
  const items = [];
  const goal = state.parentGoals.find((g) => g.status === "active");
  const today = state.dayKey;
  if (goal) {
    const left = goal.count - goal.progress;
    const what = { lessons: "money lesson", tasks: "grown-up task", save_actions: "save" }[goal.type];
    items.push({ id: "goal", icon: "target", text: `${left} more ${what}${left > 1 ? "s" : ""} to earn ${money(goal.reward)}`, cta: "Let's go", tab: goal.type === "save_actions" ? "save" : "missions" });
  }
  const waiting = state.parentGoals.find((g) => g.status === "awaiting_approval");
  if (waiting) items.push({ id: "wait", icon: "hourglass", text: `Your grown-up is checking "${waiting.title}"` });
  if (state.child.lastSaveDay !== today) items.push({ id: "save", icon: "honey", text: "Save a little today for +30 points", cta: "Save", tab: "save" });
  const lesson = state.catalog.lessons.find((l) => !state.child.lessonsDone.includes(l.id));
  if (lesson) items.push({ id: "lesson", icon: lesson.icon, text: `Try the "${lesson.title}" lesson`, cta: "Start", lesson });
  return items.slice(0, 2);
}

function Home({ state, setTab, open, run, busy, talk }) {
  const now = useNow();
  const goal = state.goals[0];
  const away = state.adventures.find((a) => a.status === "away");
  const mood = talk?.mood || moodFor(state, now);
  const tripCost = state.catalog.trip?.cost ?? 30;
  const short = tripCost - state.child.points;
  const scale = bearScale(state.balances.savings, goal?.target || 10000);
  const pct = goal ? Math.min(100, (state.balances.savings / goal.target) * 100) : 0;
  const stage = [...state.catalog.milestones].reverse().find((m) => state.child.milestonesUnlocked.includes(m.at));
  const nextMilestone = state.catalog.milestones.find((m) => !state.child.milestonesUnlocked.includes(m.at));
  const todo = nextUp(state, now);

  return (
    <div className="home">
      <section className={`scene bg-${state.child.bear.background}`} aria-label={`${state.child.bear.name}'s home`}>
        <SceneBackdrop scene={state.child.bear.background} />
        {away ? (
          <button className="trip-sign" onClick={() => talk?.open()} aria-label={`On a trip. ${countdown(away.returnsAt, now)}`}>
            <svg viewBox="0 0 260 240" aria-hidden="true">
              <g filter="url(#mq-wobble)">
                <path d="M118 95 L140 94 L144 234 L115 234 Z" fill="#9C6A40" stroke="#514738" strokeWidth="3" />
                <path d="M12 22 L247 17 L244 132 L14 138 Z" fill="#D8AD73" stroke="#514738" strokeWidth="3" />
                <path d="M28 35 Q115 28 226 32 M29 121 Q130 115 226 118" fill="none" stroke="#B77E50" strokeWidth="2" />
                <circle cx="26" cy="48" r="3" fill="#514738" /><circle cx="230" cy="109" r="3" fill="#514738" />
              </g>
              <text x="130" y="68" textAnchor="middle" className="sign-title">On a trip</text>
              <text x="130" y="103" textAnchor="middle" className="sign-time">{countdown(away.returnsAt, now)}</text>
            </svg>
          </button>
        ) : (
          <button className="bear-btn" style={{ "--scale": scale }} onClick={() => talk?.open()} aria-label={`Talk to ${state.child.bear.name}`}>
            <BearFigure bear={state.child.bear} mood={mood} size={196} />
          </button>
        )}
        {talk?.bubble && <SpeechBubble text={away && talk.bubble.startsWith(`${state.child.bear.name} is on a trip!`) ? `${state.child.bear.name} is on a trip! ${countdown(away.returnsAt, now)}` : talk.bubble} thinking={mood === "thinking"} />}
        <div className="name-sticker">
          <strong>{state.child.bear.name}</strong>
          <span>{stage ? `${stage.label} bear` : "Little cub"}</span>
        </div>
        {!away && <span className="tap-hint">Tap to talk</span>}
      </section>

      <div className="home-tools">
        <button className="chip" onClick={() => talk?.open()}>Talk to {state.child.bear.name}</button>
        <button className="chip" onClick={() => open("dress")}><Icon name="hat" size={18} /> Dress up</button>
      </div>
      <button className="btn honey wide trip-launch" disabled={busy || Boolean(away) || short > 0} onClick={() => run("child/trip", {}, `${state.child.bear.name} packed a little bag!`)}>
        {away ? "On a trip" : short > 0 ? `Earn ${short} more points` : <>Send {state.child.bear.name} on a trip · <Icon name="sparkle" size={19} art={false} />{tripCost}</>}
      </button>
      <p className="fine center trip-caption">A surprise postcard for your album. Points, never savings.</p>

      {goal ? <section className="paper-card jar-card">
        <div className="jar-row">
          <Jar pct={pct} />
          <div className="jar-text">
            <span className="kicker">Saving for</span>
            <h2><Icon name={goal.icon || "bike"} size={26} /> {goal.title}</h2>
            <p><b>{money(Math.min(state.balances.savings, goal.target))}</b> of {moneyShort(goal.target)}{goal.weeksLeft ? ` · about ${goal.weeksLeft} weeks to go` : goal.weeksLeft === 0 ? " · you did it!" : ""}</p>
          </div>
        </div>
        <div className="trail-bar" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin="0" aria-valuemax="100" aria-label="Savings goal progress">
          <span style={{ width: `${pct}%` }} />
          {state.catalog.milestones.filter((m) => m.at < goal.target).map((m) => (
            <i key={m.at} className={state.child.milestonesUnlocked.includes(m.at) ? "on" : ""} style={{ left: `${(m.at / goal.target) * 100}%` }} title={`${m.label} at ${moneyShort(m.at)}`} />
          ))}
        </div>
        {nextMilestone && <p className="fine">Next: {nextMilestone.label} bear at {moneyShort(nextMilestone.at)} · {nextMilestone.reward}</p>}
        <div className="btn-row">
          <button className="btn honey" onClick={() => open("money", { start: "save" })}>Save money</button>
          <button className="btn sage" onClick={() => open("money", { start: "spend" })}>Spent money</button>
        </div>
      </section> : <section className="paper-card jar-card">
        <h2 className="hand">Set a savings goal</h2>
        <p>Ask your grown-up to help pick something to save for.</p>
        <div className="btn-row">
          <button className="btn honey" onClick={() => open("money", { start: "save" })}>Save money</button>
          <button className="btn sage" onClick={() => open("money", { start: "spend" })}>Spent money</button>
        </div>
      </section>}

      {todo.length > 0 && (
        <section className="paper-card next-card">
          <h3 className="hand">Next up</h3>
          <ul>
            {todo.map((t) => (
              <li key={t.id}>
                <span className="next-icon"><Icon name={t.icon} size={24} /></span>
                <span className="grow">{t.text}</span>
                {t.cta && (
                  <button className="btn small sage" onClick={() => (t.lesson ? open("lesson", { lesson: t.lesson }) : t.tab === "save" ? open("money", { start: "save" }) : setTab(t.tab))}>{t.cta}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="paper-card note-card">
        <span className="tape" aria-hidden="true" />
        <h3 className="hand">A note from {state.child.bear.name}</h3>
        <p>{state.plan?.summary || "Ask me to help you make a saving plan!"}</p>
        {state.plan?.steps?.length > 0 && <ul className="steps">{state.plan.steps.slice(0, 3).map((s, i) => <li key={i}>{s}</li>)}</ul>}
        <button className="link" onClick={() => talk?.open()}>Talk to {state.child.bear.name}</button>
      </section>
    </div>
  );
}

function Jar({ pct }) {
  const h = 46 * (pct / 100);
  return (
    <svg className="jar" viewBox="0 0 64 72" width="64" height="72" aria-hidden="true">
      <defs><clipPath id="jar-clip"><path d="M12 18 H52 V60 Q52 68 44 68 H20 Q12 68 12 60 Z" /></clipPath></defs>
      <rect x="10" y={66 - h} width="44" height={h + 4} fill="#E4AD58" clipPath="url(#jar-clip)" className="jar-fill" />
      <path d="M12 18 H52 V60 Q52 68 44 68 H20 Q12 68 12 60 Z" fill="none" stroke="#514738" strokeWidth="2.5" />
      <rect x="9" y="8" width="46" height="10" rx="3" fill="#B77E50" stroke="#514738" strokeWidth="2.5" />
      <path d="M20 26 v14" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".6" />
    </svg>
  );
}

// ------------------------------------------------------------------ money sheet
function MoneySheet({ state, run, close, start, busy }) {
  const [mode, setMode] = useState(start || "save");
  const [amount, setAmount] = useState(mode === "save" ? "2" : "");
  const [memo, setMemo] = useState("");
  const [direction, setDirection] = useState("received");
  const submit = async (e) => {
    e.preventDefault();
    const a = Number(amount);
    let r;
    if (mode === "save") r = await run("child/save", { amount: a }, `Saved ${money(Math.round(a * 100))}! ${state.child.bear.name} grew a little.`);
    if (mode === "spend") r = await run("child/spend", { amount: a, memo }, (x) => (x.held ? "That's a big buy. We asked your grown-up first." : "Recorded. Nice tracking!"));
    if (mode === "log") r = await run("child/journal", { direction, amount: a || 0, note: memo }, "Added to your money diary.");
    if (mode === "ask") r = await run("child/extra", { amount: a, reason: memo }, "Sent to your grown-up!");
    if (r) { setMemo(""); if (mode !== "save") close(); }
  };
  const modes = [["save", "Save"], ["spend", "Spent"], ["log", "Cash diary"], ["ask", "Ask for extra"]];
  return (
    <Sheet title="My money" onClose={close} tall>
      <div className="money-pots">
        <div className="pot honey"><span>Savings</span><b>{money(state.balances.savings)}</b></div>
        <div className="pot sage"><span>Spending</span><b>{money(state.balances.spending)}</b></div>
      </div>
      <div className="segmented" role="tablist">
        {modes.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={mode === id} className={mode === id ? "on" : ""} onClick={() => { setMode(id); setAmount(id === "save" ? "2" : ""); }}>{label}</button>
        ))}
      </div>
      <form className="form" onSubmit={submit}>
        {mode === "log" && (
          <label>What happened?
            <select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="received">I got money (gift, chores)</option>
              <option value="spent">I spent cash</option>
              <option value="saved">I put cash in my piggy bank</option>
            </select>
          </label>
        )}
        <label htmlFor="money-amount">How much?</label>
        <div className="money-input"><span>$</span><input id="money-amount" type="number" min="0" step="0.25" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required={mode !== "log"} /></div>
        {mode === "save" && (
          <div className="chips">{[1, 2, 5].map((v) => <button type="button" key={v} className="chip" onClick={() => setAmount(String(v))}>${v}</button>)}</div>
        )}
        {mode !== "save" && (
          <label>{mode === "spend" ? "What did you buy?" : mode === "ask" ? "Why do you need it?" : "Note"}
            <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={80} required
              placeholder={mode === "spend" ? "e.g. Stickers" : mode === "ask" ? "e.g. A gift for my friend" : "e.g. Birthday money from Grandma"} />
          </label>
        )}
        <p className="fine">
          {mode === "save" && `Moves money from spending (${money(state.balances.spending)}) into savings.`}
          {mode === "spend" && `Buys over ${moneyShort(state.allowance.spendLimit)} need your grown-up's OK first.`}
          {mode === "log" && "For cash that isn't in the app. It goes in your diary."}
          {mode === "ask" && "Your grown-up decides. Maple can't move money."}
        </p>
        <button className="btn honey wide" type="submit" disabled={busy}>{{ save: "Save it", spend: "Record it", log: "Add to diary", ask: "Send request" }[mode]}</button>
      </form>
      <h3 className="hand">Recent</h3>
      <ul className="ledger">
        {state.transactions.slice(0, 8).map((t) => (
          <li key={t.id} className={t.status !== "posted" ? "reversed" : ""}>
            <span>{t.memo}</span>
            <b className={t.to === "merchant" ? "minus" : t.from === "spending" ? "" : "plus"}>{t.to === "merchant" ? "−" : t.from === "spending" ? "→ " : "+"}{money(t.amount)}</b>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ------------------------------------------------------------------ dress up
const WARDROBE = [
  ["hat", "Hats"], ["eyes", "Glasses"], ["neck", "Neckwear"], ["outfit", "Outfits"],
  ["held", "Things to hold"], ["friend", "Little friends"], ["background", "Home scene"],
];
const SCENE_SWATCH = { forest: "#A8B894", meadow: "#E5EEF0", stars: "#4E5F7A" };

function DressSheet({ state, run, close, busy }) {
  const [name, setName] = useState(state.child.bear.name);
  const [slot, setSlot] = useState("hat");
  const bear = state.child.bear;
  const items = state.catalog.cosmetics.filter((c) => c.kind === slot);
  return (
    <Sheet title={`Dress up ${bear.name}`} onClose={close} tall>
      <div className="dress-preview"><BearFigure bear={bear} size={170} /></div>
      <form className="rename" onSubmit={(e) => { e.preventDefault(); run("child/bear/name", { name }, "Name saved!"); }}>
        <label className="grow">Bear's name<input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} /></label>
        <button className="btn small sage" disabled={busy}>Rename</button>
      </form>
      <div className="wardrobe-tabs" role="tablist" aria-label="Wardrobe">
        {WARDROBE.map(([k, label]) => (
          <button key={k} role="tab" aria-selected={slot === k} className={slot === k ? "on" : ""} onClick={() => setSlot(k)}>{label}</button>
        ))}
      </div>
      <div className="swatches">
        {slot !== "background" && (
          <button disabled={busy} className={`swatch none ${!bear[slot] ? "on" : ""}`} onClick={() => run("child/cosmetic/equip", { kind: slot, value: null })}>
            <span className="swatch-art empty" aria-hidden="true">—</span>
            <span>None</span>
          </button>
        )}
        {items.map((c) => {
          const on = bear[slot] === c.value;
          const locked = !c.unlocked;
          return (
            <button key={c.id} disabled={busy || (locked && c.cost == null)} className={`swatch ${on ? "on" : ""} ${locked ? "locked" : ""}`} aria-disabled={locked && c.cost == null}
              onClick={() => (!locked ? run("child/cosmetic/equip", { kind: slot, value: c.value }) : c.cost != null ? run("child/cosmetic/buy", { id: c.id }, `Unlocked ${c.label}!`) : null)}>
              {slot === "background"
                ? <span className="swatch-art scene" style={{ background: SCENE_SWATCH[c.value] }} aria-hidden="true" />
                : <img className="swatch-art" src={`/bear/items/${c.value}.png`} alt="" loading="lazy" />}
              <span>{c.label}</span>
              <small>{!locked ? (on ? "Wearing" : c.cost === 0 ? "Free" : "Yours") : c.cost != null ? <><Icon name="sparkle" size={12} /> {c.cost}</> : `Save ${moneyShort(c.milestone)}`}</small>
            </button>
          );
        })}
      </div>
      <p className="fine">Savings milestones unlock special items forever. Spending never takes them away.</p>
    </Sheet>
  );
}

// ------------------------------------------------------------------ missions
function Missions({ state, run, open, busy }) {
  const today = state.dayKey;
  const P = state.catalog.points;
  const goals = state.parentGoals.filter((g) => g.status === "active" || g.status === "awaiting_approval");
  const daily = [
    { id: "track", title: "Record today's money", pts: P.track, done: Boolean(today) && state.child.lastTrackedDay === today, action: () => open("money", { start: "spend" }) },
    { id: "save", title: "Save toward your goal", pts: P.save, done: Boolean(today) && state.child.lastSaveDay === today, action: () => open("money", { start: "save" }) },
  ];
  const weekly = [
    { id: "budget", title: "Weekly budget challenge", pts: P.budget, done: Boolean(state.weekKey) && state.child.lastBudgetWeek === state.weekKey, action: () => open("budget") },
  ];
  return (
    <div className="page">
      <h1 className="page-title">Missions</h1>
      <p className="lede">Missions earn adventure points for trips. Points are for the game. They aren't real money.</p>

      {goals.map((g) => (
        <section key={g.id} className={`paper-card goal-card ${g.status}`}>
          <div className="row"><h3 className="hand">{g.title}</h3><span className="reward">{money(g.reward)}</span></div>
          <div className="acorns" aria-label={`${g.progress} of ${g.count} done`}>
            {Array.from({ length: g.count }, (_, i) => <span key={i} className={i < g.progress ? "on" : ""}><Icon name="acorn" size={26} /></span>)}
          </div>
          <p className="fine">{g.status === "awaiting_approval" ? "All done! Your grown-up is checking it." : `${g.progress} of ${g.count} done. A goal from your grown-up.`}</p>
        </section>
      ))}

      {[["Today", daily], ["This week", weekly]].map(([label, missions]) => <section key={label}>
        <h2 className="hand section-title">{label}</h2>
        <ul className="checklist">
          {missions.map((m) => (
            <li key={m.id} className={m.done ? "done" : ""}>
              <button onClick={m.action} disabled={m.done}>
                <span className="box" aria-hidden="true">{m.done && <Icon name="check" size={18} />}</span>
                <span className="grow">{m.title}</span>
                {!m.done && <span className="pts">+{m.pts}</span>}
              </button>
            </li>
          ))}
        </ul>
      </section>)}

      {state.missions.length > 0 && (
        <section>
          <h2 className="hand section-title">From your grown-up</h2>
          <ul className="checklist">
            {state.missions.slice().reverse().map((m) => (
              <li key={m.id} className={m.status === "done" ? "done" : m.status === "pending_review" ? "waiting" : ""}>
                <button disabled={busy || m.status !== "open"} onClick={() => run(`child/mission/${m.id}/done`, {}, "Sent to your grown-up to check!")}>
                  <span className="box" aria-hidden="true">{m.status === "done" ? <Icon name="check" size={18} /> : m.status === "pending_review" ? <Icon name="hourglass" size={18} /> : null}</span>
                  <span className="grow">{m.title}<small>{m.status === "pending_review" ? "Waiting for a grown-up to check" : m.status === "done" ? "Confirmed!" : m.createdBy.includes("buddy") ? "Idea from Maple · tap when done" : "Tap when you're done"}</small></span>
                  <span className="pts">+{m.points}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="hand section-title">Money lessons</h2>
        <div className="lesson-grid">
          {state.catalog.lessons.map((l, i) => {
            const done = state.child.lessonsDone.includes(l.id);
            return (
              <button key={l.id} className={`lesson ${done ? "done" : ""}`} style={{ "--tilt": `${[-1.2, 0.8, -0.6, 1, -0.9][i]}deg` }} onClick={() => open("lesson", { lesson: l })}>
                <span className="lesson-emoji"><Icon name={l.icon} size={40} /></span>
                <strong>{l.title}</strong>
                <small>{done ? "Done · play again" : `${l.questions.length} questions · +${P.lesson}`}</small>
                {done && <span className="done-stamp" aria-hidden="true"><Icon name="check" size={18} /></span>}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function LessonSheet({ lesson, run, close, busy }) {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [result, setResult] = useState(null);
  const pick = async (idx) => {
    if (busy) return;
    const next = [...answers, idx];
    if (next.length < lesson.questions.length) { setAnswers(next); return setI(i + 1); }
    setResult(await run("child/lesson", { lessonId: lesson.id, answers: next }));
  };
  const q = lesson.questions[i];
  return (
    <Sheet title={lesson.title} onClose={close}>
      {!result ? (
        <div className="quiz" key={i}>
          <div className="quiz-progress" aria-hidden="true">{lesson.questions.map((_, k) => <span key={k} className={k < i ? "on" : k === i ? "now" : ""} />)}</div>
          <p className="fine">Question {i + 1} of {lesson.questions.length}</p>
          <p className="quiz-q hand">{q.q}</p>
          <div className="quiz-opts">{q.options.map((o, idx) => <button key={o} disabled={busy} className="btn sage" onClick={() => pick(idx)}>{o}</button>)}</div>
        </div>
      ) : (
        <div className="quiz-result">
          <p className="big"><Icon name={result.passed ? "medal" : "heart"} size={64} /></p>
          <p className="hand big-text">{result.correct} of {result.total} right!</p>
          <p>{result.firstTime === false ? "Nice review! No extra points for repeats." : result.passed ? `Lesson complete. +20 adventure points!` : "So close! Try again to earn your points."}</p>
          <div className="btn-row center">
            {!result.passed && <button className="btn sage" onClick={() => { setI(0); setAnswers([]); setResult(null); }}>Try again</button>}
            <button className="btn honey" onClick={close}>Done</button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function BudgetSheet({ run, close, busy }) {
  const [a, setA] = useState({ save: 5, needs: 8, fun: 5, give: 2 });
  const total = Object.values(a).reduce((s, v) => s + v, 0);
  const rows = [["save", "Save", "honey"], ["needs", "Needs", "basket"], ["fun", "Fun", "balloon"], ["give", "Give", "heart"]];
  return (
    <Sheet title="Plan $20 for the week" onClose={close}>
      <form className="form" onSubmit={async (e) => { e.preventDefault(); if (await run("child/budget", { allocations: a }, (x) => (x.pointsAwarded ? `Great budget! +${x.pointsAwarded} points` : "Great budget! (Points already earned this week)"))) close(); }}>
        {rows.map(([k, label, emo]) => (
          <label key={k} className="slider-row">
            <span className="slider-label"><Icon name={emo} size={22} /> {label}</span>
            <input type="range" min="0" max="20" step="1" value={a[k]} onChange={(e) => setA({ ...a, [k]: Number(e.target.value) })} />
            <b>${a[k]}</b>
          </label>
        ))}
        <p className={`fine ${total === 20 ? "ok" : "warn"}`}>Total ${total}: {total === 20 ? "perfect!" : total > 20 ? `$${total - 20} too much` : `$${20 - total} left to plan`}</p>
        <button className="btn honey wide" type="submit" disabled={busy || total !== 20}>Finish my budget</button>
      </form>
    </Sheet>
  );
}

// ------------------------------------------------------------------ map
function MapScreen({ state, open, focus, clearFocus }) {
  const now = useNow(250);
  const owned = useMemo(() => new Set(state.postcards.filter((p) => p.source === "trip" || (!p.source && !p.from)).map((p) => p.defId)), [state.postcards]);
  const away = state.adventures.find((a) => a.status === "away");
  const frameRef = useRef(null);
  const interacting = useRef({ pointer: false, touch: false });
  const lastAutoScroll = useRef(0);
  const lastInteraction = useRef(0);
  useEffect(() => {
    if (focus) { open("place", { id: focus }); clearFocus(); }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const release = () => { interacting.current.pointer = false; lastInteraction.current = Date.now(); };
    const blur = () => { interacting.current.touch = false; release(); };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
      window.removeEventListener("blur", blur);
    };
  }, []);
  // On narrow screens the map scrolls sideways: keep the walking bear in view.
  useEffect(() => {
    const frame = frameRef.current;
    const walker = frame?.querySelector(".walker");
    if (!frame || !walker || frame.scrollWidth <= frame.clientWidth || interacting.current.pointer || interacting.current.touch || now - lastInteraction.current < 2000 || now - lastAutoScroll.current < 2000) return;
    const f = frame.getBoundingClientRect(), w = walker.getBoundingClientRect();
    const x = w.left + w.width / 2 - f.left;
    if (x < f.width * 0.2 || x > f.width * 0.8) {
      lastAutoScroll.current = now;
      frame.scrollTo({ left: frame.scrollLeft + x - f.width / 2, behavior: "smooth" });
    }
  }, [now, away]);
  const places = state.catalog.places;
  return (
    <div className="page">
      <div className="row">
        <h1 className="page-title">{state.child.bear.name}'s travels</h1>
        <span className="stat-stamp"><Icon name="sparkle" size={16} />{state.child.points} pts</span>
      </div>
      <p className="lede">Every postcard holds a little story. Tap a pin to explore.</p>
      {away && (
        <div className="away-banner" role="status">
          <Icon name="backpack" size={22} /> {state.child.bear.name} is on a surprise trip. {countdown(away.returnsAt, now)}
        </div>
      )}
      <p className="fine map-hint">Drag the map sideways to explore.</p>
      <div className="map-frame" ref={frameRef}
        onPointerDown={() => { interacting.current.pointer = true; }}
        onPointerUp={() => { interacting.current.pointer = false; lastInteraction.current = Date.now(); }}
        onPointerCancel={() => { interacting.current.pointer = false; lastInteraction.current = Date.now(); }}
        onTouchStart={() => { interacting.current.touch = true; }}
        onTouchEnd={(e) => { interacting.current.touch = e.touches.length > 0; lastInteraction.current = Date.now(); }}
        onTouchCancel={() => { interacting.current.touch = false; lastInteraction.current = Date.now(); }}
        onWheel={() => { lastInteraction.current = Date.now(); }}>
        <MapView places={places} home={state.catalog.home} owned={owned} away={away} now={now} bear={state.child.bear} onSelect={(id) => open("place", { id })} />
      </div>
      <div className="legend">
        <span><i className="lg open" /> A future adventure</span>
        <span><i className="lg visited" /> Visited</span>
        <span><i className="lg locked" /> Locked</span>
        <span>{Object.keys(places).filter((id) => owned.has(id)).length} of {Object.keys(places).length} places</span>
      </div>
    </div>
  );
}

function PlaceSheet({ id, state, close, openCard }) {
  const p = state.catalog.places[id];
  const owned = state.postcards.some((c) => c.defId === id);
  const visits = state.postcards.filter((c) => c.defId === id && c.source === "trip").length;
  if (p.hidden) {
    return (
      <Sheet title="A secret place" onClose={close}>
        <div className="secret-box"><span aria-hidden="true">?</span></div>
        <p className="hand big-text">{p.clue}</p>
        <p className="fine">Secret places can't be bought. They're discovered on other trips when you build good money habits.</p>
      </Sheet>
    );
  }
  return (
    <Sheet title={p.name} onClose={close}>
      <div className={`place-photo ${owned ? "" : "faded"}`}>
        <img src={p.image} alt={owned ? `${state.child.bear.name} at ${p.name}` : ""} />
        {!owned && <span className="place-q" aria-hidden="true">?</span>}
      </div>
      <div className="place-meta">
        <span>{p.state}</span>
        <span className={`rarity-chip ${p.rarity}`}>{RARITY_LABEL[p.rarity]}</span>
      </div>
      {owned && <><Stamp stamp={p.stamp} name={p.name} image={p.image} /><p className="story">{storyFor(p, state.child.bear.name)}</p><p className="fine">{visits ? `Visited ${visits} ${visits === 1 ? "time" : "times"}` : "A postcard from a friend. Maybe Maple will visit one day!"}</p></>}
      {!owned && <p className="hand">{p.clue || `A little adventure in ${p.state}.`}</p>}
      {!p.open && <p className="lock-note"><Icon name="lock" size={20} /> {p.lockReason}{p.progress ? ` (${p.progress})` : ""}</p>}
      {owned && <button className="link" onClick={() => openCard(id)}>See my postcard</button>}
    </Sheet>
  );
}

// ------------------------------------------------------------------ return reveal
function ReturnReveal({ state, latest, onSeen, onDone }) {
  const cards = state.postcards.filter((p) => latest.postcardIds.includes(p.id));
  const [adding, setAdding] = useState(false);
  const parcel = useRef(null);
  const finishing = useRef(false);
  const doneRef = useRef(null);
  doneRef.current = () => { onSeen(); onDone(); };
  useEffect(() => {
    if (!adding) return;
    const timer = setTimeout(() => doneRef.current(), window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 700);
    return () => clearTimeout(timer);
  }, [adding]);
  const add = () => {
    if (finishing.current) return;
    finishing.current = true;
    const target = document.querySelector('[data-nav-album="true"]')?.getBoundingClientRect();
    const from = parcel.current?.getBoundingClientRect();
    if (target && from) {
      parcel.current.style.setProperty("--album-x", `${target.left + target.width / 2 - from.left - from.width / 2}px`);
      parcel.current.style.setProperty("--album-y", `${target.top + target.height / 2 - from.top - from.height / 2}px`);
    }
    setAdding(true);
  };
  return (
    <Sheet title={`${state.child.bear.name} is home!`} onClose={add} fullscreen>
      <p className="center">A little adventure, just for you.</p>
      <div className={`return-parcel ${adding ? "adding" : ""}`} ref={parcel}>
        <svg className="return-envelope" viewBox="0 0 320 190" aria-hidden="true"><g filter="url(#mq-wobble)">
          <path className="envelope-flap" d="M8 65 L160 4 L312 65 Z" fill="#E8CB9C" stroke="#514738" strokeWidth="3" strokeLinejoin="round" />
          <rect className="envelope-body" x="8" y="65" width="304" height="116" rx="5" fill="#FFF0CF" stroke="#514738" strokeWidth="3" />
          <path d="M9 67 L160 145 L311 67 M9 179 L111 120 M311 179 L209 120" fill="none" stroke="#B77E50" strokeWidth="2" />
          <circle cx="160" cy="145" r="12" fill="#D59A84" stroke="#B77E50" strokeWidth="2" />
        </g></svg>
        <div className="return-sparkles" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="reveal-stack">
          {cards.map((c, i) => (
            <div key={c.id} className="return-card" style={{ "--delay": `${i * 2400}ms` }}>
              {i > 0 && <p className="hand surprise-title">…and a surprise!</p>}
              <FlipPostcard id={c.defId} place={state.catalog.places[c.defId]} bearName={state.child.bear.name} to={state.child.name} collectedAt={c.collectedAt} surprise={i > 0} revealDelay={i * 2400} />
            </div>
          ))}
        </div>
      </div>
      <button className="btn honey wide" disabled={adding} onClick={add}>Add to album</button>
    </Sheet>
  );
}

// ------------------------------------------------------------------ album
const GROUPS = [["common", "Cities & parks"], ["rare", "Rare finds"], ["seasonal", "Seasonal"], ["secret", "Secret places"]];

function Album({ state, open, goMap, run, busy, newCards = [], openCard }) {
  const [view, setView] = useState("mine");
  const counts = useMemo(() => {
    const m = {};
    for (const p of state.postcards) m[p.defId] = (m[p.defId] || 0) + 1;
    return m;
  }, [state.postcards]);
  const places = state.catalog.places;
  const total = Object.keys(places).length;
  const found = Object.keys(counts).length;
  return (
    <div className="page">
      <h1 className="page-title">Travel album</h1>
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={view === "mine"} className={view === "mine" ? "on" : ""} onClick={() => setView("mine")}>My postcards</button>
        <button role="tab" aria-selected={view === "friends"} className={view === "friends" ? "on" : ""} onClick={() => setView("friends")}>Friends</button>
      </div>
      {view === "mine" ? (
        <>
          <div className="passport">
            <div>
              <span className="kicker">Collected</span>
              <p className="hand big-text">{found} of {total}</p>
            </div>
            <div className="stamp-strip" aria-label="Collected stamps">
              {Object.entries(places).filter(([id]) => counts[id]).map(([id, p]) => <Stamp key={id} stamp={p.stamp} name={p.name} image={p.image} size="sm" />)}
              {found === 0 && <p className="fine">Stamps from your trips land here.</p>}
            </div>
          </div>
          {GROUPS.map(([rarity, label]) => {
            const ids = Object.keys(places).filter((id) => places[id].rarity === rarity);
            if (!ids.length) return null;
            return (
              <section key={rarity}>
                <h2 className="hand section-title">{label}</h2>
                <div className="album-grid">
                  {ids.map((id, i) => (
                    <PostcardTile key={id} id={id} place={places[id]} count={counts[id] || 0} isNew={newCards.some((c) => c.defId === id)} tilt={[-1.5, 1, -0.5, 1.4, -1][i % 5]}
                      onOpen={(pid) => (counts[pid] ? openCard(pid) : goMap(pid))} />
                  ))}
                </div>
              </section>
            );
          })}
        </>
      ) : (
        <Friends state={state} run={run} busy={busy} />
      )}
    </div>
  );
}

function PostcardSheet({ id, state, close }) {
  const p = state.catalog.places[id];
  const mine = state.postcards.filter((c) => c.defId === id);
  return (
    <Sheet title={p.name} onClose={close} tall>
      <FlipPostcard id={id} place={p} bearName={state.child.bear.name} to={state.child.name} collectedAt={mine[0]?.collectedAt} />
      <p className="fine center">Tap the postcard to turn it over.</p>
      {mine.length > 1 && <p className="fine center">You have {mine.length} of these. Spare copies can be swapped with friends.</p>}
    </Sheet>
  );
}

// ------------------------------------------------------------------ friends
function Friends({ state, run, busy }) {
  const approved = state.friends.filter((f) => f.status === "approved");
  const pending = state.friends.filter((f) => f.status === "pending_parent");
  const [sel, setSel] = useState(approved[0]?.id);
  const [code, setCode] = useState("");
  const [give, setGive] = useState("");
  const [get, setGet] = useState("");
  const friend = approved.find((f) => f.id === sel) || approved[0];
  const places = state.catalog.places;
  const nameOf = (id) => places[id]?.name || "Secret";
  const myCards = [...new Set(state.postcards.filter((p) => !p.lockedForTrade && places[p.defId]?.rarity !== "secret").map((p) => p.defId))];
  const pendingTrade = state.trades.find((t) => t.status === "pending");
  const coopGoal = 6;
  const coop = (state.child.coopLearning || 0) + approved.reduce((s, f) => s + (f.coopLearning || 0), 0);
  return (
    <div className="friends">
      <p className="lede">Friends see your bear and postcards. They never see your money.</p>
      {state.settings.coopChallenge && approved.length > 0 && (
        <section className="paper-card coop">
          <h3 className="hand">Team challenge: {coopGoal} money lessons together</h3>
          <div className="trail-bar"><span style={{ width: `${Math.min(100, (coop / coopGoal) * 100)}%` }} /></div>
          <p className="fine">{Math.min(coop, coopGoal)} of {coopGoal}{coop >= coopGoal ? ". You did it, team!" : ""}</p>
        </section>
      )}
      {approved.length > 1 && (
        <div className="friend-pills">
          {approved.map((f) => <button key={f.id} className={friend?.id === f.id ? "on" : ""} onClick={() => setSel(f.id)}>{f.name}</button>)}
        </div>
      )}
      {friend && (
        <section className="paper-card friend-card">
          <div className="friend-head">
            <BearFigure bear={friend.bear} size={96} />
            <div>
              <h2 className="hand">{friend.name}'s bear, {friend.bear.name}</h2>
              <p className="fine">{friend.postcards.length} postcards</p>
            </div>
          </div>
          <div className="mini-album">
            {friend.postcards.map((d, i) => places[d] && !places[d].hidden ? (
              <figure key={i}><img src={places[d].image} alt="" loading="lazy" /><figcaption>{places[d].name}</figcaption></figure>
            ) : null)}
          </div>
          <h3 className="hand">Swap postcards</h3>
          {pendingTrade ? (
            <p className="fine">Swap waiting: your {nameOf(pendingTrade.give)} for {nameOf(pendingTrade.get)}.{state.settings.requireTradeApproval ? " A grown-up will check it." : ""}</p>
          ) : (
            <form className="trade-form" onSubmit={async (e) => { e.preventDefault(); if (await run("child/trade", { friendId: friend.id, give, get }, state.settings.requireTradeApproval ? "Swap sent! A grown-up will check it." : "Swap done!")) { setGive(""); setGet(""); } }}>
              <label>You give
                <select value={give} onChange={(e) => setGive(e.target.value)} required>
                  <option value="">Pick one of yours</option>
                  {myCards.map((d) => {
                    const n = state.postcards.filter((p) => p.defId === d).length;
                    return <option key={d} value={d}>{nameOf(d)}{n > 1 ? ` (you have ${n})` : " (your only one)"}</option>;
                  })}
                </select>
              </label>
              <label>You get
                <select value={get} onChange={(e) => setGet(e.target.value)} required>
                  <option value="">Pick one of {friend.name}'s</option>
                  {[...new Set(friend.postcards)].map((d) => <option key={d} value={d}>{nameOf(d)}</option>)}
                </select>
              </label>
              <button className="btn honey" disabled={busy}>Propose swap</button>
            </form>
          )}
          <h3 className="hand">Send a note</h3>
          <div className="chips">
            {state.catalog.greetings.map((g, i) => <button key={i} className="chip" disabled={busy} onClick={() => run("child/greet", { friendId: friend.id, index: i }, `Sent to ${friend.name}!`)}>{g}</button>)}
          </div>
        </section>
      )}
      <section className="paper-card">
        <h3 className="hand">Add a friend</h3>
        <form className="rename" onSubmit={async (e) => { e.preventDefault(); if (await run("child/friend", { code }, "Request sent to your grown-up!")) setCode(""); }}>
          <label className="grow">Invitation code<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. SAM-12" /></label>
          <button className="btn small sage" disabled={busy}>Send</button>
        </form>
        {pending.length > 0 && <p className="fine">Waiting for a grown-up: {pending.map((f) => f.name).join(", ")}</p>}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ buddy
function speakBrowser(text) {
  if (!("speechSynthesis" in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1;
  u.pitch = 1.1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}

let currentAudio = null;
async function playBlob(blob) {
  const url = URL.createObjectURL(blob);
  currentAudio?.pause();
  currentAudio = new Audio(url);
  currentAudio.onended = () => URL.revokeObjectURL(url);
  await currentAudio.play();
}

// Cartesia: get a short-lived token from our server, call Cartesia directly
// from the browser; if that fails, use the server proxy; then browser speech.
async function speak(text, mode, allowed = () => true) {
  if (!allowed()) return;
  const clean = text.replace(/[*_#]/g, "").slice(0, 600);
  if (mode === "cartesia") {
    try {
      const t = await fetch("/api/voice/token", { method: "POST" });
      if (t.ok) {
        const { token, version, request } = await t.json();
        if (!allowed()) return;
        const res = await fetch("https://api.cartesia.ai/tts/bytes", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Cartesia-Version": version, "Content-Type": "application/json" },
          body: JSON.stringify({ ...request, transcript: clean }),
        });
        if (res.ok) { const blob = await res.blob(); if (allowed()) return await playBlob(blob); return; }
      }
    } catch {}
    if (!allowed()) return;
    try {
      const res = await fetch("/api/buddy/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: clean }) });
      if (res.ok) { const blob = await res.blob(); if (allowed()) return await playBlob(blob); return; }
    } catch {}
  }
  if (allowed()) speakBrowser(clean);
}

function Buddy({ state, run, busy, offline, startTalk, transcriptOnly }) {
  const chatRef = useRef(null);
  const chat = state.chat;
  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);
  return (
    <div className="page buddy">
      {!transcriptOnly && <h1 className="page-title">Our chat</h1>}
      {!state.goals[0] && <section className="paper-card"><h2 className="hand">Set a savings goal</h2><p>Ask your grown-up to help choose one.</p></section>}
      <div className="chat" ref={chatRef}>
        {chat.length === 0 && <p className="msg assistant">Our chats will be right here. What would you like to know?</p>}
        {chat.map((m) => (
          <div key={m.id} className={`msg ${m.role} ${m.auto ? "auto" : ""}`}>
            <small>{m.role === "user" ? "You" : state.child.bear.name}{m.auto ? " · Plan update" : ""}</small>
            {m.text.split("\n").filter(Boolean).map((line, i) => <p key={i}>{line}</p>)}
            {m.role === "assistant" && <button className="speak" disabled={busy || offline} onClick={() => run(() => speak(m.text, state.integrations.voice))} aria-label="Read aloud"><Icon name="speaker" size={18} /></button>}
          </div>
        ))}
      </div>
      <p className="fine">{state.child.bear.name} explains and plans. It can't move money, and your grown-up can read these chats.</p>
      <p className="fine">Keep passwords, phone numbers and addresses private. We hide those details if you share them.</p>
      <button className="btn honey" onClick={startTalk}>Talk to {state.child.bear.name}</button>
    </div>
  );
}

function storedList(key) {
  const raw = store.get(key, "[]");
  try { const value = JSON.parse(raw); return Array.isArray(value) ? value : []; }
  catch { return raw ? [raw] : []; } // wave 1 stored just the latest adventure id
}

function countdown(returnsAt, now) {
  const seconds = Math.max(0, Math.ceil((returnsAt - now) / 1000));
  return seconds ? `Back in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "Any second now…";
}

function stopSpeaking() {
  currentAudio?.pause();
  window.speechSynthesis?.cancel();
}

function useMapleTalk({ state, run, busy, offline }) {
  const [isOpen, setOpen] = useState(false);
  const [bubble, setBubble] = useState("");
  const [mood, setMood] = useState(null);
  const [muted, setMuted] = useState(() => store.get("mq_muted", "false") === "true");
  const turn = useRef(0);
  const inflight = useRef(false);
  const latest = useRef(null);
  const away = state.adventures.find((a) => a.status === "away");
  latest.current = { offline, away, enabled: state.settings.buddyEnabled, muted };
  const allowed = () => !latest.current.offline && !latest.current.away && latest.current.enabled;
  const close = () => setOpen(false);
  useEffect(() => {
    if (!offline && !away && state.settings.buddyEnabled) return;
    setOpen(false); setBubble(""); setMood(null); turn.current++; stopSpeaking();
  }, [offline, away?.id, state.settings.buddyEnabled]);
  useEffect(() => () => { turn.current++; stopSpeaking(); }, []);
  const open = () => {
    if (offline) { setBubble("I can't chat while we're offline, but your postcards are right here!"); setMood("resting"); return; }
    if (away) { setBubble(`${state.child.bear.name} is on a trip! ${countdown(away.returnsAt, Date.now())}`); return; }
    if (!state.settings.buddyEnabled) { setBubble("My grown-up switched chatting off for now."); setMood("resting"); return; }
    setOpen(true);
  };
  const send = async (text) => {
    if (!text.trim() || busy || inflight.current || !allowed()) return false;
    inflight.current = true;
    const id = ++turn.current;
    stopSpeaking(); setMood("thinking"); setBubble("…");
    try {
      const result = await run("buddy/chat", { text: text.trim() });
      if (id !== turn.current || !allowed()) return false;
      if (!result) { setMood("resting"); setBubble("Let's try that again in a moment."); return false; }
      setBubble(result.reply);
      setMood(/Hmm|trusted grown-up|quick answer|ask.*again/i.test(result.reply) ? "resting" : "happy");
      const maySpeak = () => id === turn.current && allowed() && !latest.current.muted;
      if (maySpeak()) speak(result.reply, state.integrations.voice, maySpeak).catch(() => {});
      return true;
    } finally { inflight.current = false; }
  };
  const toggleMute = () => {
    const next = !muted;
    latest.current.muted = next;
    setMuted(next); store.set("mq_muted", String(next));
    if (next) stopSpeaking();
  };
  return { isOpen, bubble, mood, muted, open, close, send, toggleMute };
}

function SpeechBubble({ text, thinking }) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    if (thinking || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setShown(text); return; }
    setShown("");
    let n = 0;
    const timer = setInterval(() => {
      n = Math.min(text.length, n + 4);
      setShown(text.slice(0, n));
      if (n === text.length) clearInterval(timer);
    }, 18);
    return () => clearInterval(timer);
  }, [text, thinking]);
  return (
    <div className="bear-bubble" aria-live="polite" aria-atomic="true">
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true"><path d="M12 4 Q0 6 4 28 L4 70 Q4 82 22 82 H120 L139 97 L143 82 H278 Q296 82 296 65 V21 Q296 4 278 4 Z" fill="#FFFDF7" stroke="#514738" strokeWidth="2" filter="url(#mq-wobble)" /></svg>
      <span className="sr-only">{text}</span><span aria-hidden="true">{shown || "\u00a0"}</span>
    </div>
  );
}

function TalkBar({ state, talk, busy, open }) {
  const [text, setText] = useState("");
  const [listening, setListening] = useState(false);
  const input = useRef(null);
  const recognition = useRef(null);
  const closeRef = useRef(talk.close);
  closeRef.current = talk.close;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  useEffect(() => {
    const previous = document.activeElement;
    input.current?.focus();
    const escape = (e) => { if (e.key === "Escape") closeRef.current(); };
    window.addEventListener("keydown", escape);
    return () => { recognition.current?.abort(); window.removeEventListener("keydown", escape); previous?.focus?.(); };
  }, []);
  useEffect(() => { if (busy) { recognition.current?.abort(); setListening(false); } }, [busy]);
  const send = async (msg) => {
    if (await talk.send(msg)) setText((current) => current === msg ? "" : current);
    input.current?.focus();
  };
  const stop = () => { recognition.current?.stop(); setListening(false); };
  const listen = () => {
    if (!Recognition || busy || recognition.current) return;
    const session = new Recognition();
    recognition.current = session;
    session.lang = "en-US";
    session.interimResults = true;
    session.onresult = (event) => setText(Array.from(event.results).map((r) => r[0].transcript).join(" ").slice(0, 500));
    session.onerror = session.onend = () => { recognition.current = null; setListening(false); };
    try { session.start(); setListening(true); } catch { recognition.current = null; setListening(false); }
  };
  const suggestions = ["Can I buy a $15 toy?", "When will I get my bike?", "Make me a saving plan"];
  return (
    <section className="talk-bar" aria-label={`Talk to ${state.child.bear.name}`}>
      <div className="talk-links">
        <button className="link" onClick={() => open("chat")}>See our chat</button>
        <button className="round-btn small" aria-label={talk.muted ? "Sound off" : "Sound on"} title={talk.muted ? "Sound off" : "Sound on"} aria-pressed={talk.muted} onClick={talk.toggleMute}><Icon name={talk.muted ? "speakerOff" : "speaker"} size={20} /></button>
        <button className="round-btn small" onClick={talk.close} aria-label="Close talk bar"><Icon name="close" size={16} /></button>
      </div>
      <div className="chips scroll">{suggestions.map((s) => <button type="button" key={s} className="chip" disabled={busy} onClick={() => send(s)}>{s}</button>)}</div>
      <form className="chat-input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder={`Ask ${state.child.bear.name}…`} aria-label={`Message ${state.child.bear.name}`} />
        {Recognition && <button type="button" className={`round-btn mic ${listening ? "listening" : ""}`} disabled={busy} aria-label="Hold to talk" aria-pressed={listening}
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture?.(e.pointerId); listen(); }} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onBlur={stop}
          onKeyDown={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); if (!e.repeat) listen(); } }} onKeyUp={(e) => { if (e.key === " " || e.key === "Enter") { e.preventDefault(); stop(); } }}>
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3" fill="#E4AD58" stroke="currentColor" strokeWidth="2" /><path d="M6 10v2a6 6 0 0 0 12 0v-2M12 18v3M8 21h8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>}
        <button className="btn honey" disabled={busy || !text.trim()}>Send</button>
      </form>
      {listening && <p className="fine" role="status">Listening… let go when you're done.</p>}
    </section>
  );
}
