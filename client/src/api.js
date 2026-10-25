// Tiny API client + live state hook.
// Screens refresh three ways, so they stay correct even when a proxy (like a
// phone tunnel) buffers the live event stream: right after every successful
// action, on server-sent "changed" events, and on a slow poll as a fallback.
import { useEffect, useState, useCallback, useRef } from "react";

let selectedChild = null;
let identityVersion = 0;
export function setSelectedChild(id) {
  if (selectedChild !== id) identityVersion++;
  selectedChild = id;
}

export function clearSessionCache() {
  identityVersion++;
  selectedChild = null;
  try {
    for (const key of ["mq_last_state", "mq_child_session", "mq_selected_child", "mq_parent_mode"]) localStorage.removeItem(key);
  } catch {}
}

export function rememberSession(me) {
  try {
    if (me.role === "child") localStorage.setItem("mq_child_session", JSON.stringify(me));
    else localStorage.removeItem("mq_child_session");
  } catch {}
}

export function cachedChildSession() {
  try {
    const me = JSON.parse(localStorage.getItem("mq_child_session"));
    return me?.role === "child" && me.activeChild?.id && cachedChildState(me.activeChild.id) ? me : null;
  } catch { return null; }
}

export function apiUrl(path, includeChild = true) {
  const [route, query = ""] = path.split("?");
  const publicRoute = ["auth/login", "auth/register", "auth/link", "demo/login"].includes(route);
  const selection = includeChild && selectedChild && !publicRoute && !/(^|&)child=/.test(query);
  return `/api/${path}${selection ? `${query ? "&" : "?"}child=${encodeURIComponent(selectedChild)}` : ""}`;
}

// Shared by JSON and audio requests so every authenticated route handles expiry.
export async function apiResponse(path, body, { includeChild = true, handleUnauthorized = true } = {}) {
  const version = identityVersion;
  const url = apiUrl(path, includeChild);
  const route = path.split("?")[0];
  const parentRoute = route.startsWith("parent/") || route === "auth/logout-all";
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && handleUnauthorized && !["parent/unlock", "auth/login"].includes(route)) {
    clearSessionCache();
    window.dispatchEvent(new Event("mq:unauthorized"));
  }
  if (parentRoute && res.status === 423) window.dispatchEvent(new Event("mq:locked"));
  if (res.status === 404) {
    const childId = new URLSearchParams(url.split("?")[1]).get("child");
    if (childId && version === identityVersion) window.dispatchEvent(new Event("mq:child-reset"));
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (parentRoute && (res.status === 403 && /unlock|locked/i.test(data.error || ""))) window.dispatchEvent(new Event("mq:locked"));
    const err = new Error(data.error || (res.status >= 500 ? "Something went wrong on the server. Try again." : `Request failed (${res.status})`));
    err.status = res.status;
    err.demo = data.demo === true;
    if (res.status === 429) {
      const event = new Event("mq:rate-limit");
      event.message = err.message;
      window.dispatchEvent(event);
    }
    throw err;
  }
  return res;
}

export async function api(path, body, options) {
  const version = identityVersion;
  const res = await apiResponse(path, body, options);
  const data = await res.json().catch(() => ({}));
  if (path.split("?")[0] === "state" && body === undefined && version === identityVersion) {
    try { localStorage.setItem("mq_last_state", JSON.stringify(data)); } catch {}
    if (import.meta.env.PROD && "serviceWorker" in navigator) {
      const images = ["/bear/items/mushroom.png", ...Object.values(data.catalog.places).map((p) => p.image),
        ...data.catalog.cosmetics.map((c) => c.kind === "background" ? null : `/bear/items/${c.value}.png`),
        ...["front", "side", "back", "three_quarter"].map((pose) => `/bear/poses/bear_${pose}.png`)].filter(Boolean);
      navigator.serviceWorker.ready.then((registration) => registration.active?.postMessage({ type: "mq:cache-art", images })).catch(() => {});
    }
  }
  if (body !== undefined) window.dispatchEvent(new Event("mq:changed"));
  return data;
}

export const OFFLINE_MESSAGE = "You're offline — Maple's postcards are still here!";

// A ref closes the double-click gap before React paints disabled controls.
export function useAction(toast, offline = false) {
  const [busy, setBusy] = useState(false);
  const inflight = useRef(false);
  const run = async (path, body, ok) => {
    if (offline) { toast(OFFLINE_MESSAGE); return null; }
    if (inflight.current) return null;
    inflight.current = true;
    setBusy(true);
    try {
      const result = await (typeof path === "function" ? path() : api(path, body));
      if (ok) toast(typeof ok === "function" ? ok(result) : ok);
      return result;
    } catch (e) {
      toast(e.message, "error");
      return null;
    } finally {
      inflight.current = false;
      setBusy(false);
    }
  };
  return [run, busy];
}

function cachedChildState(childId) {
  try {
    const cached = JSON.parse(localStorage.getItem("mq_last_state"));
    return cached?.child && cached?.catalog && Array.isArray(cached.goals) && (!childId || cached.childId === childId) ? cached : null;
  } catch { return null; }
}

export function useLiveState(role, childId) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const inflight = useRef(false);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) { again.current = true; return; }
    inflight.current = true;
    const version = identityVersion;
    try {
      const next = await api(role === "parent" ? "parent/state" : "state");
      if (version !== identityVersion) return;
      setState(next);
      setError(null);
    } catch (e) {
      if (version !== identityVersion || [401, 403, 423].includes(e.status)) return;
      setError(e);
      if (role === "child" && !e.status) setState((current) => current || cachedChildState(childId));
    } finally {
      inflight.current = false;
      if (again.current) { again.current = false; refresh(); }
    }
  }, [role, childId]);

  useEffect(() => {
    refresh();
    let es = null;
    try {
      es = new EventSource(apiUrl("stream"));
      es.onmessage = (event) => {
        try { if (childId && JSON.parse(event.data).childId !== childId) return; } catch { return; }
        refresh();
      };
      es.onerror = () => { api("auth/me").catch(() => {}); };
    } catch {}
    const onChange = () => refresh();
    const onVisible = () => document.visibilityState === "visible" && refresh();
    window.addEventListener("mq:changed", onChange);
    document.addEventListener("visibilitychange", onVisible);
    const poll = setInterval(() => document.visibilityState === "visible" && refresh(), 5000);
    window.addEventListener("online", onChange);
    return () => {
      es?.close();
      clearInterval(poll);
      window.removeEventListener("mq:changed", onChange);
      window.removeEventListener("online", onChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  return { state, error, refresh, offline: Boolean(error) };
}

export const money = (c) => `$${(c / 100).toFixed(2)}`;
export const moneyShort = (c) => (c % 100 === 0 ? `$${c / 100}` : money(c));
