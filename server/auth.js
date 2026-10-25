import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { database, transaction } from "./db.js";
import { CODE_ALPHABET, createChild, readChild, childRecord, listChildren, mutateFamilyChildren, seed, demoSeed, uid, importLegacy, DEMO_FAMILY_ID, DEMO_CHILD_ID } from "./store.js";
import { GameError, audit } from "./domain.js";
import { object, str } from "./validate.js";
import { takeLimit, resetLimit, MINUTE } from "./limits.js";

const DAY = 86400000;
const N = 2 ** 15;
const HASH_OPTIONS = { N, r: 8, p: 1, maxmem: 128 * 1024 * 1024 };
export const tokenHash = (token) => crypto.createHash("sha256").update(token).digest("hex");

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, HASH_OPTIONS);
  return `scrypt$${N}$8$1$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, encoded) {
  if (typeof password !== "string" || typeof encoded !== "string") return false;
  const [kind, n, r, p, saltText, hashText, extra] = encoded.split("$");
  if (kind !== "scrypt" || n !== String(N) || r !== "8" || p !== "1" || extra !== undefined || !saltText || !hashText) return false;
  const salt = Buffer.from(saltText, "base64"), expected = Buffer.from(hashText, "base64");
  if (salt.length !== 16 || expected.length !== 64) return false;
  const actual = crypto.scryptSync(password, salt, 64, HASH_OPTIONS);
  return crypto.timingSafeEqual(actual, expected);
}

function emailAddress(value) {
  const email = str(value, { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new GameError("Enter your email address");
  return email;
}

function passwordText(value, registering = false) {
  if (typeof value !== "string" || value.length > 1024 || (registering && value.length < 8)) throw new GameError("Use a password with at least 8 characters");
  return value;
}

function timezoneName(value = "UTC") {
  const timezone = str(value, { max: 80 });
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); } catch { throw new GameError("Pick a valid timezone"); }
  return timezone;
}

export function familyById(id) {
  const row = database().prepare("SELECT * FROM families WHERE id = ?").get(id);
  if (!row) throw new GameError("Please sign in again", 401);
  return { id: row.id, name: row.name, displayName: row.display_name, parentPin: row.parent_pin, timezone: row.timezone, createdAt: row.created_at };
}

export function createSession({ familyId, userId = null, role = "parent", childId = null, ua = "", deviceKind = "browser", now = Date.now() }) {
  const token = crypto.randomBytes(32).toString("base64url");
  const duration = (role === "parent" ? 30 : 180) * DAY;
  database().prepare(`INSERT INTO sessions
    (token_hash, user_id, family_id, role, child_id, created_at, expires_at, last_seen, ua, device_kind)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(tokenHash(token), userId, familyId, role, childId, now, now + duration, now, String(ua).slice(0, 500), deviceKind);
  return { token, session: database().prepare("SELECT * FROM sessions WHERE token_hash = ?").get(tokenHash(token)) };
}

export function register(body, { ip = "unknown", ua, now = Date.now() } = {}) {
  takeLimit("register", ip, now);
  body = object(body);
  const email = emailAddress(body.email), password = passwordText(body.password, true);
  const name = str(body.parentName, { max: 64 }), timezone = timezoneName(body.timezone);
  const children = body.children === undefined ? [{ name: body.childName, age: body.childAge, bearName: body.bearName }] : body.children;
  if (!Array.isArray(children) || children.length < 1 || children.length > 4) throw new GameError("Add between 1 and 4 children");
  const familyId = uid("family"), userId = uid("user");
  return transaction((db) => {
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) throw new GameError("That email is already registered");
    db.prepare("INSERT INTO families (id, name, created_at, timezone) VALUES (?, ?, ?, ?)").run(familyId, name, now, timezone);
    db.prepare("INSERT INTO users (id, family_id, role, email, pass_hash, name, created_at) VALUES (?, ?, 'parent', ?, ?, ?, ?)")
      .run(userId, familyId, email, hashPassword(password), name, now);
    for (const child of children) createChild(familyId, child);
    return createSession({ familyId, userId, ua, now });
  });
}

let dummyHash;
export function login(body, { ip = "unknown", ua, now = Date.now() } = {}) {
  takeLimit("loginIp", ip, now);
  body = object(body);
  const email = emailAddress(body.email);
  takeLimit("loginEmail", email, now);
  const password = passwordText(body.password);
  const user = database().prepare("SELECT * FROM users WHERE email = ?").get(email);
  // Unknown addresses still pay the same scrypt verification cost.
  dummyHash ||= hashPassword(crypto.randomBytes(32).toString("hex"));
  if (!verifyPassword(password, user?.pass_hash || dummyHash) || !user) throw new GameError("Email or password didn't match", 401);
  return createSession({ familyId: user.family_id, userId: user.id, ua, now });
}

export function sessionToken(req) {
  const authorization = req.get?.("authorization") || req.headers?.authorization;
  if (authorization) return /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(authorization)?.[1] || null;
  const cookie = req.get?.("cookie") || req.headers?.cookie || "";
  return cookie.split(";").map((p) => p.trim()).find((p) => p.startsWith("mq_session="))?.slice(11) || null;
}

export function authenticate(req, now = Date.now()) {
  const token = sessionToken(req);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new GameError("Please sign in first", 401);
  const hash = tokenHash(token);
  const db = database();
  const session = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(hash);
  if (!session || now >= session.expires_at || (session.role === "parent" && now >= session.created_at + 90 * DAY)) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
    throw new GameError("Please sign in again", 401);
  }
  if (session.role === "parent") session.expires_at = Math.min(now + 30 * DAY, session.created_at + 90 * DAY);
  session.last_seen = now;
  db.prepare("UPDATE sessions SET expires_at = ?, last_seen = ? WHERE token_hash = ?").run(session.expires_at, now, hash);
  return session;
}

export function cookieHeader(req, session, token, now = Date.now()) {
  const secure = process.env.NODE_ENV === "production" || req.secure || req.protocol === "https";
  return `mq_session=${token || ""}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token ? Math.max(0, Math.floor((session.expires_at - now) / 1000)) : 0}${secure ? "; Secure" : ""}`;
}

export function resolveContext(req, { parent = false, unlocked = parent, child = true } = {}, now = Date.now()) {
  const session = authenticate(req, now);
  const family = familyById(session.family_id);
  if (parent && session.role !== "parent") throw new GameError("A grown-up needs to sign in", 403);
  if (unlocked && family.parentPin && session.unlocked_until <= now) throw new GameError("Please unlock parent mode", 403);
  let childId = session.child_id;
  const selected = req.query?.child;
  if (selected !== undefined && (typeof selected !== "string" || selected.length > 64)) throw new GameError("Pick a child");
  if (session.role === "child") {
    if (selected !== undefined && selected !== childId) throw new GameError("Child not found", 404);
  } else {
    childId = selected || listChildren(family.id)[0]?.id;
  }
  if (child) {
    const row = childId && childRecord(childId);
    if (!row || row.family_id !== family.id) throw new GameError("Child not found", 404);
  }
  return { family, role: session.role, childId, session };
}

export function me(context) {
  const { family, session, role, childId } = context;
  const children = listChildren(family.id).filter((c) => role === "parent" || c.id === childId);
  return {
    demo: process.env.MQ_DEMO === "1" && family.id === DEMO_FAMILY_ID,
    family: { id: family.id, name: family.name, displayName: family.displayName, timezone: family.timezone, pinSet: Boolean(family.parentPin) },
    ...(role === "parent" ? { user: database().prepare("SELECT id, name, email FROM users WHERE id = ? AND family_id = ?").get(session.user_id, family.id) } : {}),
    role, children, activeChild: children.find((c) => c.id === childId) || null,
    unlockedUntil: session.unlocked_until,
  };
}

function accountUser(context, now = Date.now()) {
  if (context.role !== "parent") throw new GameError("A grown-up needs to sign in", 403);
  if (context.family.parentPin && context.session.unlocked_until <= now) throw new GameError("Please unlock parent mode", 403);
  const user = database().prepare("SELECT * FROM users WHERE id = ? AND family_id = ?").get(context.session.user_id, context.family.id);
  if (!user) throw new GameError("Please sign in again", 401);
  return user;
}

function accountChange(context, write, detail, updateChild = () => {}) {
  mutateFamilyChildren(context.family.id, write, (d) => {
    updateChild(d);
    audit(d, "parent", "account", detail);
    d.audit.at(-1).kind = "account";
  });
  return { ok: true };
}

export function updateAccount(context, input, now = Date.now()) {
  const user = accountUser(context, now), body = object(input);
  const name = Object.hasOwn(body, "name") ? str(body.name, { max: 64 }) : user.name;
  return accountChange(context, (db) => {
    db.prepare("UPDATE users SET name = ? WHERE id = ?").run(name, user.id);
    db.prepare("UPDATE families SET name = ? WHERE id = ?").run(name, context.family.id);
  }, "Parent name changed", (d) => { d.family.parentName = name; });
}

function checkAccountPassword(context, value, { ip = "unknown", now = Date.now() } = {}) {
  const user = accountUser(context, now);
  takeLimit("loginIp", ip, now);
  takeLimit("loginEmail", user.email, now);
  if (!verifyPassword(passwordText(value), user.pass_hash)) throw new GameError("That password didn't match", 401);
  return user;
}

export function updateEmail(context, input, options = {}) {
  const body = object(input);
  const user = checkAccountPassword(context, body.password, options), email = emailAddress(body.email);
  return accountChange(context, (db) => {
    if (db.prepare("SELECT id FROM users WHERE email = ? AND id != ?").get(email, user.id)) throw new GameError("That email is already registered");
    db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, user.id);
  }, "Sign-in email changed");
}

export function updatePassword(context, input, options = {}) {
  const body = object(input);
  const user = checkAccountPassword(context, body.currentPassword, options);
  const hash = hashPassword(passwordText(body.newPassword, true));
  return accountChange(context, (db) => {
    db.prepare("UPDATE users SET pass_hash = ? WHERE id = ?").run(hash, user.id);
    db.prepare("DELETE FROM sessions WHERE user_id = ? AND role = 'parent' AND token_hash != ?").run(user.id, context.session.token_hash);
  }, "Password changed");
}

export function updateFamily(context, input, now = Date.now()) {
  accountUser(context, now);
  const displayName = str(object(input).displayName, { max: 40, required: false });
  return accountChange(context, (db) => {
    db.prepare("UPDATE families SET display_name = ? WHERE id = ?").run(displayName, context.family.id);
  }, "Family display name changed");
}

export function logout(session) {
  database().prepare("DELETE FROM sessions WHERE token_hash = ?").run(session.token_hash);
}

export function logoutAll(session) {
  database().prepare("DELETE FROM sessions WHERE family_id = ?").run(session.family_id);
}

export function createLink(context, childId, now = Date.now()) {
  const row = childRecord(childId);
  if (!row || row.family_id !== context.family.id) throw new GameError("Child not found", 404);
  takeLimit("kidLink", childId, now);
  return transaction((db) => {
    // Keep spent/expired codes as tombstones so a mistyped code has distinct copy.
    db.prepare("UPDATE kid_links SET expires_at = ? WHERE child_id = ? AND used_at IS NULL AND expires_at > ?").run(now, childId, now);
    const alphabet = CODE_ALPHABET;
    for (let i = 0; i < 10; i++) {
      const code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
      const result = db.prepare("INSERT OR IGNORE INTO kid_links (code, family_id, child_id, expires_at) VALUES (?, ?, ?, ?)")
        .run(code, context.family.id, childId, now + 15 * MINUTE);
      if (result.changes) return { code, expiresAt: now + 15 * MINUTE };
    }
    throw new GameError("Try making a new code in a moment", 429);
  });
}

export function linkStatus(context, childId, code, now = Date.now()) {
  childForDevices(context, childId);
  code = str(code, { max: 6 }).toUpperCase();
  const link = database().prepare("SELECT used_at, expires_at FROM kid_links WHERE code = ? AND family_id = ? AND child_id = ?")
    .get(code, context.family.id, childId);
  if (!link) throw new GameError("Code not found", 404);
  return { status: link.used_at !== null ? "linked" : now >= link.expires_at ? "expired" : "pending" };
}

export function redeemLink(body, { ua, ip = "unknown", now = Date.now() } = {}) {
  // Protect the short pairing code from online guessing too.
  takeLimit("loginIp", `link:${ip}`, now);
  const code = str(object(body).code, { max: 6 }).toUpperCase();
  return transaction((db) => {
    const link = db.prepare("SELECT * FROM kid_links WHERE code = ?").get(code);
    if (!link) throw Object.assign(new GameError("That code doesn't match — check the letters and try again"), { reason: "unknown" });
    if (link.used_at !== null || now >= link.expires_at) throw Object.assign(new GameError("That code was already used or expired. Ask for a new one."), { reason: "used_or_expired" });
    db.prepare("UPDATE kid_links SET used_at = ? WHERE code = ?").run(now, code);
    return createSession({ familyId: link.family_id, childId: link.child_id, role: "child", ua, now });
  });
}

export function setPin(context, body, now = Date.now()) {
  const pin = object(body).pin;
  if (typeof pin !== "string" || !/^\d{4,8}$/.test(pin)) throw new GameError("Use a PIN with 4 to 8 digits");
  transaction((db) => {
    db.prepare("UPDATE families SET parent_pin = ? WHERE id = ?").run(hashPassword(pin), context.family.id);
    db.prepare("UPDATE sessions SET unlocked_until = 0 WHERE family_id = ? AND role = 'parent'").run(context.family.id);
    db.prepare("UPDATE sessions SET unlocked_until = ? WHERE token_hash = ?").run(now + 15 * MINUTE, context.session.token_hash);
  });
  return { ok: true, unlockedUntil: now + 15 * MINUTE };
}

export function lock(context) {
  database().prepare("UPDATE sessions SET unlocked_until = 0 WHERE token_hash = ?").run(context.session.token_hash);
  return { ok: true, unlockedUntil: 0 };
}

export function resetPin(context, body, { ip = "unknown", now = Date.now() } = {}) {
  takeLimit("loginIp", ip, now);
  const user = database().prepare("SELECT * FROM users WHERE id = ? AND family_id = ?").get(context.session.user_id, context.family.id);
  takeLimit("loginEmail", user.email, now);
  if (!verifyPassword(passwordText(object(body).password), user.pass_hash)) throw new GameError("That password didn't match", 401);
  transaction((db) => {
    db.prepare("UPDATE families SET parent_pin = NULL WHERE id = ?").run(context.family.id);
    const sessions = db.prepare("SELECT token_hash FROM sessions WHERE family_id = ? AND role = 'parent'").all(context.family.id);
    for (const session of sessions) resetLimit("unlock", session.token_hash);
    db.prepare("UPDATE sessions SET unlocked_until = 0, pin_locked_until = 0 WHERE family_id = ? AND role = 'parent'").run(context.family.id);
  });
  return { ok: true, unlockedUntil: 0 };
}

export function unlock(context, body, now = Date.now()) {
  const session = context.session;
  const locked = (until) => Object.assign(new GameError("Let's take a little break. Try again soon!", 429), { retryAfterSeconds: Math.ceil((until - now) / 1000), attemptsLeft: 0 });
  if (session.pin_locked_until > now) throw locked(session.pin_locked_until);
  if (session.pin_locked_until) {
    resetLimit("unlock", session.token_hash);
    database().prepare("UPDATE sessions SET pin_locked_until = 0 WHERE token_hash = ?").run(session.token_hash);
  }
  const pin = object(body).pin;
  if (!context.family.parentPin || typeof pin !== "string" || !/^\d{4,8}$/.test(pin) || !verifyPassword(pin, context.family.parentPin)) {
    const quota = takeLimit("unlock", session.token_hash, now);
    if (!quota.remaining) {
      const until = now + 15 * MINUTE;
      database().prepare("UPDATE sessions SET pin_locked_until = ?, unlocked_until = 0 WHERE token_hash = ?").run(until, session.token_hash);
      throw locked(until);
    }
    throw Object.assign(new GameError("That PIN didn't match", 401), { attemptsLeft: quota.remaining });
  }
  resetLimit("unlock", session.token_hash);
  database().prepare("UPDATE sessions SET unlocked_until = ?, pin_locked_until = 0 WHERE token_hash = ?").run(now + 15 * MINUTE, session.token_hash);
  return { ok: true, unlockedUntil: now + 15 * MINUTE };
}

// Device IDs are separate digests, never the stored credential hashes.
const deviceId = (hash) => tokenHash(`device:${hash}`);
function childForDevices(context, childId) {
  const row = childRecord(childId);
  if (!row || row.family_id !== context.family.id) throw new GameError("Child not found", 404);
}
function deviceName(ua = "") {
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /(?:Chrome|CriOS)\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const system = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Macintosh|Mac OS/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "device";
  return `${browser} on ${system}`;
}
export function childDevices(context, childId, now = Date.now()) {
  childForDevices(context, childId);
  return database().prepare("SELECT * FROM sessions WHERE family_id = ? AND child_id = ? AND role = 'child' AND expires_at > ? ORDER BY created_at")
    .all(context.family.id, childId, now).map((s) => ({ id: deviceId(s.token_hash), created_at: s.created_at, last_seen: s.last_seen, kind: s.device_kind, name: s.device_kind === "shortcut" ? "Apple Cash Shortcut" : deviceName(s.ua) }));
}

export function walletToken(context, { rotate = false, now = Date.now() } = {}) {
  if (context.role !== "parent") throw new GameError("A grown-up needs to sign in", 403);
  if (!context.family.parentPin) throw new GameError("Set a parent PIN in Security first", 403);
  if (context.session.unlocked_until <= now) throw new GameError("Please unlock parent mode", 403);
  childForDevices(context, context.childId);
  const lastPing = readChild(context.childId).walletLastPing || null;
  if (rotate) return transaction((db) => {
    db.prepare("DELETE FROM sessions WHERE family_id = ? AND child_id = ? AND role = 'child' AND device_kind = 'shortcut'").run(context.family.id, context.childId);
    const { token, session } = createSession({ familyId: context.family.id, childId: context.childId, role: "child", deviceKind: "shortcut", now });
    return { token, id: deviceId(session.token_hash), expiresAt: session.expires_at, lastPing, connected: false };
  });
  const session = database().prepare("SELECT * FROM sessions WHERE family_id = ? AND child_id = ? AND role = 'child' AND device_kind = 'shortcut' AND expires_at > ? ORDER BY created_at DESC LIMIT 1")
    .get(context.family.id, context.childId, now);
  return session ? { token: null, id: deviceId(session.token_hash), expiresAt: session.expires_at, lastPing, connected: Boolean(lastPing && lastPing >= session.created_at) } : { token: null, id: null, expiresAt: null, lastPing, connected: false };
}
export function unlinkDevice(context, childId, sessionId) {
  childForDevices(context, childId);
  sessionId = str(sessionId, { max: 64 });
  const session = database().prepare("SELECT token_hash FROM sessions WHERE family_id = ? AND child_id = ? AND role = 'child'")
    .all(context.family.id, childId).find((s) => deviceId(s.token_hash) === sessionId);
  if (!session) throw new GameError("Device not found", 404);
  database().prepare("DELETE FROM sessions WHERE token_hash = ?").run(session.token_hash);
  return { ok: true };
}

export function initializeAccounts() {
  const defaultDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");
  const filename = path.join(process.env.MQ_DATA_DIR || defaultDir, "db.json");
  if (fs.existsSync(filename)) importLegacy(filename);
  if (process.env.MQ_DEMO !== "1") return;
  transaction((db) => {
    const now = Date.now();
    db.prepare("INSERT OR IGNORE INTO families (id, name, created_at) VALUES (?, ?, ?)").run(DEMO_FAMILY_ID, "Jordan", now);
    if (!db.prepare("SELECT id FROM children WHERE id = ?").get(DEMO_CHILD_ID)) {
      const d = demoSeed(now);
      delete d.family.parentPin;
      db.prepare("INSERT INTO children (id, family_id, doc, version, updated_at) VALUES (?, ?, ?, ?, ?)")
        .run(DEMO_CHILD_ID, DEMO_FAMILY_ID, JSON.stringify(d), d.version, now);
    }
    if (!db.prepare("SELECT id FROM users WHERE email = ?").get("demo@moneyquest.test")) {
      db.prepare("INSERT INTO users (id, family_id, role, email, pass_hash, name, created_at) VALUES (?, ?, 'parent', ?, ?, ?, ?)")
        .run(uid("user"), DEMO_FAMILY_ID, "demo@moneyquest.test", hashPassword("demo-pass-1234"), "Jordan", now);
    }
  });
}

export function demoLogin(options = {}) {
  if (process.env.MQ_DEMO !== "1") throw new GameError("Not found", 404);
  const user = database().prepare("SELECT id FROM users WHERE family_id = ? AND email = ?").get(DEMO_FAMILY_ID, "demo@moneyquest.test");
  if (!user) throw new GameError("Demo is not ready", 404);
  return createSession({ ...options, familyId: DEMO_FAMILY_ID, userId: user.id });
}
