#!/usr/bin/env node
// Affiche les groupes WhatsApp du numéro relié (pour trouver WHATSAPP_GROUP_ID).
// Usage : npm run whatsapp:groups
import { config } from "../src/config.js";
import { listGroups } from "../src/services/whatsapp.js";

if (!["greenapi", "whapi"].includes(config.whatsapp.provider)) {
  console.error("✖ Définissez d'abord WHATSAPP_PROVIDER=greenapi ou whapi (et ses identifiants) dans le .env.");
  process.exit(1);
}
try {
  const groups = await listGroups();
  if (!groups.length) console.log("Aucun groupe trouvé. Le numéro relié doit être membre (idéalement admin) du groupe.");
  for (const g of groups) console.log(`${g.id.padEnd(40)} ${g.name}`);
  console.log("\nCopiez l'identifiant du groupe dans WHATSAPP_GROUP_ID (.env), puis redémarrez l'API.");
} catch (e) {
  console.error(`✖ ${e.message}`);
  process.exit(1);
}
