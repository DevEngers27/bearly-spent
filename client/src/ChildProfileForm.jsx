import { useState } from "react";
import { api } from "./api.js";

export default function ChildProfileForm({ summary, refreshMe, run, busy }) {
  const [editing, setEditing] = useState(false);
  const initial = () => ({ name: summary.name, age: String(summary.age), bearName: summary.bearName });
  const [form, setForm] = useState(initial);
  const field = (key) => ({ value: form[key], onChange: (event) => setForm({ ...form, [key]: event.target.value }) });
  const save = async (event) => {
    event.preventDefault();
    const result = await run(async () => {
      const result = await api(`parent/children/${encodeURIComponent(summary.id)}/profile`, { ...form, age: Number(form.age) });
      await refreshMe();
      return result;
    }, undefined, "Child profile saved");
    if (result) setEditing(false);
  };
  if (!editing) return <button className="pbtn" disabled={busy} onClick={() => { setForm(initial()); setEditing(true); }}>Edit profile</button>;
  return <form className="pform child-profile-form" onSubmit={save} aria-label={`Edit ${summary.name}'s profile`}>
    <label>Child's name<input required maxLength={24} {...field("name")} /></label>
    <label>Age<select {...field("age")}>{[7, 8, 9, 10, 11, 12].map((age) => <option key={age} value={age}>{age}</option>)}</select></label>
    <label>Bear's name<input required maxLength={24} {...field("bearName")} /></label>
    <div className="row"><button className="pbtn primary" disabled={busy}>Save profile</button><button type="button" className="pbtn" disabled={busy} onClick={() => setEditing(false)}>Cancel</button></div>
  </form>;
}
