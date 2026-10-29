// Charge tous les modules de routes (chacun s'enregistre sur le routeur).
import "./auth.js";
import "./bootstrap.js";
import "./members.js";
import "./branches.js";
import "./invitations.js";
import "./projects.js";
import "./donations.js";
import "./content.js";
import "./whatsapp.js";

export { router } from "./router.js";
