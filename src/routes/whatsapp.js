// Administration des notifications WhatsApp : état, message de test, renvoi.
import { router } from "./router.js";
import { fail, str } from "../lib/http.js";
import { requireArea } from "./helpers.js";
import { status, sendNow, resend, isConfigured } from "../services/whatsapp.js";

router.get("/api/admin/whatsapp", (ctx) => {
  requireArea(ctx, "notifications");
  return status();
});

router.post("/api/admin/whatsapp/test", async (ctx) => {
  const u = requireArea(ctx, "notifications");
  if (u.role !== "super_admin") fail(403, "Réservé à la super administratrice.");
  if (!isConfigured()) fail(409, "WhatsApp n'est pas configuré : renseignez WHATSAPP_PROVIDER et WHATSAPP_GROUP_ID dans le .env du backend.");
  const text = str(ctx.body.text, "message", { max: 1000 }) || `✅ Test FAWONE : les notifications WhatsApp fonctionnent (${u.firstName}).`;
  return { message: await sendNow("test", text) };
});

router.post("/api/admin/whatsapp/messages/:id/resend", async (ctx) => {
  requireArea(ctx, "notifications");
  const msg = await resend(ctx.params.id);
  if (!msg) fail(404, "Message introuvable.");
  return { message: msg };
});
