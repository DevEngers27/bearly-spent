import { useState } from "react";
import { money, useAction } from "./api.js";
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
];

const KIND_LABEL = { reward: "Reward", task: "Task check", spend: "Purchase", extra: "Extra allowance", friend: "Friend", trade: "Trade", mission_proposal: "Buddy suggestion", topup: "Funding", review: "Review" };

export default function Parent({ state, toast }) {
  const [sec, setSec] = useState("inbox");
  const [run, busy] = useAction(toast);
  const pending = state.approvals.filter((a) => a.status === "pending");
  const ctx = { state, run, busy };
  return (
    <div className="parent">
      <aside className="p-nav">
        <div className="p-family">
          <BearFigure bear={state.child.bear} size={44} />
          <div><strong>{state.child.name}'s account</strong><small>Managed by {state.family.parentName}</small></div>
        </div>
        <nav aria-label="Parent sections">
          {SECTIONS.map(([id, label]) => (
            <button key={id} className={sec === id ? "on" : ""} onClick={() => setSec(id)} aria-current={sec === id ? "page" : undefined}>
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
        {sec === "goals" && <Goals key={JSON.stringify(state.goals[0] && [state.goals[0].id, state.goals[0].title, state.goals[0].target])} {...ctx} />}
        {sec === "allowance" && <Allowance key={JSON.stringify([state.allowance.amount, state.allowance.savePct, state.allowance.spendLimit, state.allowance.rewardDestination])} {...ctx} />}
        {sec === "activity" && <Activity {...ctx} />}
        {sec === "guardian" && <Guardian {...ctx} />}
        {sec === "buddy" && <BuddyLog {...ctx} />}
        {sec === "settings" && <Settings {...ctx} />}
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

function Inbox({ state, run, pending, busy }) {
  const decided = state.approvals.filter((a) => a.status !== "pending").slice(0, 8);
  return (
    <div className="p-stack">
      <h1>Approvals</h1>
      {pending.length === 0 && <p className="empty">You're all caught up. New requests from {state.child.name}, the Guardian, and Money Buddy show up here.</p>}
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
                  {a.kind === "topup" && <button disabled={busy} className="pbtn primary" onClick={() => run("parent/topup", { amount: 50 }, "Added $50 to funding")}>Add $50</button>}
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
      <ul className="p-feed">
        {state.notifications.slice(0, 8).map((n) => (
          <li key={n.id} className={`k-${n.kind}`}><time>{new Date(n.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</time>{n.text}</li>
        ))}
      </ul>
    </div>
  );
}

function Overview({ state }) {
  const goal = state.goals[0];
  const learned = state.child.stats;
  return (
    <div className="p-stack">
      <h1>Overview</h1>
      <div className="p-figures">
        <Figure label={`${state.child.name}'s savings`} value={money(state.accounts.savings.balance)} sub={goal ? `${Math.round((state.accounts.savings.balance / goal.target) * 100)}% of ${goal.title}` : "Set a savings goal"} />
        <Figure label="Spending money" value={money(state.accounts.spending.balance)} />
        <Figure label="Funding account" value={money(state.accounts.parent.balance)} sub="Simulated" />
        <Figure label="Adventure points" value={state.child.points} sub="Game points, not money" />
      </div>
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
              <tr><td>Postcards collected</td><td>{state.postcards.length}</td></tr>
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
  const [g, setG] = useState({ title: "Complete five financial literacy challenges", type: "lessons", count: 5, reward: 5 });
  const [m, setM] = useState({ title: "", points: 40 });
  const [sg, setSg] = useState({ title: state.goals[0]?.title || "", target: state.goals[0] ? state.goals[0].target / 100 : 50 });
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
              <label>How many<input type="number" min="1" max="50" value={g.count} onChange={(e) => setG({ ...g, count: e.target.value })} /></label>
              <label>Reward ($)<input type="number" min="0" max="100" step="0.5" value={g.reward} onChange={(e) => setG({ ...g, reward: e.target.value })} /></label>
            </div>
            <button disabled={busy} className="pbtn primary">Create goal</button>
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
      <section className="p-card">
        <h2>{state.goals[0] ? "Savings goal" : "Set a savings goal"}</h2>
        {!state.goals[0] && <p>Pick something your child would love to save for.</p>}
        <form className="pform pform-row" onSubmit={(e) => { e.preventDefault(); run("parent/savings-goal", sg, "Savings goal updated"); }}>
          <label>Saving for<input value={sg.title} onChange={(e) => setSg({ ...sg, title: e.target.value })} /></label>
          <label>Target ($)<input type="number" min="1" value={sg.target} onChange={(e) => setSg({ ...sg, target: e.target.value })} /></label>
          <button disabled={busy} className="pbtn">Update</button>
        </form>
      </section>
      <h2>All goals</h2>
      <table className="ptable">
        <thead><tr><th>Goal</th><th>Progress</th><th>Reward</th><th>Status</th></tr></thead>
        <tbody>
          {state.parentGoals.length === 0 && <tr><td colSpan="4" className="p-muted">No goals yet. Create one above.</td></tr>}
          {state.parentGoals.slice().reverse().map((x) => (
            <tr key={x.id}><td>{x.title}</td><td>{x.progress}/{x.count}</td><td>{money(x.reward)}</td><td>{x.status.replace("_", " ")}</td></tr>
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

function Allowance({ state, run, busy }) {
  const a = state.allowance;
  const [f, setF] = useState({ amount: a.amount / 100, savePct: a.savePct, spendLimit: a.spendLimit / 100, rewardDestination: a.rewardDestination });
  return (
    <div className="p-stack">
      <h1>Allowance & limits</h1>
      <p className="p-muted">The Ledger Guardian pays the allowance on schedule, splits it between savings and spending, and holds purchases over your limit for approval. Next payout: {new Date(a.nextRun).toLocaleString()}.</p>
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
        <p>{money(state.accounts.parent.balance)} available (simulated)</p>
        <div className="row">
          <button disabled={busy} className="pbtn" onClick={() => run("parent/topup", { amount: 50 }, "Added $50")}>Add $50</button>
          <button disabled={busy} className="pbtn" onClick={() => run("parent/allowance/run-now", {}, "Fast-forwarded to payday")}>Fast-forward to payday</button>
        </div>
        <p className="p-muted">Fast-forward is a demo control: it moves the schedule to now so you can watch the Guardian pay.</p>
      </section>
    </div>
  );
}

function Activity({ state }) {
  const label = { parent: "Funding", savings: "Savings", spending: "Spending", merchant: "Store" };
  return (
    <div className="p-stack">
      <h1>Transactions</h1>
      <p className="p-muted">Every movement in the simulated ledger. Reversed rows were corrected by the Guardian.</p>
      <table className="ptable">
        <thead><tr><th>When</th><th>What</th><th>From → to</th><th className="num">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {state.transactions.map((t) => (
            <tr key={t.id} className={t.status !== "posted" ? "struck" : t.flagged ? "flag" : ""}>
              <td>{new Date(t.ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
              <td>{t.memo}{t.injected ? " (bank replay)" : ""}</td>
              <td>{label[t.from]} → {label[t.to]}</td>
              <td className="num">{money(t.amount)}</td>
              <td>{t.status}{t.flagged ? " · flagged" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Guardian({ state, run, busy }) {
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
      <section className="p-card demo">
        <h2>Try it: simulate a bank glitch</h2>
        <p className="p-muted">Makes the simulated bank post the last reward or allowance twice, the way a replayed webhook would. Watch the Guardian catch it on its next check, within a couple of seconds.</p>
        <button disabled={busy} className="pbtn" onClick={() => run("parent/inject-fault", {}, "Bank glitch injected. Watch the log.")}>Post a duplicate</button>
      </section>
      <div className="row">
        <h2>Decision log</h2>
        <label className="toggle"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show all activity</label>
      </div>
      <ol className="audit">
        {rows.slice(0, 60).map((a) => (
          <li key={a.id} className={`actor-${a.actor}`}>
            <time>{new Date(a.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</time>
            <span className="actor">{a.actor}</span>
            <span>{a.detail}</span>
          </li>
        ))}
        {rows.length === 0 && <li className="p-muted">No decisions yet.</li>}
      </ol>
    </div>
  );
}

function BuddyLog({ state }) {
  return (
    <div className="p-stack">
      <h1>Money Buddy chats</h1>
      <p className="p-muted">Everything {state.child.name} and Money Buddy said. Personal details like phone numbers are removed before messages reach the AI. Buddy can't move money; any mission it suggests comes to you first.</p>
      <ol className="transcript">
        {state.chat.length === 0 && <li className="p-muted">No conversations yet.</li>}
        {state.chat.map((m) => (
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

function Settings({ state, run, busy }) {
  const s = state.settings;
  const toggle = (k) => run("parent/settings", { [k]: !s[k] }, "Saved");
  return (
    <div className="p-stack">
      <h1>Friends & privacy</h1>
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
      <section className="p-card">
        <h2>Demo data</h2>
        <p className="p-muted">Restore the starting demo family. This erases all progress.</p>
        <button disabled={busy} className="pbtn danger" onClick={() => confirm("Reset all demo data?") && run("parent/reset", {}, "Demo reset")}>Reset demo</button>
      </section>
    </div>
  );
}
