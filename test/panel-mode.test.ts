import { describe, expect, it } from "vitest";
import { isFolded, panelMode, type PanelInputs, type PanelMode } from "../demo/src/lib/panel-mode";

const base: PanelInputs = { directions: false, collapsed: false, hasPlace: false, hasRoute: false, awaitingFix: false };

describe("panelMode", () => {
  it.each([
    [{}, "search"],
    [{ collapsed: true }, "search"], // nothing to fold to
    [{ hasPlace: true }, "place"],
    [{ hasPlace: true, collapsed: true }, "place-folded"],
    [{ directions: true, hasPlace: true }, "plan"],
    [{ directions: true, hasPlace: true, collapsed: true }, "plan"], // From still needs typing
    [{ directions: true, hasPlace: true, awaitingFix: true }, "locating"],
    [{ directions: true, hasPlace: true, awaitingFix: true, hasRoute: true, collapsed: true }, "locating"], // a stale route never hides the wait
    [{ directions: true, hasPlace: true, hasRoute: true }, "route"],
    [{ directions: true, hasPlace: true, hasRoute: true, collapsed: true }, "route-folded"],
  ] as [Partial<PanelInputs>, PanelMode][])("%o is %s", (inputs, mode) => {
    expect(panelMode({ ...base, ...inputs })).toBe(mode);
  });

  it("folds only where the panel has a one-line form", () => {
    const flags = [false, true];
    for (const directions of flags) for (const collapsed of flags) for (const hasPlace of flags) for (const hasRoute of flags) for (const awaitingFix of flags) {
      const mode = panelMode({ directions, collapsed, hasPlace, hasRoute, awaitingFix });
      if (isFolded(mode)) expect(collapsed && (directions ? hasRoute : hasPlace)).toBe(true);
    }
  });
});
