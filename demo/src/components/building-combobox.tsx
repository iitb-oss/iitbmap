import * as React from "react";

import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Command, CommandList, CommandEmpty, CommandItem } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { searchNames } from "@/lib/fuzzy";
import { BUILDING_ALIASES } from "@/lib/aliases";

function highlightMatch(name: string, query: string): React.ReactNode {
  const i = name.toLowerCase().indexOf(query.toLowerCase());
  if (!query || i === -1) return name;
  return (
    <>
      {name.slice(0, i)}
      <mark className="bg-transparent font-semibold text-primary">{name.slice(i, i + query.length)}</mark>
      {name.slice(i + query.length)}
    </>
  );
}

/** A suggestion listed above the name matches, such as a room. */
export interface ExtraSuggestion {
  key: string;
  label: string;
  detail: string;
  onSelect: () => void;
}

interface BuildingComboboxProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  buildingNames: string[];
  extra?: ExtraSuggestion[];
  placeholder?: string;
  className?: string;
}

const NO_EXTRA: ExtraSuggestion[] = [];

export function BuildingCombobox({ id, value, onValueChange, buildingNames, extra = NO_EXTRA, placeholder, className }: BuildingComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);

  const items = React.useMemo(
    () => [
      ...extra.map((s) => ({
        key: s.key,
        current: false,
        onSelect: s.onSelect,
        content: (
          <span className="flex flex-col">
            <span className="font-medium">{s.label}</span>
            <span className="text-xs text-muted-foreground">{s.detail}</span>
          </span>
        ),
      })),
      ...searchNames(value, buildingNames, BUILDING_ALIASES).map((name) => ({
        key: name,
        current: name === value,
        onSelect: () => onValueChange(name),
        content: highlightMatch(name, value),
      })),
    ],
    [extra, value, buildingNames, onValueChange],
  );
  const showPopover = open && items.length > 0;

  React.useEffect(() => setHighlightedIndex(0), [items]);

  const listboxId = `${id}-listbox`;
  const optionId = (i: number) => `${id}-option-${i}`;

  function selectMatch(i: number) {
    if (!items[i]) return;
    items[i].onSelect();
    setOpen(false);
  }

  return (
    <Popover open={showPopover} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={showPopover}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-activedescendant={showPopover ? optionId(highlightedIndex) : undefined}
          className={className}
          onChange={(e) => {
            onValueChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setOpen(false);
              return;
            }
            if (!showPopover) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setHighlightedIndex((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setHighlightedIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              selectMatch(highlightedIndex);
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (e.target instanceof HTMLElement && e.target.id === id) e.preventDefault();
        }}
      >
        <Command shouldFilter={false}>
          <CommandList id={listboxId}>
            <CommandEmpty>No place matches. Try a short name like CSE, or a DIGIPIN.</CommandEmpty>
            {items.map((item, i) => (
              <CommandItem
                key={item.key}
                id={optionId(i)}
                value={item.key}
                onSelect={() => selectMatch(i)}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={cn((i === highlightedIndex || item.current) && "bg-accent text-accent-foreground")}
              >
                {item.content}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
