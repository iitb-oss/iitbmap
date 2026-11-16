/** The search-and-directions panel's mode; derived every render, shown as data-mode. */
export type PanelMode =
  | "search" // nothing picked
  | "place" // a destination picked
  | "place-folded" // the same on one line (phones)
  | "plan" // directions open, no route yet
  | "locating" // From is "my current location", no GPS fix yet
  | "route" // a route is shown
  | "route-folded"; // the same as its summary line (phones)

export interface PanelInputs {
  /** Directions were opened and not closed. */
  directions: boolean;
  /** A fold was asked for: a phone picked a place, found a route, or dragged the map. */
  collapsed: boolean;
  /** To resolves to a point. */
  hasPlace: boolean;
  hasRoute: boolean;
  /** From is "my current location" without a fix. */
  awaitingFix: boolean;
}

export function panelMode({ directions, collapsed, hasPlace, hasRoute, awaitingFix }: PanelInputs): PanelMode {
  if (directions) {
    if (awaitingFix) return "locating";
    if (!hasRoute) return "plan";
    return collapsed ? "route-folded" : "route";
  }
  if (!hasPlace) return "search";
  return collapsed ? "place-folded" : "place";
}

export const isFolded = (mode: PanelMode): boolean => mode === "place-folded" || mode === "route-folded";
