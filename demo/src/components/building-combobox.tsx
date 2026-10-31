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

interface BuildingComboboxProps {
  id?: string;
  value: string;
  onValueChange: (value: string) => void;
  buildingNames: string[];
  placeholder?: string;
  className?: string;
}

export function BuildingCombobox({ id, value, onValueChange, buildingNames, placeholder, className }: BuildingComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);

  const matches = React.useMemo(() => searchNames(value, buildingNames, BUILDING_ALIASES), [value, buildingNames]);
  const showPopover = open && matches.length > 0;

  React.useEffect(() => setHighlightedIndex(0), [matches]);

  const listboxId = `${id}-listbox`;
  const optionId = (i: number) => `${id}-option-${i}`;

  function selectMatch(i: number) {
    const name = matches[i];
    if (!name) return;
    onValueChange(name);
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
              setHighlightedIndex((i) => Math.min(i + 1, matches.length - 1));
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
            {matches.map((name, i) => (
              <CommandItem
                key={name}
                id={optionId(i)}
                value={name}
                onSelect={() => selectMatch(i)}
                onMouseEnter={() => setHighlightedIndex(i)}
                className={cn((i === highlightedIndex || name === value) && "bg-accent text-accent-foreground")}
              >
                {highlightMatch(name, value)}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
