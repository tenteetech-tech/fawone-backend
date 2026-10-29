// Client de l'API Campay (Mobile Money Cameroun : MTN MoMo et Orange Money).
// Endpoints utilisés (identiques en démo et en production) :
//   POST /api/token/                 { username, password } → { token, expires_in }
//   POST /api/collect/               { amount, currency, from, description, external_reference }
//                                    → { reference, ussd_code, operator }
//   GET  /api/transaction/{ref}/     → { reference, status: PENDING|SUCCESSFUL|FAILED, amount, operator, … }
// Base : https://demo.campay.net (CAMPAY_ENV=demo) ou https://www.campay.net (CAMPAY_ENV=live).

import { config } from "../config.js";

const cp = config.campay;
const TIMEOUT_MS = 20000;
let cached = { token: "", expiresAt: 0 };

export class CampayError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export const isCampayConfigured = () => !!(cp.permanentToken || (cp.username && cp.password));

async function request(method, path, body, token) {
  let res;
  try {
    res = await fetch(`${cp.apiUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    throw new CampayError(e?.name === "TimeoutError" ? "Campay ne répond pas (délai dépassé)." : "Impossible de joindre Campay.", 0);
  }
  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { message: text.slice(0, 200) };
  }
  if (!res.ok) {
    const msg = data.message || data.detail || data.error || `Erreur Campay (HTTP ${res.status})`;
    throw new CampayError(String(msg), res.status);
  }
  return data;
}

async function getToken(force = false) {
  if (cp.permanentToken) return cp.permanentToken;
  if (!force && cached.token && cached.expiresAt > Date.now()) return cached.token;
  const data = await request("POST", "/api/token/", { username: cp.username, password: cp.password });
  if (!data.token) throw new CampayError("Campay n'a pas renvoyé de jeton (identifiants de l'application ?).", 401);
  cached = { token: data.token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000 };
  return cached.token;
}

/** Appel authentifié ; renouvelle le jeton une fois s'il a expiré. */
async function authed(method, path, body) {
  try {
    return await request(method, path, body, await getToken());
  } catch (e) {
    if (e instanceof CampayError && e.status === 401 && !cp.permanentToken) return request(method, path, body, await getToken(true));
    throw e;
  }
}

/** Demande de paiement : le payeur reçoit une notification sur son téléphone (ou compose le code USSD). */
export function collect({ amount, phone, description, externalReference }) {
  return authed("POST", "/api/collect/", {
    amount: String(Math.round(amount)),
    currency: "XAF",
    from: phone, // format 2376XXXXXXXX
    description: description.slice(0, 100),
    external_reference: externalReference,
  });
}

export const transactionStatus = (reference) => authed("GET", `/api/transaction/${encodeURIComponent(reference)}/`);

/* ------------------------- Numéros camerounais ------------------------- */

/** Normalise un numéro : « 6 77 12 34 56 », « +237677123456 » → « 237677123456 ». Retourne null si invalide. */
export function normalizePhone(input) {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.startsWith("00237")) digits = digits.slice(5);
  else if (digits.startsWith("237") && digits.length === 12) digits = digits.slice(3);
  return /^6\d{8}$/.test(digits) ? `237${digits}` : null;
}

/** Opérateur probable d'après le préfixe (MTN : 67, 650-654, 680-684 · Orange : 69, 655-659, 685-689). */
export function operatorOf(phone237) {
  const n = phone237.slice(3);
  if (/^67/.test(n) || /^65[0-4]/.test(n) || /^68[0-4]/.test(n)) return "MTN";
  if (/^69/.test(n) || /^65[5-9]/.test(n) || /^68[5-9]/.test(n)) return "ORANGE";
  return null;
}

export const maskPhone = (phone237) => `${phone237.slice(3, 4)}•••••${phone237.slice(-3)}`;
