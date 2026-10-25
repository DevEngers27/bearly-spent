import { useEffect, useRef, useState } from "react";
import { api, money, plural, formatTime, formatDateTime, postcardMetrics, useAction } from "./api.js";
import { BearFigure, bearScale } from "./Bear.jsx";

const SECTIONS = [
  ["inbox", "Approvals"],
  ["overview", "Overview"],
  ["goals", "Goals & tasks"],
  ["allowance", "Allowance"],
  ["activity", "Transactions"],
  ["guardian", "Guardian log"],
  ["buddy", "Buddy chats"],
  ["settings", "Friends & privacy"],
  ["children", "Children"],
  ["security", "Security"],
];

const KIND_LABEL = { reward: "Reward", task: "Task check", spend: "Purchase", extra: "Extra allowance", friend: "Friend", trade: "Trade", mission_proposal: "Buddy suggestion", topup: "Funding", review: "Review" };
const BROWSER_TIMEZONE = Intl.DateTimeFormat("en-US").resolvedOptions().timeZone || "UTC";
const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [];

export default function Parent({ state, toast, me, refreshMe, onSignOut, onSignOutAll, offline }) {
  const [sec, setSec] = useState("inbox");
  const [opened, setOpened] = useState(["inbox"]);
  const selectSection = (id) => { setSec(id); setOpened((previous) => previous.includes(id) ? previous : [...previous, id]); };
  const [fundingFocus, setFundingFocus] = useState(0);
  const onAddMoney = () => { selectSection("allowance"); setFundingFocus((current) => current + 1); };
  const [run, pendingAction] = useAction(toast, offline);
  const busy = pendingAction || offline;
  const timezoneAttempted = useRef(false);
  useEffect(() => {
    if (state.settings.timezone) {
      timezoneAttempted.current = false;
      return;
    }
    if (timezoneAttempted.current) return;
    timezoneAttempted.current = true;
    run("parent/settings", { timezone: BROWSER_TIMEZONE });
  }, [state.settings.timezone, run]);
  const pending = state.approvals.filter((a) => a.status === "pending");
  const ctx = { state, run, busy, demo: me?.demo === true, onAddMoney };
  return (
    <div className="parent">
      <aside className="p-nav">
        <div className="p-family">
          <BearFigure bear={state.child.bear} size={44} />
          <div><strong>{state.child.name}'s account</strong><small>Managed by {state.family.parentName}</small></div>
        </div>
        <nav aria-label="Parent sections">
          {SECTIONS.map(([id, label]) => (
            <button key={id} className={sec === id ? "on" : ""} onClick={() => selectSection(id)} aria-current={sec === id ? "page" : undefined}>
              {label}
              {id === "inbox" && pending.length > 0 && <span className="badge">{pending.length}</span>}
            </button>
          ))}
        </nav>
        <Integrations state={state} />
      </aside>
      <main className="p-main" id="main">
        {sec === "inbox" && <Inbox {...ctx} pending={pending} />}
        {sec === "overview" && <Overview {...ctx} />}
        {opened.includes("goals") && <div hidden={sec !== "goals"}><Goals {...ctx} /></div>}
        {opened.includes("allowance") && <div hidden={sec !== "allowance"}><Allowance key={JSON.stringify([state.allowance.amount, state.allowance.savePct, state.allowance.spendLimit, state.allowance.rewardDestination])} {...ctx} fundingFocus={fundingFocus} /></div>}
        {sec === "activity" && <Activity {...ctx} />}
        {sec === "guardian" && <Guardian {...ctx} />}
        {sec === "buddy" && <BuddyLog {...ctx} />}
        {sec === "settings" && <Settings {...ctx} />}
        {sec === "children" && <Children me={me} refreshMe={refreshMe} {...ctx} />}
        {sec === "security" && <Security me={me} refreshMe={refreshMe} onSignOut={onSignOut} onSignOutAll={onSignOutAll} {...ctx} />}
      </main>
    </div>
  );
}

function Integrations({ state }) {
  const i = state.integrations;
  return (
    <dl className="integrations">
      <dt>Money Buddy</dt><dd>{i.buddy === "claude" ? "Claude (live)" : "Offline planner"}</dd>
      <dt>Bank</dt><dd>{i.bank === "nessie" ? "Simulated + Nessie sandbox" : "Simulated ledger"}</dd>
      <dt>Voice</dt><dd>{i.voice === "cartesia" ? "Cartesia" : "Browser speech"}</dd>
    </dl>
  );
}

function Inbox({ state, run, demo, pending, busy, onAddMoney }) {
  const notifications = state.notifications.filter((n) => !n.read);
  const decided = state.approvals.filter((a) => a.status !== "pending").slice(0, 8);
  return (
    <div className="p-stack">
      <h1>Approvals</h1>
      {pending.length === 0 && <p className="empty">Nothing waiting — nice!</p>}
      <ul className="approval-list">
        {pending.map((a) => (
          <li key={a.id} className={`approval k-${a.kind}`}>
            <span className="kind-tag">{KIND_LABEL[a.kind] || a.kind}</span>
            <div className="approval-body">
              <strong>{a.title}</strong>
              {a.detail && <p>{a.detail}</p>}
              {a.amount != null && <p className="amt">{money(a.amount)}</p>}
            </div>
            <div className="approval-actions">
              {a.kind === "topup" || a.kind === "review" ? (
                <>
                  {a.kind === "topup" && <button disabled={busy} className="pbtn primary" onClick={onAddMoney}>Add money</button>}
                  {demo && a.kind === "topup" && <button disabled={busy} className="pbtn primary" onClick={() => run("parent/topup", { amount: 50 }, "Added $50 to funding")}>Add $50</button>}
                  <button disabled={busy} className="pbtn" onClick={() => run(`parent/approval/${a.id}`, { approve: true }, "Marked as handled")}>Mark handled</button>
                </>
              ) : (
                <>
                  <button disabled={busy} className="pbtn primary" onClick={() => run(`parent/approval/${a.id}`, { approve: true }, a.kind === "reward" ? `Approved. The Guardian is sending ${money(a.amount)}.` : "Approved")}>
                    {a.kind === "reward" ? `Approve ${money(a.amount)}` : a.kind === "task" ? "Confirm" : "Approve"}
                  </button>
                  <button disabled={busy} className="pbtn" onClick={() => run(`parent/approval/${a.id}`, { approve: false }, "Declined")}>Decline</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
      {decided.length > 0 && (
        <>
          <h2>Recently decided</h2>
          <table className="ptable">
            <tbody>
              {decided.map((a) => (
                <tr key={a.id}>
                  <td>{KIND_LABEL[a.kind] || a.kind}</td>
                  <td>{a.title}</td>
                  <td className={a.status === "approved" ? "pos" : "neg"}>{a.status}{a.paidTxnId ? " · paid" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <h2>Notifications</h2>
      {notifications.length === 0 && <p className="empty">Nothing waiting — nice!</p>}
      <ul className="p-feed">
        {notifications.slice(0, 8).map((n) => (
          <li key={n.id} className={`k-${n.kind}`}><time>{formatTime(n.ts)}</time>{n.text}</li>
        ))}
      </ul>
    </div>
  );
}

function Overview({ state, onAddMoney, busy }) {
  const goal = state.goals[0];
  const learned = state.child.stats;
  return (
    <div className="p-stack">
      <h1>Overview</h1>
      <div className="p-figures">
        <Figure label={`${state.child.name}'s savings`} value={money(state.accounts.savings.balance)} sub={goal ? `${Math.round((state.accounts.savings.balance / goal.target) * 100)}% of ${goal.title}` : "Set a savings goal"} />
        <Figure label="Spending money" value={money(state.accounts.spending.balance)} />
        <Figure label="Funding account" value={money(state.accounts.parent.balance)} sub="Money set aside" />
        <Figure label="Adventure points" value={state.child.points} sub="Game points, not money" />
      </div>
      {state.accounts.parent.balance === 0 && state.allowance.amount > 0 && <section className="p-card">
        <p>{`Add money to the funding record so ${state.child.bear.name}'s allowance can be paid`}</p>
        <button disabled={busy} className="pbtn primary" onClick={onAddMoney}>Add money</button>
      </section>}
      {!goal && <section className="p-card"><h2>Set a savings goal</h2><p>Choose something to save for in Goals & tasks.</p></section>}
      <div className="p-two">
        <section>
          <h2>Learning progress</h2>
          <table className="ptable">
            <tbody>
              <tr><td>Money lessons passed</td><td>{learned.learningDone} ({state.child.lessonsDone.length}/5 unique)</td></tr>
              <tr><td>Savings actions</td><td>{learned.savingsActions}</td></tr>
              <tr><td>Days with money tracked</td><td>{learned.tracked}</td></tr>
              <tr><td>Weekly budgets planned</td><td>{learned.budgetsDone}</td></tr>
              <tr><td>Adventures taken</td><td>{learned.adventures}</td></tr>
              <tr><td>Postcards collected</td><td>{postcardMetrics(state).places} of {postcardMetrics(state).total} {plural(postcardMetrics(state).total, "place")} ({postcardMetrics(state).cards} {plural(postcardMetrics(state).cards, "card")})</td></tr>
            </tbody>
          </table>
        </section>
        <section>
          <h2>Bear growth</h2>
          <div className="p-blob"><BearFigure bear={state.child.bear} size={Math.round(150 * bearScale(state.accounts.savings.balance, goal?.target || 10000))} /></div>
          <p className="p-muted">Milestones reached: {state.child.milestonesUnlocked.map((m) => money(m)).join(", ") || "none yet"}. Milestones are permanent; spending doesn't shrink them.</p>
          {state.plan && <p className="p-muted">Buddy's current plan: “{state.plan.summary}”</p>}
        </section>
      </div>
    </div>
  );
}

const Figure = ({ label, value, sub }) => (
  <div className="p-figure"><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>
);

function Goals({ state, run, busy }) {
  const remaining = state.catalog.lessons.filter((l) => !state.child.lessonsDone.includes(l.id)).length;
  const [g, setG] = useState({ title: "Complete money lessons", type: remaining ? "lessons" : "tasks", count: remaining || 1, reward: 5 });
  const [m, setM] = useState({ title: "", points: 40 });
  return (
    <div className="p-stack">
      <h1>Goals & tasks</h1>
      <div className="p-two">
        <section className="p-card">
          <h2>Reward goal</h2>
          <p className="p-muted">MoneyQuest verifies progress automatically and asks you before any money moves.</p>
          <form className="pform" onSubmit={async (e) => { e.preventDefault(); await run("parent/goal", g, "Goal created"); }}>
            <label>Goal<input value={g.title} onChange={(e) => setG({ ...g, title: e.target.value })} required /></label>
            <div className="pform-row">
              <label>Counts<select value={g.type} onChange={(e) => setG({ ...g, type: e.target.value })}>
                <option value="lessons">Money lessons passed</option>
                <option value="tasks">Tasks you confirm</option>
                <option value="save_actions">Times saved</option>
              </select></label>
              <label>How many{g.type === "lessons" && <small>{remaining} lessons remaining</small>}<input type="number" min="1" max={g.type === "lessons" ? remaining : 50} value={g.count} onChange={(e) => setG({ ...g, count: e.target.value })} /></label>
              <label>Reward ($)<input type="number" min="0" max="100" step="0.5" value={g.reward} onChange={(e) => setG({ ...g, reward: e.target.value })} /></label>
            </div>
            <button disabled={busy || (g.type === "lessons" && (remaining === 0 || Number(g.count) > remaining))} className="pbtn primary">Create goal</button>
          </form>
        </section>
        <section className="p-card">
          <h2>Assign a task</h2>
          <p className="p-muted">Tasks earn adventure points after you confirm them.</p>
          <form className="pform" onSubmit={async (e) => { e.preventDefault(); if (await run("parent/mission", m, "Task assigned")) setM({ ...m, title: "" }); }}>
            <label>Task<input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} placeholder="e.g. Compare prices on 3 cereals" required /></label>
            <label>Points<input type="number" min="5" max="100" value={m.points} onChange={(e) => setM({ ...m, points: e.target.value })} /></label>
            <button disabled={busy} className="pbtn primary">Assign task</button>
          </form>
        </section>
      </div>
      <SavingsGoal key={JSON.stringify(state.goals[0] && [state.goals[0].id, state.goals[0].title, state.goals[0].target])} state={state} run={run} busy={busy} />
      <h2>All goals</h2>
      <table className="ptable">
        <thead><tr><th>Goal</th><th>Progress</th><th>Reward</th><th>Status</th></tr></thead>
        <tbody>
          {state.parentGoals.length === 0 && <tr><td colSpan="4" className="p-muted">No goals yet. Create one above.</td></tr>}
          {state.parentGoals.slice().reverse().map((x) => (
            <tr key={x.id} className={x.status === "cancelled" ? "struck" : ""}><td>{x.title}</td><td>{x.progress}/{x.count}</td><td>{money(x.reward)}</td><td>{x.status.replace("_", " ")}{x.status === "active" && <button disabled={busy} className="pbtn" onClick={() => run(`parent/goal/${x.id}/cancel`, {}, "Goal cancelled")}>Cancel</button>}</td></tr>
          ))}
        </tbody>
      </table>
      <h2>Tasks</h2>
      <table className="ptable">
        <tbody>
          {state.missions.length === 0 && <tr><td className="p-muted">No tasks assigned yet.</td></tr>}
          {state.missions.slice().reverse().map((x) => (
            <tr key={x.id}><td>{x.title}</td><td>+{x.points} pts</td><td>{x.status.replace("_", " ")}</td><td className="p-muted">{x.createdBy}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SavingsGoal({ state, run, busy }) {
  const [sg, setSg] = useState({ title: state.goals[0]?.title || "", target: state.goals[0] ? state.goals[0].target / 100 : 50 });
  return (
    <section className="p-card">
      <h2>{state.goals[0] ? "Savings goal" : "Set a savings goal"}</h2>
      {!state.goals[0] && <p>Pick something your child would love to save for.</p>}
      <form className="pform pform-row" onSubmit={(e) => { e.preventDefault(); run("parent/savings-goal", sg, "Savings goal updated"); }}>
        <label>Saving for<input value={sg.title} onChange={(e) => setSg({ ...sg, title: e.target.value })} /></label>
        <label>Target ($)<input type="number" min="1" value={sg.target} onChange={(e) => setSg({ ...sg, target: e.target.value })} /></label>
        <button disabled={busy} className="pbtn">Update</button>
      </form>
    </section>
  );
}

function Allowance({ state, run, demo, busy, fundingFocus = 0 }) {
  const a = state.allowance;
  const [f, setF] = useState({ amount: a.amount / 100, savePct: a.savePct, spendLimit: a.spendLimit / 100, rewardDestination: a.rewardDestination });
  const [funding, setFunding] = useState({ amount: "", note: "" });
  const fundingAmount = useRef(null);
  useEffect(() => {
    if (fundingFocus > 0) fundingAmount.current?.focus();
  }, [fundingFocus]);
  const addMoney = async (event) => {
    event.preventDefault();
    const result = await run("parent/funding/add", funding, "Money recorded — real money stays with you");
    if (result) setFunding({ amount: "", note: "" });
  };
  return (
    <div className="p-stack">
      <h1>Allowance & limits</h1>
      <p className="p-muted">The Ledger Guardian pays the allowance on schedule, splits it between savings and spending, and holds purchases over your limit for approval. Next payout: {formatDateTime(a.nextRun)}.</p>
      <form className="p-card pform" onSubmit={(e) => { e.preventDefault(); run("parent/allowance", f, "Allowance rules saved"); }}>
        <div className="pform-row">
          <label>Weekly allowance ($)<input type="number" min="0" max="100" step="0.5" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label>Saved automatically (%)<input type="number" min="0" max="100" value={f.savePct} onChange={(e) => setF({ ...f, savePct: e.target.value })} /></label>
          <label>Purchase limit without approval ($)<input type="number" min="0" step="1" value={f.spendLimit} onChange={(e) => setF({ ...f, spendLimit: e.target.value })} /></label>
          <label>Rewards go to<select value={f.rewardDestination} onChange={(e) => setF({ ...f, rewardDestination: e.target.value })}>
            <option value="savings">Savings</option><option value="spending">Spending</option>
          </select></label>
        </div>
        <button disabled={busy} className="pbtn primary">Save rules</button>
      </form>
      <section className="p-card">
        <h2>Funding account</h2>
        <p>{money(state.accounts.parent.balance)} recorded as set aside</p>
        <p className="p-muted" id="funding-explanation">This is a record of money you have set aside; MoneyQuest never moves real money.</p>
        <form className="pform" onSubmit={addMoney} aria-label="Add money" aria-describedby="funding-explanation">
          <label>Amount ($)<input ref={fundingAmount} type="number" required min="1" max="1000" step="0.01" disabled={busy} value={funding.amount} onChange={(e) => setFunding({ ...funding, amount: e.target.value })} /></label>
          <label>Note (optional)<input maxLength={120} disabled={busy} value={funding.note} onChange={(e) => setFunding({ ...funding, note: e.target.value })} /></label>
          <button disabled={busy} className="pbtn primary">Add money</button>
        </form>
        {demo && <div className="row">
          <button disabled={busy} className="pbtn" onClick={() => run("parent/topup", { amount: 50 }, "Added $50")}>Add $50</button>
          <button disabled={busy} className="pbtn" onClick={() => run("parent/allowance/run-now", {}, "Fast-forwarded to payday")}>Fast-forward to payday</button>
        </div>}
        {demo && <p className="p-muted">Fast-forward is a demo control: it moves the schedule to now so you can watch the Guardian pay.</p>}
      </section>
    </div>
  );
}

function Activity({ state }) {
  const label = { external: "Set aside", parent: "Funding", savings: "Savings", spending: "Spending", merchant: "Store" };
  return (
    <div className="p-stack">
      <h1>Transactions</h1>
      <p className="p-muted">Every movement in the simulated ledger. Reversed rows were corrected by the Guardian.</p>
      <table className="ptable">
        <thead><tr><th>When</th><th>What</th><th>From → to</th><th className="num">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {state.transactions.map((t) => (
            <tr key={t.id} className={t.status !== "posted" ? "struck" : t.flagged ? "flag" : ""}>
              <td>{formatDateTime(t.ts)}</td>
              <td>{t.memo}{t.injected ? " (bank replay)" : ""}</td>
              <td>{label[t.from]} → {label[t.to]}</td>
              <td className="num">{money(t.amount)}</td>
              <td>{t.status === "reversed" ? "duplicate reversed by Guardian" : t.status}{t.flagged ? " · flagged" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Guardian({ state, run, demo, busy }) {
  const [all, setAll] = useState(false);
  const rows = state.audit.filter((a) => all || a.actor === "guardian" || a.actor === "buddy");
  return (
    <div className="p-stack">
      <h1>Ledger Guardian</h1>
      <p className="p-muted">The Guardian is MoneyQuest's autonomous bookkeeper. It can pay only what your schedule or your approvals authorise, reverse only postings that exceed an obligation, and asks you about anything else.</p>
      <div className="policy-list">
        <div><b>G1</b> Pays the allowance on schedule, never overdrawing</div>
        <div><b>G2</b> Pays approved rewards and requests exactly once</div>
        <div><b>G3</b> Reconciles the ledger and undoes double postings</div>
        <div><b>G4</b> Holds purchases over your limit and flags unusual spending</div>
        <div><b>G5</b> Warns you before funding runs short</div>
      </div>
      {demo && <section className="p-card demo">
        <h2>Try it: simulate a bank glitch</h2>
        <p className="p-muted">Makes the simulated bank post the last reward or allowance twice, the way a replayed webhook would. Watch the Guardian catch it on its next check, within a couple of seconds.</p>
        <button disabled={busy} className="pbtn" onClick={() => run("parent/inject-fault", {}, "Bank glitch injected. Watch the log.")}>Post a duplicate</button>
      </section>}
      <div className="row">
        <h2>Decision log</h2>
        <label className="toggle"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all activity</label>
      </div>
      <ol className="audit">
        {rows.slice(0, 60).map((a) => (
          <li key={a.id} className={`actor-${a.actor}`}>
            <time>{formatTime(a.ts, { second: "2-digit" })}</time>
            <span className="actor">{a.actor}</span>
            <span>{a.detail}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="p-muted">No decisions yet.</li>}
      </ol>
    </div>
  );
}

function BuddyLog({ state, run, busy }) {
  const [older, setOlder] = useState([]);
  const [cursor, setCursor] = useState(undefined);
  const before = cursor === undefined ? state.chatNextBefore : cursor;
  const messages = [...new Map([...older, ...state.chat].map((message) => [message.id, message])).values()];
  const loadOlder = async () => {
    const page = await run(() => api(`parent/state?before=${encodeURIComponent(before)}`));
    if (page) {
      setOlder((current) => [...page.chat, ...current]);
      setCursor(page.chatNextBefore);
    }
  };
  return (
    <div className="p-stack">
      <h1>Money Buddy chats</h1>
      <p className="p-muted">Everything {state.child.name} and Money Buddy said. Personal details like phone numbers are removed before messages reach the AI. Buddy can't move money; any mission it suggests comes to you first.</p>
      {before && <button className="pbtn" disabled={busy} onClick={loadOlder}>Load older</button>}
      <ol className="transcript">
        {messages.length === 0 && <li className="p-muted">No conversations yet.</li>}
        {messages.map((m) => (
          <li key={m.id} className={m.role}>
            <b>{m.role === "user" ? state.child.name : m.auto ? "Buddy (automatic update)" : "Buddy"}</b>
            <span>{m.text}</span>
            {m.tools?.length > 0 && <small>Used: {[...new Set(m.tools)].join(", ")}</small>}
            {m.redacted?.length > 0 && <small className="neg">Removed: {m.redacted.join(", ")}</small>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Settings({ state, run, demo, busy }) {
  const s = state.settings;
  const timezones = [...new Set(["UTC", BROWSER_TIMEZONE, ...TIMEZONES, ...(s.timezone ? [s.timezone] : [])])].sort();
  const toggle = (k) => run("parent/settings", { [k]: !s[k] }, "Saved");
  return (
    <div className="p-stack">
      <h1>Friends & privacy</h1>
      <section className="p-card pform">
        <label>Family time zone
          <select value={s.timezone || BROWSER_TIMEZONE} disabled={busy} onChange={(e) => run("parent/settings", { timezone: e.target.value }, "Time zone saved")}>
            {timezones.map((timezone) => <option key={timezone} value={timezone}>{timezone.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <p className="p-muted">Daily points reset at midnight here. Weekly budgets run Monday through Sunday.</p>
      </section>
      <section className="p-card">
        <label className="switch"><input type="checkbox" disabled={busy} checked={s.requireTradeApproval} onChange={() => toggle("requireTradeApproval")} /> Ask me before postcard trades</label>
        <label className="switch"><input type="checkbox" disabled={busy} checked={s.buddyEnabled} onChange={() => toggle("buddyEnabled")} /> Money Buddy is on</label>
        <label className="switch"><input type="checkbox" disabled={busy} checked={s.coopChallenge} onChange={() => toggle("coopChallenge")} /> Team challenges with friends</label>
        <p className="p-muted">Friends can only see {state.child.name}'s bear, postcards and prewritten greetings. Balances, transactions and allowance stay private. There's no open chat.</p>
      </section>
      <h2>Friends</h2>
      <table className="ptable">
        <tbody>
          {state.friends.map((f) => <tr key={f.id}><td>{f.name}</td><td>{f.code}</td><td>{f.status.replace("_", " ")}</td></tr>)}
        </tbody>
      </table>
      {demo && <section className="p-card">
        <h2>Demo data</h2>
        <p className="p-muted">Restore the starting demo family. This erases all progress.</p>
        <button disabled={busy} className="pbtn danger" onClick={() => confirm("Reset all demo data?") && run("parent/reset", {}, "Demo reset")}>Reset demo</button>
      </section>}
    </div>
  );
}


function Children({ me, refreshMe, run, busy }) {
  const [child, setChild] = useState({ name: "", age: "9", bearName: "" });
  const [links, setLinks] = useState({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const add = async (event) => {
    event.preventDefault();
    const result = await run(async () => {
      const result = await api("parent/children", { ...child, age: Number(child.age) });
      await refreshMe();
      return result;
    }, undefined, "Child added. Set their allowance to get started.");
    if (result) setChild({ name: "", age: "9", bearName: "" });
  };
  const generate = async (id) => {
    const link = await run(() => api(`parent/children/${encodeURIComponent(id)}/link?child=${encodeURIComponent(id)}`, {}));
    if (link) { setLinks((current) => ({ ...current, [id]: link })); setNow(Date.now()); }
  };
  const field = (key) => ({ value: child[key], onChange: (event) => setChild({ ...child, [key]: event.target.value }) });
  return <div className="p-stack">
    <h1>Children</h1>
    <p className="p-muted">Each saver has their own allowance, bear and adventures. Kid codes work once and last 15 minutes.</p>
    {me.children.map((summary) => {
      const link = links[summary.id];
      const seconds = link ? Math.max(0, Math.ceil((link.expiresAt - now) / 1000)) : 0;
      return <section className="p-card" key={summary.id}>
        <div className="row"><div><h2>{summary.name}</h2><p>Age {summary.age} · Bear: {summary.bearName}</p></div><button className="pbtn" disabled={busy} onClick={() => generate(summary.id)}>Generate kid code</button></div>
        <Devices childId={summary.id} busy={busy} />
        {link && <div className="p-stack">
          {seconds > 0 ? <>
            <label className="pform">Kid code<input className="kid-code" readOnly value={link.code} onFocus={(event) => event.target.select()} /></label>
            <p role="status">Expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}. Open “I have a kid code” on your child's device.</p>
            <button className="pbtn" disabled={busy || !navigator.clipboard?.writeText} onClick={() => run(() => navigator.clipboard.writeText(link.code), undefined, "Kid code copied")}>Copy code</button>
          </> : <p role="status">This code expired. Generate a new one.</p>}
        </div>}
      </section>;
    })}
    <form className="p-card pform" onSubmit={add}>
      <h2>Add a child</h2>
      <label>Child's name<input required maxLength={24} {...field("name")} /></label>
      <label>Age<select {...field("age")}>{[7, 8, 9, 10, 11, 12].map((age) => <option key={age} value={age}>{age}</option>)}</select></label>
      <label>Bear's name<input required maxLength={24} {...field("bearName")} /></label>
      <button className="pbtn primary" disabled={busy}>Add child</button>
    </form>
  </div>;
}

function Devices({ childId, busy }) {
  const [devices, setDevices] = useState([]);
  const [error, setError] = useState("");
  const [run, pending] = useAction((message) => setError(message));
  const url = `parent/children/${encodeURIComponent(childId)}/devices?child=${encodeURIComponent(childId)}`;
  const refresh = async () => {
    try { setDevices(await api(url)); setError(""); } catch (err) { setError(err.message); }
  };
  useEffect(() => {
    let active = true;
    const load = async () => {
      try { const next = await api(url); if (active) { setDevices(next); setError(""); } }
      catch (err) { if (active) setError(err.message); }
    };
    load();
    const timer = setInterval(load, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [url]);
  const unlink = (id) => run(async () => {
    await api(`parent/children/${encodeURIComponent(childId)}/devices/${encodeURIComponent(id)}?child=${encodeURIComponent(childId)}`, undefined, { method: "DELETE" });
    setDevices((current) => current.filter((device) => device.id !== id));
    return { ok: true };
  });
  return <div className="p-stack">
    <h3>Devices</h3>
    {error ? <p role="alert">{error} <button className="pbtn" disabled={busy || pending} onClick={refresh}>Try again</button></p> : devices.length === 0 && <p className="p-muted">No paired devices yet.</p>}
    {devices.map((device) => <div className="p-device" key={device.id}>
      <div><strong>{device.name}</strong><p className="p-muted">Paired {formatDateTime(device.created_at)} · Last seen {formatDateTime(device.last_seen)}</p></div>
      <button className="pbtn danger" disabled={busy || pending} onClick={() => unlink(device.id)}>Unlink</button>
    </div>)}
  </div>;
}

function Security({ me, refreshMe, onSignOut, onSignOutAll, run, busy }) {
  const [pin, setPin] = useState("");
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const save = async (event) => {
    event.preventDefault();
    const result = await run(async () => {
      const result = await api("parent/pin", { pin });
      await refreshMe();
      return result;
    }, undefined, "PIN saved");
    if (result) setPin("");
  };
  return <div className="p-stack">
    <h1>Security</h1>
    <form className="p-card pform" onSubmit={save}>
      <h2>{me.family.pinSet ? "Change your PIN" : "Set a parent PIN"}</h2>
      <p className="p-muted">A PIN protects grown-up switches on this device. Keep your password for signing in.</p>
      <label>New PIN<input type="password" inputMode="numeric" autoComplete="new-password" required pattern="[0-9]{4,8}" minLength={4} maxLength={8} value={pin} onChange={(event) => setPin(event.target.value)} /></label>
      <button className="pbtn primary" disabled={busy}>Save PIN</button>
    </form>
    <section className="p-card">
      <h2>Signed-in devices</h2>
      <button className="pbtn" disabled={busy} onClick={() => run(onSignOut)}>Sign out</button>
      <button className="pbtn" disabled={busy} onClick={() => setConfirmSignOut(true)}>Sign out everywhere</button>
      {confirmSignOut && <div className="p-stack">
        <p>Sign out of all family sessions, including kid devices; you will need new kid codes. This device will sign out too.</p>
        <div className="row"><button className="pbtn" disabled={busy} onClick={() => setConfirmSignOut(false)}>Cancel</button><button className="pbtn primary" disabled={busy} onClick={() => run(onSignOutAll)}>Confirm sign out everywhere</button></div>
      </div>}
    </section>
  </div>;
}
