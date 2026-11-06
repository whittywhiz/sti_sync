import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Opt = {
  employee_id: number;
  name: string;
  would_be: number;
  exceeds: boolean;
};

type VacantSlot = {
  day: string;
  day_id: number;
  start_time: string;
  end_time: string;
  room_id: number;
  room_number: string;
};

const fmt = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

export default function AssignInstructorModal({
  cls,
  onClose,
  onDone,
  onMove,
  vacantSlots = [],
  onEmpChange,
}: {
  cls: any;
  onClose: () => void;
  onDone: (msg?: string, empId?: number | null, empName?: string) => void;
  onMove: (slot: VacantSlot, employee_id: number | null) => Promise<boolean>;
  vacantSlots: VacantSlot[];
  onEmpChange: (id: number | null | undefined) => void;
}) {
  const [opts, setOpts] = useState<Opt[] | null>(null);
  // undefined = instructor unchanged, null = unassign, number = new instructor
  const [selEmp, setSelEmp] = useState<number | null | undefined>(undefined);
  const [selSlot, setSelSlot] = useState<VacantSlot | null>(null);
  const [warn, setWarn] = useState<{
    name: string;
    total: number;
    day?: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    onEmpChange(selEmp);
    setSelSlot(null);
  }, [selEmp]);

  useEffect(() => {
    const q = selSlot
      ? `?day_id=${selSlot.day_id}&start=${selSlot.start_time}&end=${selSlot.end_time}`
      : "";
    fetch(`/api/classes/${cls.class_id}/eligible-employees${q}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setOpts)
      .catch(() => {
        setOpts([]);
        toast.error("Failed to load instructors.");
      });
  }, [cls.class_id, selSlot]);

  const empChanged =
    selEmp !== undefined && selEmp !== (cls.employee_id ?? null);
  const canSave = empChanged || !!selSlot;

  const save = async (confirm_overload = false) => {
    setBusy(true);
    try {
      if (empChanged && !selSlot) {
        const res = await fetch(`/api/classes/${cls.class_id}/employee`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ employee_id: selEmp, confirm_overload }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 409 && data.needsConfirm) {
          const o = opts?.find((x) => x.employee_id === selEmp);
          setWarn({ name: o?.name ?? "This instructor", total: data.total });
          return;
        }
        if (!res.ok)
          return toast.error(data.error || "Could not assign instructor.");
      }
      let msg: string | undefined;
      if (selSlot) {
        const newEmp = empChanged ? (selEmp as number | null) : cls.employee_id;
        const o = opts?.find((x) => x.employee_id === newEmp);
        if (newEmp !== null && o?.exceeds && !confirm_overload) {
          setWarn({ name: o.name, total: o.would_be, day: selSlot.day });
          return;
        }
        const ok = await onMove(selSlot, newEmp);
        if (!ok) return;
      } else {
        msg = selEmp
          ? `${cls.course_code} assigned to ${opts?.find((x) => x.employee_id === selEmp)?.name ?? "instructor"}`
          : `${cls.course_code} instructor removed`;
      }

      const finalEmp = empChanged ? (selEmp as number | null) : cls.employee_id;
      const finalName =
        finalEmp === null
          ? "Unassigned"
          : (opts?.find((x) => x.employee_id === finalEmp)?.name ??
            cls.professor);
      onDone(msg, finalEmp, finalName);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const sec = `${cls.code ?? cls.program} ${cls.year_level}${cls.section_name ? " " + cls.section_name : ""}`;

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[770px] max-h-[90vh] w-full max-w-md flex-col rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="shrink-0 font-heading text-lg font-bold">Edit class</h3>
        <div className="mt-2 shrink-0 space-y-0.5 text-sm text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">
              {cls.course_code}
            </span>{" "}
            {cls.course}
          </p>
          <p>{sec}</p>
          <p>
            {cls.day} · {fmt(cls.start_time)}–{fmt(cls.end_time)} · {cls.room}
          </p>
          <p>
            Current:{" "}
            <span className="font-medium text-foreground">{cls.professor}</span>
          </p>
        </div>

        {warn ? (
          <div className="mt-4 flex flex-1 flex-col justify-between">
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              {warn.name} would teach <b>{warn.total} hrs</b> on{" "}
              {warn.day ?? cls.day}, over the 9-hour daily limit. Assign anyway?
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setWarn(null)}>
                Cancel
              </Button>
              <Button size="sm" disabled={busy} onClick={() => save(true)}>
                Assign anyway
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground">
                Instructor
              </p>
              {cls.employee_id && (
                <button
                  className={`text-xs hover:underline ${selEmp === null ? "font-semibold text-red-700" : "text-red-600"}`}
                  disabled={busy}
                  onClick={() => setSelEmp(null)}
                >
                  {selEmp === null ? "Will unassign" : "Unassign"}
                </button>
              )}
            </div>
            <ul className="mt-1 min-h-[96px] flex-1 divide-y overflow-y-auto rounded-md border">
              {opts === null && (
                <li className="p-3 text-sm text-muted-foreground">
                  Loading...
                </li>
              )}
              {opts?.length === 0 && (
                <li className="p-3 text-sm text-muted-foreground">
                  No available instructors for this time.
                </li>
              )}
              {opts?.map((o) => (
                <li key={o.employee_id}>
                  <button
                    disabled={busy || o.employee_id === cls.employee_id}
                    onClick={() => setSelEmp(o.employee_id)}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50 ${
                      selEmp === o.employee_id ? "bg-yellow-100" : ""
                    }`}
                  >
                    <span>
                      {o.name}
                      {o.employee_id === cls.employee_id ? " (current)" : ""}
                    </span>
                    <span
                      className={
                        o.exceeds
                          ? "text-xs font-semibold text-amber-600"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      {o.would_be} {o.would_be === 1 ? "hr" : "hrs"} that day
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            <p className="mt-4 shrink-0 text-xs font-semibold text-muted-foreground">
              Room and time
            </p>
            <ul className="mt-1 min-h-[96px] flex-1 divide-y overflow-y-auto rounded-md border">
              {vacantSlots.length === 0 && (
                <li className="p-3 text-sm text-muted-foreground">
                  No available slots.
                </li>
              )}
              {vacantSlots.map((slot, i) => {
                const picked =
                  selSlot?.day_id === slot.day_id &&
                  selSlot?.start_time === slot.start_time &&
                  selSlot?.room_id === slot.room_id;
                return (
                  <li
                    key={`${slot.day_id}-${slot.start_time}-${slot.room_id}-${i}`}
                  >
                    <button
                      disabled={busy}
                      onClick={() => setSelSlot(picked ? null : slot)}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-muted ${
                        picked ? "bg-yellow-100" : ""
                      }`}
                    >
                      <span>
                        {slot.day} · {fmt(slot.start_time)}–{fmt(slot.end_time)}
                      </span>
                      <span className="text-muted-foreground">
                        Room {slot.room_number}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-auto flex shrink-0 justify-end gap-2 pt-4">
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
              <Button
                size="sm"
                disabled={busy || !canSave}
                onClick={() => save()}
              >
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
