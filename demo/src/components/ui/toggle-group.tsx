import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";

import { cn } from "@/lib/utils";

function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn(
        "inline-flex items-center rounded-md border border-input p-0.5",
        "data-[orientation=horizontal]:w-fit",
        "data-[orientation=vertical]:w-full data-[orientation=vertical]:flex-col data-[orientation=vertical]:items-stretch",
        className,
      )}
      {...props}
    />
  );
}

function ToggleGroupItem({ className, children, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-sm px-3 py-2.5 pointer-coarse:min-h-11 text-sm font-medium whitespace-nowrap transition-colors outline-none",
        "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground",
        "focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "disabled:pointer-events-none disabled:opacity-50",
        // stacked options (route choices) wrap under large text
        "data-[orientation=vertical]:justify-start data-[orientation=vertical]:text-left data-[orientation=vertical]:whitespace-normal",
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
}

export { ToggleGroup, ToggleGroupItem };
