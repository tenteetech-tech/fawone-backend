// GET /api/bootstrap : toutes les données visibles par la personne connectée.
import { router } from "./router.js";
import { config } from "../config.js";
import { all, get, map } from "../db/index.js";
import { canAccess, inScope, canSeeMember } from "../auth/permissions.js";
import { audit, sanitizeMember, projectsWithTotals, stats } from "./helpers.js";
import { isCampayConfigured } from "../services/campay.js";

// Toutes les données visibles par la personne connectée, filtrées côté serveur.

router.get("/api/bootstrap", (ctx) => {
  const u = ctx.user;
  const members = all("SELECT * FROM members ORDER BY last_name").map(map.member);
  const projects = projectsWithTotals();
  const news = all("SELECT * FROM news ORDER BY published_at DESC")
    .map(map.news)
    .filter((n) => n.status === "published" || (canAccess(u, "news") && (u.role === "super_admin" || (n.branchId && inScope(u, n.branchId)))));

  let visibleMembers;
  if (u) {
    visibleMembers = members.filter((m) => canSeeMember(u, m)).map((m) => sanitizeMember(u, m));
  } else {
    // Visiteuse : seulement les noms des responsables de projets et autrices publiques.
    const ids = new Set([...projects.map((p) => p.managerId), ...news.map((n) => n.authorId)]);
    visibleMembers = members
      .filter((m) => ids.has(m.id))
      .map((m) => ({ id: m.id, title: m.title, firstName: m.firstName, lastName: m.lastName, position: m.position, role: m.role, branchId: m.branchId, location: m.location, joinedAt: m.joinedAt, status: m.status, privacy: m.privacy, contactHidden: true }));
  }
  const visibleIds = new Set(visibleMembers.map((m) => m.id));

  const invitations = !u
    ? []
    : all("SELECT * FROM invitations ORDER BY created_at DESC")
        .map(map.invitation)
        .filter((i) => i.sponsorId === u.id || (canAccess(u, "invitations") && inScope(u, i.branchId)));

  const donations = !u
    ? []
    : canAccess(u, "donations")
      ? all("SELECT * FROM donations ORDER BY created_at DESC").map(map.donation)
      : all("SELECT * FROM donations WHERE donor_id = ? ORDER BY created_at DESC", u.id).map(map.donation);

  const notifications = canAccess(u, "notifications")
    ? all("SELECT * FROM notifications ORDER BY sent_at DESC").map(map.notification).filter((n) => u.role === "super_admin" || n.audience === u.branchId)
    : [];

  let auditLogs = [];
  if (u && (u.role === "super_admin" || u.role === "treasurer")) auditLogs = all("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200").map(map.audit);
  else if (u?.role === "branch_admin")
    auditLogs = all(
      "SELECT a.* FROM audit_logs a JOIN members m ON m.id = a.actor_id WHERE m.branch_id = ? ORDER BY a.created_at DESC LIMIT 50",
      u.branchId,
    ).map(map.audit);

  return {
    me: u,
    branches: all("SELECT * FROM branches ORDER BY created_at").map(map.branch),
    members: visibleMembers,
    invitations,
    familyLinks: all("SELECT * FROM family_links").map(map.familyLink).filter((l) => visibleIds.has(l.memberId) && visibleIds.has(l.relatedMemberId)),
    projects,
    projectUpdates: all("SELECT * FROM project_updates ORDER BY date DESC").map(map.projectUpdate),
    donations,
    news,
    events: all("SELECT * FROM events ORDER BY starts_at").map(map.event),
    notifications,
    auditLogs,
    stats: stats(),
    config: { paymentsReady: isCampayConfigured(), campayEnv: config.campay.env, minAmount: config.campay.minAmount, maxAmount: config.campay.maxAmount },
  };
});
