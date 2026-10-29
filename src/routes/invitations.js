// Invitations familiales (sœurs, nièces).
import { router } from "./router.js";
import { get, run, insert, tx, now } from "../db/index.js";
import { newToken, sha256, newId } from "../lib/security.js";
import { requireUser } from "../auth/session.js";
import { fail, str, oneOf } from "../lib/http.js";
import { audit, requireArea, requireBranchScope } from "./helpers.js";
import { config } from "../config.js";

router.post("/api/invitations", (ctx) => {
  const u = requireUser(ctx);
  const b = ctx.body;
  if (b.consentConfirmed !== true) fail(422, "Le consentement de la personne est obligatoire.", { field: "consent" });
  const contact = str(b.contact, "contact", { required: true, max: 120 });
  if (!/^(\+?\d[\d\s]{7,}|[^\s@]+@[^\s@]+\.[^\s@]+)$/.test(contact)) fail(422, "Téléphone ou e-mail invalide.", { field: "contact" });
  const id = newId("inv");
  insert("invitations", {
    id, sponsor_id: u.id, invitee_name: str(b.inviteeName, "nom", { required: true, min: 3, max: 120 }),
    relationship: oneOf(b.relationship, "lien familial", ["sœur", "nièce"], { required: true }), contact, branch_id: u.branchId,
    consent_confirmed: 1, is_minor: b.isMinor ? 1 : 0, status: "pending", created_at: now(), note: b.isMinor ? "Mineure – consentement parental à vérifier" : null,
  });
  return { ok: true, id };
});

function issueInvitationLink(invId) {
  const token = newToken();
  run("UPDATE invitations SET token_hash = ?, token_expires_at = ? WHERE id = ?", sha256(token), new Date(Date.now() + 7 * 864e5).toISOString(), invId);
  const url = `${config.appUrl}/join?token=${token}`;
  console.log(`[invitations] Lien d'invitation ${invId} : ${url}`);
  return url;
}

router.patch("/api/invitations/:id", (ctx) => {
  const u = requireArea(ctx, "invitations");
  const inv = get("SELECT * FROM invitations WHERE id = ?", ctx.params.id);
  if (!inv) fail(404, "Invitation introuvable.");
  requireBranchScope(u, inv.branch_id);
  const status = oneOf(ctx.body.status, "statut", ["approved", "rejected"], { required: true });
  if (inv.status !== "pending") fail(409, "Cette invitation a déjà été traitée.");
  let inviteUrl;
  tx(() => {
    run("UPDATE invitations SET status = ?, reviewed_by = ? WHERE id = ?", status, u.id, inv.id);
    if (status === "approved") inviteUrl = issueInvitationLink(inv.id);
    audit(u.id, status === "approved" ? "Invitation approuvée" : "Invitation refusée", "invitation", inv.id);
  });
  // Pas encore de fournisseur e-mail/SMS : le lien est rendu à l'administratrice pour être transmis.
  return { ok: true, inviteUrl };
});

router.post("/api/invitations/:id/link", (ctx) => {
  const u = requireArea(ctx, "invitations");
  const inv = get("SELECT * FROM invitations WHERE id = ?", ctx.params.id);
  if (!inv) fail(404, "Invitation introuvable.");
  requireBranchScope(u, inv.branch_id);
  if (inv.status !== "approved") fail(409, "Seule une invitation approuvée possède un lien.");
  return { inviteUrl: issueInvitationLink(inv.id) };
});
