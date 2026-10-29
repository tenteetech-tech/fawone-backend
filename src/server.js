// Serveur API FAWONE — Node.js + SQLite.
import http from "node:http";
import { config } from "./config.js";
import { router } from "./routes/index.js";
import { currentUser } from "./auth/session.js";
import { HttpError, readJson, sendJson } from "./lib/http.js";
import { createSuperAdmin, superAdminCount } from "./db/admins.js";
import { get } from "./db/index.js";

import { driverName } from "./db/driver.js";

if (Number(process.versions.node.split(".")[0]) < 20) {
  console.error(`Node.js ${process.versions.node} détecté : la version 20 ou supérieure est requise.`);
  process.exit(1);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin || !config.corsOrigins.includes(origin)) return false;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
  return true;
}

export const server = http.createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url, "http://localhost");
  try {
    const cors = applyCors(req, res);
    if (req.method === "OPTIONS") {
      res.writeHead(cors ? 204 : 403);
      return res.end();
    }
    if (!url.pathname.startsWith("/api/")) return sendJson(res, 404, { error: "Introuvable." });
    const found = router.match(req.method, url.pathname);
    if (!found) return sendJson(res, 404, { error: "Route inconnue." });
    if (found === "method") return sendJson(res, 405, { error: "Méthode non autorisée." });
    const ctx = {
      req,
      res,
      params: found.params,
      query: Object.fromEntries(url.searchParams),
      body: await readJson(req, 1_000_000, { lenient: url.pathname.startsWith("/api/payments/") }),
      user: currentUser(req),
      ip: String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim(),
    };
    const result = await found.handler(ctx);
    sendJson(res, 200, result ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, ...(e.details ? { details: e.details } : {}) });
    if (String(e?.message).includes("UNIQUE constraint failed")) return sendJson(res, 409, { error: "Cet élément existe déjà (doublon)." });
    if (String(e?.message).includes("FOREIGN KEY constraint failed")) return sendJson(res, 422, { error: "Référence invalide." });
    console.error(e);
    sendJson(res, 500, { error: "Erreur interne du serveur." });
  } finally {
    if (config.logRequests) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

/** Première super administratrice via ADMIN_EMAIL / ADMIN_PASSWORD (si aucune n'existe). */
function ensureInitialAdmin() {
  if (superAdminCount() > 0) return;
  if (config.initialAdmin) {
    try {
      createSuperAdmin(config.initialAdmin);
      console.log(`[api] Super administratrice créée : ${config.initialAdmin.email}`);
    } catch (e) {
      console.error(`[api] Impossible de créer la super administratrice : ${e.message}`);
    }
  } else {
    console.warn("[api] Aucune super administratrice. Lancez « npm run create-admin » ou définissez ADMIN_EMAIL et ADMIN_PASSWORD.");
  }
}

/** SEED_DEMO_IF_EMPTY=true : remplit une base vide avec les données de démo. */
async function seedDemoIfEmpty() {
  if (!config.seedDemoIfEmpty || get("SELECT COUNT(*) AS n FROM members").n > 0) return;
  const { seedDemo } = await import("./db/seed-demo.js");
  seedDemo({ password: process.env.DEMO_PASSWORD || "fawone2026" });
  console.log("[api] Base vide : données de démo chargées (SEED_DEMO_IF_EMPTY=true).");
}

if (process.env.NO_LISTEN !== "1") {
  await seedDemoIfEmpty();
  {
    const { reconcilePending } = await import("./services/payments.js");
    const { isCampayConfigured } = await import("./services/campay.js");
    if (!isCampayConfigured()) console.warn("[campay] Identifiants Campay manquants (CAMPAY_USERNAME / CAMPAY_PASSWORD) : les dons en ligne sont désactivés.");
    else console.log(`[campay] Paiements Mobile Money actifs (${config.campay.env === "live" ? "PRODUCTION" : "démo"}).`);
    // Filet de sécurité si le webhook n'arrive pas (ex. serveur local) : revérification toutes les 2 minutes.
    setInterval(() => void reconcilePending().catch((e) => console.error(`[campay] ${e.message}`)), 120_000).unref();
  }
  ensureInitialAdmin();
  server.listen(config.port, config.host, () => console.log(`[api] FAWONE API prête sur http://${config.host}:${config.port} (SQLite : ${driverName})`));
}
