// Notifications WhatsApp : un faux fournisseur (API type Whapi) enregistre les messages reçus.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const received = [];
let failNext = false;
const fake = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (failNext) {
      failNext = false;
      res.writeHead(500, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { message: "panne simulée" } }));
    }
    received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body || "{}") });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ sent: true, message: { id: `msg-${received.length}` } }));
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fawone-wa-"));
Object.assign(process.env, {
  DATABASE_PATH: path.join(dir, "wa.db"),
  NO_LISTEN: "1",
  LOG_REQUESTS: "false",
  APP_URL: "https://app.fawone.org",
  WHATSAPP_PROVIDER: "whapi",
  WHAPI_API_URL: `http://127.0.0.1:${fake.address().port}`,
  WHAPI_TOKEN: "jeton-test",
  WHATSAPP_GROUP_ID: "120363000000000001@g.us",
  CAMPAY_USERNAME: "",
  CAMPAY_PASSWORD: "",
  CAMPAY_PERMANENT_TOKEN: "",
});

const { server } = await import("../src/server.js");
const { seedDemo } = await import("../src/db/seed-demo.js");
seedDemo();
let base;
before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fake.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let cookie = "";
const call = async (method, url, body) => {
  const res = await fetch(base + url, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, data: await res.json() };
};
const waitFor = async (n) => {
  for (let i = 0; i < 50 && received.length < n; i++) await new Promise((r) => setTimeout(r, 20));
};

test("création de projet → message dans le groupe, montants en FCFA", async () => {
  await call("POST", "/api/auth/login", { email: "esther@fawone.org", password: "fawone2026" });
  const r = await call("POST", "/api/projects", {
    title: "Cantine scolaire de Mutengene", summary: "Repas chauds pour 120 élèves.", category: "education", status: "active",
    location: "Mutengene", startDate: "2026-11-01", endDate: "2027-06-30", targetAmount: 3000000,
  });
  assert.equal(r.status, 200);
  await waitFor(1);
  const msg = received.at(-1);
  assert.equal(msg.url, "/messages/text");
  assert.equal(msg.auth, "Bearer jeton-test");
  assert.equal(msg.body.to, "120363000000000001@g.us");
  assert.match(msg.body.body, /Nouveau projet FAWONE/);
  assert.match(msg.body.body, /3 000 000 FCFA/);
  assert.match(msg.body.body, /https:\/\/app\.fawone\.org\/projects\//);
});

test("événement, actualité publiée (pas les brouillons) et don", async () => {
  const start = received.length;
  await call("POST", "/api/events", { title: "Réunion cantine", location: "Mutengene", startsAt: "2026-12-12T10:00:00Z", endsAt: "2026-12-12T12:00:00Z", branchId: null });
  await call("POST", "/api/news", { title: "Brouillon interne", content: "…", category: "news", status: "draft", branchId: null });
  await call("POST", "/api/news", { title: "Lancement de la cantine", content: "Premiers repas en janvier.", category: "news", status: "published", branchId: null });
  await call("POST", "/api/donations/manual", { donorName: "Esther Test", projectId: "p-sante", amount: 10000, provider: "mtn_momo" });
  await waitFor(start + 3);
  const bodies = received.slice(start).map((m) => m.body.body);
  assert.equal(bodies.length, 3, "le brouillon ne doit pas être envoyé");
  assert.match(bodies[0], /Nouvel événement/);
  assert.match(bodies[1], /Lancement de la cantine/);
  assert.match(bodies[2], /Nouveau don de 10 000 FCFA/);
  assert.match(bodies[2], /Collecté : .* FCFA \/ 6 000 000 FCFA/);
  assert.doesNotMatch(bodies[2], /Esther/, "nom de la donatrice masqué par défaut");
});

test("échec du fournisseur : l'action réussit, le message est marqué en échec puis renvoyé", async () => {
  failNext = true;
  const r = await call("POST", "/api/donations/manual", { donorName: "Paroisse Saint-Joseph", amount: 50000, projectId: null, provider: "orange_money" });
  assert.equal(r.status, 200, "le don est enregistré malgré l'échec WhatsApp");
  await new Promise((res) => setTimeout(res, 150));
  const st = await call("GET", "/api/admin/whatsapp");
  const failed = st.data.messages.find((m) => m.status === "failed");
  assert.ok(failed, "message en échec journalisé");
  assert.match(failed.error, /panne simulée/);
  const again = await call("POST", `/api/admin/whatsapp/messages/${failed.id}/resend`);
  assert.equal(again.data.message.status, "sent");
  assert.equal(st.data.configured, true);
  assert.equal(st.data.groupId.includes("000000000001"), false, "identifiant du groupe masqué");
});

test("message de test (super administratrice uniquement)", async () => {
  const ok = await call("POST", "/api/admin/whatsapp/test", {});
  assert.equal(ok.data.message.status, "sent");
  await call("POST", "/api/auth/logout", {});
  await call("POST", "/api/auth/login", { email: "grace.ekema@example.com", password: "fawone2026" });
  assert.equal((await call("POST", "/api/admin/whatsapp/test", {})).status, 403);
});
