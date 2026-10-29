// Premier démarrage : base vide, création de la super administratrice, connexion.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fawone-first-"));
process.env.DATABASE_PATH = path.join(dir, "empty.db");
process.env.NO_LISTEN = "1";
process.env.LOG_REQUESTS = "false";
Object.assign(process.env, { CAMPAY_USERNAME: "", CAMPAY_PASSWORD: "", CAMPAY_PERMANENT_TOKEN: "" });

const { server } = await import("../src/server.js");
const { createSuperAdmin } = await import("../src/db/admins.js");
let base;
before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (url, body, cookie = "") =>
  fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });

test("la base démarre vide (aucune donnée de démo)", async () => {
  const data = await (await fetch(base + "/api/bootstrap")).json();
  assert.equal(data.branches.length, 0);
  assert.equal(data.projects.length, 0);
  assert.equal(data.stats.totalRaised, 0);
  assert.equal(data.config.paymentsReady, false, "dons désactivés tant que Campay n'est pas configuré");
});

test("création de la super administratrice puis connexion", async () => {
  assert.throws(() => createSuperAdmin({ email: "admin@fawone.org", password: "court" }), /8 caractères/);
  createSuperAdmin({ email: "Admin@Fawone.org", password: "MotDePasse2026", firstName: "Esther", lastName: "Mbianda", branch: "Buea" });
  assert.throws(() => createSuperAdmin({ email: "admin@fawone.org", password: "MotDePasse2026" }), /existe déjà/);
  const res = await post("/api/auth/login", { email: "admin@fawone.org", password: "MotDePasse2026" });
  assert.equal(res.status, 200);
  const cookie = res.headers.get("set-cookie").split(";")[0];
  const branch = await post("/api/branches", { name: "Limbe", city: "Limbe", country: "Cameroun" }, cookie);
  assert.equal(branch.status, 200);
  const data = await (await fetch(base + "/api/bootstrap", { headers: { Cookie: cookie } })).json();
  assert.deepEqual(data.branches.map((b) => b.name).sort(), ["Buea", "Limbe"]);
  assert.equal(data.me.role, "super_admin");
});
