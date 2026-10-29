// Fonctions partagées par les routes.
import { all, get, insert, now, map, fromCents } from "../db/index.js";
import { newId } from "../lib/security.js";
import { requireUser } from "../auth/session.js";
import { fail } from "../lib/http.js";
import { isAdmin, canAccess, inScope, canSeeContact } from "../auth/permissions.js";

export const ROLES = ["super_admin", "branch_admin", "treasurer", "member"];
/** Seuls moyens de paiement acceptés : Mobile Money via Campay. */
export const PROVIDERS = ["mtn_momo", "orange_money"];

export function audit(actorId, action, entityType, entityId) {
  insert("audit_logs", { id: newId("al"), actor_id: actorId, action, entity_type: entityType, entity_id: entityId ?? "", created_at: now() });
}

export function requireArea(ctx, area) {
  const u = requireUser(ctx);
  if (!canAccess(u, area)) fail(403, "Accès non autorisé pour votre rôle.");
  return u;
}

export function requireBranchScope(u, branchId) {
  if (!inScope(u, branchId)) fail(403, "Cette branche est hors de votre périmètre.");
}

export const memberRow = (id) => {
  const r = get("SELECT * FROM members WHERE id = ?", id);
  return r ? map.member(r) : null;
};

/** Masque les coordonnées selon les préférences de confidentialité. */
export function sanitizeMember(viewer, m) {
  const out = { ...m };
  if (!canSeeContact(viewer, m)) {
    delete out.phone;
    delete out.email;
    out.contactHidden = true;
  }
  if (!isAdmin(viewer)) delete out.hasAccount;
  return out;
}

export const projectsWithTotals = () =>
  all(`SELECT p.*,
         COALESCE(SUM(CASE WHEN d.status = 'confirmed' THEN d.amount_cents END), 0) AS raised_cents,
         COUNT(DISTINCT CASE WHEN d.status = 'confirmed' THEN d.donor_name END) AS donors_count
       FROM projects p LEFT JOIN donations d ON d.project_id = p.id
       GROUP BY p.id ORDER BY p.updated_at DESC`).map(map.project);

export function nextReceiptNumber() {
  const year = new Date().getFullYear();
  let n = get("SELECT COUNT(*) AS n FROM donations WHERE receipt_number LIKE ?", `FAW-${year}-%`).n + 1;
  while (get("SELECT 1 FROM donations WHERE receipt_number = ?", `FAW-${year}-${String(n).padStart(4, "0")}`)) n += 1;
  return `FAW-${year}-${String(n).padStart(4, "0")}`;
}

export function stats() {
  const totals = get(`SELECT
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount_cents END), 0) AS total,
      COALESCE(SUM(CASE WHEN status = 'confirmed' AND project_id IS NULL THEN amount_cents END), 0) AS general,
      COUNT(CASE WHEN status = 'confirmed' THEN 1 END) AS count
    FROM donations`);
  const monthlyRows = all(
    `SELECT substr(created_at, 1, 7) AS month, SUM(amount_cents) AS total FROM donations
     WHERE status = 'confirmed' GROUP BY month ORDER BY month DESC LIMIT 24`,
  );
  return {
    totalRaised: fromCents(totals.total),
    generalFund: fromCents(totals.general),
    donationsCount: totals.count,
    activeMembers: get("SELECT COUNT(*) AS n FROM members WHERE status = 'active' AND is_minor = 0").n,
    monthly: monthlyRows.map((r) => ({ month: r.month, total: fromCents(r.total) })),
  };
}
