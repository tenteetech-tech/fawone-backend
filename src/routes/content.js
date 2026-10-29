// Actualités, événements et notifications.
import { router } from "./router.js";
import { all, get, insert, update, tx, now } from "../db/index.js";
import { newId } from "../lib/security.js";
import { fail, str, oneOf, isoDate } from "../lib/http.js";
import { audit, requireArea, requireBranchScope } from "./helpers.js";
import { notifyEventCreated, notifyNewsPublished, queueWhatsApp } from "../services/whatsapp.js";

function checkContentScope(u, branchId) {
  if (branchId === null) {
    if (u.role !== "super_admin") fail(403, "Seule la super administratrice publie pour toutes les branches.");
  } else {
    if (!get("SELECT 1 FROM branches WHERE id = ?", branchId)) fail(422, "Branche inconnue.");
    requireBranchScope(u, branchId);
  }
}

function newsInput(b) {
  const content = str(b.content, "contenu", { required: true, max: 10000 });
  const projectId = b.projectId || null;
  if (projectId && !get("SELECT 1 FROM projects WHERE id = ?", projectId)) fail(422, "Projet inconnu.");
  return {
    title: str(b.title, "titre", { required: true, max: 160 }),
    excerpt: str(b.excerpt, "chapô", { max: 300 }) || content.slice(0, 110),
    content,
    category: oneOf(b.category, "type", ["news", "project", "announcement"], { required: true }),
    project_id: projectId,
    branch_id: b.branchId || null,
    status: oneOf(b.status, "statut", ["draft", "published", "archived"], { required: true }),
  };
}

router.post("/api/news", (ctx) => {
  const u = requireArea(ctx, "news");
  const row = newsInput(ctx.body);
  checkContentScope(u, row.branch_id);
  const id = newId("n");
  tx(() => {
    insert("news", { ...row, id, published_at: now(), author_id: u.id });
    audit(u.id, `Actualité créée : ${row.title}`, "news", id);
  });
  notifyNewsPublished(id); // seulement si publiée (pas les brouillons)
  return { ok: true, id };
});

router.put("/api/news/:id", (ctx) => {
  const u = requireArea(ctx, "news");
  const n = get("SELECT * FROM news WHERE id = ?", ctx.params.id);
  if (!n) fail(404, "Actualité introuvable.");
  checkContentScope(u, n.branch_id);
  const row = newsInput(ctx.body);
  checkContentScope(u, row.branch_id);
  tx(() => {
    update("news", n.id, { ...row, published_at: row.status === "published" && n.status !== "published" ? now() : n.published_at });
    audit(u.id, `Actualité modifiée : ${row.title}`, "news", n.id);
  });
  if (row.status === "published" && n.status !== "published") notifyNewsPublished(n.id);
  return { ok: true };
});

router.post("/api/events", (ctx) => {
  const u = requireArea(ctx, "events");
  const b = ctx.body;
  const branchId = b.branchId || null;
  checkContentScope(u, branchId);
  const startsAt = isoDate(b.startsAt, "début", { required: true });
  const endsAt = isoDate(b.endsAt, "fin", { required: true });
  if (endsAt <= startsAt) fail(422, "L'heure de fin doit suivre l'heure de début.");
  const id = newId("e");
  const title = str(b.title, "titre", { required: true, max: 160 });
  tx(() => {
    insert("events", { id, title, description: str(b.description, "description", { max: 3000 }) ?? "", location: str(b.location, "lieu", { required: true, max: 200 }), online: b.online ? 1 : 0, starts_at: startsAt, ends_at: endsAt, branch_id: branchId });
    audit(u.id, `Événement créé : ${title}`, "event", id);
  });
  notifyEventCreated(id);
  return { ok: true, id };
});

router.post("/api/notifications", (ctx) => {
  const u = requireArea(ctx, "notifications");
  const b = ctx.body;
  const audience = str(b.audience, "destinataires", { required: true, max: 60 });
  checkContentScope(u, audience === "all" ? null : audience);
  const channels = Array.isArray(b.channels) ? b.channels.filter((c) => ["in_app", "email", "sms", "whatsapp", "push"].includes(c)) : [];
  if (!channels.length) fail(422, "Choisissez au moins un canal.");
  const id = newId("nt");
  const title = str(b.title, "titre", { required: true, max: 120 });
  tx(() => {
    insert("notifications", { id, title, body: str(b.body, "message", { required: true, max: 480 }), channels: JSON.stringify(channels), audience, sent_at: now(), sent_by: u.id });
    audit(u.id, `Notification envoyée : ${title}`, "notification", id);
  });
  const recipients = get(
    `SELECT COUNT(*) AS n FROM members WHERE status = 'active' AND is_minor = 0 ${audience === "all" ? "" : "AND branch_id = ?"}`,
    ...(audience === "all" ? [] : [audience]),
  ).n;
  let whatsappId = null;
  if (channels.includes("whatsapp")) {
    const scope = audience === "all" ? "" : ` (branche ${get("SELECT name FROM branches WHERE id = ?", audience)?.name ?? ""})`;
    whatsappId = queueWhatsApp("manual", id, `📣 *${title}*${scope}\n\n${String(b.body).trim()}`, { force: true });
  }
  return { ok: true, recipients, whatsapp: whatsappId ? "queued" : channels.includes("whatsapp") ? "disabled" : undefined };
});
