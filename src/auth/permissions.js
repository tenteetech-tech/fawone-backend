// Règles d'accès appliquées CÔTÉ SERVEUR (le front ne fait que refléter ces règles).

const areasByRole = {
  super_admin: ["dashboard", "members", "branches", "invitations", "projects", "donations", "news", "events", "notifications", "reports", "settings"],
  branch_admin: ["dashboard", "members", "invitations", "projects", "news", "events", "notifications", "settings"],
  treasurer: ["dashboard", "donations", "reports", "settings"],
  member: [],
  donor: [],
};

export const isAdmin = (u) => !!u && areasByRole[u.role]?.length > 0;
export const canAccess = (u, area) => !!u && areasByRole[u.role]?.includes(area);

export function inScope(u, branchId) {
  if (!u) return false;
  if (u.role === "super_admin" || u.role === "treasurer") return true;
  if (u.role === "branch_admin") return branchId === u.branchId;
  return false;
}

export function canSeeContact(viewer, m) {
  if (!viewer) return false;
  if (viewer.id === m.id || viewer.role === "super_admin") return true;
  if (viewer.role === "branch_admin" && viewer.branchId === m.branchId) return true;
  if (m.privacy === "members") return true;
  if (m.privacy === "branch") return viewer.branchId === m.branchId;
  return false;
}

/** Une membre (non admin) voit l'annuaire : actives, non mineures. */
export function canSeeMember(viewer, m) {
  if (!viewer) return false;
  if (viewer.id === m.id) return true;
  if (viewer.role === "super_admin") return true;
  if (viewer.role === "branch_admin" && viewer.branchId === m.branchId) return true;
  return m.status === "active" && !m.isMinor;
}

export const canManageMember = (viewer, m) => canAccess(viewer, "members") && inScope(viewer, m.branchId);
