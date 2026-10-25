import Markdown from "./Markdown.jsx";
import { useEffect, useRef, useState } from "react";
import { api, money, moneyShort, plural, formatTime, formatDateTime, postcardMetrics, useAction, GOAL_ICONS, goalIconName, goalLabel, goalStatusLabel, currentSavingsGoal } from "./api.js";
import { BearFigure, bearScale } from "./Bear.jsx";
import ChildProfileForm from "./ChildProfileForm.jsx";
import Account from "./Account.jsx";
import { Icon } from "./Icons.jsx";
import { useParentNavigation, MONEY_SECTIONS, KIDS_SECTIONS, MORE_SECTIONS, PARENT_TABS } from "./ParentNavigation.js";

const SECTIONS = [
  ["inbox", "Approvals"],
  ["overview", "Overview"],
  ["goals", "Goals & tasks"],
  ["allowance", "Allowance"],
  ["activity", "Transactions"],
  ["guardian", "Guardian log"],
  ["buddy", "Buddy chats"],
  ["help", "Ask about MoneyQuest"],
  ["settings", "Friends & privacy"],
  ["children", "Children"],
  ["account", "Account"],
  ["security", "Security"],
];

const KIND_LABEL = { goal_purchase: "Goal purchase", child_funds: "Child funds", reward: "Reward", task: "Task check", spend: "Purchase", extra: "Extra allowance", friend: "Friend", friend_request: "Friend request", trade: "Trade", mission_proposal: "Buddy suggestion", topup: "Funding", review: "Review", wallet_pending: "Apple Cash" };
const BROWSER_TIMEZONE = Intl.DateTimeFormat("en-US").resolvedOptions().timeZone || "UTC";
const TIMEZONES = Intl.supportedValuesOf ? Intl.supportedValuesOf("timeZone") : [];

export default function Parent({ state, toast, me, refreshMe, onSignOut, onSignOutAll, offline }) {
  const { mobile, sec, opened, tab, selectSection, selectTab, backToMore } = useParentNavigation();
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
  const pending = state.approvals.filter((a) => a.status === "pending" || (a.kind === "goal_purchase" && a.status === "approved" && !a.paidTxnId));
  const pendingCount = pending.length + (state.walletPending?.length || 0);
  const ctx = { state, run, busy, demo: me?.demo === true, onAddMoney, mobile };
  const main = useRef(null);
  useEffect(() => {
    if (!mobile || sec === "allowance") return; // Allowance manages its own focus (Add money)
    window.scrollTo({ top: 0 });
    main.current?.focus({ preventScroll: true });
  }, [mobile, sec]);
  const segments = tab === "money" ? MONEY_SECTIONS : tab === "kids" ? KIDS_SECTIONS : null;
  const pushed = mobile && MORE_SECTIONS.some(([id]) => id === sec);
  return (
    <div className="parent">
      {!mobile && <aside className="p-nav">
        <div className="p-family">
          <BearFigure bear={state.child.bear} size={44} />
          <div><strong>{state.child.name}'s account</strong><small>Managed by {state.family.parentName}</small></div>
        </div>
        <nav aria-label="Parent sections">
          {SECTIONS.map(([id, label]) => (
            <button key={id} className={sec === id ? "on" : ""} onClick={() => selectSection(id)} aria-current={sec === id ? "page" : undefined}>
              {label}
              {id === "inbox" && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
            </button>
          ))}
        </nav>
        <Integrations state={state} />
        <a className="p-help-link" href="/help" target="_blank" rel="noopener noreferrer">Help</a>
      </aside>}
      <main className={`p-main${pushed ? " p-pushed" : ""}`} id="main" ref={main} tabIndex={-1}>
        {mobile && segments && <nav className="p-segments" aria-label={tab === "money" ? "Money sections" : "Kids sections"}>
          {segments.map(([id, label]) => <button key={id} className={sec === id ? "on" : ""} aria-current={sec === id ? "page" : undefined} onClick={() => selectSection(id)}>{label}</button>)}
        </nav>}
        {pushed && <button className="p-back" onClick={backToMore}><span aria-hidden="true">‹</span> Back to More</button>}
        {mobile && sec === "more" && <div className="p-stack">
          <h1>More</h1>
          <nav className="p-more" aria-label="More sections">
            {MORE_SECTIONS.map(([id, label]) => <button key={id} onClick={() => selectSection(id)}>{label}<span aria-hidden="true">›</span></button>)}
          </nav>
          <section className="p-card p-status"><h2>Integrations & status</h2><Integrations state={state} /></section>
          <a href="/help" target="_blank" rel="noopener noreferrer">Help</a>
        </div>}
        {sec === "inbox" && <Inbox {...ctx} pending={pending} />}
        {sec === "overview" && <Overview {...ctx} />}
        {opened.includes("goals") && <div hidden={sec !== "goals"}><Goals {...ctx} /></div>}
        {opened.includes("allowance") && <div hidden={sec !== "allowance"}><Allowance key={JSON.stringify([state.allowance.amount, state.allowance.savePct, state.allowance.spendLimit, state.allowance.rewardDestination])} {...ctx} fundingFocus={fundingFocus} /></div>}
        {sec === "activity" && <Activity {...ctx} />}
        {sec === "guardian" && <Guardian {...ctx} />}
        {sec === "buddy" && <BuddyLog {...ctx} />}
        {sec === "help" && <ParentHelp offline={offline} />}
        {sec === "settings" && <Settings {...ctx} />}
        {sec === "children" && <Children me={me} refreshMe={refreshMe} {...ctx} />}
        {sec === "account" && <Account key={JSON.stringify([me.user, me.family.displayName])} me={me} refreshMe={refreshMe} run={run} busy={busy} />}
        {sec === "security" && <Security me={me} refreshMe={refreshMe} onSignOut={onSignOut} onSignOutAll={onSignOutAll} {...ctx} />}
      </main>
      {mobile && <nav className="p-tabs" aria-label="Parent tabs">
        {PARENT_TABS.map(([id, label, icon]) => <button key={id} className={tab === id ? "on" : ""} aria-current={tab === id ? "page" : undefined} aria-label={id === "inbox" && pendingCount ? `Inbox, ${pendingCount} pending` : label} onClick={() => selectTab(id)}>
          <span className="p-tab-icon"><Icon name={icon} size={24} art={false} />{id === "inbox" && pendingCount > 0 && <span className="badge">{pendingCount}</span>}</span>
          <span>{label}</span>
        </button>)}
      </nav>}
    </div>
  );
}

function ParentHelp({ offline }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const inflight = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const ask = async (event) => {
    event.preventDefault();
    if (inflight.current || offline || !question.trim()) return;
    inflight.current = true; setPending(true); setError(""); setAnswer("");
    try {
      const result = await api("parent/help/ask", { question: question.trim() });
      if (active.current) setAnswer(result.answer);
    } catch (err) {
      if (active.current) setError(err.message);
    } finally {
      inflight.current = false;
      if (active.current) setPending(false);
    }
  };
  return <div className="p-stack parent-help">
    <h1>Ask about MoneyQuest</h1>
    <p className="p-muted">Get steps for using the app. Questions and answers aren't saved. Keep passwords, codes and tokens private.</p>
    <form className="p-card pform" onSubmit={ask}>
      <label htmlFor="parent-help-question">Your question</label>
      <textarea id="parent-help-question" required maxLength={500} rows={3} value={question} disabled={pending || offline} onChange={(event) => setQuestion(event.target.value)} placeholder="How do I connect my child's device?" />
      <button className="pbtn primary" disabled={pending || offline || !question.trim()}>{pending ? "Finding help…" : "Ask"}</button>
    </form>
    {offline && <p role="status">Connect to ask a question. The Help guide is also available below when connected.</p>}
    {error && <p role="alert">{error}</p>}
    <div aria-live="polite" aria-busy={pending}>{answer && <section className="p-card" aria-label="Help answer"><Markdown text={answer} /></section>}</div>
    <a href="/help" target="_blank" rel="noopener noreferrer">Help</a>
  </div>;
}

function Integrations({ state }) {
  const i = state.integrations;
  return (
    <dl className="integrations">
      <dt>Money Buddy</dt><dd>{i.buddy === "claude" ? "Claude (live)" : "Offline planner"}</dd>
      <dt>Bank</dt><dd>{i.bank === "nessie" ? "Simulated + Nessie sandbox" : "Simulated ledger"}</dd>
    </dl>
  );
}

function Inbox({ state, run, demo, pending, busy, onAddMoney, mobile }) {
  const notifications = state.notifications.filter((n) => !n.read);
  const receipts = state.walletPending || [];
  const pendingCount = pending.length + receipts.length;
  const decided = state.approvals.filter((a) => a.status !== "pending").slice(0, 8);
  return (
    <div className="p-stack">
      <h1>Approvals{mobile && pendingCount > 0 && <span className="badge">{pendingCount}</span>}</h1>
      {pendingCount === 0 && <p className="empty">Nothing waiting — nice!</p>}
      <ul className="approval-list">
        {receipts.map((receipt) => <li key={receipt.id} className="approval k-wallet_pending">
          <span className="kind-tag">{KIND_LABEL.wallet_pending}</span>
          <div className="approval-body"><strong>{state.child.name}'s Apple Cash spent {money(receipt.amount)} at {receipt.merchant}</strong><p>Waiting for savings · {formatDateTime(receipt.ts)}</p><p>Your child can add received money in My money → Received. Then this receipt can be recorded.</p></div>
          <div className="approval-actions">
            <button disabled={busy} className="pbtn" onClick={() => run(`parent/wallet/pending/${receipt.id}/record`, {}, "Apple Cash purchase recorded")}>Record now</button>
            <button disabled={busy} className="pbtn" onClick={() => run(`parent/wallet/pending/${receipt.id}/dismiss`, {}, "Receipt dismissed")}>Dismiss</button>
          </div>
        </li>)}
        {pending.map((a) => (
          <li key={a.id} className={`approval k-${a.kind}`}>
            <span className="kind-tag">{KIND_LABEL[a.kind] || a.kind}</span>
            <div className="approval-body">
              <strong>{a.title}</strong>
              {a.kind === "friend_request" && state.friends.some((f) => f.id === a.socialId && !f.incoming) ? <p>Approving sends the request to the other family; they also have to agree</p> : a.detail && <p>{a.detail}</p>}
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
                  <button disabled={busy || a.status === "approved"} className="pbtn primary" onClick={() => run(`parent/approval/${a.id}`, { approve: true }, a.kind === "reward" ? `Approved. The Guardian is sending ${money(a.amount)}.` : "Approved")}>
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
          <table className="ptable" role="table">
            <tbody>
              {decided.map((a) => (
                <tr key={a.id}>
                  <td data-label="Kind"><span className="p-cell-value">{KIND_LABEL[a.kind] || a.kind}</span></td>
                  <td data-label="Request"><span className="p-cell-value">{a.title}</span></td>
                  <td data-label="Status" className={a.status === "approved" ? "pos" : "neg"}><span className="p-cell-value">{a.real && a.kind === "friend_request" && a.status === "declined" ? "didn't go through" : a.status}{a.paidTxnId ? " · paid" : ""}</span></td>
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
  const goal = currentSavingsGoal(state);
  const learned = state.child.stats;
  return (
    <div className="p-stack">
      <h1>Overview</h1>
      <div className="p-figures">
        <Figure label={`${state.child.name}'s savings`} value={money(state.accounts.savings.balance)} sub={goal ? `${Math.round((state.accounts.savings.balance / goal.target) * 100)}% of ${goal.title}` : "Set a savings goal"} />
        <Figure label="Spending money" value={money(state.accounts.spending.balance)} />
        <Figure label="Funding account" value={money(state.accounts.parent.balance)} sub="Covers allowance and rewards" />
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
          <table className="ptable ptable-summary" role="table">
            <tbody>
              <tr><td>Money lessons passed</td><td>{learned.learningDone} ({state.child.lessonsDone.length}/{state.catalog.lessons.length} unique)</td></tr>
              <tr><td>Savings actions</td><td>{learned.savingsActions}</td></tr>
              <tr><td>Days with money tracked</td><td>{learned.tracked}</td></tr>
              <tr><td>Weekly budgets planned</td><td>{learned.budgetsDone}{state.child.lastBudget && <small className="p-muted"> · {moneyShort(state.child.lastBudget.total)}: {Object.entries(state.child.lastBudget.allocations).map(([k, v]) => `${k} ${v / 100}`).join(" · ")}</small>}</td></tr>
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

function Goals({ state, run, busy, mobile }) {
  const remaining = state.catalog.lessons.filter((l) => !state.child.lessonsDone.includes(l.id)).length;
  const [g, setG] = useState({ title: "Complete money lessons", type: remaining ? "lessons" : "tasks", count: remaining || 1, reward: 5 });
  const [m, setM] = useState({ title: "", points: 40 });
  const lessonCountError = g.type === "lessons" && (remaining === 0 ? "All money lessons are complete. Choose tasks or times saved instead." : Number(g.count) > remaining ? `Only ${remaining} ${plural(remaining, "lesson")} remaining. Choose ${remaining} or fewer.` : "");
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
              <label>How many{g.type === "lessons" && <small>{remaining} lessons remaining</small>}<input type="number" inputMode={mobile ? "numeric" : undefined} min="1" max={g.type === "lessons" ? remaining : 50} value={g.count} aria-invalid={Boolean(lessonCountError)} aria-describedby={lessonCountError ? "lesson-count-error" : undefined} onChange={(e) => setG({ ...g, count: e.target.value })} />{lessonCountError && <small id="lesson-count-error" role="status">{lessonCountError}</small>}</label>
              <label>Reward ($)<input type="number" inputMode="decimal" min="0" max="100" step="0.5" value={g.reward} onChange={(e) => setG({ ...g, reward: e.target.value })} /></label>
            </div>
            <button disabled={busy || Boolean(lessonCountError)} className="pbtn primary">Create goal</button>
          </form>
        </section>
        <section className="p-card">
          <h2>Assign a task</h2>
          <p className="p-muted">Tasks earn adventure points after you confirm them.</p>
          <form className="pform" onSubmit={async (e) => { e.preventDefault(); if (await run("parent/mission", m, "Task assigned")) setM({ ...m, title: "" }); }}>
            <label>Task<input value={m.title} onChange={(e) => setM({ ...m, title: e.target.value })} placeholder="e.g. Compare prices on 3 cereals" required /></label>
            <label>Points<input type="number" inputMode="numeric" min="5" max="100" value={m.points} onChange={(e) => setM({ ...m, points: e.target.value })} /></label>
            <button disabled={busy} className="pbtn primary">Assign task</button>
          </form>
        </section>
      </div>
      <h2>Savings goals</h2>
      {state.goals.map((goal) => <SavingsGoal key={JSON.stringify([goal.id, goal.title, goal.target, goal.icon])} goal={goal} state={state} run={run} busy={busy} />)}
      <SavingsGoal key="new" create state={state} run={run} busy={busy} />
      <h2>All goals</h2>
      <table className="ptable" role="table">
        <thead><tr><th>Goal</th><th>Progress</th><th>Reward</th><th>Status</th></tr></thead>
        <tbody>
          {state.parentGoals.length === 0 && <tr><td colSpan="4" className="p-muted">No goals yet. Create one above.</td></tr>}
          {state.parentGoals.slice().reverse().map((x) => (
            <tr key={x.id} className={x.status === "cancelled" ? "struck" : ""}><td data-label="Goal"><span className="p-cell-value">{x.title}</span></td><td data-label="Progress"><span className="p-cell-value">{x.progress}/{x.count}</span></td><td data-label="Reward"><span className="p-cell-value">{money(x.reward)}</span></td><td data-label="Status"><span className="p-cell-value">{x.status.replace("_", " ")}{x.status === "active" && <button disabled={busy} className="pbtn" onClick={() => run(`parent/goal/${x.id}/cancel`, {}, "Goal cancelled")}>Cancel</button>}</span></td></tr>
          ))}
        </tbody>
      </table>
      <h2>Tasks</h2>
      <table className="ptable" role="table">
        <tbody>
          {state.missions.length === 0 && <tr><td className="p-muted">No tasks assigned yet.</td></tr>}
          {state.missions.slice().reverse().map((x) => (
            <tr key={x.id}><td data-label="Task"><span className="p-cell-value">{x.title}</span></td><td data-label="Points"><span className="p-cell-value">+{x.points} pts</span></td><td data-label="Status"><span className="p-cell-value">{x.status.replace("_", " ")}</span></td><td data-label="Created by" className="p-muted"><span className="p-cell-value">{x.createdBy}</span></td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SavingsGoal({ state, goal, create = false, run, busy }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const selected = create ? null : goal || currentSavingsGoal(state);
  const [sg, setSg] = useState({ title: selected?.title || "", target: selected ? selected.target / 100 : 50, icon: selected?.icon || "bike" });
  const live = !selected?.status || ["active", "reached"].includes(selected.status);
  const editable = live || selected?.status === "archived";
  const current = selected && selected.id === (state.currentGoalId ?? state.child.currentGoalId);
  const waiting = selected && state.approvals.some((a) => a.kind === "goal_purchase" && a.goalId === selected.id && ["pending", "approved"].includes(a.status) && !a.paidTxnId);
  return (
    <section className="p-card">
      <h2>{selected ? `${selected.title} (${goalLabel(selected.icon)})` : "Set a savings goal"}</h2>
      {selected && <p>{goalStatusLabel(selected.status)}{current ? " · Current goal" : ""}</p>}
      {!selected && <p>Pick something your child would love to save for.</p>}
      <form className="pform pform-row" onSubmit={async (e) => { e.preventDefault(); if (await run(`parent/goals${selected ? `/${selected.id}` : ""}`, sg, selected ? "Savings goal updated" : "Savings goal created")) { if (!selected) setSg({ title: "", target: 50, icon: "bike" }); } }}>
        <label>Saving for<input required maxLength={40} disabled={busy || !editable || waiting} value={sg.title} onChange={(e) => setSg({ ...sg, title: e.target.value })} /></label>
        <label>Target ($)<input required type="number" inputMode="decimal" min="1" max="1000" step="0.01" disabled={busy || !editable || waiting} value={sg.target} onChange={(e) => setSg({ ...sg, target: e.target.value })} /></label>
        <fieldset className="goal-pictures" disabled={busy || !editable || waiting}><legend>Picture</legend><div className="goal-picture-row">{GOAL_ICONS.map((icon) => <button type="button" key={icon} aria-pressed={sg.icon === icon} onClick={() => setSg({ ...sg, icon })}><Icon name={goalIconName(icon)} size={26} /><span>{goalLabel(icon)}</span></button>)}</div></fieldset>
        <button disabled={busy || !editable || waiting} className="pbtn">{selected ? "Update" : "Create savings goal"}</button>
      </form>
      {selected && <div className="btn-row">
        {selected.status === "archived" && <button disabled={busy} className="pbtn" onClick={() => run(`parent/goals/${selected.id}/restore`, {}, "Goal brought back")}>Bring back</button>}
        {live && !current && <button disabled={busy} className="pbtn" onClick={() => run(`parent/goals/${selected.id}/current`, {}, "Current goal changed")}>Make current</button>}
        {live && <button disabled={busy || waiting} className="pbtn" onClick={() => run(`parent/goals/${selected.id}/archive`, {}, "Goal archived")}>Archive</button>}
        <button disabled={busy || current || waiting || selected.status === "bought"} className="pbtn" onClick={() => setConfirmDelete(true)}>Delete</button>
        {confirmDelete && <div className="p-stack"><p>Delete {selected.title}?</p><div className="row"><button className="pbtn" disabled={busy} onClick={() => setConfirmDelete(false)}>Cancel</button><button className="pbtn danger" disabled={busy || current || waiting || selected.status === "bought"} onClick={async () => { if (await run(`parent/goals/${selected.id}`, undefined, "Goal deleted", { method: "DELETE" })) setConfirmDelete(false); }}>Confirm delete</button></div></div>}
        {(current || waiting || selected.status === "bought") && <small className="p-muted" role="note">{selected.status === "bought" ? "Bought goals stay as a memory; they can't be changed or deleted." : waiting ? "Waiting for the purchase decision first." : "Choose another current goal before deleting this one."}</small>}
      </div>}
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
          <label>Weekly allowance ($)<input type="number" inputMode="decimal" min="0" max="100" step="0.5" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></label>
          <label>Saved automatically (%)<input type="number" inputMode="numeric" min="0" max="100" value={f.savePct} onChange={(e) => setF({ ...f, savePct: e.target.value })} /></label>
          <label>Purchase limit without approval ($)<input type="number" inputMode="decimal" min="0" step="1" value={f.spendLimit} onChange={(e) => setF({ ...f, spendLimit: e.target.value })} /></label>
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
          <label>Amount ($)<input ref={fundingAmount} type="number" inputMode="decimal" required min="1" max="1000" step="0.01" disabled={busy} value={funding.amount} onChange={(e) => setFunding({ ...funding, amount: e.target.value })} /></label>
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
  const label = { external: "Set aside", outside: "From you", parent: "Funding", savings: "Savings", spending: "Spending", wallet: "Apple Cash", merchant: "Store" };
  return (
    <div className="p-stack">
      <h1>Transactions</h1>
      <p className="p-muted">Every movement in the simulated ledger. Reversed rows were corrected by the Guardian.</p>
      <table className="ptable" role="table">
        <thead><tr><th>When</th><th>What</th><th>From → to</th><th className="num">Amount</th><th>Status</th></tr></thead>
        <tbody>
          {state.transactions.map((t) => (
            <tr key={t.id} className={t.status !== "posted" ? "struck" : t.flagged ? "flag" : ""}>
              <td data-label="When"><span className="p-cell-value">{formatDateTime(t.ts)}</span></td>
              <td data-label="What"><span className="p-cell-value">{t.kind === "wallet_in" ? "Sent via Apple Cash (before 0.7)" : t.memo}{["wallet_in", "wallet_spend", "wallet_received"].includes(t.kind) && <small className="wallet-tag">Apple Cash</small>}{t.injected ? " (bank replay)" : ""}{t.note && <small> · {t.note}</small>}</span></td>
              <td data-label="From → to"><span className="p-cell-value">{label[t.from]} → {label[t.to]}</span></td>
              <td data-label="Amount" className="num"><span className="p-cell-value">{money(t.amount)}</span></td>
              <td data-label="Status"><span className="p-cell-value">{t.status === "reversed" ? "duplicate reversed by Guardian" : t.status}{t.flagged ? " · flagged" : ""}{t.uncovered ? " · uncovered" : ""}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Older audit entries used raw settings JSON and omitted the allowance currency.
function auditDetail(entry) {
  if (entry.action === "allowance_updated") return entry.detail.replace(/^Allowance (?=\d)/, "Allowance $");
  if (entry.action !== "settings" || !entry.detail.startsWith("Updated settings:")) return entry.detail;
  try {
    const update = JSON.parse(entry.detail.slice("Updated settings:".length));
    const labels = { requireTradeApproval: "Trade approval", buddyEnabled: "Buddy", coopChallenge: "Team challenge" };
    return Object.entries(update).map(([key, value]) => key === "timezone" ? `Time zone set to ${value}` : labels[key] ? `${labels[key]} turned ${value ? "on" : "off"}` : "").filter(Boolean).join(". ") || "Settings unchanged";
  } catch { return "Settings updated"; }
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
            <span>{auditDetail(a)}</span>
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
            <Markdown text={m.text} />
            {m.tools?.length > 0 && <small>Used: {[...new Set(m.tools)].join(", ")}</small>}
            {m.redacted?.length > 0 && <small className="neg">Removed: {m.redacted.join(", ")}</small>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Settings({ state, run, demo, busy }) {
  const [confirmFriend, setConfirmFriend] = useState(null);
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
        <label className="switch"><input type="checkbox" disabled={busy} checked={s.buddyEnabled} onChange={() => toggle("buddyEnabled")} /> Money Buddy is {s.buddyEnabled ? "on" : "off"}</label>
        {demo && <label className="switch"><input type="checkbox" disabled={busy} checked={s.coopChallenge} onChange={() => toggle("coopChallenge")} /> Team challenges with friends</label>}
        <p className="p-muted">Friends can only see {state.child.name}'s bear, postcards and prewritten greetings. Balances, transactions and allowance stay private. There's no open chat.</p>
      </section>
      <h2>Friends</h2>
      {!state.friends.length && <p className="p-muted">Add a friend with their code. Both children and both parents must agree.</p>}
      <table className="ptable" role="table">
        <tbody>
          {state.friends.map((f) => <tr key={f.id}><td data-label="Friend"><span className="p-cell-value">{f.name || "Friend request"}</span></td><td data-label="Status"><span className="p-cell-value">{f.status.replaceAll("_", " ")}</span></td><td data-label="Action"><span className="p-cell-value">{f.real && f.status === "approved" && <button className="pbtn danger" disabled={busy} onClick={() => setConfirmFriend(f.id)}>Unfriend</button>}</span></td></tr>)}
        </tbody>
      </table>
      {confirmFriend && <div className="p-stack"><p>Unfriend {state.friends.find((f) => f.id === confirmFriend)?.name}?</p><div className="row"><button className="pbtn" disabled={busy} onClick={() => setConfirmFriend(null)}>Cancel</button><button className="pbtn danger" disabled={busy} onClick={async () => { if (await run(`parent/friend/${confirmFriend}/remove`, {}, "Friend removed")) setConfirmFriend(null); }}>Confirm unfriend</button></div></div>}
      {demo && <section className="p-card">
        <h2>Demo data</h2>
        <p className="p-muted">Restore the starting demo family. This erases all progress.</p>
        <button disabled={busy} className="pbtn danger" onClick={() => confirm("Reset all demo data?") && run("parent/reset", {}, "Demo reset")}>Reset demo</button>
      </section>}
    </div>
  );
}


function Children({ state, me, refreshMe, run, busy }) {
  useEffect(() => { if (state) refreshMe().catch(() => {}); }, [state?.version]);
  const [child, setChild] = useState({ name: "", age: "9", bearName: "" });
  const [adding, setAdding] = useState(false);
  const linksKey = `mq_kid_links:${encodeURIComponent(me.family.id)}`;
  const [links, setLinks] = useState(() => { try { return JSON.parse(sessionStorage.getItem(linksKey) || "{}"); } catch { return {}; } });
  useEffect(() => { try { sessionStorage.setItem(linksKey, JSON.stringify(links)); } catch {} }, [linksKey, links]);
  const [confirmation, setConfirmation] = useState(null);
  const [shortcutVersions, setShortcutVersions] = useState({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const pending = Object.entries(links).filter(([, link]) => !link.status);
    if (!pending.length) return;
    let active = true, inflight = false;
    const load = async () => {
      if (inflight) return;
      inflight = true;
      await Promise.all(pending.map(async ([id, link]) => {
        try {
          const result = await api(`parent/children/${encodeURIComponent(id)}/link?child=${encodeURIComponent(id)}&code=${encodeURIComponent(link.code)}`);
          if (active && ["linked", "expired"].includes(result.status)) setLinks((current) => current[id]?.code === link.code ? { ...current, [id]: { ...current[id], status: result.status } } : current);
        } catch {
          // A failed status read is not evidence that the code was used.
        }
      }));
      inflight = false;
    };
    load();
    const timer = setInterval(load, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [links]);
  const add = async (event) => {
    event.preventDefault();
    const result = await run(async () => {
      const result = await api("parent/children", { ...child, age: Number(child.age) });
      await refreshMe();
      return result;
    }, undefined, "Child added. Set their allowance to get started.");
    if (result) { setChild({ name: "", age: "9", bearName: "" }); setAdding(false); }
  };
  const generate = async (id) => {
    const link = await run(() => api(`parent/children/${encodeURIComponent(id)}/link?child=${encodeURIComponent(id)}`, {}));
    if (link) { setLinks((current) => ({ ...current, [id]: link })); setNow(Date.now()); }
  };
  const field = (key) => ({ value: child[key], onChange: (event) => setChild({ ...child, [key]: event.target.value }) });
  return <div className="p-stack">
    <h1>Children</h1>
    <p className="p-muted">Each saver has their own allowance, bear and adventures. Kid codes work once and last 15 minutes.</p>
    <button className="pbtn primary add-child" disabled={busy} aria-expanded={adding} onClick={() => setAdding((value) => !value)}>Add a child</button>
    {adding && <form className="p-card pform" onSubmit={add}>
      <h2>Add a child</h2>
      <label>Child's name<input required maxLength={24} {...field("name")} /></label>
      <label>Age<select {...field("age")}>{[7, 8, 9, 10, 11, 12].map((age) => <option key={age} value={age}>{age}</option>)}</select></label>
      <label>Bear's name<input required maxLength={24} {...field("bearName")} /></label>
      <button className="pbtn primary" disabled={busy}>Add child</button>
      <button type="button" className="pbtn" disabled={busy} onClick={() => setAdding(false)}>Cancel</button>
    </form>}
    {me.children.map((summary) => {
      const link = links[summary.id];
      const seconds = link ? Math.max(0, Math.ceil((link.expiresAt - now) / 1000)) : 0;
      return <section className="p-card child-card" key={summary.id}>
        <header><h2>{summary.name}</h2><p>Age {summary.age} · Bear: {summary.bearName}</p></header>
        <section className="kid-signin p-stack" aria-label="Sign in on your child's device">
          <h3>Sign in on your child's device</h3>
          <button className="pbtn primary kid-code-button" disabled={busy} onClick={() => generate(summary.id)}>Get a kid code</button>
          {link && <div className="p-stack">
            {link.status === "linked" ? <p role="status">Linked ✓</p> : seconds > 0 && link.status !== "expired" ? <>
              <label className="pform">Kid code<input className="kid-code" readOnly value={link.code} onFocus={(event) => event.target.select()} /></label>
              <p role="status">Expires in {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}. Open “I have a kid code” on your child's device.</p>
              <button className="pbtn" disabled={busy || !navigator.clipboard?.writeText} onClick={() => run(() => navigator.clipboard.writeText(link.code), undefined, "Kid code copied")}>Copy code</button>
            </> : <p role="status">This code expired. Generate a new one.</p>}
          </div>}
        </section>
        <ChildProfileForm key={JSON.stringify(summary)} summary={summary} refreshMe={refreshMe} run={run} busy={busy} />
        {summary.friendCode && <section className="friend-code-section p-stack" aria-label="Friend code">
          <h3>Friend code — for adding friends, not for signing in</h3>
          <label className="pform">Friend code<input className="kid-code" readOnly value={summary.friendCode || ""} onFocus={(event) => event.target.select()} /></label>
          <p className="p-muted">Share with a friend's family. This code stays valid until you replace it. It cannot pair a device.</p>
          <button className="pbtn" disabled={busy} onClick={() => setConfirmation({ childId: summary.id, kind: "code" })}>Replace friend code</button>
          {(summary.friends || []).map((f) => <div className="row" key={f.id}><span>{f.name} · {f.status.replaceAll("_", " ")}</span>{f.status === "approved" && <button className="pbtn danger" disabled={busy} onClick={() => setConfirmation({ childId: summary.id, kind: "friend", friend: f })}>Unfriend</button>}</div>)}
          {confirmation?.childId === summary.id && <div className="p-stack">
            <p>{confirmation.kind === "code" ? `Replace ${summary.name}'s friend code? The old code will stop working.` : `Unfriend ${confirmation.friend.name}?`}</p>
            <div className="row"><button className="pbtn" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button className="pbtn danger" disabled={busy} onClick={async () => {
              const result = await run(async () => {
                const result = await api(confirmation.kind === "code" ? `parent/children/${encodeURIComponent(summary.id)}/friend-code?child=${encodeURIComponent(summary.id)}` : `parent/friend/${confirmation.friend.id}/remove?child=${encodeURIComponent(summary.id)}`, {});
                await refreshMe();
                return result;
              }, undefined, confirmation.kind === "code" ? "Friend code replaced" : "Friend removed");
              if (result) setConfirmation(null);
            }}>Confirm {confirmation.kind === "code" ? "replace code" : "unfriend"}</button></div>
          </div>}
        </section>}
        <Devices key={`${summary.id}:${shortcutVersions[summary.id] || 0}`} childId={summary.id} busy={busy} onUnlink={(device) => {
          if (device?.kind === "shortcut") setShortcutVersions((current) => ({ ...current, [summary.id]: (current[summary.id] || 0) + 1 }));
        }} />
        <AppleCashTracking key={`${summary.id}:${shortcutVersions[summary.id] || 0}`} childId={summary.id} pinSet={me.family.pinSet} busy={busy} refreshKey={state} onUnlink={() => setShortcutVersions((current) => ({ ...current, [summary.id]: (current[summary.id] || 0) + 1 }))} />
      </section>;
    })}
    {state && <WalletLedger state={state} run={run} busy={busy} />}
  </div>;
}

function WalletLedger({ state }) {
  const rows = [
    ...(state.walletPending || []).map((r) => ({ ...r, memo: r.merchant, status: "waiting for savings" })),
    ...(state.walletTransactions || []).filter((t) => t.kind === "wallet_spend"),
  ];
  return <section className="p-card p-stack">
    <h2>Apple Cash activity</h2>
    <p>Savings available for Apple Cash: <strong>{money(state.accounts.savings.balance)}</strong></p>
    <p className="p-muted">Apple Cash purchases deduct from the child’s savings. Received money can be added in My money → Received. Check actual payments in Wallet.</p>
    <p>Apple Cash spent this week: <strong>{money(state.walletSpent?.week ?? 0)}</strong> · This month: <strong>{money(state.walletSpent?.month ?? 0)}</strong></p>
    {state.walletLastPing && <p>Last connection test: {formatDateTime(state.walletLastPing)}</p>}
    <table className="ptable" role="table"><thead><tr><th>When</th><th>What</th><th>Amount</th><th>Status</th></tr></thead><tbody>
      {!rows.length && <tr><td colSpan="4">No Apple Cash activity yet.</td></tr>}
      {rows.map((t) => <tr key={t.id}><td data-label="When"><span className="p-cell-value">{formatDateTime(t.ts)}</span></td><td data-label="What"><span className="p-cell-value">{t.memo}<small className="wallet-tag">Apple Cash</small></span></td><td data-label="Amount"><span className="p-cell-value">−{money(t.amount)}</span></td><td data-label="Status"><span className="p-cell-value">{t.status}{t.overLimit ? " · above purchase limit" : ""}{t.unusual ? " · unusual spend" : ""}{t.flagged ? " · flagged" : ""}{t.uncovered ? " · uncovered (before 0.7)" : ""}</span></td></tr>)}
    </tbody></table>
  </section>;
}

function AppleCashTracking({ childId, pinSet, busy, refreshKey, onUnlink }) {
  const [credential, setCredential] = useState(null);
  const credentialEpoch = useRef(0);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [run, pending] = useAction((text) => setMessage(text));
  const path = `child/wallet/token?child=${encodeURIComponent(childId)}`;
  useEffect(() => {
    let active = true;
    const epoch = credentialEpoch.current;
    if (pinSet) api(path).then((result) => { if (active && epoch === credentialEpoch.current) setCredential(result); }).catch((err) => { if (active && epoch === credentialEpoch.current) setMessage(err.message); });
    return () => { active = false; };
  }, [path, pinSet, refreshKey]);
  const generate = async () => {
    credentialEpoch.current++;
    const result = await run(() => api(path, {}));
    credentialEpoch.current++;
    if (result) { setCredential(result); setToken(result.token); setMessage("Copy this token now. Rotating it disconnects the previous Shortcut."); }
  };
  const unlink = () => run(async () => {
    credentialEpoch.current++;
    await api(`parent/children/${encodeURIComponent(childId)}/devices/${encodeURIComponent(credential.id)}?child=${encodeURIComponent(childId)}`, undefined, { method: "DELETE" });
    credentialEpoch.current++;
    setCredential(null); setToken(""); setMessage("Shortcut unlinked."); onUnlink?.();
    return { ok: true };
  });
  const lastPing = credential?.lastPing;
  return <div className="p-stack wallet-setup">
    <h3>Apple Cash tracking</h3>
    <p role="status">{credential?.connected ? "Connected" : "Not connected"}{lastPing ? ` · Last ping: ${formatDateTime(lastPing)}` : " · No ping yet"}</p>
    {!pinSet ? <p>Set a parent PIN in Security, then unlock parent mode to create a Shortcut token.</p> : <>
      <button className="pbtn" disabled={busy || pending} onClick={generate}>{credential?.id ? "Rotate Shortcut token" : "Generate Shortcut token"}</button>
      {credential?.id && <button className="pbtn danger" disabled={busy || pending} onClick={unlink}>Unlink</button>}
      {token && <>
        <label className="pform">Shortcut token<input className="shortcut-token" readOnly value={token} onFocus={(e) => e.target.select()} /></label>
        <div className="row">
          <button className="pbtn" disabled={busy || pending || !navigator.clipboard?.writeText} onClick={() => run(() => navigator.clipboard.writeText(token), undefined, "Token copied")}>Copy token</button>
        </div>
      </>}
    </>}
    {message && <p role="status">{message}</p>}
    <a href="/help/apple-cash" target="_blank" rel="noopener noreferrer">How to connect the iPhone Shortcut</a>
  </div>;
}

function Devices({ childId, busy, onUnlink }) {
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
    const target = devices.find((device) => device.id === id);
    await api(`parent/children/${encodeURIComponent(childId)}/devices/${encodeURIComponent(id)}?child=${encodeURIComponent(childId)}`, undefined, { method: "DELETE" });
    setDevices((current) => current.filter((device) => device.id !== id));
    if (target) onUnlink?.(target);
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
