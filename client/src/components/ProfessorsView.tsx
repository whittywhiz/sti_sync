import { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  Clock,
  Pencil,
  Check,
  X,
  Search,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { motion, AnimatePresence } from "framer-motion";
import { ImportExcelButton } from "@/components/ImportExcelButton";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Modal } from "@/components/Modal";
import { toast } from "sonner";
import { authFetch } from "../lib/authFetch";
import { createPortal } from "react-dom";

interface Employee {
  employee_id: number;
  department: string | null;
  lname: string;
  mname: string | null;
  fname: string;
  name: string;
  position: string | null;
  max_hours_per_day: number | null;
  max_hours_per_week: number | null;
}

interface Availability {
  availability_id: number;
  employee_id: number;
  day_id: number;
  start_time: string;
  end_time: string;
}

interface DayRow {
  day_id: number;
  name: string;
}

const SHORT_DAY: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
  Sunday: "Sun",
};

function formatTime12hr(time24: string): string {
  const [hStr, mStr] = time24.split(":");
  const hour = parseInt(hStr, 10);
  const minute = (mStr ?? "00").padStart(2, "0");
  const period = hour >= 12 ? "PM" : "AM";
  let h = hour % 12;
  if (h === 0) h = 12;
  return `${h}:${minute} ${period}`;
}

function formatHour12(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  let h = hour % 12;
  if (h === 0) h = 12;
  return `${h}:00 ${period}`;
}

const HOUR_OPTIONS = Array.from({ length: 14 }, (_, i) => i + 7);

interface SlotDraft {
  day_id: number;
  start_hour: number;
  end_hour: number;
}

interface ProfessorFormValues {
  fname: string;
  mname: string;
  lname: string;
  department: string;
  position: string;
  maxHoursPerDay: string;
  maxHoursPerWeek: string;
  slots: SlotDraft[];
}

interface ProfessorFormProps {
  initial: ProfessorFormValues;
  days: DayRow[];
  onSave: (values: ProfessorFormValues) => void;
  onCancel: () => void;
}

function ProfessorForm({
  initial,
  days,
  onSave,
  onCancel,
}: ProfessorFormProps) {
  const [fname, setFname] = useState(initial.fname);
  const [mname, setMname] = useState(initial.mname);
  const [lname, setLname] = useState(initial.lname);
  const [department, setDepartment] = useState(initial.department);
  const [position, setPosition] = useState(initial.position);
  const [maxHoursPerDay, setMaxHoursPerDay] = useState(initial.maxHoursPerDay);
  const [maxHoursPerWeek, setMaxHoursPerWeek] = useState(
    initial.maxHoursPerWeek,
  );

  const [slots, setSlots] = useState<SlotDraft[]>(initial.slots);
  const [selDayId, setSelDayId] = useState<number>(days[0]?.day_id ?? 1);
  const [selStart, setSelStart] = useState(7);
  const [selEnd, setSelEnd] = useState(17);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/departments")
      .then((r) => r.json())
      .then((rows: { description: string }[]) =>
        setDepartments(rows.map((d) => d.description)),
      )
      .catch(() => setSaveError("Could not load departments."));
  }, []);
  const dayName = (id: number) => days.find((d) => d.day_id === id)?.name ?? "";

  const addSlot = () => {
    if (selEnd <= selStart) {
      setSlotError("End time must be after start time.");
      return;
    }

    if (slots.some((s) => s.day_id === selDayId)) {
      setSlotError(
        "That day already has a slot — remove it below first if you want to change it.",
      );
      return;
    }
    setSlotError(null);
    setSlots((s) => [
      ...s,
      { day_id: selDayId, start_hour: selStart, end_hour: selEnd },
    ]);
  };
  const removeSlot = (dayId: number) =>
    setSlots((s) => s.filter((slot) => slot.day_id !== dayId));

  const handleSave = () => {
    if (!fname.trim() || !lname.trim() || !department.trim()) {
      setSaveError("First Name, Last Name, and Department are required.");
      return;
    }

    const dayVal = maxHoursPerDay === "" ? null : Number(maxHoursPerDay);
    const weekVal = maxHoursPerWeek === "" ? null : Number(maxHoursPerWeek);

    if (dayVal != null && (isNaN(dayVal) || dayVal < 0 || dayVal > 24)) {
      setSaveError("Max hours/day must be between 0 and 24.");
      return;
    }
    if (weekVal != null && (isNaN(weekVal) || weekVal < 0 || weekVal > 168)) {
      setSaveError("Max hours/week must be between 0 and 168.");
      return;
    }
    if (dayVal != null && weekVal != null && dayVal > weekVal) {
      setSaveError("Max hours/day can't be greater than max hours/week.");
      return;
    }

    setSaveError(null);
    onSave({
      fname,
      mname,
      lname,
      department,
      position,
      maxHoursPerDay,
      maxHoursPerWeek,
      slots,
    });
  };

  const handleEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSave();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <select
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="" disabled>
            Select department
          </option>
          {department && !departments.includes(department) && (
            <option value={department}>{department}</option>
          )}
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <Input
          placeholder="Position (optional)"
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          onKeyDown={handleEnter}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Input
          placeholder="First Name"
          value={fname}
          onChange={(e) => setFname(e.target.value)}
          onKeyDown={handleEnter}
        />
        <Input
          placeholder="Middle Name (optional)"
          value={mname}
          onChange={(e) => setMname(e.target.value)}
          onKeyDown={handleEnter}
        />
        <Input
          placeholder="Last Name"
          value={lname}
          onChange={(e) => setLname(e.target.value)}
          onKeyDown={handleEnter}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Max hours/day (optional)
          </label>
          <Input
            type="number"
            min={0}
            max={16}
            step={0.5}
            placeholder="No limit"
            value={maxHoursPerDay}
            onChange={(e) => setMaxHoursPerDay(e.target.value)}
            onKeyDown={(e) => {
              if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
              else handleEnter(e);
            }}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground mb-1 block">
            Max hours/week (optional)
          </label>
          <Input
            type="number"
            min={0}
            max={60}
            step={0.5}
            placeholder="No limit"
            value={maxHoursPerWeek}
            onChange={(e) => setMaxHoursPerWeek(e.target.value)}
            onKeyDown={(e) => {
              if (["e", "E", "+", "-"].includes(e.key)) e.preventDefault();
              else handleEnter(e);
            }}
          />
        </div>
      </div>
      <div>
        <p className="text-sm font-medium mb-2">Availability</p>
        <div className="flex gap-2 items-end flex-wrap">
          <select
            value={selDayId}
            onChange={(e) => setSelDayId(+e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            {days.map((d) => (
              <option key={d.day_id} value={d.day_id}>
                {d.name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <select
              value={selStart}
              onChange={(e) => setSelStart(+e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {formatHour12(h)}
                </option>
              ))}
            </select>
            <span className="text-muted-foreground">to</span>
            <select
              value={selEnd}
              onChange={(e) => setSelEnd(+e.target.value)}
              className="h-10 rounded-md border border-input bg-background px-2 text-sm"
            >
              {HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>
                  {formatHour12(h)}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-[40px] hover:bg-yellow-400"
            onClick={addSlot}
          >
            Add Slot
          </Button>
          {slotError && (
            <p className="text-xs text-destructive mt-1 w-full">{slotError}</p>
          )}
        </div>
        <div className="flex gap-2 mt-2 flex-wrap">
          {slots.map((s) => (
            <Badge
              key={s.day_id}
              variant="secondary"
              className="cursor-pointer"
              onClick={() => removeSlot(s.day_id)}
            >
              {SHORT_DAY[dayName(s.day_id)] ?? dayName(s.day_id)}{" "}
              {formatHour12(s.start_hour)}–{formatHour12(s.end_hour)} ✕
            </Badge>
          ))}
        </div>
      </div>
      {saveError && <p className="text-xs text-destructive">{saveError}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={handleSave}>
          <Check className="w-4 h-4 mr-1" /> Save
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          <X className="w-4 h-4 mr-1" /> Cancel
        </Button>
      </div>
    </div>
  );
}

export function ProfessorsView() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [days, setDays] = useState<DayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Employee | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const emptyForm: ProfessorFormValues = {
    fname: "",
    mname: "",
    lname: "",
    department: "",
    position: "",
    maxHoursPerDay: "",
    maxHoursPerWeek: "",
    slots: [],
  };

  const fetchAll = async () => {
    setLoading(true);

    try {
      const [empRes, availRes, daysRes] = await Promise.all([
        fetch("/api/employees"),
        fetch("/api/availability"),
        fetch("/api/days"),
      ]);
      setEmployees(await empRes.json());
      setAvailability(await availRes.json());
      setDays(await daysRes.json());
    } catch (err) {
      console.error("Failed to fetch professors data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const saveAvailabilityForEmployee = async (
    employeeId: number,
    slots: SlotDraft[],
  ) => {
    const existing = availability.filter((a) => a.employee_id === employeeId);
    await Promise.all(
      existing.map((a) =>
        fetch(`/api/availability/${a.availability_id}`, { method: "DELETE" }),
      ),
    );
    await Promise.all(
      slots.map((s) =>
        fetch("/api/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            employee_id: employeeId,
            day_id: s.day_id,
            start_time: `${String(s.start_hour).padStart(2, "0")}:00`,
            end_time: `${String(s.end_hour).padStart(2, "0")}:00`,
          }),
        }),
      ),
    );
  };

  const handleSubmit = async (values: ProfessorFormValues) => {
    if (!values.fname || !values.lname || !values.department) return;
    try {
      const res = await fetch("/api/employees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department: values.department,
          fname: values.fname,
          mname: values.mname || null,
          lname: values.lname,
          position: values.position || null,
          max_hours_per_day:
            values.maxHoursPerDay === "" ? null : Number(values.maxHoursPerDay),
          max_hours_per_week:
            values.maxHoursPerWeek === ""
              ? null
              : Number(values.maxHoursPerWeek),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error ?? "Could not add the professor.");
        return;
      }
      await saveAvailabilityForEmployee(data.employee_id, values.slots);
      setShowForm(false);
      fetchAll();
    } catch (err) {
      console.error("Failed to create professor", err);
      toast.error("Could not add the professor.");
    }
  };

  const startEdit = (id: number) => {
    setEditingId(id);
    setShowForm(false);
  };

  const saveEdit = async (values: ProfessorFormValues) => {
    if (!editingId || !values.fname || !values.lname || !values.department)
      return;
    try {
      const res = await fetch(`/api/employees/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          department: values.department,
          fname: values.fname,
          mname: values.mname || null,
          lname: values.lname,
          position: values.position || null,
          max_hours_per_day:
            values.maxHoursPerDay === "" ? null : Number(values.maxHoursPerDay),
          max_hours_per_week:
            values.maxHoursPerWeek === ""
              ? null
              : Number(values.maxHoursPerWeek),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not update the professor.");
        return;
      }
      await saveAvailabilityForEmployee(editingId, values.slots);
      setEditingId(null);
      fetchAll();
    } catch (err) {
      console.error("Failed to update professor", err);
      toast.error("Could not update the professor.");
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const removeProfessor = async (id: number) => {
    try {
      const res = await fetch(`/api/employees/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to delete professor");
        return;
      }
      setSelected((s) => s.filter((x) => x !== id));
      fetchAll();
    } catch (err) {
      console.error("Failed to delete professor", err);
      toast.error("Failed to delete professor");
    }
  };

  const toggleSelect = (id: number) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  const removeSelected = async () => {
    const ids = [...selected];
    const failed: number[] = [];
    let firstError = "";
    for (const id of ids) {
      try {
        const res = await fetch(`/api/employees/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failed.push(id);
          if (!firstError) firstError = data.error ?? "";
        }
      } catch {
        failed.push(id);
      }
    }
    const deleted = ids.length - failed.length;
    if (deleted > 0) {
      toast.success(`Deleted ${deleted} professor${deleted !== 1 ? "s" : ""}`);
    }
    if (failed.length > 0) {
      const names = employees
        .filter((e) => failed.includes(e.employee_id))
        .map((e) => e.name)
        .join(", ");
      toast.error(
        `Could not delete ${names}${firstError ? `: ${firstError}` : ""}`,
      );
    }
    setSelected(failed);
    fetchAll();
  };

  const slotsForEmployee = (employeeId: number): SlotDraft[] =>
    availability
      .filter((a) => a.employee_id === employeeId)
      .map((a) => ({
        day_id: a.day_id,
        start_hour: parseInt(a.start_time.split(":")[0], 10),
        end_hour: parseInt(a.end_time.split(":")[0], 10),
      }));

  const dayName = (id: number) => days.find((d) => d.day_id === id)?.name ?? "";
  const filtered = employees.filter((p) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.department ?? "").toLowerCase().includes(q) ||
      (p.position ?? "").toLowerCase().includes(q)
    );
  });

  const sorted = [...filtered].sort((a, b) => a.lname.localeCompare(b.lname));

  const editingProf = employees.find((e) => e.employee_id === editingId);

  const maxHoursText = (p: Employee) => {
    const parts: string[] = [];
    if (p.max_hours_per_day != null) parts.push(`${p.max_hours_per_day}/day`);
    if (p.max_hours_per_week != null) parts.push(`${p.max_hours_per_week}/wk`);
    return parts.length ? parts.join(" · ") : "—";
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-50 bg-background pt-4 pb-4 -mx-6 px-6 shadow-none border-none">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-heading text-2xl font-bold">Professors</h2>
            <p className="text-muted-foreground mt-1">
              Manage faculty and availability
            </p>
          </div>
          <div className="flex gap-2">
            <div className="inline-block [&_button]:!bg-white [&_button]:!text-gray-800 [&_button]:border [&_button]:border-gray-300 hover:[&_button]:!bg-gray-100">
              <ImportExcelButton
                endpoint="/api/employees/import"
                onDone={fetchAll}
              />
            </div>
            <Button
              onClick={() => {
                setShowForm(true);
                setEditingId(null);
              }}
            >
              <Plus className="w-4 h-4 mr-1" /> Add Professor
            </Button>
          </div>
        </div>
        <div className="glass-card rounded-xl p-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name, department, or position…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setEditingId(null);
              }}
              className="pl-9"
            />
          </div>
        </div>

        {selected.length > 0 && (
          <div className="glass-card rounded-xl mt-3 px-4 py-2 flex items-center justify-between text-sm">
            <span className="font-medium">{selected.length} selected</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(sorted.map((p) => p.employee_id))}
              >
                Select all ({sorted.length})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setBulkDeleteOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-1" /> Delete selected
              </Button>
            </div>
          </div>
        )}
      </div>

      {sorted.length > 0 && (
        <div className="glass-card rounded-xl max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-xs font-semibold text-muted-foreground">
              <tr className="border-b">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={
                      sorted.length > 0 && selected.length === sorted.length
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
                          ? sorted.map((p) => p.employee_id)
                          : [],
                      )
                    }
                    aria-label="Select all professors"
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                </th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">Department</th>
                <th className="px-4 py-3 text-left">Position</th>

                <th className="px-4 py-3 text-left">Availability</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {sorted.map((p) => (
                  <motion.tr
                    key={p.employee_id}
                    initial={search ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className={`border-b last:border-0 hover:bg-muted/40 ${
                      selected.includes(p.employee_id) ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3 align-top">
                      <input
                        type="checkbox"
                        checked={selected.includes(p.employee_id)}
                        onChange={() => toggleSelect(p.employee_id)}
                        aria-label={`Select ${p.name}`}
                        className="h-4 w-4 cursor-pointer accent-primary"
                      />
                    </td>
                    <td className="px-4 py-3 align-top font-medium">
                      {p.name}
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {p.department ?? "—"}
                    </td>
                    <td className="px-4 py-3 align-top text-muted-foreground">
                      {p.position ?? "—"}
                    </td>

                    <td className="px-4 py-3 align-top">
                      <div className="flex gap-1.5 flex-wrap">
                        {availability
                          .filter((a) => a.employee_id === p.employee_id)
                          .map((a) => (
                            <span
                              key={a.availability_id}
                              className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full whitespace-nowrap"
                            >
                              <Clock className="w-3 h-3" />
                              {SHORT_DAY[dayName(a.day_id)] ??
                                dayName(a.day_id)}{" "}
                              {formatTime12hr(a.start_time)}–
                              {formatTime12hr(a.end_time)}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => startEdit(p.employee_id)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      {!loading && sorted.length === 0 && (
        <div className="glass-card rounded-xl p-10 text-center text-sm text-muted-foreground">
          {search
            ? "No professors match your search."
            : "No professors yet. Click Add Professor to create one."}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Add Professor"
        className="max-w-2xl"
      >
        <ProfessorForm
          initial={emptyForm}
          days={days}
          onSave={handleSubmit}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      <Modal
        open={!!editingProf}
        onClose={cancelEdit}
        title="Edit Professor"
        className="max-w-2xl"
      >
        {editingProf && (
          <ProfessorForm
            initial={{
              fname: editingProf.fname,
              mname: editingProf.mname ?? "",
              lname: editingProf.lname,
              department: editingProf.department ?? "",
              position: editingProf.position ?? "",
              maxHoursPerDay:
                editingProf.max_hours_per_day != null
                  ? String(editingProf.max_hours_per_day)
                  : "",
              maxHoursPerWeek:
                editingProf.max_hours_per_week != null
                  ? String(editingProf.max_hours_per_week)
                  : "",
              slots: slotsForEmployee(editingProf.employee_id),
            }}
            days={days}
            onSave={saveEdit}
            onCancel={cancelEdit}
          />
        )}
      </Modal>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title="Delete this professor?"
        description={`Are you sure you want to delete ${deleteTarget?.name}?`}
        onConfirm={() => {
          if (deleteTarget) removeProfessor(deleteTarget.employee_id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDeleteDialog
        open={bulkDeleteOpen}
        title={`Delete ${selected.length} selected professor${selected.length !== 1 ? "s" : ""}?`}
        description="Professors who are scheduled in classes or assigned to courses can't be deleted and will stay selected."
        onConfirm={() => {
          setBulkDeleteOpen(false);
          removeSelected();
        }}
        onCancel={() => setBulkDeleteOpen(false)}
      />
      {loading &&
        createPortal(
          <div
            role="status"
            aria-busy="true"
            className="fixed inset-y-0 right-0 left-64 z-[60] flex cursor-wait items-center justify-center bg-gray-200/60"
          >
            <div className="flex items-center gap-3 rounded-lg bg-white px-5 py-3 shadow-md">
              <Loader2 className="h-5 w-5 animate-spin text-gray-700" />
              <span className="text-sm text-gray-700">Loading...</span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
