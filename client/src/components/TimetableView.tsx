import { useState, useEffect, useMemo, useRef } from "react";
import { authFetch } from "../lib/authFetch";
import {
  Filter,
  Users,
  BookOpen,
  DoorOpen,
  Layers,
  GraduationCap,
  FileDown,
  FileSpreadsheet,
  History as HistoryIcon,
  X,
  Loader2,
  ChevronDown,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { Button } from "@/components/ui/button";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";

import * as XLSX from "xlsx";

interface ClassRow {
  class_id: number;
  employee_id: number;
  room_id: number;
  day_id: number;
  schedule_id: number;
  start_time: string;
  end_time: string;
  professor: string;
  room: string;
  section_id: number;
  year_level: string;
  program: string;
  course_code: string;
  course: string;
  day: string;
  academic_year: string;
  school_term: string;
  section_name: string | null;
  code: string | null;
}

interface HistoryRow {
  schedule_id: number;
  year: string;
  term: string;
  status: string;
}

interface DayRow {
  day_id: number;
  name: string;
}

interface AvailabilityRow {
  availability_id: number;
  start_time: string;
  end_time: string;
  day_id: number;
  employee_id: number;
}
interface EmployeeRow {
  employee_id: number;
  lname: string;
  mname: string | null;
  fname: string;
  name: string;
  max_hours_per_day: number | null;
  max_hours_per_week: number | null;
}

interface RoomRow {
  room_id: number;
  room_number: string;
  type?: string;
}
interface VacantSlot {
  day: string;
  day_id: number;
  start_time: string;
  end_time: string;
  room_id: number;
  room_number: string;
}

function timeToStr(hourFloat: number): string {
  const h = Math.floor(hourFloat);
  const m = Math.round((hourFloat - h) * 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function getVacantSlots(
  entry: ClassRow,
  allClasses: ClassRow[],
  allRooms: RoomRow[],
  allDays: DayRow[],
  allAvailability: AvailabilityRow[],
  allEmployees: EmployeeRow[],
): VacantSlot[] {
  const duration =
    timeToHourFloat(entry.end_time) - timeToHourFloat(entry.start_time);
  const currentRoom = allRooms.find((r) => r.room_id === entry.room_id);
  const requiredType = (currentRoom as any)?.type ?? null;
  const candidateRooms = requiredType
    ? allRooms.filter((r) => (r as any).type === requiredType)
    : allRooms;
  const others = allClasses.filter((c) => c.class_id !== entry.class_id);
  const slots: VacantSlot[] = [];
  const entryStart = timeToHourFloat(entry.start_time);
  const EPSILON = 0.01;

  const employee = allEmployees.find(
    (e) => e.employee_id === entry.employee_id,
  );

  const otherClassesForEmployee = others.filter(
    (c) => c.employee_id === entry.employee_id,
  );
  const hoursByDay = new Map<number, number>();
  let weeklyHours = 0;
  for (const c of otherClassesForEmployee) {
    const hrs = timeToHourFloat(c.end_time) - timeToHourFloat(c.start_time);
    hoursByDay.set(c.day_id, (hoursByDay.get(c.day_id) ?? 0) + hrs);
    weeklyHours += hrs;
  }

  for (const day of allDays) {
    for (const room of candidateRooms) {
      for (let start = 7; start + duration <= 20; start += 0.5) {
        const end = start + duration;

        const isCurrentSlot =
          day.day_id === entry.day_id &&
          room.room_id === entry.room_id &&
          Math.abs(start - entryStart) < EPSILON;
        if (isCurrentSlot) continue;

        if (employee) {
          const dayHoursWithoutThis = hoursByDay.get(day.day_id) ?? 0;
          if (
            employee.max_hours_per_day != null &&
            dayHoursWithoutThis + duration > employee.max_hours_per_day
          ) {
            continue;
          }
          if (
            employee.max_hours_per_week != null &&
            weeklyHours + duration > employee.max_hours_per_week
          ) {
            continue;
          }
        }

        const roomConflict = others.some(
          (c) =>
            c.day_id === day.day_id &&
            c.room_id === room.room_id &&
            start < timeToHourFloat(c.end_time) &&
            end > timeToHourFloat(c.start_time),
        );
        if (roomConflict) continue;

        const employeeConflict = others.some(
          (c) =>
            c.day_id === day.day_id &&
            c.employee_id === entry.employee_id &&
            start < timeToHourFloat(c.end_time) &&
            end > timeToHourFloat(c.start_time),
        );
        if (employeeConflict) continue;

        const sectionConflict = others.some(
          (c) =>
            c.day_id === day.day_id &&
            c.section_id === entry.section_id &&
            start < timeToHourFloat(c.end_time) &&
            end > timeToHourFloat(c.start_time),
        );
        if (sectionConflict) continue;

        const isAvailable = allAvailability.some(
          (a) =>
            a.employee_id === entry.employee_id &&
            a.day_id === day.day_id &&
            start >= timeToHourFloat(a.start_time) &&
            end <= timeToHourFloat(a.end_time),
        );
        if (!isAvailable) continue;

        slots.push({
          day: day.name,
          day_id: day.day_id,
          start_time: timeToStr(start),
          end_time: timeToStr(end),
          room_id: room.room_id,
          room_number: room.room_number,
        });
      }
    }
  }
  return slots;
}

const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const HOURS = Array.from({ length: 14 }, (_, i) => i + 7);
const ROW_HEIGHT = 60;

const ENTRY_COLORS = [
  {
    bg: "bg-teal-50",
    border: "border-teal-200",
    accent: "bg-teal-500",
    text: "text-teal-900",
  },
  {
    bg: "bg-blue-50",
    border: "border-blue-200",
    accent: "bg-blue-500",
    text: "text-blue-900",
  },
  {
    bg: "bg-amber-50",
    border: "border-amber-200",
    accent: "bg-amber-500",
    text: "text-amber-900",
  },
  {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    accent: "bg-emerald-500",
    text: "text-emerald-900",
  },
  {
    bg: "bg-rose-50",
    border: "border-rose-200",
    accent: "bg-rose-500",
    text: "text-rose-900",
  },
  {
    bg: "bg-slate-50",
    border: "border-slate-200",
    accent: "bg-slate-500",
    text: "text-slate-900",
  },
];

type FilterType = "all" | "professor" | "room" | "section" | "program";

function timeToHourFloat(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h + (m ?? 0) / 60;
}

function layoutDayClasses(dayClasses: ClassRow[]) {
  const sorted = [...dayClasses].sort(
    (a, b) => timeToHourFloat(a.start_time) - timeToHourFloat(b.start_time),
  );
  type Positioned = ClassRow & { col: number; colCount: number };
  const result: Positioned[] = [];
  let cluster: ClassRow[] = [];
  let clusterEnd = -Infinity;
  const flushCluster = () => {
    if (cluster.length === 0) return;
    cluster.forEach((c, i) =>
      result.push({ ...c, col: i, colCount: cluster.length }),
    );
    cluster = [];
  };
  for (const c of sorted) {
    const start = timeToHourFloat(c.start_time);
    const end = timeToHourFloat(c.end_time);
    if (start >= clusterEnd) {
      flushCluster();
      clusterEnd = end;
    } else {
      clusterEnd = Math.max(clusterEnd, end);
    }
    cluster.push(c);
  }
  flushCluster();
  return result;
}

function formatTime12hr(time: string): string {
  const [hStr, mStr] = time.split(":");
  let h = Number(hStr);
  const m = Number(mStr ?? "0");
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 === 0 ? 12 : h % 12;
  return `${h}:${m.toString().padStart(2, "0")} ${period}`;
}

function formatDuration(startTime: string, endTime: string): string {
  const totalMin = Math.round(
    (timeToHourFloat(endTime) - timeToHourFloat(startTime)) * 60,
  );
  const hrs = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hrs === 0) return `${mins}min`;
  if (mins === 0) return `${hrs}hr`;
  return `${hrs}hr ${mins}min`;
}
function sectionLabel(c: any): string {
  if (!c.code || !c.section_name) return `${c.program} Sec ${c.section_id}`;
  return `${c.code}${c.year_level.charAt(0)}${c.school_term.charAt(0)}${c.section_name}`;
}

const HEAD = [
  "Day",
  "Start Time",
  "End Time",
  "Course",
  "Professor",
  "Room",
  "Section",
];

function toRows(list: ClassRow[]) {
  return [...list]
    .sort((a, b) => {
      const di = DAYS.indexOf(a.day) - DAYS.indexOf(b.day);
      return di !== 0
        ? di
        : timeToHourFloat(a.start_time) - timeToHourFloat(b.start_time);
    })
    .map((c) => [
      c.day,
      formatTime12hr(c.start_time),
      formatTime12hr(c.end_time),
      `${c.course_code} ${c.course}`,
      c.professor,
      c.room,
      sectionLabel(c),
    ]);
}

function exportSheet(
  list: ClassRow[],
  ext: "xlsx" | "xls" | "csv",
  name: string,
) {
  const ws = XLSX.utils.aoa_to_sheet([HEAD, ...toRows(list)]);
  ws["!cols"] = [10, 12, 12, 40, 25, 10, 35].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Timetable");
  XLSX.writeFile(wb, `${name}.${ext}`);
  toast.success(`Timetable exported (${ext.toUpperCase()})`);
}

function exportPdf(list: ClassRow[], name: string) {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "pt",
    format: "a4",
  });
  autoTable(doc, {
    head: [HEAD],
    body: toRows(list),
    startY: 30,
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [0, 61, 165], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 247, 252] },
  });
  doc.save(`${name}.pdf`);
  toast.success("Timetable exported");
}

const PANEL_WIDTH = 340;
const PANEL_MAX_HEIGHT = 480;

const DAY_ABBR: Record<string, string> = {
  Monday: "Mon",
  Tuesday: "Tue",
  Wednesday: "Wed",
  Thursday: "Thu",
  Friday: "Fri",
  Saturday: "Sat",
};

function SearchSelect({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = options.filter((o) =>
    o.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className="relative w-full">
      <button
        type="button"
        onClick={() => {
          setQuery("");
          setOpen((o) => !o);
        }}
        className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
      >
        <span className="truncate">{value}</span>
        <ChevronDown className="ml-2 h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-1 w-full rounded-md border bg-white shadow-lg">
            <div className="border-b p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="h-8 w-full rounded-md border border-input px-2 text-sm"
              />
            </div>
            <div className="max-h-60 overflow-y-auto">
              {shown.map((o) => (
                <button
                  key={o}
                  type="button"
                  onClick={() => {
                    onChange(o);
                    setOpen(false);
                  }}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    o === value
                      ? "bg-yellow-400 font-semibold text-black"
                      : "hover:bg-yellow-100"
                  }`}
                >
                  {o}
                </button>
              ))}
              {shown.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  No matches
                </p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function TimetableView() {
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [allRooms, setAllRooms] = useState<RoomRow[]>([]);
  const [allEmployees, setAllEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<FilterType>("professor");
  const [filterValue, setFilterValue] = useState<string>("");
  const [hoveredClassId, setHoveredClassId] = useState<number | null>(null);
  const [allDays, setAllDays] = useState<DayRow[]>([]);
  const [allAvailability, setAllAvailability] = useState<AvailabilityRow[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<ClassRow | null>(null);
  const [moving, setMoving] = useState(false);
  const [slotDayFilter, setSlotDayFilter] = useState<string>("All Days");
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({
    top: 12,
    left: 12,
  });
  const [highlightedClassId, setHighlightedClassId] = useState<number | null>(
    null,
  );
  const highlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [pendingSlot, setPendingSlot] = useState<VacantSlot | null>(null);
  const calendarWrapperRef = useRef<HTMLDivElement | null>(null);
  const classesRef = useRef<ClassRow[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [exportingId, setExportingId] = useState<number | null>(null);

  const fetchClasses = async (showLoading = true) => {
    if (showLoading) setLoading(true);

    try {
      const [classesRes, roomsRes, employeesRes, daysRes, availabilityRes] =
        await Promise.all([
          fetch("/api/classes"),
          fetch("/api/rooms"),
          fetch("/api/employees"),
          fetch("/api/days"),
          fetch("/api/availability"),
        ]);
      const [
        classesData,
        roomsData,
        employeesData,
        daysData,
        availabilityData,
      ] = await Promise.all([
        classesRes.json(),
        roomsRes.json(),
        employeesRes.json(),
        daysRes.json(),
        availabilityRes.json(),
      ]);
      setClasses(classesData);
      setAllRooms(roomsData);
      setAllEmployees(employeesData);
      setAllDays(daysData);
      setAllAvailability(availabilityData);
    } catch (err) {
      console.error("Failed to fetch timetable data", err);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    try {
      const res = await fetch("/api/timetable-history");
      if (!res.ok) throw new Error();
      setHistory(await res.json());
    } catch {
      toast.error("Failed to load history.");
    }
  };

  const exportHistory = async (h: HistoryRow, kind: "pdf" | "xls" | "xlsx") => {
    setExportingId(h.schedule_id);
    try {
      const res = await fetch(`/api/classes?schedule_id=${h.schedule_id}`);
      if (!res.ok) throw new Error();
      const rows: ClassRow[] = await res.json();
      const name = `sti-sync-${h.year}-${h.term}`.replace(/\s+/g, "-");
      if (kind === "pdf") exportPdf(rows, name);
      else exportSheet(rows, kind, name);
    } catch {
      toast.error("Export failed. Please try again.");
    } finally {
      setExportingId(null);
    }
  };

  const handleMoveClass = async (slot: VacantSlot) => {
    if (!selectedEntry) return;
    setMoving(true);

    const previous = {
      start_time: selectedEntry.start_time,
      end_time: selectedEntry.end_time,
      employee_id: selectedEntry.employee_id,
      room_id: selectedEntry.room_id,
      section_id: selectedEntry.section_id,
      course_code: selectedEntry.course_code,
      day_id: selectedEntry.day_id,
      schedule_id: selectedEntry.schedule_id,
    };
    const classId = selectedEntry.class_id;

    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          start_time: slot.start_time,
          end_time: slot.end_time,
          employee_id: previous.employee_id,
          room_id: slot.room_id,
          section_id: previous.section_id,
          course_code: previous.course_code,
          day_id: slot.day_id,
          schedule_id: previous.schedule_id,
        }),
      });
      if (!res.ok) throw new Error("Move failed");
      const movedCourseCode = previous.course_code;
      setSelectedEntry(null);

      await fetchClasses(false);

      toast.success(
        `${movedCourseCode} moved to ${slot.day} · ${formatTime12hr(
          slot.start_time,
        )}–${formatTime12hr(slot.end_time)} · ${slot.room_number}`,
        {
          duration: 10000,
          action: {
            label: "View",
            onClick: () => goToClass(classId),
          },
          cancel: {
            label: "Undo",
            onClick: () => undoMove(classId, previous),
          },
        },
      );
    } catch (err) {
      console.error("Failed to move class", err);
      toast.error("Failed to move class. Please try again.");
    } finally {
      setMoving(false);
    }
  };
  const undoMove = async (
    classId: number,
    previous: {
      start_time: string;
      end_time: string;
      employee_id: number;
      room_id: number;
      section_id: number;
      course_code: string;
      day_id: number;
      schedule_id: number;
    },
  ) => {
    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(previous),
      });
      if (!res.ok) throw new Error("Undo failed");
      await fetchClasses(false);
      toast.success(`${previous.course_code} move undone`);
    } catch (err) {
      console.error("Failed to undo move", err);
      toast.error("Failed to undo move. Please try again.");
    }
  };

  const goToClass = (classId: number) => {
    const target = classesRef.current.find((c) => c.class_id === classId);
    if (!target) return;

    const isVisible = classMatchesFilter(target, filterType, filterValue);
    if (!isVisible && filterType === "room") {
      setFilterValue(target.room);
    }

    const scrollAndHighlight = () => {
      const el = document.getElementById(`class-${classId}`);
      if (el) {
        el.scrollIntoView({
          behavior: "smooth",
          block: "center",
          inline: "center",
        });
      }
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
      setHighlightedClassId(classId);
      highlightTimeoutRef.current = setTimeout(() => {
        setHighlightedClassId(null);
      }, 3000);
    };

    if (!isVisible) {
      setTimeout(scrollAndHighlight, 60);
    } else {
      scrollAndHighlight();
    }
  };

  const openEntry = (entry: ClassRow, e: React.MouseEvent<HTMLDivElement>) => {
    setSlotDayFilter("All Days");
    setPendingSlot(null);
    setSelectedEntry(entry);

    const container = calendarWrapperRef.current;
    const cell = e.currentTarget;
    if (container && cell) {
      const containerRect = container.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();

      const cellLeft = cellRect.left - containerRect.left;
      const cellRight = cellRect.right - containerRect.left;
      const cellTop = cellRect.top - containerRect.top;

      let left = cellRight + 6;
      if (left + PANEL_WIDTH > containerRect.width) {
        left = cellLeft - PANEL_WIDTH - 6;
      }
      left = Math.max(8, Math.min(left, containerRect.width - PANEL_WIDTH - 8));

      let top = cellTop;
      top = Math.max(
        8,
        Math.min(top, containerRect.height - PANEL_MAX_HEIGHT - 8),
      );

      setPanelPos({ top, left });
    }
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  useEffect(() => {
    classesRef.current = classes;
  }, [classes]);

  useEffect(() => {
    return () => {
      if (highlightTimeoutRef.current) {
        clearTimeout(highlightTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setSelectedEntry(null);
  }, [filterType, filterValue]);

  const courseColorMap = useMemo(() => {
    const map = new Map<string, (typeof ENTRY_COLORS)[0]>();
    const uniqueCourses = Array.from(
      new Set(classes.map((c) => c.course_code)),
    );
    uniqueCourses.forEach((code, i) =>
      map.set(code, ENTRY_COLORS[i % ENTRY_COLORS.length]),
    );
    return map;
  }, [classes]);

  const filterOptions = useMemo(() => {
    const uniq = (arr: string[]) => Array.from(new Set(arr)).sort();
    return {
      professor: uniq(allEmployees.map((e) => e.name)),
      room: uniq(allRooms.map((r) => r.room_number)),
      section: uniq(
        classes.map(
          (c) => `${c.program} · ${c.year_level} · Section ${c.section_id}`,
        ),
      ),
      program: uniq(classes.map((c) => c.program)),
    };
  }, [classes, allRooms, allEmployees]);

  useEffect(() => {
    if (!filterValue && filterOptions[filterType]?.length) {
      setFilterValue(filterOptions[filterType][0]);
    }
  }, [filterType, filterOptions, filterValue]);

  const classMatchesFilter = (
    c: ClassRow,
    type: FilterType,
    value: string,
  ): boolean => {
    if (type === "all") return true;
    if (type === "professor") return c.professor === value;
    if (type === "room") return c.room === value;
    if (type === "program") return c.program === value;
    if (type === "section") {
      return (
        `${c.program} · ${c.year_level} · Section ${c.section_id}` === value
      );
    }
    return true;
  };

  const filteredClasses = useMemo(
    () => classes.filter((c) => classMatchesFilter(c, filterType, filterValue)),
    [classes, filterType, filterValue],
  );

  const positionedByDay = useMemo(() => {
    const map = new Map<string, ReturnType<typeof layoutDayClasses>>();
    for (const day of DAYS) {
      map.set(
        day,
        layoutDayClasses(filteredClasses.filter((c) => c.day === day)),
      );
    }
    return map;
  }, [filteredClasses]);

  const allVacantSlots = useMemo(() => {
    if (!selectedEntry) return [];
    return getVacantSlots(
      selectedEntry,
      classes,
      allRooms,
      allDays,
      allAvailability,
      allEmployees,
    );
  }, [
    selectedEntry,
    classes,
    allRooms,
    allDays,
    allAvailability,
    allEmployees,
  ]);

  const availableSlotDays = useMemo(() => {
    const present = new Set(allVacantSlots.map((s) => s.day));
    return DAYS.filter((d) => present.has(d));
  }, [allVacantSlots]);

  const visibleSlots = useMemo(() => {
    if (slotDayFilter === "All Days") return allVacantSlots;
    return allVacantSlots.filter((s) => s.day === slotDayFilter);
  }, [allVacantSlots, slotDayFilter]);

  const groupedSlots = useMemo(() => {
    const groups: { day: string; slots: VacantSlot[] }[] = [];
    for (const day of DAYS) {
      const daySlots = visibleSlots.filter((s) => s.day === day);
      if (daySlots.length > 0) groups.push({ day, slots: daySlots });
    }
    return groups;
  }, [visibleSlots]);

  const selectedEntryRoomType = useMemo(() => {
    if (!selectedEntry) return null;
    return (
      allRooms.find((r) => r.room_id === selectedEntry.room_id)?.type ?? null
    );
  }, [selectedEntry, allRooms]);

  const isLab = selectedEntryRoomType
    ? selectedEntryRoomType.toLowerCase().includes("lab")
    : false;

  const handleExportSheet = (format: "xlsx" | "csv") =>
    exportSheet(filteredClasses, format, `sti-sync-timetable-${Date.now()}`);

  const handleExportPdf = () =>
    exportPdf(filteredClasses, `sti-sync-timetable-${Date.now()}`);
  const historyDialog = historyOpen && (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      onClick={() => setHistoryOpen(false)}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-6 max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-heading text-lg font-bold">Timetable History</h3>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => setHistoryOpen(false)}
          >
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
        <div className="overflow-y-auto min-h-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Year</th>
                <th>Semester</th>
                <th>Export</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.schedule_id} className="border-b last:border-0">
                  <td className="py-2">{h.year}</td>
                  <td>
                    {h.term}
                    {h.status === "active" ? " (current)" : ""}
                  </td>
                  <td className="py-2">
                    <div className="flex gap-1.5">
                      {(["pdf", "xls", "xlsx"] as const).map((k) => (
                        <Button
                          key={k}
                          variant="outline"
                          size="sm"
                          className="text-xs h-7"
                          disabled={exportingId === h.schedule_id}
                          onClick={() => exportHistory(h, k)}
                        >
                          {k === "pdf" ? "PDF" : k === "xls" ? "Excel" : "XLSX"}
                        </Button>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="py-6 text-center text-muted-foreground"
                  >
                    No generated timetables yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="font-heading text-2xl font-bold">Timetable</h2>
        {createPortal(
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

  if (classes.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-2xl font-bold">Timetable</h2>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 !bg-white hover:!bg-accent"
            onClick={openHistory}
          >
            <HistoryIcon className="w-3.5 h-3.5" />
            History
          </Button>
        </div>
        <div className="glass-card rounded-xl p-12 text-center">
          <p className="text-muted-foreground">
            No schedule generated yet. Go to the Generate tab first.
          </p>
        </div>
        {historyDialog}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="flex items-center justify-between"
      >
        <div>
          <h2 className="font-heading text-2xl font-bold">Timetable</h2>
          <p className="text-muted-foreground text-sm mt-0.5">
            {filteredClasses.length} of {classes.length} classes shown
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 !bg-white hover:!bg-accent"
            onClick={openHistory}
          >
            <HistoryIcon className="w-3.5 h-3.5" />
            History
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 !bg-white hover:!bg-accent"
            onClick={handleExportPdf}
          >
            <FileDown className="w-3.5 h-3.5" />
            Export PDF
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 !bg-white hover:!bg-accent"
            onClick={() => handleExportSheet("xlsx")}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Export Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-xs gap-1.5 !bg-white hover:!bg-accent"
            onClick={() => handleExportSheet("csv")}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Export CSV
          </Button>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.05 }}
        className="glass-card rounded-xl p-4 space-y-3"
      >
        <div className="flex items-center gap-2 mb-1">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Filter View</span>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {(
            [
              {
                type: "professor" as FilterType,
                icon: Users,
                label: "Professor",
              },
              { type: "room" as FilterType, icon: DoorOpen, label: "Room" },
              {
                type: "section" as FilterType,
                icon: BookOpen,
                label: "Section",
              },
              {
                type: "program" as FilterType,
                icon: GraduationCap,
                label: "Program",
              },
            ] as const
          ).map(({ type, icon: Icon, label }) => (
            <Button
              key={type}
              variant={filterType === type ? "default" : "outline"}
              size="sm"
              className="text-xs"
              onClick={() => {
                if (filterType === type) return;
                setFilterType(type);
                setFilterValue(filterOptions[type]?.[0] ?? "");
              }}
            >
              <Icon className="w-3.5 h-3.5 mr-1" /> {label}
            </Button>
          ))}
          {filterType !== "all" && (
            <div className="ml-auto w-64">
              <SearchSelect
                options={filterOptions[filterType]}
                value={filterValue}
                onChange={setFilterValue}
              />
            </div>
          )}
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
        className="relative"
        ref={calendarWrapperRef}
      >
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <div className="min-w-[960px]">
              <div className="grid grid-cols-[80px_repeat(6,1fr)] border-b-2 border-border">
                <div className="p-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground bg-muted/50" />
                {DAYS.map((d) => (
                  <div
                    key={d}
                    className="p-3 text-xs font-bold uppercase tracking-wider text-center bg-muted/50 border-l border-border/50"
                  >
                    {d.slice(0, 3)}
                  </div>
                ))}
              </div>
              <div
                className="grid grid-cols-[80px_repeat(6,1fr)]"
                style={{ height: `${HOURS.length * ROW_HEIGHT}px` }}
              >
                <div className="relative">
                  {HOURS.map((hour, i) => (
                    <div
                      key={hour}
                      className="absolute left-0 right-0 flex items-start justify-end pr-3 pt-2 text-[11px] text-muted-foreground font-medium bg-muted/20 border-b border-border/20"
                      style={{
                        top: `${i * ROW_HEIGHT}px`,
                        height: `${ROW_HEIGHT}px`,
                      }}
                    >
                      {formatTime12hr(`${hour}:00`)}
                    </div>
                  ))}
                </div>
                {DAYS.map((day) => {
                  const positioned = positionedByDay.get(day) ?? [];
                  return (
                    <div
                      key={day}
                      className="relative border-l border-border/20"
                    >
                      {HOURS.map((_, i) => (
                        <div
                          key={i}
                          className="absolute left-0 right-0 border-b border-border/20"
                          style={{
                            top: `${i * ROW_HEIGHT}px`,
                            height: `${ROW_HEIGHT}px`,
                          }}
                        />
                      ))}
                      {positioned.map((entry) => {
                        const startH = timeToHourFloat(entry.start_time);
                        const endH = timeToHourFloat(entry.end_time);
                        const topPx = (startH - HOURS[0]) * ROW_HEIGHT;
                        const heightPx = (endH - startH) * ROW_HEIGHT - 4;

                        const isCompact = heightPx < 60;

                        const isHovered = hoveredClassId === entry.class_id;
                        const isSelected =
                          selectedEntry?.class_id === entry.class_id;
                        const isHighlighted =
                          highlightedClassId === entry.class_id;

                        const isFrontmost = isHovered || isHighlighted;
                        const isStacked = entry.colCount > 1;
                        const cascadeOffset = entry.col * 10;

                        return (
                          <div
                            key={entry.class_id}
                            id={`class-${entry.class_id}`}
                            onMouseEnter={() =>
                              setHoveredClassId(entry.class_id)
                            }
                            onMouseLeave={() => setHoveredClassId(null)}
                            onClick={(e) => openEntry(entry, e)}
                            className={`absolute rounded-lg border border-gray-200 border-l-4 border-l-amber-400 bg-white transition-all duration-200 ease-in-out cursor-pointer ${
                              isSelected
                                ? "ring-2 ring-blue-500 ring-offset-1"
                                : ""
                            } ${
                              isHighlighted
                                ? "ring-4 ring-blue-500 ring-offset-2 overflow-visible z-[100] animate-pulse"
                                : "overflow-hidden shadow-sm"
                            } ${
                              isHovered && !isSelected && !isHighlighted
                                ? "shadow-md scale-[1.02] border-gray-300 z-50"
                                : ""
                            }`}
                            style={{
                              top: `${topPx + 2 + (isStacked && !isFrontmost ? cascadeOffset : 0)}px`,
                              height: `${heightPx}px`,
                              left: `calc(2px + ${isStacked && !isFrontmost ? cascadeOffset : 0}px)`,
                              right: "2px",
                              zIndex: isHighlighted
                                ? 100
                                : isHovered
                                  ? 50
                                  : entry.colCount - entry.col,
                              opacity:
                                isStacked &&
                                !isFrontmost &&
                                (hoveredClassId !== null || isHighlighted)
                                  ? 0.5
                                  : 1,
                            }}
                          >
                            <div className="pl-3 pr-2 py-1.5 h-full flex flex-col justify-center gap-1">
                              <span className="text-[11px] font-bold leading-tight truncate text-slate-900">
                                {entry.course_code}
                              </span>
                              {!isCompact && (
                                <p className="text-[10px] font-medium truncate text-slate-700 leading-tight">
                                  {entry.course}
                                </p>
                              )}
                              {isCompact ? (
                                <p className="text-[10px] font-medium truncate text-slate-600">
                                  {entry.professor}
                                </p>
                              ) : (
                                <>
                                  <p className="text-[9px] text-slate-500 truncate leading-tight">
                                    {entry.program} · Sec {entry.section_id}
                                  </p>
                                  <p className="text-[10px] font-medium truncate text-slate-700">
                                    {entry.professor}
                                  </p>
                                </>
                              )}
                              <p className="text-[9px] text-slate-500 mt-auto truncate leading-tight">
                                {entry.room} ·{" "}
                                {formatTime12hr(entry.start_time)}–
                                {formatTime12hr(entry.end_time)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {selectedEntry && (
          <div
            className="glass-card rounded-xl p-4 space-y-3 absolute z-[60] shadow-2xl border border-border overflow-hidden flex flex-col"
            style={{
              width: PANEL_WIDTH,
              maxHeight: PANEL_MAX_HEIGHT,
              top: panelPos.top,
              left: panelPos.left,
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-heading font-bold text-sm">
                    {selectedEntry.course_code}
                  </span>
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                      isLab
                        ? "bg-purple-600 text-white"
                        : "bg-blue-600 text-white"
                    }`}
                  >
                    {isLab ? "Laboratory" : "Lecture"}
                  </span>
                </div>
                <p className="text-xs font-medium mt-0.5 truncate">
                  {selectedEntry.course}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {selectedEntry.program} · Sec {selectedEntry.section_id} ·{" "}
                  {formatDuration(
                    selectedEntry.start_time,
                    selectedEntry.end_time,
                  )}{" "}
                  · {selectedEntry.professor}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onClick={() => {
                  setSelectedEntry(null);
                  setPendingSlot(null);
                }}
              >
                <X className="w-3.5 h-3.5" />
              </Button>
            </div>

            {!pendingSlot && (
              <>
                <p className="text-[11px] text-muted-foreground pt-1">
                  Select a vacant slot to move this class:
                </p>

                <div className="flex gap-1.5 flex-wrap">
                  <Button
                    variant={
                      slotDayFilter === "All Days" ? "default" : "outline"
                    }
                    size="sm"
                    className="text-[11px] h-6 px-2"
                    onClick={() => setSlotDayFilter("All Days")}
                  >
                    All Days
                  </Button>
                  {availableSlotDays.map((d) => (
                    <Button
                      key={d}
                      variant={slotDayFilter === d ? "default" : "outline"}
                      size="sm"
                      className="text-[11px] h-6 px-2"
                      onClick={() => setSlotDayFilter(d)}
                    >
                      {DAY_ABBR[d] ?? d}
                    </Button>
                  ))}
                </div>
              </>
            )}

            <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pt-1">
              {pendingSlot ? (
                <div className="space-y-3 p-2">
                  <p className="text-xs text-muted-foreground">
                    Move{" "}
                    <span className="font-semibold text-foreground">
                      {selectedEntry.course_code}
                    </span>{" "}
                    to:
                  </p>
                  <div className="rounded-md border border-border px-3 py-2 text-sm">
                    {pendingSlot.day} · {formatTime12hr(pendingSlot.start_time)}
                    –{formatTime12hr(pendingSlot.end_time)} ·{" "}
                    {pendingSlot.room_number}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={moving}
                      onClick={() => {
                        handleMoveClass(pendingSlot);
                        setPendingSlot(null);
                      }}
                    >
                      Confirm Move
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={moving}
                      onClick={() => setPendingSlot(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {groupedSlots.map((group) => (
                    <div key={group.day} className="space-y-1">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {group.day}
                      </p>
                      <div className="space-y-1">
                        {group.slots.map((slot, i) => (
                          <button
                            key={i}
                            disabled={moving}
                            onClick={() => setPendingSlot(slot)}
                            className="w-full text-left text-xs rounded-md px-3 py-2 hover:bg-muted transition-colors flex items-center justify-between border border-transparent hover:border-border"
                          >
                            <span>
                              {formatTime12hr(slot.start_time)}–
                              {formatTime12hr(slot.end_time)}
                            </span>
                            <span className="text-muted-foreground">
                              {slot.room_number}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  {groupedSlots.length === 0 && (
                    <p className="text-xs text-muted-foreground p-2">
                      No vacant slots available.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </motion.div>
      {historyDialog}
    </div>
  );
}
