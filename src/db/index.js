// Connexion SQLite, schéma et conversions.
import { openDatabase } from "./driver.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const here = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
export const db = openDatabase(config.databasePath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
db.exec(fs.readFileSync(path.join(here, "schema.sql"), "utf8"));

/** Migrations légères : ajoute les colonnes apparues après la création d'une base existante. */
function ensureColumn(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}
ensureColumn("donations", "gateway", "TEXT"); // "campay" pour les paiements Mobile Money réels
ensureColumn("donations", "operator", "TEXT"); // MTN / ORANGE (renvoyé par Campay)
ensureColumn("donations", "failure_reason", "TEXT");
ensureColumn("donations", "payer_phone", "TEXT"); // numéro masqué, ex. 6•••••123

/* ------------------------------------------------------------------ */
/* Utilitaires                                                         */
/* ------------------------------------------------------------------ */

export const now = () => new Date().toISOString();
export const toCents = (v) => Math.round(Number(v) * 100);
export const fromCents = (c) => (c ?? 0) / 100;

export function tx(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const get = (sql, ...p) => db.prepare(sql).get(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

/** INSERT générique à partir d'un objet { colonne: valeur }. */
export function insert(table, row) {
  const cols = Object.keys(row);
  run(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, ...cols.map((c) => row[c] ?? null));
}

/** UPDATE générique (seules les colonnes fournies sont modifiées). */
export function update(table, id, row) {
  const cols = Object.keys(row).filter((c) => row[c] !== undefined);
  if (!cols.length) return;
  run(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, ...cols.map((c) => row[c] ?? null), id);
}

/* ------------------------------------------------------------------ */
/* Conversion lignes SQL -> objets JSON de l'API (camelCase)           */
/* ------------------------------------------------------------------ */

export const map = {
  branch: (r) => ({ id: r.id, name: r.name, city: r.city, country: r.country, status: r.status, createdAt: r.created_at }),
  member: (r) => ({
    id: r.id,
    title: r.title ?? undefined,
    firstName: r.first_name,
    lastName: r.last_name,
    position: r.position,
    role: r.role,
    branchId: r.branch_id,
    location: r.location,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    joinedAt: r.joined_at,
    status: r.status,
    privacy: r.privacy,
    isMinor: !!r.is_minor,
    bio: r.bio ?? undefined,
    hasAccount: !!r.password_hash,
  }),
  invitation: (r) => ({
    id: r.id,
    sponsorId: r.sponsor_id,
    inviteeName: r.invitee_name,
    relationship: r.relationship,
    contact: r.contact,
    branchId: r.branch_id,
    consentConfirmed: !!r.consent_confirmed,
    isMinor: !!r.is_minor,
    status: r.status,
    reviewedBy: r.reviewed_by ?? undefined,
    note: r.note ?? undefined,
    createdAt: r.created_at,
  }),
  familyLink: (r) => ({ id: r.id, memberId: r.member_id, relatedMemberId: r.related_member_id, relationship: r.relationship }),
  project: (r) => ({
    id: r.id,
    title: r.title,
    summary: r.summary,
    description: r.description,
    category: r.category,
    location: r.location,
    branchId: r.branch_id ?? undefined,
    status: r.status,
    startDate: r.start_date,
    endDate: r.end_date,
    budget: fromCents(r.budget_cents),
    targetAmount: fromCents(r.target_cents),
    spentAmount: fromCents(r.spent_cents),
    managerId: r.manager_id,
    updatedAt: r.updated_at,
    raised: fromCents(r.raised_cents),
    donorsCount: r.donors_count ?? 0,
  }),
  projectUpdate: (r) => ({ id: r.id, projectId: r.project_id, title: r.title, content: r.content, date: r.date }),
  donation: (r) => ({
    id: r.id,
    donorName: r.donor_name,
    donorEmail: r.donor_email ?? undefined,
    donorId: r.donor_id ?? undefined,
    projectId: r.project_id,
    amount: fromCents(r.amount_cents),
    currency: r.currency,
    provider: r.provider,
    providerReference: r.provider_reference,
    status: r.status,
    recurrence: r.recurrence,
    receiptNumber: r.receipt_number ?? undefined,
    gateway: r.gateway ?? undefined,
    operator: r.operator ?? undefined,
    failureReason: r.failure_reason ?? undefined,
    payerPhone: r.payer_phone ?? undefined,
    createdAt: r.created_at,
  }),
  news: (r) => ({
    id: r.id,
    title: r.title,
    excerpt: r.excerpt,
    content: r.content,
    category: r.category,
    projectId: r.project_id ?? undefined,
    branchId: r.branch_id,
    status: r.status,
    publishedAt: r.published_at,
    authorId: r.author_id,
  }),
  event: (r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    location: r.location,
    online: !!r.online,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    branchId: r.branch_id,
  }),
  notification: (r) => ({ id: r.id, title: r.title, body: r.body, channels: JSON.parse(r.channels), audience: r.audience, sentAt: r.sent_at, sentBy: r.sent_by }),
  audit: (r) => ({ id: r.id, actorId: r.actor_id, action: r.action, entityType: r.entity_type, entityId: r.entity_id, createdAt: r.created_at }),
};
