// Choix du moteur SQLite :
//  1. module intégré node:sqlite (Node.js ≥ 22.13) — aucune installation ;
//  2. sinon le paquet better-sqlite3 (Node.js 20), installé par « npm install ».
// Les deux exposent la même API synchrone : exec(), prepare().get/all/run().

let Database;
let driverName;

const forced = process.env.SQLITE_DRIVER; // "node:sqlite" ou "better-sqlite3" (facultatif)

try {
  if (forced === "better-sqlite3") throw new Error("forcé");
  ({ DatabaseSync: Database } = await import("node:sqlite"));
  driverName = "node:sqlite";
} catch {
  try {
    Database = (await import("better-sqlite3")).default;
    driverName = "better-sqlite3";
  } catch {
    console.error(
      [
        `\n✖ Aucun moteur SQLite disponible avec Node.js ${process.versions.node}.`,
        "  Solution 1 (recommandée) : installer Node.js 22 LTS ou plus récent — https://nodejs.org",
        "  Solution 2 : dans le dossier backend, lancer « npm install » (installe better-sqlite3).\n",
      ].join("\n"),
    );
    process.exit(1);
  }
}

export { driverName };
export const openDatabase = (file) => new Database(file);
