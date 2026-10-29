#!/usr/bin/env node
// Crée une super administratrice.
// Usage : npm run create-admin -- --email admin@fawone.org --first-name Esther --last-name Mbianda [--branch "Bureau exécutif"]
// Le mot de passe est demandé de façon interactive (ou --password pour un script).
import readline from "node:readline/promises";
import { parseArgs } from "node:util";
import { createSuperAdmin } from "../src/db/admins.js";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    password: { type: "string" },
    "first-name": { type: "string", default: "Admin" },
    "last-name": { type: "string", default: "FAWONE" },
    branch: { type: "string", default: "Bureau exécutif" },
  },
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const email = values.email || (await rl.question("E-mail : "));
const password = values.password || (await rl.question("Mot de passe (8 caractères min., lettres et chiffres) : "));
rl.close();

try {
  createSuperAdmin({ email, password, firstName: values["first-name"], lastName: values["last-name"], branch: values.branch });
  console.log(`✔ Super administratrice créée : ${email}`);
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exit(1);
}
