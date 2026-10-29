// Paiements Mobile Money via Campay : un faux serveur Campay reproduit l'API
// (/api/token/, /api/collect/, /api/transaction/{ref}/).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const fakeState = { transactions: new Map(), tokens: 0, collects: [], failCollect: false };
const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const send = (code, data) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/api/token/" && req.method === "POST") {
      if (body.username !== "app-user" || body.password !== "app-pass") return send(401, { message: "Invalid credentials" });
      fakeState.tokens += 1;
      return send(200, { token: `tok-${fakeState.tokens}`, expires_in: 3600 });
    }
    if (!String(req.headers.authorization).startsWith("Token tok-")) return send(401, { detail: "Authentication credentials were not provided." });
    if (req.url === "/api/collect/" && req.method === "POST") {
      if (fakeState.failCollect) return send(400, { message: "Invalid phone number", error_code: "ER101" });
      const reference = `ref-${fakeState.collects.length + 1}`;
      fakeState.collects.push(body);
      fakeState.transactions.set(reference, { reference, status: "PENDING", amount: Number(body.amount), currency: "XAF", operator: body.from.startsWith("23769") ? "ORANGE" : "MTN" });
      return send(200, { reference, ussd_code: "*126#", operator: "MTN" });
    }
    const m = req.url.match(/^\/api\/transaction\/([^/]+)\/$/);
    if (m && req.method === "GET") {
      const t = fakeState.transactions.get(m[1]);
      return t ? send(200, t) : send(404, { message: "Not found" });
    }
    send(404, { message: "route inconnue" });
  });
});
await new Promise((r) => fake.listen(0, "127.0.0.1", r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fawone-campay-"));
Object.assign(process.env, {
  DATABASE_PATH: path.join(dir, "c.db"),
  NO_LISTEN: "1",
  LOG_REQUESTS: "false",
  CAMPAY_PERMANENT_TOKEN: "",
  // Le faux serveur accepte les montants de production.
  CAMPAY_MIN_AMOUNT: "100",
  CAMPAY_MAX_AMOUNT: "50000000",
  CAMPAY_API_URL: `http://127.0.0.1:${fake.address().port}`,
  CAMPAY_USERNAME: "app-user",
  CAMPAY_PASSWORD: "app-pass",
  WHATSAPP_PROVIDER: "none",
});

const { server } = await import("../src/server.js");
const { seedDemo } = await import("../src/db/seed-demo.js");
const { reconcilePending } = await import("../src/services/payments.js");
const { db } = await import("../src/db/index.js");
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

const post = async (url, body) => {
  const res = await fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};
const getJson = async (url) => {
  const res = await fetch(base + url);
  return { status: res.status, data: await res.json() };
};
const raised = async (id) => (await getJson("/api/bootstrap")).data.projects.find((p) => p.id === id).raised;
const donor = { donorName: "Mireille Test", donorEmail: "mireille@example.com" };

test("bootstrap annonce le mode Campay", async () => {
  const { data } = await getJson("/api/bootstrap");
  assert.equal(data.config.paymentsReady, true);
  assert.equal(data.config.campayEnv, "demo");
});

test("numéro invalide ou opérateur incohérent → refus avant tout appel Campay", async () => {
  const before = fakeState.collects.length;
  assert.equal((await post("/api/donations", { ...donor, amount: 5000, provider: "mtn_momo", phone: "12345" })).status, 422);
  const wrongOp = await post("/api/donations", { ...donor, amount: 5000, provider: "mtn_momo", phone: "699 12 34 56" });
  assert.equal(wrongOp.status, 422);
  assert.match(wrongOp.data.error, /Orange/);
  assert.equal((await post("/api/donations", { ...donor, amount: 5000, provider: "card", phone: "677123456" })).status, 422, "carte non disponible via Campay");
  assert.equal(fakeState.collects.length, before);
});

test("MTN : en attente → confirmé après validation sur le téléphone", async () => {
  const start = await raised("p-sante");
  const r = await post("/api/donations", { ...donor, projectId: "p-sante", amount: 15000, provider: "mtn_momo", phone: "+237 677 12 34 56" });
  assert.equal(r.status, 200);
  assert.equal(r.data.donation.status, "pending");
  assert.equal(r.data.payment.ussdCode, "*126#");
  assert.equal(r.data.donation.payerPhone, "6•••••456");
  const sent = fakeState.collects.at(-1);
  assert.deepEqual([sent.amount, sent.currency, sent.from, sent.external_reference], ["15000", "XAF", "237677123456", r.data.donation.id]);

  // Toujours en attente : le montant collecté ne bouge pas.
  let s = await getJson(`/api/donations/${r.data.donation.id}/status`);
  assert.equal(s.data.donation.status, "pending");
  assert.equal(s.data.donation.donorEmail, undefined, "pas d'e-mail dans la réponse publique");
  assert.equal(await raised("p-sante"), start);

  // La donatrice valide avec son code PIN.
  fakeState.transactions.get(r.data.payment.reference).status = "SUCCESSFUL";
  s = await getJson(`/api/donations/${r.data.donation.id}/status`);
  assert.equal(s.data.donation.status, "confirmed");
  assert.match(s.data.donation.receiptNumber, /^FAW-/);
  assert.equal(await raised("p-sante"), start + 15000);

  // Un second contrôle ne double pas le don.
  await getJson(`/api/donations/${r.data.donation.id}/status`);
  assert.equal(await raised("p-sante"), start + 15000);
});

test("Orange : paiement refusé → échec avec motif", async () => {
  const r = await post("/api/donations", { ...donor, amount: 5000, provider: "orange_money", phone: "699123456" });
  assert.equal(r.status, 200);
  const t = fakeState.transactions.get(r.data.payment.reference);
  t.status = "FAILED";
  t.reason = "Solde insuffisant";
  const s = await getJson(`/api/donations/${r.data.donation.id}/status`);
  assert.equal(s.data.donation.status, "failed");
  assert.equal(s.data.donation.failureReason, "Solde insuffisant");
});

test("webhook : seul le statut relu chez Campay compte", async () => {
  const r = await post("/api/donations", { ...donor, amount: 7000, provider: "mtn_momo", phone: "650123456" });
  const ref = r.data.payment.reference;
  // Un faux webhook prétendant « SUCCESSFUL » ne confirme rien tant que Campay dit PENDING.
  await fetch(`${base}/api/payments/campay/webhook?reference=${ref}&status=SUCCESSFUL`);
  assert.equal((await getJson(`/api/donations/${r.data.donation.id}/status`)).data.donation.status, "pending");
  fakeState.transactions.get(ref).status = "SUCCESSFUL";
  const hook = await fetch(`${base}/api/payments/campay/webhook`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: `reference=${ref}&status=SUCCESSFUL` });
  assert.equal(hook.status, 200);
  const row = db.prepare("SELECT status FROM donations WHERE id = ?").get(r.data.donation.id);
  assert.equal(row.status, "confirmed");
});

test("montant payé inférieur au montant demandé → refusé", async () => {
  const r = await post("/api/donations", { ...donor, amount: 20000, provider: "mtn_momo", phone: "677000111" });
  const t = fakeState.transactions.get(r.data.payment.reference);
  t.status = "SUCCESSFUL";
  t.amount = 100;
  const s = await getJson(`/api/donations/${r.data.donation.id}/status`);
  assert.equal(s.data.donation.status, "failed");
});

test("tâche de fond et expiration des paiements abandonnés", async () => {
  const a = await post("/api/donations", { ...donor, amount: 3000, provider: "mtn_momo", phone: "677000222" });
  fakeState.transactions.get(a.data.payment.reference).status = "SUCCESSFUL";
  const b = await post("/api/donations", { ...donor, amount: 3000, provider: "mtn_momo", phone: "677000333" });
  db.prepare("UPDATE donations SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 3600e3).toISOString(), b.data.donation.id);
  await reconcilePending();
  assert.equal(db.prepare("SELECT status FROM donations WHERE id = ?").get(a.data.donation.id).status, "confirmed");
  assert.equal(db.prepare("SELECT status FROM donations WHERE id = ?").get(b.data.donation.id).status, "cancelled");
});

test("erreur Campay au lancement → message clair, don marqué en échec", async () => {
  fakeState.failCollect = true;
  const r = await post("/api/donations", { ...donor, amount: 5000, provider: "mtn_momo", phone: "677000444" });
  fakeState.failCollect = false;
  assert.equal(r.status, 502);
  assert.match(r.data.error, /Invalid phone number/);
  assert.equal(fakeState.tokens, 1, "le jeton Campay est réutilisé");
});
