// Suivi des paiements Campay : vérification du statut auprès de Campay
// (on ne croit jamais un statut envoyé par le navigateur ou par un webhook),
// confirmation unique du don (reçu + message WhatsApp), expiration.

import { config } from "../config.js";
import { all, get, run } from "../db/index.js";
import { nextReceiptNumber } from "../routes/helpers.js";
import { transactionStatus, CampayError } from "./campay.js";
import { notifyDonationConfirmed } from "./whatsapp.js";

/** Interroge Campay et met à jour le don s'il est encore « en attente ». Retourne la ligne à jour. */
export async function refreshDonation(id) {
  const d = get("SELECT * FROM donations WHERE id = ?", id);
  if (!d || d.status !== "pending" || d.gateway !== "campay" || d.provider_reference.startsWith("PENDING-")) return d;

  let t;
  try {
    t = await transactionStatus(d.provider_reference);
  } catch (e) {
    if (e instanceof CampayError && e.status === 404) return expireIfTooOld(d);
    throw e;
  }
  const status = String(t.status || "").toUpperCase();

  if (status === "SUCCESSFUL") {
    const paidCents = Math.round(Number(t.amount) * 100);
    if (Number.isFinite(paidCents) && paidCents > 0 && paidCents < d.amount_cents) {
      run("UPDATE donations SET status = 'failed', failure_reason = ? WHERE id = ? AND status = 'pending'", `Montant reçu (${t.amount} XAF) inférieur au montant attendu.`, id);
      console.warn(`[campay] montant incohérent pour ${id} (${t.amount} XAF reçus)`);
    } else {
      // Mise à jour conditionnelle : un seul appel (polling, webhook ou tâche de fond) confirme le don.
      const res = run(
        "UPDATE donations SET status = 'confirmed', receipt_number = COALESCE(receipt_number, ?), operator = COALESCE(?, operator), failure_reason = NULL WHERE id = ? AND status = 'pending'",
        nextReceiptNumber(),
        t.operator ?? null,
        id,
      );
      if (res.changes === 1) notifyDonationConfirmed(id);
    }
  } else if (status === "FAILED") {
    run("UPDATE donations SET status = 'failed', failure_reason = ? WHERE id = ? AND status = 'pending'", t.reason || "Paiement refusé ou annulé sur le téléphone.", id);
  } else {
    return expireIfTooOld(d);
  }
  return get("SELECT * FROM donations WHERE id = ?", id);
}

function expireIfTooOld(d) {
  const ageMin = (Date.now() - new Date(d.created_at).getTime()) / 60000;
  if (ageMin > config.campay.pendingTimeoutMinutes) {
    run("UPDATE donations SET status = 'cancelled', failure_reason = ? WHERE id = ? AND status = 'pending'", "Paiement non validé à temps.", d.id);
  }
  return get("SELECT * FROM donations WHERE id = ?", d.id);
}

/** Tâche de fond : revérifie les paiements en attente des dernières 48 h. */
export async function reconcilePending() {
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  const rows = all("SELECT id FROM donations WHERE status = 'pending' AND gateway = 'campay' AND created_at > ?", since);
  for (const { id } of rows) {
    try {
      await refreshDonation(id);
    } catch (e) {
      console.error(`[campay] vérification impossible pour ${id} : ${e.message}`);
    }
  }
  return rows.length;
}

