// Primitives de sécurité (sans dépendance externe).
import crypto from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hachage scrypt avec sel aléatoire. Format : scrypt$N$r$p$sel$hash (base64). */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64"), hash.toString("base64")].join("$");
}

export function verifyPassword(password, stored) {
  if (!stored || typeof password !== "string") return false;
  const [algo, N, r, p, salt, hash] = stored.split("$");
  if (algo !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p });
  return crypto.timingSafeEqual(expected, actual);
}

/** Jeton aléatoire envoyé au client ; seul son empreinte SHA-256 est stockée en base. */
export const newToken = () => crypto.randomBytes(32).toString("base64url");
export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const newId = (prefix) => `${prefix}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

/** Règles minimales de mot de passe. Retourne un message d'erreur ou null. */
export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 8) return "Le mot de passe doit contenir au moins 8 caractères.";
  if (pw.length > 200) return "Mot de passe trop long.";
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return "Le mot de passe doit contenir au moins une lettre et un chiffre.";
  return null;
}
