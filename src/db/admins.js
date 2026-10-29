// Création de la première super administratrice (base vide en production).
import { get, insert, tx, now } from "./index.js";
import { hashPassword, newId, passwordProblem } from "../lib/security.js";
import { EMAIL_RE } from "../lib/http.js";

export const superAdminCount = () => get("SELECT COUNT(*) AS n FROM members WHERE role = 'super_admin' AND status = 'active'").n;

/** Crée (si besoin) la branche puis le compte super administratrice. Lève une Error lisible. */
export function createSuperAdmin({ email, password, firstName = "Admin", lastName = "FAWONE", branch = "Bureau exécutif", country = "Cameroun" }) {
  email = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error("Adresse e-mail invalide.");
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if (get("SELECT 1 FROM members WHERE email = ?", email)) throw new Error(`Un compte existe déjà pour ${email}.`);
  const id = newId("m");
  tx(() => {
    let b = get("SELECT id FROM branches WHERE name = ?", branch);
    if (!b) {
      b = { id: newId("br") };
      insert("branches", { id: b.id, name: branch, city: branch, country, status: "active", created_at: now() });
    }
    insert("members", {
      id, first_name: firstName, last_name: lastName, position: "Super administratrice", role: "super_admin", branch_id: b.id,
      location: "", email, joined_at: now(), status: "active", privacy: "private", is_minor: 0, password_hash: hashPassword(password),
    });
    insert("audit_logs", { id: newId("al"), actor_id: id, action: "Compte super administratrice créé", entity_type: "member", entity_id: id, created_at: now() });
  });
  return id;
}
