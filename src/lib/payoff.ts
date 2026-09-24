import { useEffect, useMemo, useState } from "react";
import { LAYER_DEFAULT, type LayerTransform } from "../world/compose";
import { PLACEMENTS, type PlacementCopy } from "../world/placements";

/**
 * The payoff, remembered.
 *
 * This used to live inside the city surface, which was fine while the city was the only place with
 * something to remember. It is not: the arrangement moved to the editing phase, and the city still draws
 * what the arrangement decided. One store, read and written by whichever surface is on screen — so the two
 * cannot disagree about a number, and a visitor who arranges and then goes to download finds their
 * arrangement waiting rather than reverted to a default they never chose.
 */

/** How the photograph sits in a surface. Chosen, not assumed. */
export type Fit = "cover" | "contain";

export const STORE = "bahia-rosa.payoff.v1";

export interface StoredPayoff {
  copy?: Partial<PlacementCopy>;
  placement?: string;
  fit?: Fit;
  /** The subject's framing — one arrangement, applied to every surface. */
  layer?: LayerTransform;
  /** The shape this used to have, when the arrangement was kept per surface. Read, then written as `layer`. */
  layers?: Record<string, LayerTransform>;
}

export interface Payoff {
  copy: PlacementCopy;
  setCopy: (next: PlacementCopy | ((current: PlacementCopy) => PlacementCopy)) => void;
  placementId: string;
  setPlacementId: (id: string) => void;
  fit: Fit;
  setFit: (fit: Fit) => void;
  layer: LayerTransform;
  setLayer: (next: LayerTransform | ((current: LayerTransform) => LayerTransform)) => void;
}

/** A stored layer, read defensively: a corrupted or hostile entry becomes the default, never a NaN. */
function readLayer(value: unknown): LayerTransform | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<LayerTransform>;
  const number = (input: unknown, fallback: number, min: number, max: number): number =>
    typeof input === "number" && Number.isFinite(input) ? Math.min(max, Math.max(min, input)) : fallback;
  return {
    dx: number(candidate.dx, 0, -1.5, 1.5),
    dy: number(candidate.dy, 0, -1.5, 1.5),
    scale: number(candidate.scale, 1, 0.2, 4),
    cropTop: number(candidate.cropTop, 0, 0, 0.6),
    cropBottom: number(candidate.cropBottom, 0, 0, 0.6),
    cropLeft: number(candidate.cropLeft, 0, 0, 0.6),
    cropRight: number(candidate.cropRight, 0, 0, 0.6),
    overflow: candidate.overflow === true,
  };
}

export function defaultPayoff(
  city: string,
  location: string | null | undefined,
): { copy: PlacementCopy; placement: string; fit: Fit; layer: LayerTransform } {
  return {
    copy: {
      city,
      handle: "@you",
      title: location ? `printed at the ${location}` : "tonight on the coast",
      line: "made it myself, out tonight",
    },
    placement: PLACEMENTS[0].id,
    // The whole photograph, by default. A surface that hides part of someone's picture should be their
    // decision — so `cover` is offered, never assumed.
    fit: "contain",
    // And the subject exactly where the press put it: centred, fitted, nothing cut.
    layer: LAYER_DEFAULT,
  };
}

export function restorePayoff(
  city: string,
  location: string | null | undefined,
): { copy: PlacementCopy; placement: string; fit: Fit; layer: LayerTransform } {
  const fallback = defaultPayoff(city, location);
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(STORE);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as StoredPayoff;
    const known = PLACEMENTS.some((placement) => placement.id === parsed.placement);
    const placement = known ? (parsed.placement as string) : fallback.placement;
    // The arrangement used to be kept per surface. It is one arrangement now, applied everywhere — so the
    // old shape is read once, for the surface that was selected when it was made, and written back as the
    // single one. A visitor who arranged something before this change keeps their arrangement.
    const legacy = parsed.layers?.[placement] ?? Object.values(parsed.layers ?? {})[0];
    const layer = readLayer(parsed.layer) ?? readLayer(legacy) ?? fallback.layer;
    return {
      copy: { ...fallback.copy, ...parsed.copy },
      placement,
      fit: parsed.fit === "cover" || parsed.fit === "contain" ? parsed.fit : fallback.fit,
      layer,
    };
  } catch {
    return fallback;
  }
}

/**
 * The words, the surface, how it sits, and the arrangement — kept in this browser as they change.
 *
 * The arrangement is in the dependency list as much as the words are: without it a drag updates the canvas
 * and never reaches storage, which is a memory that looks like it works until the visitor comes back.
 */
export function usePayoff(city: string, location: string | null | undefined): Payoff {
  const first = useMemo(() => restorePayoff(city, location), [city, location]);
  const [copy, setCopy] = useState<PlacementCopy>(first.copy);
  const [placementId, setPlacementId] = useState<string>(first.placement);
  const [fit, setFit] = useState<Fit>(first.fit);
  const [layer, setLayer] = useState<LayerTransform>(first.layer);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        STORE,
        JSON.stringify({ copy, placement: placementId, fit, layer } satisfies StoredPayoff),
      );
    } catch {
      // A browser with storage disabled is not a broken page: the copy simply is not remembered.
    }
  }, [copy, placementId, fit, layer]);

  return { copy, setCopy, placementId, setPlacementId, fit, setFit, layer, setLayer };
}