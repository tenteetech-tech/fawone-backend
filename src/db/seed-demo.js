// Données de démonstration FICTIVES — facultatives.
// Utilisées par « npm run seed:demo » et par les tests. Remplacent tout le contenu de la base.
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { db, all, run, insert, tx, now, toCents } from "./index.js";
import { hashPassword } from "../lib/security.js";

/* ------------------------------------------------------------------ */
/* Données de démonstration                                            */
/* ------------------------------------------------------------------ */

/** Comptes qui reçoivent le mot de passe de démo. Les autres membres doivent
 *  activer leur compte via « mot de passe oublié » (comme après un import). */
const DEMO_ACCOUNT_IDS = ["m-esther", "m-aicha", "m-grace", "m-comfort", "m-marie", "m-fatima", "m-lucie", "m-rachel", "m-awa"];

const TABLES = ["whatsapp_messages", "audit_logs", "notifications", "events", "news", "donations", "project_updates", "projects", "family_links", "invitations", "password_resets", "sessions", "members", "branches"];

export function seedDemo({ password = "fawone2026", keepSessions = false } = {}) {
  const seed = JSON.parse(fs.readFileSync(path.join(config.root, "seed", "demo.json"), "utf8"));
  const demoHash = hashPassword(password);
  const savedSessions = keepSessions ? all("SELECT * FROM sessions") : [];
  tx(() => {
    db.exec("PRAGMA defer_foreign_keys = ON");
    for (const t of TABLES) run(`DELETE FROM ${t}`);
    for (const b of seed.branches) insert("branches", { id: b.id, name: b.name, city: b.city, country: b.country, status: b.status, created_at: b.createdAt });
    for (const m of seed.members)
      insert("members", {
        id: m.id, title: m.title, first_name: m.firstName, last_name: m.lastName, position: m.position, role: m.role, branch_id: m.branchId,
        location: m.location, phone: m.phone, email: m.email, joined_at: m.joinedAt, status: m.status, privacy: m.privacy,
        is_minor: m.isMinor ? 1 : 0, bio: m.bio, password_hash: DEMO_ACCOUNT_IDS.includes(m.id) ? demoHash : null,
      });
    for (const i of seed.invitations)
      insert("invitations", {
        id: i.id, sponsor_id: i.sponsorId, invitee_name: i.inviteeName, relationship: i.relationship, contact: i.contact, branch_id: i.branchId,
        consent_confirmed: i.consentConfirmed ? 1 : 0, is_minor: i.isMinor ? 1 : 0, status: i.status, reviewed_by: i.reviewedBy, note: i.note, created_at: i.createdAt,
      });
    for (const l of seed.familyLinks) insert("family_links", { id: l.id, member_id: l.memberId, related_member_id: l.relatedMemberId, relationship: l.relationship, created_at: now() });
    for (const p of seed.projects)
      insert("projects", {
        id: p.id, title: p.title, summary: p.summary, description: p.description, category: p.category, location: p.location, branch_id: p.branchId,
        status: p.status, start_date: p.startDate, end_date: p.endDate, budget_cents: toCents(p.budget), target_cents: toCents(p.targetAmount),
        spent_cents: toCents(p.spentAmount), manager_id: p.managerId, updated_at: p.updatedAt,
      });
    for (const u of seed.projectUpdates) insert("project_updates", { id: u.id, project_id: u.projectId, title: u.title, content: u.content, date: u.date });
    for (const d of seed.donations)
      insert("donations", {
        id: d.id, donor_name: d.donorName, donor_email: d.donorEmail, donor_id: d.donorId, project_id: d.projectId, amount_cents: toCents(d.amount),
        currency: d.currency, provider: d.provider, provider_reference: `${d.providerReference}-${d.id}`, status: d.status, recurrence: d.recurrence,
        receipt_number: d.receiptNumber, created_at: d.createdAt,
      });
    for (const n of seed.news)
      insert("news", {
        id: n.id, title: n.title, excerpt: n.excerpt, content: n.content, category: n.category, project_id: n.projectId, branch_id: n.branchId,
        status: n.status, published_at: n.publishedAt, author_id: n.authorId,
      });
    for (const e of seed.events)
      insert("events", { id: e.id, title: e.title, description: e.description, location: e.location, online: e.online ? 1 : 0, starts_at: e.startsAt, ends_at: e.endsAt, branch_id: e.branchId });
    for (const n of seed.notifications)
      insert("notifications", { id: n.id, title: n.title, body: n.body, channels: JSON.stringify(n.channels), audience: n.audience, sent_at: n.sentAt, sent_by: n.sentBy });
    for (const a of seed.auditLogs)
      insert("audit_logs", { id: a.id, actor_id: a.actorId, action: a.action, entity_type: a.entityType, entity_id: a.entityId, created_at: a.createdAt });
    const ids = new Set(seed.members.map((m) => m.id));
    for (const sess of savedSessions) if (ids.has(sess.member_id)) insert("sessions", { ...sess });
  });
}
