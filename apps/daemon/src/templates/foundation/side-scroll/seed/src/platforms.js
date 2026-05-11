function platformColliders(level) {
  return (level?.colliders || []).filter((col) => col.type === "platform" || col.type === "wall");
}

/** Colliders that deal damage or instakill on overlap, separate from
 *  platform/wall collision (which blocks movement). Read by
 *  updateHazards alongside the dedicated `hazards[]` array. */
function damageColliders(level) {
  return (level?.colliders || []).filter((col) => col.type === "hazard" || col.type === "kill");
}

function linkedPlatform(level, collider) {
  return (level?.platforms || []).find((platform) => platform.id === collider.links) || null;
}
