// Configuration lue depuis les variables d'environnement (fichier .env facultatif).
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(root, ".env"));
} catch {
  /* pas de fichier .env : valeurs par défaut */
}

const env = process.env;
const isProd = env.NODE_ENV === "production";

export const config = {
  root,
  dev: !isProd,
  port: Number(env.PORT || 4000),
  // Sur Render (variable RENDER définie), il faut écouter sur toutes les interfaces.
  host: env.HOST || (env.RENDER ? "0.0.0.0" : "127.0.0.1"),
  /** URL publique du frontend : sert à fabriquer les liens d'invitation et de réinitialisation. */
  appUrl: (env.APP_URL || "http://localhost:3000").replace(/\/$/, ""),
  /** Origines autorisées à appeler l'API directement (CORS). Vide = uniquement via le proxy du frontend. */
  corsOrigins: (env.CORS_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
  databasePath: env.DATABASE_PATH ? path.resolve(root, env.DATABASE_PATH) : path.join(root, "data", "fawone.db"),
  cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : isProd,
  sessionDays: Number(env.SESSION_DAYS || 30),
  /** Devise de l'association : franc CFA (BEAC). */
  currency: env.CURRENCY || "XAF",
  /** Notifications WhatsApp vers un groupe (voir src/services/whatsapp.js). */
  whatsapp: {
    provider: (env.WHATSAPP_PROVIDER || "none").toLowerCase(), // none | console | greenapi | whapi
    groupId: env.WHATSAPP_GROUP_ID || "",
    events: (env.WHATSAPP_EVENTS || "project,event,news,donation").split(",").map((s) => s.trim()).filter(Boolean),
    showDonorNames: env.WHATSAPP_SHOW_DONOR_NAMES === "true",
    greenapi: { apiUrl: (env.GREENAPI_API_URL || "https://api.green-api.com").replace(/\/$/, ""), idInstance: env.GREENAPI_ID_INSTANCE || "", token: env.GREENAPI_API_TOKEN || "" },
    whapi: { apiUrl: (env.WHAPI_API_URL || "https://gate.whapi.cloud").replace(/\/$/, ""), token: env.WHAPI_TOKEN || "" },
  },
  /** Campay (https://www.campay.net) : MTN Mobile Money et Orange Money. */
  campay: {
    env: env.CAMPAY_ENV === "live" ? "live" : "demo",
    apiUrl: (env.CAMPAY_API_URL || (env.CAMPAY_ENV === "live" ? "https://www.campay.net" : "https://demo.campay.net")).replace(/\/$/, ""),
    username: env.CAMPAY_USERNAME || "",
    password: env.CAMPAY_PASSWORD || "",
    permanentToken: env.CAMPAY_PERMANENT_TOKEN || "",
    /** Délai après lequel un paiement resté « en attente » est considéré comme abandonné. */
    pendingTimeoutMinutes: Number(env.CAMPAY_PENDING_TIMEOUT_MINUTES || 30),
    /** Montants autorisés (FCFA). L'environnement de démo Campay refuse tout montant au-dessus de 25 XAF. */
    minAmount: Number(env.CAMPAY_MIN_AMOUNT || (env.CAMPAY_ENV === "live" ? 100 : 5)),
    maxAmount: Number(env.CAMPAY_MAX_AMOUNT || (env.CAMPAY_ENV === "live" ? 50_000_000 : 25)),
  },
  logRequests: env.LOG_REQUESTS !== "false",
  /** Charge les données de démo au démarrage si la base est vide (pratique sur un hébergement sans disque persistant). */
  seedDemoIfEmpty: env.SEED_DEMO_IF_EMPTY === "true",
  /** Création automatique de la première super administratrice au démarrage. */
  initialAdmin: env.ADMIN_EMAIL && env.ADMIN_PASSWORD
    ? { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD, firstName: env.ADMIN_FIRST_NAME || "Admin", lastName: env.ADMIN_LAST_NAME || "FAWONE", branch: env.ADMIN_BRANCH || "Bureau exécutif" }
    : null,
};
