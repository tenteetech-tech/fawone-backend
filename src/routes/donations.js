// Dons et reçus.
import { router } from "./router.js";
import { config } from "../config.js";
import { get, run, insert, tx, now, map } from "../db/index.js";
import { newToken, newId } from "../lib/security.js";
import { fail, str, oneOf, money, email as emailField } from "../lib/http.js";
import { PROVIDERS, audit, requireArea, nextReceiptNumber } from "./helpers.js";
import { notifyDonationConfirmed } from "../services/whatsapp.js";
import { collect, isCampayConfigured, normalizePhone, operatorOf, maskPhone } from "../services/campay.js";
import { refreshDonation } from "../services/payments.js";

// Paiement uniquement par Mobile Money (MTN MoMo ou Orange Money) via Campay.
// Le don est créé « en attente », Campay envoie une demande sur le téléphone, puis le statut
// est vérifié auprès de Campay (polling du navigateur, webhook et tâche de fond).
// Campay ne gère pas les prélèvements automatiques : les dons sont toujours ponctuels.

function donationInput(ctx) {
  const u = ctx.user;
  const b = ctx.body;
  const { minAmount, maxAmount, env } = config.campay;
  const fcfa = (n) => new Intl.NumberFormat("fr-FR").format(n);
  const amount = money(Math.round(Number(b.amount)), "montant", { required: true });
  if (amount < minAmount * 100) fail(422, `Montant trop faible : ${fcfa(minAmount)} FCFA minimum.`, { field: "amount" });
  if (amount > maxAmount * 100)
    fail(422, env === "demo" ? `Campay est en mode test : ${fcfa(maxAmount)} FCFA maximum par don.` : `Montant trop élevé pour un don en ligne (${fcfa(maxAmount)} FCFA maximum).`, { field: "amount" });
  const projectId = b.projectId || null;
  let project = null;
  if (projectId) {
    project = get("SELECT title, status FROM projects WHERE id = ?", projectId);
    if (!project) fail(422, "Projet inconnu.");
    if (project.status === "completed") fail(422, "Ce projet est terminé et ne reçoit plus de dons.");
  }
  return {
    u,
    b,
    amount,
    projectId,
    project,
    donorName: u ? `${u.firstName} ${u.lastName}` : str(b.donorName, "nom", { required: true, max: 120 }),
    donorEmail: u ? u.email : emailField(b.donorEmail, "e-mail", { required: true }),
  };
}

router.post("/api/donations", async (ctx) => {
  const { u, b, amount, projectId, project, donorName, donorEmail } = donationInput(ctx);
  const id = newId("d");

  if (!isCampayConfigured()) fail(503, "Le paiement Mobile Money n'est pas encore configuré (identifiants Campay manquants).");
  const provider = oneOf(b.provider, "moyen de paiement", PROVIDERS, { required: true });
  const phone = normalizePhone(b.phone);
  if (!phone) fail(422, "Numéro Mobile Money invalide : 9 chiffres commençant par 6 (ex. 677 12 34 56).", { field: "phone" });
  const operator = operatorOf(phone);
  if (operator === "MTN" && provider === "orange_money") fail(422, "Ce numéro est un numéro MTN : choisissez MTN Mobile Money.", { field: "phone" });
  if (operator === "ORANGE" && provider === "mtn_momo") fail(422, "Ce numéro est un numéro Orange : choisissez Orange Money.", { field: "phone" });

  insert("donations", {
    id, donor_name: donorName, donor_email: donorEmail, donor_id: u?.id ?? null, project_id: projectId, amount_cents: amount, currency: config.currency,
    provider, provider_reference: `PENDING-${id}`, status: "pending", recurrence: "once", created_at: now(), gateway: "campay", operator, payer_phone: maskPhone(phone),
  });

  let res;
  try {
    res = await collect({
      amount: amount / 100,
      phone,
      description: project ? `Don FAWONE - ${project.title}` : "Don FAWONE - fonds général",
      externalReference: id,
    });
  } catch (e) {
    run("UPDATE donations SET status = 'failed', failure_reason = ? WHERE id = ?", e.message, id);
    fail(502, `Le paiement n'a pas pu être lancé : ${e.message}`);
  }
  if (!res.reference) {
    run("UPDATE donations SET status = 'failed', failure_reason = ? WHERE id = ?", "Réponse Campay sans référence.", id);
    fail(502, "Le paiement n'a pas pu être lancé (réponse Campay incomplète).");
  }
  run("UPDATE donations SET provider_reference = ?, operator = COALESCE(?, operator) WHERE id = ?", res.reference, res.operator ?? null, id);
  return {
    donation: map.donation(get("SELECT * FROM donations WHERE id = ?", id)),
    payment: { gateway: "campay", reference: res.reference, ussdCode: res.ussd_code ?? null, operator: res.operator ?? operator },
  };
});

/** Statut d'un don (sondé par la page de paiement). L'identifiant est aléatoire et non devinable. */
router.get("/api/donations/:id/status", async (ctx) => {
  let d = get("SELECT * FROM donations WHERE id = ?", ctx.params.id);
  if (!d) fail(404, "Don introuvable.");
  if (d.status === "pending" && d.gateway === "campay") {
    try {
      d = await refreshDonation(d.id);
    } catch (e) {
      console.error(`[campay] ${e.message}`);
    }
  }
  const out = map.donation(d);
  delete out.donorEmail;
  return { donation: out };
});

/** Webhook Campay (URL à déclarer dans l'application Campay). Le contenu sert seulement à savoir
 *  quel don revérifier : le statut est toujours relu auprès de l'API Campay. */
async function campayWebhook(ctx) {
  const p = { ...ctx.query, ...ctx.body };
  const d =
    (p.reference && get("SELECT id FROM donations WHERE provider_reference = ?", String(p.reference))) ||
    (p.external_reference && get("SELECT id FROM donations WHERE id = ?", String(p.external_reference)));
  if (d) {
    try {
      await refreshDonation(d.id);
    } catch (e) {
      console.error(`[campay] webhook : ${e.message}`);
    }
  }
  return { ok: true };
}
router.get("/api/payments/campay/webhook", campayWebhook);
router.post("/api/payments/campay/webhook", campayWebhook);

/** Administration : revérifier un paiement en attente. */
router.post("/api/donations/:id/refresh", async (ctx) => {
  requireArea(ctx, "donations");
  const d = get("SELECT * FROM donations WHERE id = ?", ctx.params.id);
  if (!d) fail(404, "Don introuvable.");
  if (d.gateway !== "campay") fail(409, "Ce don n'est pas un paiement Campay.");
  return { donation: map.donation(await refreshDonation(d.id)) };
});

router.post("/api/donations/manual", (ctx) => {
  const u = requireArea(ctx, "donations");
  const b = ctx.body;
  const projectId = b.projectId || null;
  if (projectId && !get("SELECT 1 FROM projects WHERE id = ?", projectId)) fail(422, "Projet inconnu.");
  const ref = str(b.reference, "référence", { max: 80 }) || `MAN-${newToken().slice(0, 8)}`;
  if (get("SELECT 1 FROM donations WHERE provider_reference = ?", ref)) fail(409, "Cette référence a déjà été enregistrée (doublon).");
  const id = newId("d");
  tx(() => {
    insert("donations", {
      id, donor_name: str(b.donorName, "donatrice", { required: true, max: 120 }), project_id: projectId, amount_cents: money(b.amount, "montant", { required: true, min: 1 }),
      currency: config.currency, provider: oneOf(b.provider, "moyen de paiement", PROVIDERS, { required: true }), provider_reference: ref, status: "confirmed", recurrence: "once",
      receipt_number: nextReceiptNumber(), created_at: now(),
    });
    audit(u.id, "Don manuel enregistré", "donation", id);
  });
  notifyDonationConfirmed(id);
  return { donation: map.donation(get("SELECT * FROM donations WHERE id = ?", id)) };
});

router.patch("/api/donations/:id", (ctx) => {
  const u = requireArea(ctx, "donations");
  const d = get("SELECT * FROM donations WHERE id = ?", ctx.params.id);
  if (!d) fail(404, "Don introuvable.");
  const status = oneOf(ctx.body.status, "statut", ["confirmed", "refunded", "failed", "cancelled"], { required: true });
  const allowed = { pending: ["confirmed", "failed", "cancelled"], confirmed: ["refunded"] };
  if (!allowed[d.status]?.includes(status)) fail(409, `Transition impossible : ${d.status} → ${status}.`);
  tx(() => {
    run("UPDATE donations SET status = ?, receipt_number = COALESCE(receipt_number, ?) WHERE id = ?", status, status === "confirmed" ? nextReceiptNumber() : null, d.id);
    audit(u.id, status === "confirmed" ? "Don confirmé" : status === "refunded" ? "Don remboursé" : `Don : ${status}`, "donation", d.id);
  });
  if (status === "confirmed") notifyDonationConfirmed(d.id);
  return { donation: map.donation(get("SELECT * FROM donations WHERE id = ?", d.id)) };
});
