// Membres : profil personnel, création, modification, import CSV.
import { router } from "./router.js";
import { get, run, insert, update, tx, now } from "../db/index.js";
import { newId } from "../lib/security.js";
import { requireUser } from "../auth/session.js";
import { fail, str, oneOf, email as emailField } from "../lib/http.js";
import { canManageMember } from "../auth/permissions.js";
import { ROLES, audit, requireArea, requireBranchScope, memberRow } from "./helpers.js";

router.patch("/api/members/me", (ctx) => {
  const u = requireUser(ctx);
  const b = ctx.body;
  const email = b.email === "" ? null : emailField(b.email);
  if (email && get("SELECT 1 FROM members WHERE email = ? AND id != ?", email, u.id)) fail(409, "Cette adresse e-mail est déjà utilisée.", { field: "email" });
  if (b.email === "" && u.email) fail(422, "L'e-mail est nécessaire pour se connecter.", { field: "email" });
  update("members", u.id, {
    phone: b.phone === "" ? null : str(b.phone, "téléphone", { max: 40 }),
    email: email ?? undefined,
    location: str(b.location, "lieu", { required: true, max: 120 }),
    bio: b.bio === "" ? null : str(b.bio, "présentation", { max: 600 }),
    privacy: oneOf(b.privacy, "confidentialité", ["members", "branch", "private"]),
  });
  return { user: memberRow(u.id) };
});

function memberInput(u, b, existing) {
  const branchId = str(b.branchId, "branche", { required: !existing, max: 60 }) ?? existing?.branchId;
  if (!get("SELECT 1 FROM branches WHERE id = ?", branchId)) fail(422, "Branche inconnue.", { field: "branchId" });
  requireBranchScope(u, branchId);
  const role = oneOf(b.role, "rôle", ROLES);
  if (role && role !== (existing?.role ?? "member") && u.role !== "super_admin") fail(403, "Seule la super administratrice attribue les rôles.");
  return {
    first_name: str(b.firstName, "prénom", { required: !existing, max: 80 }),
    last_name: str(b.lastName, "nom", { required: !existing, max: 80 }),
    email: b.email === "" ? null : emailField(b.email),
    phone: b.phone === "" ? null : str(b.phone, "téléphone", { max: 40 }),
    branch_id: branchId,
    location: str(b.location, "lieu", { max: 120 }),
    position: str(b.position, "fonction", { max: 80 }),
    role,
    status: oneOf(b.status, "statut", ["active", "pending", "inactive"]),
  };
}

function assertNoDuplicate(row, exceptId = "") {
  if (row.email && get("SELECT 1 FROM members WHERE email = ? AND id != ?", row.email, exceptId)) fail(409, "Doublon : une membre utilise déjà cet e-mail.", { field: "email" });
  if (row.first_name && row.last_name) {
    const d = get("SELECT first_name, last_name FROM members WHERE lower(first_name) = lower(?) AND lower(last_name) = lower(?) AND id != ?", row.first_name, row.last_name, exceptId);
    if (d) fail(409, `Doublon possible : ${d.first_name} ${d.last_name} existe déjà.`);
  }
}

router.post("/api/members", (ctx) => {
  const u = requireArea(ctx, "members");
  const row = memberInput(u, ctx.body, null);
  assertNoDuplicate(row);
  const id = newId("m");
  tx(() => {
    insert("members", { ...row, id, location: row.location ?? "", position: row.position ?? "Membre", role: row.role ?? "member", status: row.status ?? "active", joined_at: now(), privacy: "private" });
    audit(u.id, `Membre ajoutée : ${row.first_name} ${row.last_name}`, "member", id);
  });
  return { member: memberRow(id) };
});

router.patch("/api/members/:id", (ctx) => {
  const u = requireArea(ctx, "members");
  const m = memberRow(ctx.params.id);
  if (!m) fail(404, "Membre introuvable.");
  if (!canManageMember(u, m)) fail(403, "Cette membre est hors de votre périmètre.");
  const row = memberInput(u, ctx.body, m);
  if (m.id === u.id && ((row.status && row.status !== m.status) || (row.role && row.role !== m.role))) fail(403, "Vous ne pouvez pas modifier votre propre statut ou rôle.");
  assertNoDuplicate({ ...row, first_name: row.first_name ?? m.firstName, last_name: row.last_name ?? m.lastName }, m.id);
  tx(() => {
    update("members", m.id, row);
    if (row.status === "inactive") run("DELETE FROM sessions WHERE member_id = ?", m.id);
    audit(u.id, row.status && row.status !== m.status ? `Statut de ${m.firstName} ${m.lastName} : ${row.status}` : `Profil modifié : ${m.firstName} ${m.lastName}`, "member", m.id);
  });
  return { member: memberRow(m.id) };
});

router.post("/api/members/import", (ctx) => {
  const u = requireArea(ctx, "members");
  const rows = Array.isArray(ctx.body.rows) ? ctx.body.rows.slice(0, 1000) : fail(422, "Liste de lignes attendue.");
  const created = [];
  const skipped = [];
  tx(() => {
    rows.forEach((r, i) => {
      try {
        const row = memberInput(u, { ...r, role: "member", status: "pending", position: "Membre" }, null);
        assertNoDuplicate(row);
        const id = newId("m");
        insert("members", { ...row, id, location: row.location ?? "", joined_at: now(), privacy: "private" });
        created.push(id);
      } catch (e) {
        if (!e.status) throw e;
        skipped.push({ line: i + 1, reason: e.message });
      }
    });
    if (created.length) audit(u.id, `Import CSV : ${created.length} membre(s)`, "member", created[0]);
  });
  return { created: created.length, skipped };
});
