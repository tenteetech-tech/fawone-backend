// Projets et mises à jour de projet.
import { router } from "./router.js";
import { get, run, insert, update, tx, now } from "../db/index.js";
import { newId } from "../lib/security.js";
import { requireUser } from "../auth/session.js";
import { fail, str, oneOf, money, isoDate } from "../lib/http.js";
import { canAccess, inScope } from "../auth/permissions.js";
import { audit, requireArea } from "./helpers.js";
import { notifyProjectCreated } from "../services/whatsapp.js";

function canEditProject(u, p) {
  return canAccess(u, "projects") && (u.role === "super_admin" || (p.branch_id && inScope(u, p.branch_id)));
}

function projectInput(b, partial) {
  const row = {
    title: str(b.title, "titre", { required: !partial, min: 4, max: 140 }),
    summary: str(b.summary, "résumé", { required: !partial, max: 300 }),
    description: str(b.description, "description", { max: 5000 }) ?? (partial ? undefined : ""),
    category: oneOf(b.category, "catégorie", ["education", "sante", "social", "eau", "agriculture", "numerique"], { required: !partial }),
    location: str(b.location, "lieu", { max: 120 }) ?? (partial ? undefined : ""),
    status: oneOf(b.status, "statut", ["upcoming", "active", "completed"], { required: !partial }),
    start_date: isoDate(b.startDate, "début", { required: !partial }),
    end_date: isoDate(b.endDate, "fin", { required: !partial }),
    budget_cents: money(b.budget, "budget"),
    target_cents: money(b.targetAmount, "objectif", { required: !partial, min: 1 }),
    spent_cents: money(b.spentAmount, "dépensé"),
    manager_id: b.managerId ? (get("SELECT 1 FROM members WHERE id = ?", b.managerId) ? b.managerId : fail(422, "Responsable inconnue.")) : undefined,
    updated_at: now(),
  };
  if (row.start_date && row.end_date && row.end_date < row.start_date) fail(422, "La date de fin doit suivre la date de début.");
  return row;
}

router.post("/api/projects", (ctx) => {
  const u = requireArea(ctx, "projects");
  if (u.role !== "super_admin") fail(403, "Seule la super administratrice crée des projets.");
  const row = projectInput(ctx.body, false);
  const branchId = ctx.body.branchId || null;
  if (branchId && !get("SELECT 1 FROM branches WHERE id = ?", branchId)) fail(422, "Branche inconnue.");
  const id = newId("p");
  tx(() => {
    insert("projects", { ...row, id, branch_id: branchId, budget_cents: row.budget_cents ?? 0, spent_cents: row.spent_cents ?? 0, manager_id: row.manager_id ?? u.id });
    audit(u.id, `Projet créé : ${row.title}`, "project", id);
  });
  notifyProjectCreated(id); // message WhatsApp au groupe
  return { ok: true, id };
});

router.put("/api/projects/:id", (ctx) => {
  const u = requireUser(ctx);
  const p = get("SELECT * FROM projects WHERE id = ?", ctx.params.id);
  if (!p) fail(404, "Projet introuvable.");
  if (!canEditProject(u, p)) fail(403, "Vous ne pouvez pas modifier ce projet.");
  const row = projectInput(ctx.body, true);
  const start = row.start_date ?? p.start_date;
  const end = row.end_date ?? p.end_date;
  if (end < start) fail(422, "La date de fin doit suivre la date de début.");
  tx(() => {
    update("projects", p.id, row);
    audit(u.id, `Projet modifié : ${row.title ?? p.title}`, "project", p.id);
  });
  return { ok: true };
});

router.post("/api/projects/:id/updates", (ctx) => {
  const u = requireUser(ctx);
  const p = get("SELECT * FROM projects WHERE id = ?", ctx.params.id);
  if (!p) fail(404, "Projet introuvable.");
  if (!canEditProject(u, p)) fail(403, "Vous ne pouvez pas publier sur ce projet.");
  const title = str(ctx.body.title, "titre", { required: true, max: 140 });
  tx(() => {
    insert("project_updates", { id: newId("pu"), project_id: p.id, title, content: str(ctx.body.content, "contenu", { required: true, max: 3000 }), date: now() });
    run("UPDATE projects SET updated_at = ? WHERE id = ?", now(), p.id);
    audit(u.id, `Mise à jour publiée : ${title}`, "project", p.id);
  });
  return { ok: true };
});
