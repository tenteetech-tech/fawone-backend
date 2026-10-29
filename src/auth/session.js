// Sessions (cookie httpOnly + jeton haché en base) et limitation des tentatives.
import { config } from "../config.js";
import { get, run, now, map } from "../db/index.js";
import { newToken, sha256 } from "../lib/security.js";
import { parseCookies, serializeCookie, fail } from "../lib/http.js";

export const COOKIE = "fawone_session";
const SESSION_DAYS = config.sessionDays;
const SECURE = config.cookieSecure;

export function createSession(res, memberId, userAgent = "") {
  const token = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  run("INSERT INTO sessions (token_hash, member_id, created_at, expires_at, user_agent) VALUES (?,?,?,?,?)", sha256(token), memberId, now(), expires, String(userAgent).slice(0, 200));
  run("UPDATE members SET last_login_at = ? WHERE id = ?", now(), memberId);
  res.setHeader("Set-Cookie", serializeCookie(COOKIE, token, { maxAge: SESSION_DAYS * 86400, secure: SECURE }));
}

export function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) run("DELETE FROM sessions WHERE token_hash = ?", sha256(token));
  res.setHeader("Set-Cookie", serializeCookie(COOKIE, "", { maxAge: 0, secure: SECURE }));
}

/** Membre connecté (ou null). Les comptes inactifs sont refusés. */
export function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return null;
  const row = get(
    `SELECT m.* FROM sessions s JOIN members m ON m.id = s.member_id
     WHERE s.token_hash = ? AND s.expires_at > ? AND m.status != 'inactive'`,
    sha256(token),
    now(),
  );
  return row ? map.member(row) : null;
}

export function requireUser(ctx) {
  if (!ctx.user) fail(401, "Connexion requise.");
  return ctx.user;
}

/* ------------------- Limitation des tentatives ------------------- */
const attempts = new Map(); // clé -> { count, until }
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

export function checkRateLimit(key) {
  const a = attempts.get(key);
  if (a && a.count >= MAX_ATTEMPTS && a.until > Date.now()) {
    const min = Math.ceil((a.until - Date.now()) / 60000);
    fail(429, `Trop de tentatives. Réessayez dans ${min} minute${min > 1 ? "s" : ""}.`);
  }
}
export function recordFailure(key) {
  const a = attempts.get(key);
  if (!a || a.until < Date.now()) attempts.set(key, { count: 1, until: Date.now() + WINDOW_MS });
  else a.count += 1;
}
export const clearFailures = (key) => attempts.delete(key);
