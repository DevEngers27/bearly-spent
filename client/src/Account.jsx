import { useState } from "react";
import { api } from "./api.js";

export default function Account({ me, refreshMe, run, busy }) {
  const [name, setName] = useState(me.user?.name || me.family.name);
  const [displayName, setDisplayName] = useState(me.family.displayName || "");
  const [email, setEmail] = useState(me.user?.email || "");
  const [emailPassword, setEmailPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const save = async (event, path, body, message, clear = () => {}) => {
    event.preventDefault();
    const result = await run(async () => {
      const result = await api(path, body);
      await refreshMe();
      return result;
    }, undefined, message);
    if (result) clear();
  };
  return <div className="p-stack">
    <h1>Account</h1>
    <form className="p-card pform" onSubmit={(event) => save(event, "auth/account", { name }, "Name saved")}>
      <h2>Your name</h2>
      <label>Parent name<input required maxLength={64} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <button className="pbtn primary" disabled={busy}>Save name</button>
    </form>
    <form className="p-card pform" onSubmit={(event) => save(event, "parent/family", { displayName }, "Family name saved")}>
      <h2>Family display name</h2>
      <label>Family name (optional)<input maxLength={40} placeholder="The Smith family" value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
      <button className="pbtn primary" disabled={busy}>Save family name</button>
    </form>
    <form className="p-card pform" onSubmit={(event) => save(event, "auth/email", { email, password: emailPassword }, "Sign-in email saved", () => setEmailPassword(""))}>
      <h2>Sign-in email</h2>
      <p className="p-muted">Current email: {me.user?.email}</p>
      <label>Email<input required type="email" maxLength={254} autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
      <label>Current password<input required type="password" maxLength={1024} autoComplete="current-password" value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} /></label>
      <button className="pbtn primary" disabled={busy}>Change email</button>
    </form>
    <form className="p-card pform" onSubmit={(event) => save(event, "auth/password", { currentPassword, newPassword }, "Password changed. Other parent sessions signed out.", () => { setCurrentPassword(""); setNewPassword(""); })}>
      <h2>Change password</h2>
      <label>Current password<input required type="password" maxLength={1024} autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} /></label>
      <label>New password<input required type="password" minLength={8} maxLength={1024} autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
      <button className="pbtn primary" disabled={busy}>Change password</button>
    </form>
  </div>;
}
