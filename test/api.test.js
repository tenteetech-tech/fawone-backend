// Tests d'intégration de l'API (sur une base temporaire remplie de données fictives) : npm test
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fawone-test-"));
process.env.DATABASE_PATH = path.join(dir, "test.db");
process.env.NO_LISTEN = "1";
process.env.LOG_REQUESTS = "false";
// Jamais d'appel au vrai Campay pendant les tests (les identifiants du .env sont ignorés).
Object.assign(process.env, { CAMPAY_USERNAME: "", CAMPAY_PASSWORD: "", CAMPAY_PERMANENT_TOKEN: "" });

const { server } = await import("../src/server.js");
const { seedDemo } = await import("../src/db/seed-demo.js");
seedDemo(); // jeu de données fictif utilisé par ces tests
let base;
const PW = "fawone2026";

before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Petit client avec gestion du cookie de session. */
function client() {
  let cookie = "";
  const call = async (method, url, body, headers = {}) => {
    const res = await fetch(base + url, {
      method,
      headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return { status: res.status, data: await res.json() };
  };
  return {
    get: (u) => call("GET", u),
    post: (u, b = {}, h) => call("POST", u, b, h),
    patch: (u, b) => call("PATCH", u, b),
    put: (u, b) => call("PUT", u, b),
    login: async (email, password = PW) => call("POST", "/api/auth/login", { email, password }),
  };
}

test("page d'accueil : présente l'API FAWONE dans le navigateur", async () => {
  const res = await fetch(base + "/");
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
  assert.match(html, /Bienvenue sur l’API FAWONE/);
  assert.match(html, /href="\/api\/health"/);
});

test("connexion : mauvais mot de passe refusé, bon accepté, session active", async () => {
  const c = client();
  assert.equal((await c.login("aicha.ndive@example.com", "mauvais")).status, 401);
  const ok = await c.login("aicha.ndive@example.com");
  assert.equal(ok.status, 200);
  assert.equal(ok.data.user.firstName, "Aïcha");
  assert.equal(ok.data.user.password_hash, undefined);
  assert.equal((await c.get("/api/auth/me")).data.user.id, "m-aicha");
  await c.post("/api/auth/logout");
  assert.equal((await c.get("/api/auth/me")).data.user, null);
});

test("limitation : 5 échecs bloquent la connexion", async () => {
  const c = client();
  for (let i = 0; i < 5; i++) await c.login("rachel.m@example.com", "faux-mdp-1");
  const r = await c.login("rachel.m@example.com");
  assert.equal(r.status, 429);
});

test("CSRF : une requête non-JSON est rejetée", async () => {
  const res = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "email=x" });
  assert.equal(res.status, 415);
});

test("visiteuse : pas d'annuaire ni de dons, mais totaux publics des projets", async () => {
  const c = client();
  const { data } = await c.get("/api/bootstrap");
  assert.equal(data.donations.length, 0);
  assert.ok(data.members.every((m) => !m.email && !m.phone));
  const p = data.projects.find((x) => x.id === "p-formation");
  assert.equal(p.raised, 3_900_000); // 6 500 $ × 600 → FCFA
});

test("membre : confidentialité des coordonnées et mineures masquées", async () => {
  const c = client();
  await c.login("aicha.ndive@example.com");
  const { data } = await c.get("/api/bootstrap");
  assert.ok(!data.members.some((m) => m.isMinor), "mineures exclues");
  const rachel = data.members.find((m) => m.id === "m-rachel"); // privacy = private
  assert.equal(rachel.email, undefined);
  const esther = data.members.find((m) => m.id === "m-esther"); // privacy = members
  assert.equal(esther.email, "esther@fawone.org");
  assert.ok(data.donations.every((d) => d.donorId === "m-aicha"), "uniquement ses propres dons");
  assert.equal((await c.post("/api/members", { firstName: "X", lastName: "Y", branchId: "br-buea" })).status, 403);
});

test("administratrice de branche : limitée à sa branche", async () => {
  const c = client();
  await c.login("grace.ekema@example.com");
  const other = await c.patch("/api/members/m-aicha", { status: "inactive" }); // Buea
  assert.equal(other.status, 403);
  const own = await c.patch("/api/members/m-marie", { position: "Secrétaire générale adjointe" }); // Limbe
  assert.equal(own.status, 200);
  assert.equal((await c.patch("/api/members/m-grace", { status: "inactive" })).status, 403, "pas sur soi-même");
  assert.equal((await c.post("/api/branches", { name: "Kumba", city: "Kumba", country: "Cameroun" })).status, 403);
});

test("trésorière : dons oui, membres non", async () => {
  const c = client();
  await c.login("tresorerie@fawone.org");
  const { data } = await c.get("/api/bootstrap");
  assert.ok(data.donations.length > 200);
  assert.equal((await c.patch("/api/members/m-aicha", { status: "inactive" })).status, 403);
  const pending = data.donations.find((d) => d.status === "pending");
  const conf = await c.patch(`/api/donations/${pending.id}`, { status: "confirmed" });
  assert.equal(conf.status, 200);
  assert.ok(conf.data.donation.receiptNumber);
  assert.equal((await c.patch(`/api/donations/${pending.id}`, { status: "confirmed" })).status, 409);
});

test("don : sans Campay configuré, aucun don n'est enregistré", async () => {
  const c = client();
  const { data } = await c.get("/api/bootstrap");
  assert.equal(data.config.paymentsReady, false);
  const before = data.projects.find((p) => p.id === "p-sante").raised;
  assert.equal(data.config.maxAmount, 25, "Campay démo : 25 FCFA maximum");
  const r = await c.post("/api/donations", { projectId: "p-sante", amount: 20, provider: "mtn_momo", phone: "677123456", donorName: "Test Donatrice", donorEmail: "test@example.com" });
  assert.equal(r.status, 503);
  const tooBig = await c.post("/api/donations", { projectId: "p-sante", amount: 7500, provider: "mtn_momo", phone: "677123456", donorName: "Test Donatrice", donorEmail: "test@example.com" });
  assert.equal(tooBig.status, 422);
  assert.match(tooBig.data.error, /mode test/);
  const after = (await c.get("/api/bootstrap")).data.projects.find((p) => p.id === "p-sante").raised;
  assert.equal(after, before);
  assert.equal((await c.post("/api/donations", { projectId: "p-puits", amount: 1000, provider: "mtn_momo", donorName: "A", donorEmail: "a@b.co" })).status, 422, "projet terminé");
  assert.equal((await c.post("/api/donations", { amount: -5, provider: "mtn_momo", donorName: "A", donorEmail: "a@b.co" })).status, 422);
});

test("don manuel : uniquement MTN Mobile Money ou Orange Money", async () => {
  const c = client();
  await c.login("tresorerie@fawone.org");
  for (const provider of ["card", "paypal", "manual", undefined]) {
    assert.equal((await c.post("/api/donations/manual", { donorName: "Paroisse", amount: 5000, projectId: null, provider })).status, 422, `refusé : ${provider}`);
  }
  const ok = await c.post("/api/donations/manual", { donorName: "Paroisse", amount: 5000, projectId: null, provider: "orange_money" });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.donation.provider, "orange_money");
});

test("invitation : demande → approbation → lien → création du compte", async () => {
  const m = client();
  await m.login("aicha.ndive@example.com");
  assert.equal((await m.post("/api/invitations", { inviteeName: "Odette Ndive", relationship: "sœur", contact: "+237 6 99 88 77 66", consentConfirmed: false })).status, 422);
  const created = await m.post("/api/invitations", { inviteeName: "Odette Ndive", relationship: "sœur", contact: "+237 6 99 88 77 66", consentConfirmed: true });
  assert.equal(created.status, 200);

  const g = client();
  await g.login("grace.ekema@example.com");
  assert.equal((await g.patch(`/api/invitations/${created.data.id}`, { status: "approved" })).status, 403, "hors branche");

  const a = client();
  await a.login("esther@fawone.org");
  const appr = await a.patch(`/api/invitations/${created.data.id}`, { status: "approved" });
  assert.equal(appr.status, 200);
  const token = new URL(appr.data.inviteUrl).searchParams.get("token");

  const invitee = client();
  const info = await invitee.get(`/api/auth/invitation/${token}`);
  assert.equal(info.data.inviteeName, "Odette Ndive");
  assert.equal((await invitee.post("/api/auth/accept-invitation", { token, email: "odette@example.com", password: "court", firstName: "Odette", lastName: "Ndive" })).status, 422);
  const acc = await invitee.post("/api/auth/accept-invitation", { token, email: "odette@example.com", password: "Bienvenue2026", firstName: "Odette", lastName: "Ndive" });
  assert.equal(acc.status, 200);
  assert.equal((await invitee.get("/api/auth/me")).data.user.email, "odette@example.com");
  const boot = (await m.get("/api/bootstrap")).data;
  assert.ok(boot.familyLinks.some((l) => l.memberId === "m-aicha" && l.relatedMemberId === acc.data.user.id), "lien familial créé");
  assert.equal((await invitee.post("/api/auth/accept-invitation", { token, email: "x@example.com", password: "Bienvenue2026", firstName: "O", lastName: "N" })).status, 404, "lien à usage unique");
});

test("mot de passe oublié → réinitialisation → connexion", async () => {
  const c = client();
  const f = await c.post("/api/auth/forgot", { email: "awa.balla@example.com" });
  assert.equal(f.status, 200);
  const token = new URL(f.data.devResetUrl).searchParams.get("token");
  assert.equal((await c.post("/api/auth/reset", { token, password: "NouveauMdp9" })).status, 200);
  assert.equal((await c.post("/api/auth/reset", { token, password: "NouveauMdp9" })).status, 400, "jeton à usage unique");
  const c2 = client();
  assert.equal((await c2.login("awa.balla@example.com", PW)).status, 401);
  assert.equal((await c2.login("awa.balla@example.com", "NouveauMdp9")).status, 200);
  const unknown = await c.post("/api/auth/forgot", { email: "personne@example.com" });
  assert.equal(unknown.status, 200, "pas de fuite sur l'existence d'un compte");
  assert.equal(unknown.data.devResetUrl, undefined);
});

test("changement de mot de passe et compte désactivé", async () => {
  const c = client();
  await c.login("fatima.t@example.com");
  assert.equal((await c.post("/api/auth/change-password", { currentPassword: "faux", newPassword: "Autre2026x" })).status, 400);
  assert.equal((await c.post("/api/auth/change-password", { currentPassword: PW, newPassword: "Autre2026x" })).status, 200);
  const admin = client();
  await admin.login("esther@fawone.org");
  assert.equal((await admin.patch("/api/members/m-fatima", { status: "inactive" })).status, 200);
  assert.equal((await c.get("/api/auth/me")).data.user, null, "session coupée");
  assert.equal((await client().login("fatima.t@example.com", "Autre2026x")).status, 403);
});
