import * as React from "react";

import { Button } from "@/components/ui/button";
import { roomDetail, type FloorGroup, type RoomHit } from "@/lib/rooms";

/** A building's rooms by floor; picking one shows it like a searched room. */
export function RoomList({ groups, selected, onPick }: { groups: FloorGroup[]; selected: RoomHit | null; onPick: (room: RoomHit) => void }) {
  // hostel lists are long; build them only once opened
  const [open, setOpen] = React.useState(false);
  const total = groups.reduce((n, g) => n + g.rooms.length, 0);
  return (
    <details className="text-sm" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="cursor-pointer text-muted-foreground pointer-coarse:py-3">Rooms ({total})</summary>
      {open && (
        <div className="mt-1 flex max-h-72 flex-col gap-3 overflow-y-auto">
          {groups.map((g) => (
            <section key={g.heading} aria-label={g.heading}>
              <h3 className="mb-1 text-xs font-semibold text-muted-foreground">
                {g.heading} <span className="font-normal tabular-nums">· {g.rooms.length}</span>
              </h3>
              <div className="flex flex-wrap gap-1">
                {g.rooms.map((room) => (
                  <Button
                    key={`${room.room} ${room.label}`}
                    variant={room === selected ? "default" : "outline"}
                    size="sm"
                    className="font-mono"
                    aria-pressed={room === selected}
                    title={roomDetail(room)}
                    onClick={() => onPick(room)}
                  >
                    {room.room}
                  </Button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </details>
  );
}
