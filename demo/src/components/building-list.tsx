import * as React from "react";
import { Building2, ChevronRight, X } from "lucide-react";

import { PALETTE } from "../../../src/style";
import { builtUpByName } from "../../../src/buildings";
import type { BuildingGroup } from "@/lib/building-groups";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BUILDING_ALIASES } from "@/lib/aliases";
import { searchNames } from "@/lib/fuzzy";
import { cn } from "@/lib/utils";

interface BuildingListProps {
  groups: BuildingGroup[];
  /** Building name -> "7 storeys", where known. */
  storeys: Map<string, string>;
  selected: string;
  dark: boolean;
  /** Matches the app's breakpoint: side panel at or above it, bottom sheet below. */
  wideQuery: string;
  onPick: (name: string) => void;
}

// at this size the list stays open after a pick
const ROOMY = "(min-width: 1024px) and (min-height: 600px)";

// static: the sheet patches storeys only
const BUILT_UP = builtUpByName();

/** Every named building, by group. */
export const BuildingList = React.memo(function BuildingList({ groups, storeys, selected, dark, wideQuery, onPick }: BuildingListProps) {
  const [wide, setWide] = React.useState(() => window.matchMedia(wideQuery).matches);
  const [open, setOpen] = React.useState(false);
  const closeRef = React.useRef<HTMLButtonElement>(null);
  const openRef = React.useRef<HTMLButtonElement>(null);
  const wasOpen = React.useRef(false);
  const colors = dark ? PALETTE.dark : PALETTE.light;
  const total = groups.reduce((n, g) => n + g.names.length, 0);
  const [query, setQuery] = React.useState("");
  const close = () => {
    setOpen(false);
    setQuery("");
  };
  const allNames = React.useMemo(() => groups.flatMap((g) => g.names), [groups]);
  const shown = React.useMemo(() => {
    if (!query.trim()) return groups;
    const hits = new Set(searchNames(query, allNames, BUILDING_ALIASES));
    return groups.map((g) => ({ ...g, names: g.names.filter((n) => hits.has(n)) })).filter((g) => g.names.length);
  }, [query, groups, allNames]);

  React.useEffect(() => {
    const mq = window.matchMedia(wideQuery);
    const onChange = (e: MediaQueryListEvent) => {
      setWide(e.matches);
      close();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [wideQuery]);

  // return focus to the Buildings button after the list closes
  React.useEffect(() => {
    if (wasOpen.current && !open) openRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  React.useEffect(() => {
    if (!open || wide) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, wide]);

  const pick = (name: string) => {
    onPick(name);
    // below desktop size, close after a pick so the map shows it
    if (!window.matchMedia(ROOMY).matches) close();
  };

  if (!open) {
    return (
      <Button
        ref={openRef}
        variant="outline"
        className="absolute z-10 h-11 rounded-full bg-card px-4 shadow-lg sm:h-9 sm:rounded-md pointer-coarse:h-11"
        style={
          wide
            ? { top: "max(12px, env(safe-area-inset-top))", right: "max(12px, env(safe-area-inset-right))" }
            : { bottom: "calc(max(12px, env(safe-area-inset-bottom)) + 8px)", left: "max(12px, env(safe-area-inset-left))" }
        }
        aria-expanded={false}
        aria-controls="building-list"
        onClick={() => setOpen(true)}
      >
        <Building2 className="size-4" />
        Buildings
      </Button>
    );
  }

  return (
    <>
      {!wide && <div className="fixed inset-0 z-20 bg-black/30" aria-hidden onClick={close} />}
      <section
        id="building-list"
        aria-label="All buildings"
        className={cn(
          "z-20 flex flex-col overflow-hidden border bg-card text-card-foreground shadow-lg",
          wide ? "absolute w-[300px] rounded-xl" : "fixed inset-x-0 bottom-0 h-[72dvh] rounded-t-2xl border-b-0",
        )}
        style={
          wide
            ? {
                top: "max(12px, env(safe-area-inset-top))",
                right: "max(12px, env(safe-area-inset-right))",
                // leaves the bottom-right locate and attribution controls clear
                maxHeight: "calc(100dvh - max(12px, env(safe-area-inset-top)) - 120px)",
              }
            : undefined
        }
      >
        {!wide && <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-border" aria-hidden />}
        <header className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-2">
          <div>
            <h2 className="font-display text-base font-semibold leading-tight">Buildings</h2>
            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{total} on campus</p>
          </div>
          <Button
            ref={closeRef}
            variant="ghost"
            size="icon"
            className="sm:size-8 pointer-coarse:size-11"
            aria-label="Close building list"
            aria-expanded
            aria-controls="building-list"
            onClick={close}
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="shrink-0 border-b px-3 py-2">
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter buildings"
            aria-label="Filter buildings"
            aria-controls="building-list"
            className="h-9 pointer-coarse:h-11"
          />
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
          style={{ paddingBottom: wide ? 8 : "max(12px, env(safe-area-inset-bottom))" }}
        >
          {shown.length === 0 && <p className="px-4 py-3 text-sm text-muted-foreground">No matching building.</p>}
          {shown.map((g) => (
            // groups start collapsed; a search opens them so hits show
            <details key={g.id} open={query.trim() !== ""} className="group">
              <summary className="sticky top-0 z-[1] flex min-h-11 cursor-pointer list-none items-center gap-2 bg-card px-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground select-none sm:min-h-9 pointer-coarse:min-h-11 [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                <span className="size-2.5 rounded-[3px]" style={{ background: colors[g.id] }} aria-hidden />
                {g.label}
                <span className="ml-auto font-mono font-normal tabular-nums">{g.names.length}</span>
              </summary>
              <ul className="px-2 pb-2">
                {g.names.map((name) => {
                  const area = BUILT_UP.get(name);
                  const detail = [storeys.get(name), area && `${Math.round(area).toLocaleString("en-IN")} m²`].filter(Boolean).join(" · ");
                  return (
                    <li key={name}>
                      <button
                        type="button"
                        onClick={() => pick(name)}
                        aria-current={name === selected ? "true" : undefined}
                        className={cn(
                          "flex min-h-11 w-full items-center rounded-md px-2 py-1.5 text-left text-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:min-h-8 pointer-coarse:min-h-11",
                          name === selected && "bg-accent font-medium",
                        )}
                      >
                        {name}
                        {detail && (
                          <span
                            className="ml-auto shrink-0 pl-3 font-mono text-[11px] tabular-nums text-muted-foreground"
                            title={area ? "Built-up area over all floors, from the master plan" : undefined}
                          >
                            {detail}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </details>
          ))}
        </div>
      </section>
    </>
  );
});
