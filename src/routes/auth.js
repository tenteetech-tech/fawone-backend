// Santé et authentification : connexion, déconnexion, mot de passe, invitations.
import { router } from "./router.js";
import { get, run, insert, tx, now, map } from "../db/index.js";
import { hashPassword, verifyPassword, newToken, sha256, newId, passwordProblem } from "../lib/security.js";
import { createSession, destroySession, requireUser, checkRateLimit, recordFailure, clearFailures, COOKIE } from "../auth/session.js";
import { fail, str, oneOf, email as emailField, parseCookies } from "../lib/http.js";
import { audit, memberRow } from "./helpers.js";
import { config } from "../config.js";

router.get("/api/health", () => ({ ok: true, time: now() }));

router.get("/api/auth/me", (ctx) => ({ user: ctx.user }));

router.post("/api/auth/login", (ctx) => {
  const email = emailField(ctx.body.email, "e-mail", { required: true });
  const password = str(ctx.body.password, "mot de passe", { required: true, max: 200 });
  const key = `${ctx.ip}|${email}`;
  checkRateLimit(key);
  const row = get("SELECT * FROM members WHERE email = ?", email);
  if (!row || !verifyPassword(password, row.password_hash)) {
    recordFailure(key);
    fail(401, "E-mail ou mot de passe incorrect.");
  }
  if (row.status === "inactive") fail(403, "Ce compte est désactivé. Contactez votre administratrice de branche.");
  clearFailures(key);
  createSession(ctx.res, row.id, ctx.req.headers["user-agent"]);
  return { user: map.member(row) };
});

router.post("/api/auth/logout", (ctx) => {
  destroySession(ctx.req, ctx.res);
  return { ok: true };
});

router.post("/api/auth/change-password", (ctx) => {
  const u = requireUser(ctx);
  const current = str(ctx.body.currentPassword, "mot de passe actuel", { required: true, max: 200 });
  const next = ctx.body.newPassword;
  const row = get("SELECT password_hash FROM members WHERE id = ?", u.id);
  if (!verifyPassword(current, row.password_hash)) fail(400, "Mot de passe actuel incorrect.", { field: "currentPassword" });
  const problem = passwordProblem(next);
  if (problem) fail(422, problem, { field: "newPassword" });
  const currentToken = sha256(parseCookies(ctx.req.headers.cookie)[COOKIE] ?? "");
  tx(() => {
    run("UPDATE members SET password_hash = ? WHERE id = ?", hashPassword(next), u.id);
    run("DELETE FROM sessions WHERE member_id = ? AND token_hash != ?", u.id, currentToken); // déconnecte les autres appareils
  });
  return { ok: true };
});

router.post("/api/auth/forgot", (ctx) => {
  const email = emailField(ctx.body.email, "e-mail", { required: true });
  checkRateLimit(`forgot|${ctx.ip}`);
  recordFailure(`forgot|${ctx.ip}`); // limite à 5 demandes / 15 min par adresse IP
  const row = get("SELECT id, status FROM members WHERE email = ?", email);
  const response = { ok: true, message: "Si un compte existe pour cette adresse, un lien de réinitialisation a été envoyé." };
  if (!row || row.status === "inactive") return response;
  const token = newToken();
  run("INSERT INTO password_resets (token_hash, member_id, expires_at) VALUES (?,?,?)", sha256(token), row.id, new Date(Date.now() + 3600e3).toISOString());
  const url = `${config.appUrl}/reset-password?token=${token}`;
  // Pas encore de fournisseur e-mail : le lien est affiché dans la console du serveur.
  console.log(`[auth] Lien de réinitialisation pour ${email} : ${url}`);
  return config.dev ? { ...response, devResetUrl: url } : response;
});

router.post("/api/auth/reset", (ctx) => {
  const token = str(ctx.body.token, "jeton", { required: true, max: 200 });
  const problem = passwordProblem(ctx.body.password);
  if (problem) fail(422, problem, { field: "password" });
  const reset = get("SELECT * FROM password_resets WHERE token_hash = ?", sha256(token));
  if (!reset || reset.used_at || reset.expires_at < now()) fail(400, "Ce lien est invalide ou a expiré. Faites une nouvelle demande.");
  tx(() => {
    run("UPDATE members SET password_hash = ?, status = CASE WHEN status = 'pending' THEN 'active' ELSE status END WHERE id = ?", hashPassword(ctx.body.password), reset.member_id);
    run("UPDATE password_resets SET used_at = ? WHERE token_hash = ?", now(), reset.token_hash);
    run("DELETE FROM sessions WHERE member_id = ?", reset.member_id);
  });
  const m = memberRow(reset.member_id);
  if (m.status === "inactive") fail(403, "Ce compte est désactivé.");
  createSession(ctx.res, m.id, ctx.req.headers["user-agent"]);
  return { user: m };
});

function invitationByToken(token) {
  const inv = get("SELECT * FROM invitations WHERE token_hash = ?", sha256(String(token)));
  if (!inv || inv.status !== "approved" || !inv.token_expires_at || inv.token_expires_at < now()) fail(404, "Cette invitation est invalide, déjà utilisée ou expirée.");
  return inv;
}

router.get("/api/auth/invitation/:token", (ctx) => {
  const inv = invitationByToken(ctx.params.token);
  const sponsor = memberRow(inv.sponsor_id);
  const branch = get("SELECT name FROM branches WHERE id = ?", inv.branch_id);
  return {
    inviteeName: inv.invitee_name,
    relationship: inv.relationship,
    sponsorName: sponsor ? `${sponsor.firstName} ${sponsor.lastName}` : "",
    branchName: branch?.name ?? "",
    email: inv.contact.includes("@") ? inv.contact : "",
    isMinor: !!inv.is_minor,
  };
});

router.post("/api/auth/accept-invitation", (ctx) => {
  const inv = invitationByToken(str(ctx.body.token, "jeton", { required: true, max: 200 }));
  const email = emailField(ctx.body.email, "e-mail", { required: true });
  const problem = passwordProblem(ctx.body.password);
  if (problem) fail(422, problem, { field: "password" });
  const privacy = oneOf(ctx.body.privacy ?? "private", "confidentialité", ["members", "branch", "private"]);
  const firstName = str(ctx.body.firstName, "prénom", { required: true, max: 80 });
  const lastName = str(ctx.body.lastName, "nom", { required: true, max: 80 });
  if (get("SELECT 1 FROM members WHERE email = ?", email)) fail(409, "Un compte existe déjà avec cet e-mail.", { field: "email" });
  const id = newId("m");
  const branch = get("SELECT city FROM branches WHERE id = ?", inv.branch_id);
  tx(() => {
    insert("members", {
      id, first_name: firstName, last_name: lastName, position: inv.is_minor ? "Membre (mineure)" : "Membre", role: "member",
      branch_id: inv.branch_id, location: branch?.city ?? "", email, phone: inv.contact.includes("@") ? null : inv.contact,
      joined_at: now(), status: "active", privacy: inv.is_minor ? "private" : privacy, is_minor: inv.is_minor, password_hash: hashPassword(ctx.body.password),
    });
    insert("family_links", { id: newId("fl"), member_id: inv.sponsor_id, related_member_id: id, relationship: inv.relationship, created_at: now() });
    run("UPDATE invitations SET status = 'accepted', token_hash = NULL WHERE id = ?", inv.id);
    audit(id, "Invitation acceptée – compte activé", "invitation", inv.id);
  });
  createSession(ctx.res, id, ctx.req.headers["user-agent"]);
  return { user: memberRow(id) };
});
