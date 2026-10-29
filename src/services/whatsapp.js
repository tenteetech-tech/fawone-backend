// Notifications WhatsApp vers le groupe de l'association.
//
// L'API officielle de Meta (Cloud API) ne permet pas de publier dans un groupe
// existant de la communauté : on passe donc par un fournisseur qui relie un
// numéro WhatsApp (Green-API ou Whapi.Cloud). Configuration dans .env :
//   WHATSAPP_PROVIDER = none | console | greenapi | whapi
//   WHATSAPP_GROUP_ID = 1203630xxxxxxxx@g.us   (npm run whatsapp:groups pour le trouver)
//
// Les envois sont asynchrones : un échec WhatsApp ne bloque jamais l'action
// (création de projet, don…). Chaque message est journalisé (table whatsapp_messages)
// et peut être renvoyé depuis l'administration.

import { config } from "../config.js";
import { all, get, insert, run, now } from "../db/index.js";
import { newId } from "../lib/security.js";

const wa = config.whatsapp;
const TIMEOUT_MS = 15000;

export const isConfigured = () => {
  if (wa.provider === "console") return true;
  if (!wa.groupId) return false;
  if (wa.provider === "greenapi") return !!(wa.greenapi.idInstance && wa.greenapi.token);
  if (wa.provider === "whapi") return !!wa.whapi.token;
  return false;
};

/* ------------------------------ Fournisseurs ------------------------------ */

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} : ${(data.error?.message || data.message || text).toString().slice(0, 300)}`);
  return data;
}

async function getJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} : ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const providers = {
  console: {
    send: async (text) => {
      console.log(`\n[whatsapp] (mode console) → groupe ${wa.groupId || "(non défini)"}\n${text}\n`);
      return { id: `console-${Date.now()}` };
    },
    groups: async () => [],
  },
  // https://green-api.com/en/docs/api/sending/SendMessage
  greenapi: {
    send: async (text) => {
      const { apiUrl, idInstance, token } = wa.greenapi;
      const data = await postJson(`${apiUrl}/waInstance${idInstance}/sendMessage/${token}`, { chatId: wa.groupId, message: text });
      return { id: data.idMessage };
    },
    groups: async () => {
      const { apiUrl, idInstance, token } = wa.greenapi;
      const list = await getJson(`${apiUrl}/waInstance${idInstance}/getContacts/${token}`);
      return list.filter((c) => c.type === "group" || String(c.id).endsWith("@g.us")).map((c) => ({ id: c.id, name: c.name || c.contactName || "" }));
    },
  },
  // https://support.whapi.cloud/help-desk/groups/send-group-message
  whapi: {
    send: async (text) => {
      const data = await postJson(`${wa.whapi.apiUrl}/messages/text`, { to: wa.groupId, body: text }, { Authorization: `Bearer ${wa.whapi.token}` });
      return { id: data.message?.id || data.id || null };
    },
    groups: async () => {
      const data = await getJson(`${wa.whapi.apiUrl}/groups?count=500`, { Authorization: `Bearer ${wa.whapi.token}` });
      return (data.groups || []).map((g) => ({ id: g.id, name: g.name || "" }));
    },
  },
};

/* ------------------------------ Envoi ------------------------------ */

async function deliver(id) {
  const msg = get("SELECT * FROM whatsapp_messages WHERE id = ?", id);
  if (!msg) return;
  try {
    const provider = providers[wa.provider];
    if (!provider || !isConfigured()) throw new Error("WhatsApp n'est pas configuré (WHATSAPP_PROVIDER / WHATSAPP_GROUP_ID).");
    const out = await provider.send(msg.body);
    run("UPDATE whatsapp_messages SET status = 'sent', provider_message_id = ?, error = NULL, sent_at = ? WHERE id = ?", out?.id ?? null, now(), id);
  } catch (e) {
    const error = e?.name === "TimeoutError" ? "Délai dépassé (fournisseur injoignable)." : String(e?.message || e).slice(0, 500);
    run("UPDATE whatsapp_messages SET status = 'failed', error = ? WHERE id = ?", error, id);
    console.error(`[whatsapp] échec ${id} : ${error}`);
  }
}

/**
 * Enregistre puis envoie un message (en arrière-plan).
 * kind : project | event | news | donation | manual | test
 * Retourne l'id du message, ou null si ce type d'événement est désactivé / WhatsApp coupé.
 */
export function queueWhatsApp(kind, entityId, body, { force = false } = {}) {
  if (wa.provider === "none") return null;
  if (!force && !wa.events.includes(kind)) return null;
  const id = newId("wa");
  insert("whatsapp_messages", { id, kind, entity_id: entityId ?? null, body, status: "pending", provider: wa.provider, created_at: now() });
  setImmediate(() => void deliver(id));
  return id;
}

/** Envoi immédiat (attend le résultat) — utilisé pour le test et le renvoi. */
export async function sendNow(kind, body, entityId = null) {
  const id = newId("wa");
  insert("whatsapp_messages", { id, kind, entity_id: entityId, body, status: "pending", provider: wa.provider, created_at: now() });
  await deliver(id);
  return mapMessage(get("SELECT * FROM whatsapp_messages WHERE id = ?", id));
}

export async function resend(id) {
  const msg = get("SELECT * FROM whatsapp_messages WHERE id = ?", id);
  if (!msg) return null;
  run("UPDATE whatsapp_messages SET status = 'pending', provider = ?, error = NULL WHERE id = ?", wa.provider, id);
  await deliver(id);
  return mapMessage(get("SELECT * FROM whatsapp_messages WHERE id = ?", id));
}

export async function listGroups() {
  const provider = providers[wa.provider];
  if (!provider) throw new Error(`Fournisseur inconnu : ${wa.provider}`);
  return provider.groups();
}

const mapMessage = (r) => ({
  id: r.id,
  kind: r.kind,
  entityId: r.entity_id,
  body: r.body,
  status: r.status,
  provider: r.provider,
  error: r.error ?? undefined,
  createdAt: r.created_at,
  sentAt: r.sent_at ?? undefined,
});

export function status() {
  const masked = wa.groupId ? wa.groupId.replace(/^(\d{4})\d+/, "$1••••") : "";
  return {
    provider: wa.provider,
    configured: isConfigured(),
    groupId: masked,
    events: wa.events,
    messages: all("SELECT * FROM whatsapp_messages ORDER BY created_at DESC LIMIT 50").map(mapMessage),
  };
}

/* ------------------------------ Contenu des messages ------------------------------ */

const money = (cents) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: config.currency, maximumFractionDigits: 0 }).format((cents ?? 0) / 100).replace(/ | /g, " ");
const date = (iso, withTime = false) =>
  new Intl.DateTimeFormat("fr-FR", { weekday: withTime ? "long" : undefined, day: "numeric", month: "long", year: "numeric", ...(withTime ? { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Douala" } : { timeZone: "Africa/Douala" }) }).format(new Date(iso));
const link = (path) => `${config.appUrl}${path}`;
const branchName = (id) => (id ? get("SELECT name FROM branches WHERE id = ?", id)?.name : null);

function projectTotals(projectId) {
  return get(
    `SELECT p.title, p.target_cents, COALESCE(SUM(CASE WHEN d.status = 'confirmed' THEN d.amount_cents END), 0) AS raised
     FROM projects p LEFT JOIN donations d ON d.project_id = p.id WHERE p.id = ? GROUP BY p.id`,
    projectId,
  );
}

export const messages = {
  project(p) {
    const lines = [
      "🌱 *Nouveau projet FAWONE*",
      `*${p.title}*`,
      p.summary,
      "",
      `📍 ${p.location || branchName(p.branch_id) || "Fako"}`,
      `🎯 Objectif : ${money(p.target_cents)}`,
      `🗓️ Du ${date(p.start_date)} au ${date(p.end_date)}`,
      "",
      `👉 Soutenir le projet : ${link(`/projects/${p.id}`)}`,
    ];
    return lines.join("\n");
  },
  event(e) {
    const branch = branchName(e.branch_id);
    return [
      "📅 *Nouvel événement FAWONE*",
      `*${e.title}*`,
      e.description || "",
      "",
      `🕘 ${date(e.starts_at, true)}`,
      `${e.online ? "💻" : "📍"} ${e.location}`,
      branch ? `👥 Branche : ${branch}` : "👥 Toutes les branches",
      "",
      `👉 ${link("/news?tab=events")}`,
    ]
      .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
      .join("\n");
  },
  news(n) {
    const icon = n.category === "announcement" ? "📢" : n.category === "project" ? "🌱" : "📰";
    return [`${icon} *${n.title}*`, "", n.excerpt || n.content.slice(0, 200), "", `👉 Lire la suite : ${link(`/news/${n.id}`)}`].join("\n");
  },
  donation(d) {
    const who = wa.showDonorNames ? d.donor_name.split(" ")[0] : "Une généreuse donatrice";
    if (!d.project_id) {
      return [`💚 *Nouveau don de ${money(d.amount_cents)}*`, `${who} a soutenu le fonds général de FAWONE. Merci !`, "", `👉 Faire un don : ${link("/donate")}`].join("\n");
    }
    const t = projectTotals(d.project_id);
    const pct = t.target_cents > 0 ? Math.min(100, Math.round((t.raised / t.target_cents) * 100)) : 0;
    return [
      `💚 *Nouveau don de ${money(d.amount_cents)}*`,
      `${who} soutient « ${t.title} ». Merci !`,
      "",
      `📊 Collecté : ${money(t.raised)} / ${money(t.target_cents)} (${pct} %)`,
      `👉 Participer : ${link(`/donate?project=${d.project_id}`)}`,
    ].join("\n");
  },
};

/* Raccourcis utilisés par les routes (lisent la ligne en base après enregistrement). */
export const notifyProjectCreated = (id) => {
  const p = get("SELECT * FROM projects WHERE id = ?", id);
  if (p) queueWhatsApp("project", id, messages.project(p));
};
export const notifyEventCreated = (id) => {
  const e = get("SELECT * FROM events WHERE id = ?", id);
  if (e) queueWhatsApp("event", id, messages.event(e));
};
export const notifyNewsPublished = (id) => {
  const n = get("SELECT * FROM news WHERE id = ?", id);
  if (n && n.status === "published") queueWhatsApp("news", id, messages.news(n));
};
export const notifyDonationConfirmed = (id) => {
  const d = get("SELECT * FROM donations WHERE id = ?", id);
  if (d && d.status === "confirmed") queueWhatsApp("donation", id, messages.donation(d));
};

