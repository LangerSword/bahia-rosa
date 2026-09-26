/**
 * The magnet.
 *
 * A ring accompanies the pointer and leans toward whatever it is near — the button, the tile, the frame —
 * so the interface feels like it is meeting the visitor halfway. It never replaces the pointer and never
 * touches input: the pull is a *display* offset, the click still lands where the visitor aimed.
 *
 * Pure arithmetic, so the behaviour can be tested without a mouse: which magnet is nearest, how strongly it
 * pulls, and by how much the ring should lean.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Magnet {
  id: string;
  rect: Rect;
}

export interface Pull {
  dx: number;
  dy: number;
  id: string | null;
  /** 0 at the edge of the field, 1 when the pointer is on the element. */
  strength: number;
}

export const MAGNET_RADIUS = 150;
export const MAGNET_REACH = 22;

const EMPTY: Pull = { dx: 0, dy: 0, id: null, strength: 0 };

function distanceTo(rect: Rect, x: number, y: number): number {
  const nx = Math.max(rect.left, Math.min(x, rect.left + rect.width));
  const ny = Math.max(rect.top, Math.min(y, rect.top + rect.height));
  return Math.hypot(x - nx, y - ny);
}

/**
 * Where the ring should sit for a pointer at (x, y): the middle of the nearest magnet's pull, capped so the
 * ring never flies off the pointer. Nearest wins — a stack of magnets pulls as one nearest field rather than
 * tearing the ring between them.
 */
export function magnetPull(
  x: number,
  y: number,
  magnets: Magnet[],
  radius = MAGNET_RADIUS,
  reach = MAGNET_REACH,
): Pull {
  let nearest: { magnet: Magnet; distance: number } | null = null;
  for (const magnet of magnets) {
    const distance = distanceTo(magnet.rect, x, y);
    if (distance > radius) continue;
    if (!nearest || distance < nearest.distance) nearest = { magnet, distance };
  }
  if (!nearest) return EMPTY;

  const centreX = nearest.magnet.rect.left + nearest.magnet.rect.width / 2;
  const centreY = nearest.magnet.rect.top + nearest.magnet.rect.height / 2;
  const towardsX = centreX - x;
  const towardsY = centreY - y;
  const towards = Math.hypot(towardsX, towardsY);
  if (towards === 0) return { dx: 0, dy: 0, id: nearest.magnet.id, strength: 1 };

  const strength = 1 - nearest.distance / radius;
  const travel = Math.min(reach, towards * 0.3) * strength;
  return {
    dx: (towardsX / towards) * travel,
    dy: (towardsY / towards) * travel,
    id: nearest.magnet.id,
    strength,
  };
}