// Tiny API client + live state hook.
// Screens refresh three ways, so they stay correct even when a proxy (like a
// phone tunnel) buffers the live event stream: right after every successful
// action, on server-sent "changed" events, and on a slow poll as a fallback.
import { useEffect, useState, useCallback, useRef } from "react";

let parentToken = sessionStorage.getItem("mq_parent") || null;
export const setParentToken = (t) => {
  parentToken = t;
  try { t ? sessionStorage.setItem("mq_parent", t) : sessionStorage.removeItem("mq_parent"); } catch {}
};
export const hasParentToken = () => Boolean(parentToken);

export async function api(path, body) {
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...(parentToken ? { "x-parent-token": parentToken } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || (res.status >= 500 ? "Something went wrong on the server. Try again." : `Request failed (${res.status})`));
    err.status = res.status;
    throw err;
  }
  if (body !== undefined) window.dispatchEvent(new Event("mq:changed"));
  return data;
}

export function useLiveState(role) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const inflight = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) { again.current = true; return; }
    inflight.current = true;
    try {
      setState(await api(role === "parent" ? "parent/state" : "state"));
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      inflight.current = false;
      if (again.current) { again.current = false; refresh(); }
    }
  }, [role]);

  useEffect(() => {
    refresh();
    let es = null;
    try {
      es = new EventSource("/api/stream");
      es.onmessage = () => refresh();
    } catch {}
    const onChange = () => refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("mq:changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(() => document.visibilityState === "visible" && refresh(), 5000);
    return () => {
      es?.close();
      clearInterval(poll);
      window.removeEventListener("mq:changed", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { state, error, refresh };
}

export const money = (c) => `$${(c / 100).toFixed(2)}`;
export const moneyShort = (c) => (c % 100 === 0 ? `$${c / 100}` : money(c));
