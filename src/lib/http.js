// Mini-framework HTTP (node:http) : routage, JSON, cookies, erreurs.

export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const fail = (status, message, details) => {
  throw new HttpError(status, message, details);
};

export function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, httpOnly = true, sameSite = "Lax", secure = false, path = "/" } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=${sameSite}`;
  if (httpOnly) c += "; HttpOnly";
  if (secure) c += "; Secure";
  if (maxAge !== undefined) c += `; Max-Age=${maxAge}`;
  return c;
}

export async function readJson(req, limit = 1_000_000, { lenient = false } = {}) {
  if (req.method === "GET" || req.method === "HEAD") return {};
  const type = req.headers["content-type"] || "";
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, "Requête trop volumineuse.");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8");
  // Webhooks des prestataires : JSON ou formulaire accepté (le contenu n'est jamais cru sur parole).
  if (lenient && !type.includes("application/json")) return Object.fromEntries(new URLSearchParams(raw));
  // Protection CSRF : un formulaire d'un autre site ne peut pas envoyer de JSON sans pré-vérification CORS.
  if (!type.includes("application/json")) fail(415, "Content-Type application/json requis.");
  try {
    return JSON.parse(raw);
  } catch {
    fail(400, "JSON invalide.");
  }
}

export function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  res.end(body);
}

export class Router {
  routes = [];
  add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      "^" + pattern.replace(/\//g, "\\/").replace(/:(\w+)/g, (_, k) => (keys.push(k), "([^/]+)")) + "\\/?$",
    );
    this.routes.push({ method, regex, keys, handler });
  }
  get = (p, h) => this.add("GET", p, h);
  post = (p, h) => this.add("POST", p, h);
  put = (p, h) => this.add("PUT", p, h);
  patch = (p, h) => this.add("PATCH", p, h);
  delete = (p, h) => this.add("DELETE", p, h);
  match(method, pathname) {
    let pathMatched = false;
    for (const r of this.routes) {
      const m = r.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      return { handler: r.handler, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return pathMatched ? "method" : null;
  }
}

/* ---------------------------- Validation ---------------------------- */

export function str(v, field, { required = false, max = 2000, min = 0 } = {}) {
  if (v === undefined || v === null || v === "") {
    if (required) fail(422, `Champ obligatoire : ${field}.`, { field });
    return undefined;
  }
  if (typeof v !== "string") fail(422, `Format invalide : ${field}.`, { field });
  const s = v.trim();
  if (required && !s) fail(422, `Champ obligatoire : ${field}.`, { field });
  if (s.length > max) fail(422, `${field} : ${max} caractères maximum.`, { field });
  if (s.length < min) fail(422, `${field} : ${min} caractères minimum.`, { field });
  return s;
}
export function oneOf(v, field, values, { required = false } = {}) {
  if (v === undefined || v === null) {
    if (required) fail(422, `Champ obligatoire : ${field}.`, { field });
    return undefined;
  }
  if (!values.includes(v)) fail(422, `Valeur invalide pour ${field}.`, { field });
  return v;
}
export function money(v, field, { required = false, min = 0 } = {}) {
  if (v === undefined || v === null || v === "") {
    if (required) fail(422, `Champ obligatoire : ${field}.`, { field });
    return undefined;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > 1_000_000_000_000) fail(422, `Montant invalide : ${field}.`, { field });
  return Math.round(n * 100); // centimes
}
export function isoDate(v, field, { required = false } = {}) {
  if (!v) {
    if (required) fail(422, `Champ obligatoire : ${field}.`, { field });
    return undefined;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) fail(422, `Date invalide : ${field}.`, { field });
  return d.toISOString();
}
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function email(v, field = "e-mail", opts = {}) {
  const s = str(v, field, { ...opts, max: 254 });
  if (s && !EMAIL_RE.test(s)) fail(422, "Adresse e-mail invalide.", { field });
  return s?.toLowerCase();
}
