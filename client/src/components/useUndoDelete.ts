import { useState } from "react";
import { toast } from "sonner";

export function useUndoDelete(deleteFn, onDone, delay = 5000) {
  const [pending, setPending] = useState(new Set());

  const unhide = (ids) =>
    setPending((p) => {
      const n = new Set(p);
      ids.forEach((i) => n.delete(i));
      return n;
    });

  const remove = (ids) => {
    setPending((p) => new Set([...p, ...ids]));

    const timer = setTimeout(async () => {
      await deleteFn(ids);
      onDone();
      unhide(ids);
    }, delay);

    toast(`${ids.length} program${ids.length > 1 ? "s" : ""} deleted`, {
      duration: delay,
      action: {
        label: "Undo",
        onClick: () => {
          clearTimeout(timer);
          unhide(ids);
        },
      },
    });
  };

  return { pending, remove };
}
