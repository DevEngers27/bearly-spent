// Fixed windows and concurrency limits are process-local (single API process).
import { GameError } from "./domain.js";

const windows = new Map();
const chats = new Set();
const streams = new Map();
export const MINUTE = 60000;
export const HOUR = 60 * MINUTE;
export const policies = {
  loginIp: [10, 15 * MINUTE], loginEmail: [5, 15 * MINUTE],
  register: [5, HOUR], unlock: [5, 15 * MINUTE],
  kidLink: [5, 15 * MINUTE],
  chat: [30, HOUR], speak: [60, HOUR], voice: [20, 10 * MINUTE],
};

export function takeLimit(policy, key, now = Date.now()) {
  const [max, duration] = policies[policy];
  for (const [k, value] of windows) if (now >= value.until) windows.delete(k);
  const fullKey = `${policy}:${key}`;
  let window = windows.get(fullKey);
  if (!window) windows.set(fullKey, window = { until: now + duration, count: 0 });
  if (window.count >= max) throw new GameError("Let's take a little break. Try again soon!", 429);
  window.count += 1;
  return { remaining: max - window.count, until: window.until };
}

export function resetLimit(policy, key) {
  windows.delete(`${policy}:${key}`);
}

export async function withChat(childId, fn, now = Date.now()) {
  if (chats.has(childId)) throw new GameError("Buddy is still thinking. One moment!", 429);
  takeLimit("chat", childId, now);
  chats.add(childId);
  try { return await fn(); } finally { chats.delete(childId); }
}

export function openFamilyStream(familyId, close) {
  if (!streams.has(familyId)) streams.set(familyId, []);
  const group = streams.get(familyId);
  const entry = { close };
  group.push(entry);
  if (group.length > 4) group.shift().close();
  return () => {
    const index = group.indexOf(entry);
    if (index >= 0) group.splice(index, 1);
    if (!group.length && streams.get(familyId) === group) streams.delete(familyId);
  };
}

export function _clearLimitsForTest() {
  windows.clear();
  chats.clear();
  for (const group of streams.values()) for (const stream of group) stream.close();
  streams.clear();
}
