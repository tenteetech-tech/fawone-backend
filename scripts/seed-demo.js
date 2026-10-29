#!/usr/bin/env node
// Remplit la base avec des données de démonstration FICTIVES (optionnel).
// ATTENTION : efface tout le contenu existant. Usage : npm run seed:demo -- --force
import { parseArgs } from "node:util";
import { get } from "../src/db/index.js";
import { seedDemo } from "../src/db/seed-demo.js";

const { values } = parseArgs({ options: { force: { type: "boolean", default: false }, password: { type: "string", default: "fawone2026" } } });
const count = get("SELECT COUNT(*) AS n FROM members").n;
// « npm run seed:demo --force » (sans « -- ») : npm garde --force pour lui et l'expose dans npm_config_force.
const force = values.force || process.env.npm_config_force === "true";
if (count > 0 && !force) {
  console.error(`✖ La base contient déjà ${count} membre(s). Relancez avec « npm run seed:demo -- --force » pour TOUT remplacer par les données de démo.`);
  process.exit(1);
}
seedDemo({ password: values.password });
console.log(`✔ Données de démo chargées. Comptes : esther@fawone.org, aicha.ndive@example.com, grace.ekema@example.com, tresorerie@fawone.org — mot de passe « ${values.password} ».`);
