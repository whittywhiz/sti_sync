import { useMemo, useEffect, useState } from "react";
import {
  Users,
  DoorOpen,
  BookOpen,
  GraduationCap,
  Calendar,
  Clock,
} from "lucide-react";
import { useSchedulingStore } from "@/store/schedulingStore";
import { motion } from "framer-motion";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { authFetch } from "../lib/authFetch";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

interface Employee {
  employee_id: number;
  department: string | null;
  lname: string;
  mname: string | null;
  fname: string;
}

interface Room {
  room_id: number;
  room_number: string;
  capacity: number;
  type: string;
}

interface Availability {
  availability_id: number;
  start_time: string;
  end_time: string;
  day_id: number;
  employee_id: number;
}

interface DayRow {
  day_id: number;
  name: string;
}

interface ClassRow {
  class_id: number;
  start_time: string;
  end_time: string;
  professor: string;
  room: string;
  employee_id?: number;
  room_id?: number;
  day: string;
}

interface Counts {
  programs: number;
  professors: number;
  rooms: number;
  courses: number;
  sections: number;
}

function employeeDisplayName(e: Employee): string {
  return `${e.fname} ${e.mname ? e.mname.charAt(0) + ". " : ""}${e.lname}`;
}

function timeToHourFloat(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h + (m ?? 0) / 60;
}

function formatHour12(h: number): string {
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = Math.floor(h) % 12 === 0 ? 12 : Math.floor(h) % 12;
  return `${hour12}:00 ${period}`;
}

export function DashboardView() {
  const { setActiveTab } = useSchedulingStore();

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [days, setDays] = useState<DayRow[]>([]);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [counts, setCounts] = useState<Counts>({
    programs: 0,
    professors: 0,
    rooms: 0,
    courses: 0,
    sections: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAll = async () => {
      setLoading(true);
      try {
        const [
          employeesRes,
          roomsRes,
          availabilityRes,
          daysRes,
          classesRes,
          programsRes,
          coursesRes,
          sectionsRes,
        ] = await Promise.all([
          fetch("/api/employees"),
          fetch("/api/rooms"),
          fetch("/api/availability"),
          fetch("/api/days"),
          fetch("/api/classes"),
          fetch("/api/programs"),
          fetch("/api/courses"),
          fetch("/api/sections"),
        ]);
        const [
          employeesData,
          roomsData,
          availabilityData,
          daysData,
          classesData,
          programsData,
          coursesData,
          sectionsData,
        ] = await Promise.all([
          employeesRes.json(),
          roomsRes.json(),
          availabilityRes.json(),
          daysRes.json(),
          classesRes.json(),
          programsRes.json(),
          coursesRes.json(),
          sectionsRes.json(),
        ]);
        setEmployees(employeesData);
        setRooms(roomsData);
        setAvailability(availabilityData);
        setDays(daysData);
        setClasses(Array.isArray(classesData) ? classesData : []);
        setCounts({
          programs: programsData.length,
          professors: employeesData.length,
          rooms: roomsData.length,
          courses: coursesData.length,
          sections: sectionsData.length,
        });
      } catch (err) {
        console.error("Failed to fetch dashboard data", err);
        setClasses([]);
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const nowHourFloat = now.getHours() + now.getMinutes() / 60;
  const jsDay = now.getDay();
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const todayName = dayNames[jsDay];
  const isSchoolDay = jsDay >= 1 && jsDay <= 6;

  const timeLabel = now.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  const ongoing = useMemo(() => {
    if (!isSchoolDay || !Array.isArray(classes)) return [];
    return classes.filter((c) => {
      if (c.day !== todayName) return false;
      const start = timeToHourFloat(c.start_time);
      const end = timeToHourFloat(c.end_time);
      return nowHourFloat >= start && nowHourFloat < end;
    });
  }, [classes, todayName, nowHourFloat, isSchoolDay]);

  const occupiedRoomNumbers = new Set(ongoing.map((c) => c.room));
  const vacantRooms = rooms.filter(
    (r) => !occupiedRoomNumbers.has(r.room_number),
  );

  const busyProfessorNames = new Set(ongoing.map((c) => c.professor));

  const todayDayId = days.find((d) => d.name === todayName)?.day_id;

  const availableProfessors = useMemo(() => {
    if (!isSchoolDay || !todayDayId) return [];
    return employees
      .map((e) => {
        const slot = availability.find(
          (a) =>
            a.employee_id === e.employee_id &&
            a.day_id === todayDayId &&
            nowHourFloat >= timeToHourFloat(a.start_time) &&
            nowHourFloat < timeToHourFloat(a.end_time),
        );
        return { e, slot };
      })
      .filter(
        ({ e, slot }) =>
          !!slot && !busyProfessorNames.has(employeeDisplayName(e)),
      );
  }, [
    employees,
    availability,
    todayDayId,
    nowHourFloat,
    isSchoolDay,
    busyProfessorNames,
  ]);

  const stats = [
    {
      label: "Programs",
      value: counts.programs,
      icon: GraduationCap,
      tab: "programs",
    },
    {
      label: "Professors",
      value: counts.professors,
      icon: Users,
      tab: "professors",
    },
    { label: "Rooms", value: counts.rooms, icon: DoorOpen, tab: "rooms" },
    { label: "Courses", value: counts.courses, icon: BookOpen, tab: "courses" },
    {
      label: "Sections",
      value: counts.sections,
      icon: GraduationCap,
      tab: "sections",
    },
    {
      label: "Scheduled Classes",
      value: classes.length,
      icon: Calendar,
      tab: "timetable",
    },
  ];

  if (loading) {
    return (
      <div className="space-y-6">
        <h2 className="font-heading text-2xl font-bold">Dashboard</h2>
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
  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">
            Dashboard
          </h2>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground glass-card rounded-lg px-3 py-2">
          <Clock className="w-4 h-4 text-primary" />
          <span>
            {todayName} ·{" "}
            <strong className="text-foreground">{timeLabel}</strong>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-xl p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-success" />
              <h3 className="font-heading font-semibold">
                Professors Available Now
              </h3>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-md bg-success/10 text-success font-semibold">
              {availableProfessors.length}/{employees.length}
            </span>
          </div>
          {!isSchoolDay ? (
            <p className="text-sm text-muted-foreground">
              No classes scheduled today.
            </p>
          ) : availableProfessors.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No professors available right now.
            </p>
          ) : (
            <div className="border border-border/40 rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Time Duration</TableHead>
                      <TableHead className="text-xs">Name</TableHead>
                      <TableHead className="text-xs">Department</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {availableProfessors.map(({ e, slot }) => (
                      <TableRow key={e.employee_id}>
                        <TableCell className="text-xs font-medium">
                          {slot
                            ? `${formatHour12(timeToHourFloat(slot.start_time))} - ${formatHour12(timeToHourFloat(slot.end_time))}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {employeeDisplayName(e)}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {e.department ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card rounded-xl p-5"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <DoorOpen className="w-4 h-4 text-primary" />
              <h3 className="font-heading font-semibold">Rooms Vacant Now</h3>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-md bg-primary/10 text-primary font-semibold">
              {vacantRooms.length}/{rooms.length}
            </span>
          </div>
          {rooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No rooms registered yet.
            </p>
          ) : vacantRooms.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              All rooms are occupied.
            </p>
          ) : (
            <div className="border border-border/40 rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Room</TableHead>
                      <TableHead className="text-xs">Capacity</TableHead>
                      <TableHead className="text-xs">Type</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {vacantRooms.map((r) => (
                      <TableRow key={r.room_id}>
                        <TableCell className="text-xs font-medium">
                          {r.room_number}
                        </TableCell>
                        <TableCell className="text-xs">{r.capacity}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {r.type}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {stats.map((stat) => (
          <button
            key={stat.label}
            onClick={() => setActiveTab(stat.tab)}
            className="glass-card rounded-xl p-4 text-left hover:ring-2 hover:ring-primary/30 transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-heading font-bold mt-0.5">
                  {stat.value}
                </p>
              </div>
              <stat.icon className="w-5 h-5 text-muted-foreground" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
