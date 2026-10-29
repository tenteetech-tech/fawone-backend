// Branches.
import { router } from "./router.js";
import { get, insert, tx, now } from "../db/index.js";
import { newId } from "../lib/security.js";
import { fail, str } from "../lib/http.js";
import { audit, requireArea } from "./helpers.js";

router.post("/api/branches", (ctx) => {
  const u = requireArea(ctx, "branches");
  const name = str(ctx.body.name, "nom", { required: true, max: 80 });
  if (get("SELECT 1 FROM branches WHERE name = ?", name)) fail(409, "Une branche porte déjà ce nom.");
  const id = newId("br");
  tx(() => {
    insert("branches", { id, name, city: str(ctx.body.city, "ville", { required: true, max: 80 }), country: str(ctx.body.country, "pays", { required: true, max: 80 }), status: "active", created_at: now() });
    audit(u.id, `Branche créée : ${name}`, "branch", id);
  });
  return { ok: true, id };
});
