import {
  SchedulingInput,
  CurriculumEntry,
  ClassAssignment,
  Candidate,
  EmployeeData,
  DayData,
  AvailabilityData,
  PROGRAM_HOME_LAB_ROOM_NUMBERS,
  STRICT_HOME_LAB_PROGRAM_IDS,
} from "./types";
import { scoreCandidate, hasHardViolations } from "./csp";

export interface SchedulingRequirement {
  section_id: number;
  course_code: string;
  session_number: 1 | 2;
  session_duration_hours: number;
  prefers_lab_room?: boolean;
  preferred_room_numbers?: string[] | undefined;
}

export function buildRequirements(
  input: SchedulingInput,
): SchedulingRequirement[] {
  const requirements: SchedulingRequirement[] = [];
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));

  const SPLIT_EXCLUDED_COURSE_CODES = new Set<string>(["PATHFIT"]);

  for (const section of input.sections) {
    const matchingCourses = input.curriculum.filter(
      (c: CurriculumEntry) =>
        c.program_id === section.program_id &&
        c.year_level === section.year_level,
    );
    for (const curriculumEntry of matchingCourses) {
      const course = courseMap.get(curriculumEntry.course_code);
      const totalHours = Number(course?.total_hours ?? 1.5);

      const courseTypeLabel =
        (course as any)?.course_type_description ??
        (course as any)?.course_type?.course_type_description ??
        "";
      const isLab = String(courseTypeLabel).toLowerCase().includes("lab");
      const homeRoomNumbers = isLab
        ? PROGRAM_HOME_LAB_ROOM_NUMBERS[section.program_id]
        : undefined;

      const isExcludedFromSplitting =
        SPLIT_EXCLUDED_COURSE_CODES.has(curriculumEntry.course_code) ||
        totalHours <= 2;

      if (isExcludedFromSplitting) {
        requirements.push({
          section_id: section.section_id,
          course_code: curriculumEntry.course_code,
          session_number: 1,
          session_duration_hours: Number(totalHours),
          preferred_room_numbers: homeRoomNumbers,
        });
        continue;
      }

      let session1Hours: number;
      let session2Hours: number;

      switch (Math.round(totalHours)) {
        case 3:
          session1Hours = 2;
          session2Hours = 1;
          break;
        case 4:
          session1Hours = 3;
          session2Hours = 1;
          break;
        case 5:
          session1Hours = 3;
          session2Hours = 2;
          break;
        case 6:
          session1Hours = 4;
          session2Hours = 2;
          break;
        default:
          session2Hours = totalHours <= 4 ? 1 : 2;
          session1Hours = totalHours - session2Hours;
      }

      requirements.push({
        section_id: section.section_id,
        course_code: curriculumEntry.course_code,
        session_number: 1,
        session_duration_hours: session1Hours,
        prefers_lab_room: isLab,
        preferred_room_numbers: homeRoomNumbers,
      });

      requirements.push({
        section_id: section.section_id,
        course_code: curriculumEntry.course_code,
        session_number: 2,
        session_duration_hours: session2Hours,
        prefers_lab_room: false,
        preferred_room_numbers: undefined,
      });
    }
  }
  return requirements;
}

function randomFrom<T>(arr: T[]): T {
  const index = Math.floor(Math.random() * arr.length);
  return arr[index]!;
}

function buildEligibleEmployeesByCourse(
  input: SchedulingInput,
): Map<string, EmployeeData[]> {
  const employeeMap = new Map(input.employees.map((e) => [e.employee_id, e]));
  const idsByCourse = new Map<string, number[]>();
  for (const ce of input.course_employees ?? []) {
    if (!idsByCourse.has(ce.course_code)) idsByCourse.set(ce.course_code, []);
    idsByCourse.get(ce.course_code)!.push(ce.employee_id);
  }
  const result = new Map<string, EmployeeData[]>();
  for (const [courseCode, ids] of idsByCourse) {
    const emps = ids
      .map((id) => employeeMap.get(id))
      .filter((e): e is EmployeeData => e !== undefined);
    if (emps.length > 0) result.set(courseCode, emps);
  }
  return result;
}

function restrictToEligible(
  pool: EmployeeData[],
  courseCode: string,
  eligibleByCourse: Map<string, EmployeeData[]>,
): EmployeeData[] {
  const eligible = eligibleByCourse.get(courseCode);
  if (!eligible) return pool;
  const restricted = pool.filter((e) =>
    eligible.some((el) => el.employee_id === e.employee_id),
  );
  return restricted.length > 0 ? restricted : eligible;
}

function buildEmployeesByDay(
  input: SchedulingInput,
): Map<number, EmployeeData[]> {
  const employeeMap = new Map(input.employees.map((e) => [e.employee_id, e]));
  const result = new Map<number, EmployeeData[]>();

  for (const day of input.days) {
    const employeeIdsForDay = new Set(
      input.availability
        .filter((a) => a.day_id === day.day_id)
        .map((a) => a.employee_id),
    );
    const employeesForDay = Array.from(employeeIdsForDay)
      .map((id) => employeeMap.get(id))
      .filter((e): e is EmployeeData => e !== undefined);
    result.set(day.day_id, employeesForDay);
  }

  return result;
}

function pickDayWithAvailableEmployees(
  input: SchedulingInput,
  employeesByDay: Map<number, EmployeeData[]>,
): DayData {
  const daysWithAvailability = input.days.filter(
    (d) => (employeesByDay.get(d.day_id)?.length ?? 0) > 0,
  );
  if (daysWithAvailability.length > 0) {
    return randomFrom(daysWithAvailability);
  }
  return randomFrom(input.days);
}

function pickEmployeeForDay(
  input: SchedulingInput,
  dayId: number,
  employeesByDay: Map<number, EmployeeData[]>,
  eligible?: EmployeeData[],
): EmployeeData {
  const availableEmployees = employeesByDay.get(dayId) ?? [];
  const base =
    availableEmployees.length > 0 ? availableEmployees : input.employees;
  if (!eligible) {
    return randomFrom(base);
  }
  const restricted = base.filter((e) =>
    eligible.some((el) => el.employee_id === e.employee_id),
  );
  return randomFrom(restricted.length > 0 ? restricted : eligible);
}

function buildAvailabilityByEmployeeDay(
  input: SchedulingInput,
): Map<string, AvailabilityData[]> {
  const map = new Map<string, AvailabilityData[]>();
  for (const a of input.availability) {
    const key = `${a.employee_id}-${a.day_id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(a);
  }
  return map;
}

const WORKING_DAY_START_MIN = 7 * 60;
const WORKING_DAY_END_MIN = 20 * 60;
const SLOT_GRANULARITY_MIN = 30;

const EMPLOYEE_ATTEMPT_LIMIT = 6;
const NINE_HOUR_SOFT_LIMIT = 9;
const DAY_ATTEMPT_LIMIT = 8;

const BACKUP_ROOM_NUMBERS = new Set(["gym b", "gym c", "gym d"]);
const isBackupRoom = (r: { room_number: string }) =>
  BACKUP_ROOM_NUMBERS.has(r.room_number.toLowerCase().trim());

function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

const tmCache = new Map<string, number>();
function timeToMinutes(time: string): number {
  let v = tmCache.get(time);
  if (v === undefined) {
    const p = time.split(":").map(Number);
    tmCache.set(time, (v = (p[0] ?? 0) * 60 + (p[1] ?? 0)));
  }
  return v;
}

function timeRangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function pickRandomTimeSlot(durationHours: number): {
  start_time: string;
  end_time: string;
} {
  const durationMin = Math.round(durationHours * 60);
  const latestPossibleStart = WORKING_DAY_END_MIN - durationMin;

  if (latestPossibleStart < WORKING_DAY_START_MIN) {
    return {
      start_time: minutesToTime(WORKING_DAY_START_MIN),
      end_time: minutesToTime(WORKING_DAY_START_MIN + durationMin),
    };
  }

  const slotCount =
    Math.floor(
      (latestPossibleStart - WORKING_DAY_START_MIN) / SLOT_GRANULARITY_MIN,
    ) + 1;
  const randomSlotIndex = Math.floor(Math.random() * slotCount);
  const startMin =
    WORKING_DAY_START_MIN + randomSlotIndex * SLOT_GRANULARITY_MIN;

  return {
    start_time: minutesToTime(startMin),
    end_time: minutesToTime(startMin + durationMin),
  };
}

function pickTimeSlotForEmployeeDay(
  employeeId: number,

  dayId: number,
  durationHours: number,
  availabilityByEmployeeDay: Map<string, AvailabilityData[]>,
): { start_time: string; end_time: string } {
  const durationMin = Math.round(durationHours * 60);
  const windows = availabilityByEmployeeDay.get(`${employeeId}-${dayId}`) ?? [];

  const validStarts: number[] = [];
  for (const w of windows) {
    const windowStart = timeToMinutes(w.start_time);
    const windowEnd = timeToMinutes(w.end_time);
    const latestStart = windowEnd - durationMin;
    for (
      let start = windowStart;
      start <= latestStart;
      start += SLOT_GRANULARITY_MIN
    ) {
      validStarts.push(start);
    }
  }

  if (validStarts.length > 0) {
    const chosenStart = randomFrom(validStarts);
    return {
      start_time: minutesToTime(chosenStart),
      end_time: minutesToTime(chosenStart + durationMin),
    };
  }

  return pickRandomTimeSlot(durationHours);
}

function getConflictFreeStarts(
  employee: EmployeeData,
  windows: AvailabilityData[],
  bookedIntervals: { start: number; end: number }[],
  durationMin: number,
  currentDayHours: number,
  currentWeekHours: number,
): number[] {
  const durationHours = durationMin / 60;

  if (
    employee.max_hours_per_day != null &&
    currentDayHours + durationHours > employee.max_hours_per_day
  ) {
    return [];
  }
  if (
    employee.max_hours_per_week != null &&
    currentWeekHours + durationHours > employee.max_hours_per_week
  ) {
    return [];
  }

  const validStarts: number[] = [];
  for (const w of windows) {
    const windowStart = timeToMinutes(w.start_time);
    const windowEnd = timeToMinutes(w.end_time);
    const latestStart = windowEnd - durationMin;
    for (
      let start = windowStart;
      start <= latestStart;
      start += SLOT_GRANULARITY_MIN
    ) {
      const end = start + durationMin;
      const conflicts = bookedIntervals.some((b) =>
        timeRangesOverlap(start, end, b.start, b.end),
      );
      if (!conflicts) validStarts.push(start);
    }
  }
  return validStarts;
}

type Interval = { start: number; end: number };

function isFree(
  intervals: Interval[] | undefined,
  start: number,
  end: number,
): boolean {
  return !(intervals ?? []).some((b) =>
    timeRangesOverlap(start, end, b.start, b.end),
  );
}

function getOpenStarts(booked: Interval[], durationMin: number): number[] {
  const out: number[] = [];
  for (
    let s = WORKING_DAY_START_MIN;
    s + durationMin <= WORKING_DAY_END_MIN;
    s += SLOT_GRANULARITY_MIN
  ) {
    if (isFree(booked, s, s + durationMin)) out.push(s);
  }
  return out;
}

function addInterval(
  map: Map<string, Interval[]>,
  key: string,
  interval: Interval,
) {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(interval);
}
const COMPUTER_LAB_COURSE_CODES = new Set<string>(["HOSP1019", "STIC1003"]);

function roomPoolForRequirement(
  req: SchedulingRequirement,
  courseType: string,
  input: SchedulingInput,
  sectionProgramId: number,
): SchedulingInput["rooms"] {
  const isLab = courseType === "laboratory";

  if (
    req.session_number === 1 &&
    COMPUTER_LAB_COURSE_CODES.has(req.course_code)
  ) {
    const computerLabs = input.rooms.filter(
      (r) => r.type?.toLowerCase() === "laboratory" && r.program_id == null,
    );
    if (computerLabs.length > 0) return computerLabs;
  }

  const filterReserved = (rooms: SchedulingInput["rooms"]) =>
    rooms.filter((r) =>
      COMPUTER_LAB_COURSE_CODES.has(req.course_code)
        ? r.program_id == null
        : r.program_id == null || r.program_id === sectionProgramId,
    );

  const reservedForSection = input.rooms.filter(
    (r) => r.program_id === sectionProgramId,
  );
  if (
    reservedForSection.length > 0 &&
    (isLab || req.prefers_lab_room) &&
    req.course_code.startsWith("HOSP") &&
    !COMPUTER_LAB_COURSE_CODES.has(req.course_code)
  ) {
    return reservedForSection;
  }
  const labRooms = input.rooms.filter(
    (r) => r.type?.toLowerCase() === "laboratory",
  );

  if (isLab || req.prefers_lab_room) {
    if (req.session_number === 2) {
      const lectureRooms = input.rooms.filter(
        (r) =>
          r.type?.toLowerCase() === "lecture" &&
          (r.program_id == null || r.program_id === sectionProgramId),
      );
      // Lab course session 2 may use lecture or lab rooms
      if (isLab) {
        const pool = Array.from(
          new Map(
            [
              ...lectureRooms,
              ...filterReserved(labRooms).filter(
                (r) =>
                  STRICT_HOME_LAB_PROGRAM_IDS.has(sectionProgramId) ||
                  r.room_number.trim().toLowerCase() !== "lab 2",
              ),
            ].map((r) => [r.room_id, r]),
          ).values(),
        );
        if (pool.length > 0) return pool;
      }
      if (lectureRooms.length > 0) return lectureRooms;
    }
    // Session 1: strict programs (BMMA, BACOMM) may only use their home lab
    const home = PROGRAM_HOME_LAB_ROOM_NUMBERS[sectionProgramId];
    if (home && STRICT_HOME_LAB_PROGRAM_IDS.has(sectionProgramId)) {
      const preferred = filterReserved(labRooms).filter((r) =>
        home.some(
          (n) => r.room_number.toLowerCase().trim() === n.toLowerCase().trim(),
        ),
      );
      if (preferred.length > 0) return preferred;
    }
    // Session 1: Prioritize reserved lab rooms first, but allow all compatible lab rooms so they don't bottleneck
    const prioritizedLabs = [
      ...reservedForSection.filter(
        (r) => r.type?.toLowerCase() === "laboratory",
      ),
      ...filterReserved(labRooms),
    ];
    if (prioritizedLabs.length > 0) {
      return Array.from(
        new Map(prioritizedLabs.map((r) => [r.room_id, r])).values(),
      );
    }
  }

  const matchingTypeRooms = input.rooms.filter(
    (r) => r.type?.toLowerCase() === courseType,
  );
  if (matchingTypeRooms.length > 0) return filterReserved(matchingTypeRooms);
  return filterReserved(input.rooms);
}
const LAB_UTILIZATION_LIMIT = 0.95; // starting guess, tune with real data
export function checkLabCapacity(
  requirements: SchedulingRequirement[],
  input: SchedulingInput,
): string | null {
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));
  const sectionMap = new Map(input.sections.map((s) => [s.section_id, s]));
  const hoursPerRoom =
    (input.days.length * (WORKING_DAY_END_MIN - WORKING_DAY_START_MIN)) / 60;

  const pools = new Map<
    string,
    { rooms: Map<number, string>; hours: number }
  >();
  for (const req of requirements) {
    const type = (
      courseMap.get(req.course_code)?.course_type_description ?? ""
    ).toLowerCase();
    if (type !== "laboratory") continue;
    const pid = sectionMap.get(req.section_id)?.program_id ?? 0;
    const labs = roomPoolForRequirement(req, type, input, pid).filter(
      (r) => r.type?.toLowerCase() === "laboratory",
    );
    // Session 2 can use lecture rooms too, so only session 1 is lab-bound
    if (req.session_number !== 1) continue;
    const key = labs
      .map((r) => r.room_id)
      .sort((a, b) => a - b)
      .join(",");
    if (!pools.has(key))
      pools.set(key, {
        rooms: new Map(labs.map((r) => [r.room_id, r.room_number.trim()])),
        hours: 0,
      });
    pools.get(key)!.hours += req.session_duration_hours;
  }

  const list = [...pools.values()];
  for (let mask = 1; mask < 1 << list.length; mask++) {
    const rooms = new Map<number, string>();
    let need = 0;
    list.forEach((p, i) => {
      if (mask & (1 << i)) {
        p.rooms.forEach((n, id) => rooms.set(id, n));
        need += p.hours;
      }
    });
    const cap = rooms.size * hoursPerRoom;
    const usable = Math.floor(cap * LAB_UTILIZATION_LIMIT);
    if (need > usable)
      return `Laboratory demand ${need}h exceeds usable capacity ${usable}h (${LAB_UTILIZATION_LIMIT * 100}% of ${cap}h) for: ${[...rooms.values()].join(", ") || "no lab room"}. Reduce lab hours or add lab rooms.`;
  }
  return null;
}
const ROOM_UTILIZATION_LIMITS: Record<string, number> = {
  lecture: 0.95,
  pe: 0.85,
};

export function checkRoomCapacity(
  requirements: SchedulingRequirement[],
  input: SchedulingInput,
  type: "lecture" | "pe",
): string | null {
  const limit = ROOM_UTILIZATION_LIMITS[type]!;
  const label = type === "pe" ? "Gym" : "Lecture room";
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));
  const sectionMap = new Map(input.sections.map((s) => [s.section_id, s]));
  const hoursPerRoom =
    (input.days.length * (WORKING_DAY_END_MIN - WORKING_DAY_START_MIN)) / 60;

  const pools = new Map<
    string,
    { rooms: Map<number, string>; hours: number }
  >();
  for (const req of requirements) {
    const courseType = (
      courseMap.get(req.course_code)?.course_type_description ?? ""
    ).toLowerCase();
    if (courseType !== type) continue;
    const pid = sectionMap.get(req.section_id)?.program_id ?? 0;
    const rooms = roomPoolForRequirement(req, courseType, input, pid).filter(
      (r) => r.type?.toLowerCase() === type,
    );
    const key = rooms
      .map((r) => r.room_id)
      .sort((a, b) => a - b)
      .join(",");
    if (!pools.has(key))
      pools.set(key, {
        rooms: new Map(rooms.map((r) => [r.room_id, r.room_number.trim()])),
        hours: 0,
      });
    pools.get(key)!.hours += req.session_duration_hours;
  }

  const list = [...pools.values()];
  for (let mask = 1; mask < 1 << list.length; mask++) {
    const rooms = new Map<number, string>();
    let need = 0;
    list.forEach((p, i) => {
      if (mask & (1 << i)) {
        p.rooms.forEach((n, id) => rooms.set(id, n));
        need += p.hours;
      }
    });
    const cap = rooms.size * hoursPerRoom;
    const usable = Math.floor(cap * limit);
    if (need > usable)
      return `${label} demand ${need}h exceeds usable capacity ${usable}h (${limit * 100}% of ${cap}h) for: ${[...rooms.values()].join(", ") || "no " + label.toLowerCase()}. Reduce course hours or add rooms.`;
  }
  return null;
}
function findFreeSlot(
  roomPool: SchedulingInput["rooms"],
  sectionId: number,
  durationMin: number,
  days: DayData[],
  avoidDayId: number | undefined,
  byRoom: Map<string, Interval[]>,
  bySection: Map<string, Interval[]>,
) {
  const order = shuffle(days).sort(
    (a, b) => Number(a.day_id === avoidDayId) - Number(b.day_id === avoidDayId),
  );
  for (const day of order) {
    const secBooked = bySection.get(`${sectionId}-${day.day_id}`) ?? [];
    for (const start of shuffle(getOpenStarts(secBooked, durationMin))) {
      const room = roomPool.find((r) =>
        isFree(
          byRoom.get(`${r.room_id}-${day.day_id}`),
          start,
          start + durationMin,
        ),
      );
      if (room) return { day, start, room };
    }
  }
  return null;
}
function pickRoomForSection(
  rooms: SchedulingInput["rooms"],
  students: number,
): SchedulingInput["rooms"][number] {
  const fitting = rooms.filter((r) => r.capacity >= students);
  if (fitting.length > 0) {
    const primary = fitting.filter((r) => !isBackupRoom(r));
    return randomFrom(primary.length > 0 ? primary : fitting);
  }
  return rooms.reduce((a, b) => (b.capacity > a.capacity ? b : a));
}

export function generateRandomCandidate(
  requirements: SchedulingRequirement[],
  input: SchedulingInput,
): ClassAssignment[] {
  const sectionMap = new Map(input.sections.map((s) => [s.section_id, s]));
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));
  const employeesByDay = buildEmployeesByDay(input);
  const availabilityByEmployeeDay = buildAvailabilityByEmployeeDay(input);
  const eligibleByCourse = buildEligibleEmployeesByCourse(input);

  const bookedIntervalsByEmployeeDay = new Map<string, Interval[]>();
  const bookedIntervalsBySectionDay = new Map<string, Interval[]>();
  const bookedIntervalsByRoomDay = new Map<string, Interval[]>();
  const hoursByEmployeeDay = new Map<string, number>();
  const hoursByEmployeeWeek = new Map<number, number>();

  const assignments: ClassAssignment[] = [];

  const isLabSession1 = (r: SchedulingRequirement) =>
    (
      courseMap.get(r.course_code)?.course_type_description ?? ""
    ).toLowerCase() === "laboratory" && r.session_number === 1;

  const isStrictLab = (r: SchedulingRequirement) =>
    isLabSession1(r) &&
    STRICT_HOME_LAB_PROGRAM_IDS.has(
      sectionMap.get(r.section_id)?.program_id ?? 0,
    );
  const ordered = [...requirements].sort(
    (a, b) =>
      Number(isStrictLab(b)) - Number(isStrictLab(a)) ||
      Number(isLabSession1(b)) - Number(isLabSession1(a)) ||
      b.session_duration_hours - a.session_duration_hours ||
      Number(!!b.prefers_lab_room) - Number(!!a.prefers_lab_room),
  );
  const usedDaysBySectionCourse = new Map<string, number>();
  for (const req of ordered) {
    const course = courseMap.get(req.course_code);
    const courseType = (course?.course_type_description ?? "").toLowerCase();
    const scKey = `${req.section_id}-${req.course_code}`;
    const usedDay = usedDaysBySectionCourse.get(scKey);
    const section = sectionMap.get(req.section_id);
    const roomPool = roomPoolForRequirement(
      req,
      courseType,
      input,
      section?.program_id ?? 0,
    );

    const durationHours =
      req.session_duration_hours ?? course?.total_hours ?? 1.5;
    const durationMin = Math.round(durationHours * 60);
    const unassigned = !eligibleByCourse.has(req.course_code);
    let chosenDay: DayData | null = null;
    let chosenEmployee: EmployeeData | null = null;
    let chosenStart: number | null = null;
    let labRoom: SchedulingInput["rooms"][number] | null = null;
    if (courseType === "laboratory" && req.session_number === 1) {
      type Room = SchedulingInput["rooms"][number];
      const homeNums = PROGRAM_HOME_LAB_ROOM_NUMBERS[section?.program_id ?? 0];
      const isHome = (r: Room) =>
        !!homeNums?.some(
          (n) => n.toLowerCase().trim() === r.room_number.toLowerCase().trim(),
        );
      const labs = roomPool.filter(
        (r) => r.type?.toLowerCase() === "laboratory",
      );
      const options: { day: DayData; start: number; room: Room }[] = [];
      for (const day of input.days) {
        const secBooked =
          bookedIntervalsBySectionDay.get(`${req.section_id}-${day.day_id}`) ??
          [];
        for (const start of getOpenStarts(secBooked, durationMin)) {
          for (const room of labs) {
            const roomBooked = bookedIntervalsByRoomDay.get(
              `${room.room_id}-${day.day_id}`,
            );
            if (isFree(roomBooked, start, start + durationMin))
              options.push({ day, start, room });
          }
        }
      }
      const homeOpts = options.filter((o) => isHome(o.room));
      const cands =
        homeOpts.length > 0
          ? [...homeOpts, ...options.filter((o) => !isHome(o.room))]
          : options;

      const eligible = eligibleByCourse.get(req.course_code);
      let found = false;

      search: for (const o of cands) {
        for (const emp of eligible ?? []) {
          const key = `${emp.employee_id}-${o.day.day_id}`;
          const starts = getConflictFreeStarts(
            emp,
            availabilityByEmployeeDay.get(key) ?? [],
            bookedIntervalsByEmployeeDay.get(key) ?? [],
            durationMin,
            hoursByEmployeeDay.get(key) ?? 0,
            hoursByEmployeeWeek.get(emp.employee_id) ?? 0,
          );
          if (starts.includes(o.start)) {
            chosenDay = o.day;
            chosenStart = o.start;
            chosenEmployee = emp;
            labRoom = o.room;
            found = true;
            break search;
          }
        }
      }
      if (!found && cands.length > 0) {
        const o = cands[0]!;
        chosenDay = o.day;
        chosenStart = o.start;
        labRoom = o.room;
      }
    }

    dayAttempts: for (
      let dAttempt = 0;
      dAttempt < DAY_ATTEMPT_LIMIT && chosenDay === null;
      dAttempt++
    ) {
      const availableDays = usedDay
        ? { ...input, days: input.days.filter((d) => d.day_id !== usedDay) }
        : input;
      const day = pickDayWithAvailableEmployees(availableDays, employeesByDay);
      const candidatesForDay = employeesByDay.get(day.day_id) ?? [];
      const basePool =
        candidatesForDay.length > 0 ? candidatesForDay : input.employees;
      const pool = restrictToEligible(
        basePool,
        req.course_code,
        eligibleByCourse,
      );
      const sectionBooked =
        bookedIntervalsBySectionDay.get(`${req.section_id}-${day.day_id}`) ??
        [];
      if (unassigned) {
        const starts = getOpenStarts(sectionBooked, durationMin).filter(
          (start) =>
            roomPool.some((r) =>
              isFree(
                bookedIntervalsByRoomDay.get(`${r.room_id}-${day.day_id}`),
                start,
                start + durationMin,
              ),
            ),
        );
        if (starts.length > 0) {
          chosenDay = day;
          chosenStart = randomFrom(starts);
          break dayAttempts;
        }
        continue;
      }
      for (let eAttempt = 0; eAttempt < EMPLOYEE_ATTEMPT_LIMIT; eAttempt++) {
        const employee = randomFrom(pool);
        const key = `${employee.employee_id}-${day.day_id}`;
        const windows = availabilityByEmployeeDay.get(key) ?? [];
        const booked = bookedIntervalsByEmployeeDay.get(key) ?? [];
        const dayHours = hoursByEmployeeDay.get(key) ?? 0;
        const weekHours = hoursByEmployeeWeek.get(employee.employee_id) ?? 0;

        if (
          dayHours + durationMin / 60 > NINE_HOUR_SOFT_LIMIT &&
          eAttempt < EMPLOYEE_ATTEMPT_LIMIT - 1
        )
          continue;

        const validStarts = getConflictFreeStarts(
          employee,
          windows,
          [...booked, ...sectionBooked],
          durationMin,
          dayHours,
          weekHours,
        ).filter((start) =>
          roomPool.some((r) =>
            isFree(
              bookedIntervalsByRoomDay.get(`${r.room_id}-${day.day_id}`),
              start,
              start + durationMin,
            ),
          ),
        );

        if (validStarts.length > 0) {
          chosenDay = day;
          chosenEmployee = employee;
          chosenStart = randomFrom(validStarts);
          break dayAttempts;
        }
      }
    }

    if (!unassigned && chosenEmployee === null && labRoom === null) {
      const eligible = restrictToEligible(
        input.employees,
        req.course_code,
        eligibleByCourse,
      );
      outer: for (const day of shuffle(input.days).filter(
        (d) => d.day_id !== usedDay,
      )) {
        const secBooked =
          bookedIntervalsBySectionDay.get(`${req.section_id}-${day.day_id}`) ??
          [];
        for (const emp of shuffle(eligible)) {
          const key = `${emp.employee_id}-${day.day_id}`;
          const dayH = hoursByEmployeeDay.get(key) ?? 0;
          if (dayH + durationMin / 60 > NINE_HOUR_SOFT_LIMIT) continue;
          const starts = getConflictFreeStarts(
            emp,
            availabilityByEmployeeDay.get(key) ?? [],
            [...(bookedIntervalsByEmployeeDay.get(key) ?? []), ...secBooked],
            durationMin,
            dayH,
            hoursByEmployeeWeek.get(emp.employee_id) ?? 0,
          ).filter((s) =>
            roomPool.some((r) =>
              isFree(
                bookedIntervalsByRoomDay.get(`${r.room_id}-${day.day_id}`),
                s,
                s + durationMin,
              ),
            ),
          );
          if (starts.length > 0) {
            chosenDay = day;
            chosenEmployee = emp;
            chosenStart = randomFrom(starts);
            break outer;
          }
        }
      }
    }
    if (
      chosenDay === null ||
      chosenStart === null ||
      (labRoom === null && !unassigned && chosenEmployee === null)
    ) {
      const slot = findFreeSlot(
        roomPool,
        req.section_id,
        durationMin,
        input.days,
        usedDay,
        bookedIntervalsByRoomDay,
        bookedIntervalsBySectionDay,
      );
      if (slot) {
        chosenDay = slot.day;
        chosenStart = slot.start;
        chosenEmployee = null;
        labRoom = slot.room;
      } else {
        type Room = SchedulingInput["rooms"][number];
        let best: {
          day: DayData;
          start: number;
          room: Room;
          score: number;
        } | null = null;
        for (const day of input.days) {
          const secBooked =
            bookedIntervalsBySectionDay.get(
              `${req.section_id}-${day.day_id}`,
            ) ?? [];
          for (
            let s = WORKING_DAY_START_MIN;
            s + durationMin <= WORKING_DAY_END_MIN;
            s += SLOT_GRANULARITY_MIN
          ) {
            const secClash = secBooked.filter((b) =>
              timeRangesOverlap(s, s + durationMin, b.start, b.end),
            ).length;
            for (const r of roomPool) {
              const roomClash = (
                bookedIntervalsByRoomDay.get(`${r.room_id}-${day.day_id}`) ?? []
              ).filter((b) =>
                timeRangesOverlap(s, s + durationMin, b.start, b.end),
              ).length;
              const score =
                secClash * 2 + roomClash + (day.day_id === usedDay ? 3 : 0);
              if (best === null || score < best.score) {
                best = { day, start: s, room: r, score };
              }
            }
          }
        }
        if (best !== null) {
          chosenDay = best.day;
          chosenStart = best.start;
          chosenEmployee = null;
          labRoom = best.room;
        } else {
          chosenDay = randomFrom(input.days);
          chosenEmployee = null;
          chosenStart = WORKING_DAY_START_MIN;
        }
      }
    }
    const dayId = chosenDay.day_id;
    const employeeId = chosenEmployee?.employee_id ?? null;
    const startMin = chosenStart;
    const endMin = startMin + durationMin;

    const freeRooms = roomPool.filter((r) =>
      isFree(
        bookedIntervalsByRoomDay.get(`${r.room_id}-${dayId}`),
        startMin,
        endMin,
      ),
    );
    const freeLabRooms = freeRooms.filter(
      (r) => r.type?.toLowerCase() === "laboratory",
    );
    const home =
      req.session_number === 1
        ? PROGRAM_HOME_LAB_ROOM_NUMBERS[section?.program_id ?? 0]
        : undefined;
    const freeHomeLabs = home
      ? freeLabRooms.filter((r) =>
          home.some(
            (n) =>
              r.room_number.toLowerCase().trim() === n.toLowerCase().trim(),
          ),
        )
      : [];
    const isMandatoryLabSession =
      courseType === "laboratory" && req.session_number === 1;

    const isLabSession2 =
      courseType === "laboratory" && req.session_number === 2;
    const roomsToPickFrom = isLabSession2
      ? freeRooms.length > 0
        ? freeRooms
        : roomPool
      : isMandatoryLabSession
        ? freeHomeLabs.length > 0
          ? freeHomeLabs
          : freeLabRooms.length > 0
            ? freeLabRooms
            : roomPool.filter((r) => r.type?.toLowerCase() === "laboratory")
        : freeHomeLabs.length > 0
          ? freeHomeLabs
          : freeLabRooms.length > 0
            ? freeLabRooms
            : freeRooms.length > 0
              ? freeRooms
              : roomPool;

    const room =
      labRoom ??
      pickRoomForSection(
        roomsToPickFrom,
        sectionMap.get(req.section_id)?.number_of_students ?? 0,
      );
    const interval = { start: startMin, end: endMin };
    if (employeeId !== null) {
      const empKey = `${employeeId}-${dayId}`;
      addInterval(bookedIntervalsByEmployeeDay, empKey, interval);
      hoursByEmployeeDay.set(
        empKey,
        (hoursByEmployeeDay.get(empKey) ?? 0) + durationMin / 60,
      );
      hoursByEmployeeWeek.set(
        employeeId,
        (hoursByEmployeeWeek.get(employeeId) ?? 0) + durationMin / 60,
      );
    }
    addInterval(
      bookedIntervalsBySectionDay,
      `${req.section_id}-${dayId}`,
      interval,
    );
    addInterval(bookedIntervalsByRoomDay, `${room.room_id}-${dayId}`, interval);
    assignments.push({
      course_code: req.course_code,
      section_id: req.section_id,
      employee_id: employeeId,
      room_id: room.room_id,
      day_id: dayId,
      start_time: minutesToTime(startMin),
      end_time: minutesToTime(endMin),
      session_number: req.session_number,
      session_duration_hours: req.session_duration_hours,
    });
    if (!usedDaysBySectionCourse.has(scKey)) {
      usedDaysBySectionCourse.set(scKey, dayId);
    }
  }

  return assignments;
}

export function initializePopulation(
  populationSize: number,
  requirements: SchedulingRequirement[],
  input: SchedulingInput,
): Candidate[] {
  const population: Candidate[] = [];

  for (let i = 0; i < populationSize; i++) {
    const assignments = generateRandomCandidate(requirements, input);
    const candidate: Candidate = { assignments, fitness: 0 };
    scoreCandidate(candidate, input);
    population.push(candidate);
  }

  return population;
}

const TOURNAMENT_SIZE = 3;
export function tournamentSelect(population: Candidate[]): Candidate {
  let best: Candidate | null = null;

  for (let i = 0; i < TOURNAMENT_SIZE; i++) {
    const contender = randomFrom(population);
    if (best === null || contender.fitness < best.fitness) {
      best = contender;
    }
  }

  return best!;
}

export function crossover(
  parentA: Candidate,
  parentB: Candidate,
  input: SchedulingInput,
): Candidate {
  const childAssignments: ClassAssignment[] = parentA.assignments.map(
    (assignmentFromA, index) => {
      const assignmentFromB = parentB.assignments[index]!;
      return Math.random() < 0.5 ? assignmentFromA : assignmentFromB;
    },
  );

  const child: Candidate = { assignments: childAssignments, fitness: 0 };
  scoreCandidate(child, input);
  return child;
}

const MUTATION_RATE = 0.015;
const ELITE_COUNT = 3;
const CROSSOVER_RATE = 0.1;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

const ctxCache = new WeakMap<SchedulingInput, ReturnType<typeof buildCtx>>();
function buildCtx(input: SchedulingInput) {
  return {
    courseMap: new Map(input.courses.map((c) => [c.course_code, c])),
    sectionMap: new Map(input.sections.map((s) => [s.section_id, s])),
    employeeMap: new Map(input.employees.map((e) => [e.employee_id, e])),
    employeesByDay: buildEmployeesByDay(input),
    availabilityByEmployeeDay: buildAvailabilityByEmployeeDay(input),
    eligibleByCourse: buildEligibleEmployeesByCourse(input),
  };
}
function getCtx(input: SchedulingInput) {
  let c = ctxCache.get(input);
  if (!c) ctxCache.set(input, (c = buildCtx(input)));
  return c;
}

export function mutate(
  candidate: Candidate,
  input: SchedulingInput,
): Candidate {
  const {
    courseMap,
    sectionMap,
    employeeMap,
    employeesByDay,
    availabilityByEmployeeDay,
    eligibleByCourse,
  } = getCtx(input);

  const original = candidate.assignments;
  type B = { idx: number; start: number; end: number };
  const byEmpDay = new Map<string, B[]>();
  const bySecDay = new Map<string, B[]>();
  const byRoomDay = new Map<string, B[]>();
  const byCourse = new Map<string, B[]>(); // value: idx only, `start` holds day_id
  const empWeek = new Map<number, number>();
  const push = (m: Map<string, B[]>, k: string, b: B) => {
    const l = m.get(k);
    l ? l.push(b) : m.set(k, [b]);
  };
  const mins = original.map((a, i) => {
    const b = {
      idx: i,
      start: timeToMinutes(a.start_time),
      end: timeToMinutes(a.end_time),
    };
    if (a.employee_id !== null) {
      push(byEmpDay, `${a.employee_id}-${a.day_id}`, b);
      empWeek.set(
        a.employee_id,
        (empWeek.get(a.employee_id) ?? 0) + (b.end - b.start) / 60,
      );
    }
    push(bySecDay, `${a.section_id}-${a.day_id}`, b);
    push(byRoomDay, `${a.room_id}-${a.day_id}`, b);
    push(byCourse, `${a.section_id}|${a.course_code}`, {
      idx: i,
      start: a.day_id,
      end: 0,
    });
    return b;
  });

  function getSiblingBookings(employeeId: number, dayId: number, ex: number) {
    const intervals = (byEmpDay.get(`${employeeId}-${dayId}`) ?? []).filter(
      (b) => b.idx !== ex,
    );
    const dayHours = intervals.reduce((s, b) => s + (b.end - b.start) / 60, 0);
    let weekHours = empWeek.get(employeeId) ?? 0;
    if (original[ex]!.employee_id === employeeId)
      weekHours -= (mins[ex]!.end - mins[ex]!.start) / 60;
    return { intervals, dayHours, weekHours };
  }

  function getOtherIntervals(
    dayId: number,
    ex: number,
    kind: "sec" | "room",
  ): Interval[] {
    const self = original[ex]!;
    const list =
      kind === "sec"
        ? bySecDay.get(`${self.section_id}-${dayId}`)
        : byRoomDay.get(`${self.room_id}-${dayId}`);
    return (list ?? []).filter((b) => b.idx !== ex);
  }

  const roomFree = (
    roomId: number,
    dayId: number,
    s: number,
    e: number,
    ex: number,
  ) =>
    !(byRoomDay.get(`${roomId}-${dayId}`) ?? []).some(
      (b) => b.idx !== ex && timeRangesOverlap(s, e, b.start, b.end),
    );

  const siblingDayOf = (ex: number) =>
    (
      byCourse.get(
        `${original[ex]!.section_id}|${original[ex]!.course_code}`,
      ) ?? []
    ).find((b) => b.idx !== ex)?.start;
  const mutatedAssignments: ClassAssignment[] = original.map(
    (assignment, index) => {
      if (Math.random() > MUTATION_RATE) {
        return assignment;
      }

      const sameSection = "sec" as const;
      const sameRoom = "room" as const;

      const mutationChoice = Math.floor(Math.random() * 4);
      if (assignment.employee_id === null) {
        const course = courseMap.get(assignment.course_code);
        const section = sectionMap.get(assignment.section_id);
        const courseType = (
          course?.course_type_description ?? ""
        ).toLowerCase();
        const isLab = courseType === "laboratory";
        const roomPool = roomPoolForRequirement(
          {
            section_id: assignment.section_id,
            course_code: assignment.course_code,
            session_number: assignment.session_number,
            session_duration_hours: assignment.session_duration_hours,
            prefers_lab_room: isLab && assignment.session_number === 1,
          },
          courseType,
          input,
          section?.program_id ?? 0,
        );
        const durationHours =
          assignment.session_duration_hours ?? course?.total_hours ?? 1.5;
        const durationMin = Math.round(durationHours * 60);

        const eligibleForNull = eligibleByCourse.get(assignment.course_code);
        if (eligibleForNull && Math.random() < 0.5) {
          const emp = randomFrom(eligibleForNull);
          const key = `${emp.employee_id}-${assignment.day_id}`;
          const empBooked = byEmpDay.get(key) ?? [];
          const dayHours = empBooked.reduce(
            (s, b) => s + (b.end - b.start) / 60,
            0,
          );
          if (dayHours + durationMin / 60 <= NINE_HOUR_SOFT_LIMIT) {
            const starts = getConflictFreeStarts(
              emp,
              availabilityByEmployeeDay.get(key) ?? [],
              [
                ...empBooked,
                ...getOtherIntervals(assignment.day_id, index, sameSection),
                ...getOtherIntervals(assignment.day_id, index, sameRoom),
              ],
              durationMin,
              dayHours,
              empWeek.get(emp.employee_id) ?? 0,
            );
            if (starts.length > 0) {
              const ns = randomFrom(starts);
              return {
                ...assignment,
                employee_id: emp.employee_id,
                start_time: minutesToTime(ns),
                end_time: minutesToTime(ns + durationMin),
              };
            }
          }
        }

        switch (mutationChoice) {
          case 0: {
            const freeRooms = roomPool.filter((r) =>
              roomFree(
                r.room_id,
                assignment.day_id,
                mins[index]!.start,
                mins[index]!.end,
                index,
              ),
            );
            if (freeRooms.length === 0) return assignment;
            const newRoom = pickRoomForSection(
              freeRooms,
              section?.number_of_students ?? 0,
            );
            return { ...assignment, room_id: newRoom.room_id };
          }
          case 1: {
            const sectionIntervals = getOtherIntervals(
              assignment.day_id,
              index,
              sameSection,
            );
            const openStarts = getOpenStarts(
              sectionIntervals,
              durationMin,
            ).filter((start) =>
              roomFree(
                assignment.room_id,
                assignment.day_id,
                start,
                start + durationMin,
                index,
              ),
            );
            if (openStarts.length > 0) {
              const newStart = randomFrom(openStarts);
              return {
                ...assignment,
                start_time: minutesToTime(newStart),
                end_time: minutesToTime(newStart + durationMin),
              };
            }
            return assignment;
          }
          case 2:
          default: {
            const siblingDay = siblingDayOf(index);
            const availableDays = siblingDay
              ? input.days.filter((d) => d.day_id !== siblingDay)
              : input.days;
            const candidateDays =
              availableDays.length > 0 ? availableDays : input.days;

            for (let attempt = 0; attempt < DAY_ATTEMPT_LIMIT; attempt++) {
              const d = randomFrom(candidateDays);
              const sectionIntervals = getOtherIntervals(
                d.day_id,
                index,
                sameSection,
              );
              const openStarts = getOpenStarts(sectionIntervals, durationMin);
              if (openStarts.length === 0) continue;

              const shuffledStarts = shuffle(openStarts);
              for (const start of shuffledStarts) {
                const freeRooms = roomPool.filter((r) =>
                  roomFree(
                    r.room_id,
                    d.day_id,
                    start,
                    start + durationMin,
                    index,
                  ),
                );
                if (freeRooms.length > 0) {
                  const newRoom = pickRoomForSection(
                    freeRooms,
                    section?.number_of_students ?? 0,
                  );
                  return {
                    ...assignment,
                    day_id: d.day_id,
                    room_id: newRoom.room_id,
                    start_time: minutesToTime(start),
                    end_time: minutesToTime(start + durationMin),
                  };
                }
              }
            }
            return assignment;
          }
        }
      }
      switch (mutationChoice) {
        case 0: {
          const course = courseMap.get(assignment.course_code);
          const section = sectionMap.get(assignment.section_id);
          const courseType = (
            course?.course_type_description ?? ""
          ).toLowerCase();
          const isLab = courseType === "laboratory";
          //
          const roomPool = roomPoolForRequirement(
            {
              section_id: assignment.section_id,
              course_code: assignment.course_code,
              session_number: assignment.session_number,
              session_duration_hours: assignment.session_duration_hours,
              prefers_lab_room: isLab && assignment.session_number === 1,
            },
            courseType,
            input,
            section?.program_id ?? 0,
          );

          const freeRooms = roomPool.filter((r) =>
            roomFree(
              r.room_id,
              assignment.day_id,
              mins[index]!.start,
              mins[index]!.end,
              index,
            ),
          );
          if (freeRooms.length === 0) return assignment;
          const newRoom = pickRoomForSection(
            freeRooms,
            section?.number_of_students ?? 0,
          );
          return { ...assignment, room_id: newRoom.room_id };
        }
        case 1: {
          const course = courseMap.get(assignment.course_code);
          const durationHours =
            assignment.session_duration_hours ?? course?.total_hours ?? 1.5;
          const durationMin = Math.round(durationHours * 60);
          const candidatesForDay = employeesByDay.get(assignment.day_id) ?? [];
          const basePool =
            candidatesForDay.length > 0 ? candidatesForDay : input.employees;
          const pool = restrictToEligible(
            basePool,
            assignment.course_code,
            eligibleByCourse,
          );
          const sectionIntervals = getOtherIntervals(
            assignment.day_id,
            index,
            sameSection,
          );
          const roomIntervals = getOtherIntervals(
            assignment.day_id,
            index,
            sameRoom,
          );

          let newEmployee: EmployeeData | null = null;
          let newStart: number | null = null;
          for (let attempt = 0; attempt < EMPLOYEE_ATTEMPT_LIMIT; attempt++) {
            const candidateEmployee = randomFrom(pool);
            const key = `${candidateEmployee.employee_id}-${assignment.day_id}`;
            const windows = availabilityByEmployeeDay.get(key) ?? [];
            const { intervals, dayHours, weekHours } = getSiblingBookings(
              candidateEmployee.employee_id,
              assignment.day_id,
              index,
            );
            if (
              dayHours + durationMin / 60 > NINE_HOUR_SOFT_LIMIT &&
              attempt < EMPLOYEE_ATTEMPT_LIMIT - 1
            )
              continue;
            const validStarts = getConflictFreeStarts(
              candidateEmployee,
              windows,
              [...intervals, ...sectionIntervals, ...roomIntervals],
              durationMin,
              dayHours,
              weekHours,
            );
            if (validStarts.length > 0) {
              newEmployee = candidateEmployee;
              newStart = randomFrom(validStarts);
              break;
            }
          }

          if (newEmployee === null || newStart === null) return assignment;
          const newEnd = newStart + durationMin;
          return {
            ...assignment,
            employee_id: newEmployee.employee_id,
            start_time: minutesToTime(newStart),
            end_time: minutesToTime(newEnd),
          };
        }
        case 2: {
          const course = courseMap.get(assignment.course_code);
          const durationHours =
            assignment.session_duration_hours ?? course?.total_hours ?? 1.5;
          const durationMin = Math.round(durationHours * 60);

          let newDay: DayData | null = null;
          let newEmployee: EmployeeData | null = null;
          let newStart: number | null = null;

          dayAttempts: for (
            let dAttempt = 0;
            dAttempt < DAY_ATTEMPT_LIMIT;
            dAttempt++
          ) {
            const siblingDay = siblingDayOf(index);
            const availableDays = siblingDay
              ? {
                  ...input,
                  days: input.days.filter((d) => d.day_id !== siblingDay),
                }
              : input;
            const day = pickDayWithAvailableEmployees(
              availableDays,
              employeesByDay,
            );
            const candidatesForDay = employeesByDay.get(day.day_id) ?? [];
            const basePool =
              candidatesForDay.length > 0 ? candidatesForDay : input.employees;
            const pool = restrictToEligible(
              basePool,
              assignment.course_code,
              eligibleByCourse,
            );
            const sectionIntervals = getOtherIntervals(
              day.day_id,
              index,
              sameSection,
            );
            const roomIntervals = getOtherIntervals(
              day.day_id,
              index,
              sameRoom,
            );

            for (
              let eAttempt = 0;
              eAttempt < EMPLOYEE_ATTEMPT_LIMIT;
              eAttempt++
            ) {
              const candidateEmployee = randomFrom(pool);
              const key = `${candidateEmployee.employee_id}-${day.day_id}`;
              const windows = availabilityByEmployeeDay.get(key) ?? [];
              const { intervals, dayHours, weekHours } = getSiblingBookings(
                candidateEmployee.employee_id,
                day.day_id,
                index,
              );
              if (
                dayHours + durationMin / 60 > NINE_HOUR_SOFT_LIMIT &&
                eAttempt < EMPLOYEE_ATTEMPT_LIMIT - 1
              )
                continue;
              const validStarts = getConflictFreeStarts(
                candidateEmployee,
                windows,
                [...intervals, ...sectionIntervals, ...roomIntervals],
                durationMin,
                dayHours,
                weekHours,
              );
              if (validStarts.length > 0) {
                newDay = day;
                newEmployee = candidateEmployee;
                newStart = randomFrom(validStarts);
                break dayAttempts;
              }
            }
          }

          if (newDay === null || newEmployee === null || newStart === null)
            return assignment;
          const newEnd = newStart + durationMin;
          return {
            ...assignment,
            day_id: newDay.day_id,
            employee_id: newEmployee.employee_id,
            start_time: minutesToTime(newStart),
            end_time: minutesToTime(newEnd),
          };
        }
        default: {
          if (assignment.employee_id === null) return assignment;
          const course = courseMap.get(assignment.course_code);
          const durationHours =
            assignment.session_duration_hours ?? course?.total_hours ?? 1.5;
          const durationMin = Math.round(durationHours * 60);
          const key = `${assignment.employee_id}-${assignment.day_id}`;
          const windows = availabilityByEmployeeDay.get(key) ?? [];
          const { intervals, dayHours, weekHours } = getSiblingBookings(
            assignment.employee_id,
            assignment.day_id,
            index,
          );
          const sectionIntervals = getOtherIntervals(
            assignment.day_id,
            index,
            sameSection,
          );
          const roomIntervals = getOtherIntervals(
            assignment.day_id,
            index,
            sameRoom,
          );
          const employee = employeeMap.get(assignment.employee_id);

          const validStarts = employee
            ? getConflictFreeStarts(
                employee,
                windows,
                [...intervals, ...sectionIntervals, ...roomIntervals],
                durationMin,
                dayHours,
                weekHours,
              )
            : [];
          if (validStarts.length === 0) return assignment;
          const newStart = randomFrom(validStarts);

          const newEnd = newStart + durationMin;
          return {
            ...assignment,
            start_time: minutesToTime(newStart),
            end_time: minutesToTime(newEnd),
          };
        }
      }
    },
  );
  const mutated: Candidate = { assignments: mutatedAssignments, fitness: 0 };
  scoreCandidate(mutated, input, false);
  return mutated;
}

function repairCandidate(
  candidate: Candidate,
  requirements: SchedulingRequirement[],
  input: SchedulingInput,
): void {
  const A = candidate.assignments;
  const reqByKey = new Map(
    requirements.map((r) => [
      `${r.section_id}|${r.course_code}|${r.session_number}`,
      r,
    ]),
  );
  const sectionMap = new Map(input.sections.map((s) => [s.section_id, s]));
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));
  const employeeMap = new Map(input.employees.map((e) => [e.employee_id, e]));
  const roomMap = new Map(input.rooms.map((r) => [r.room_id, r]));
  const eligibleByCourse = buildEligibleEmployeesByCourse(input);
  const availability = buildAvailabilityByEmployeeDay(input);

  const valid = (a: ClassAssignment, skip: number): boolean => {
    const s = timeToMinutes(a.start_time);
    const e = timeToMinutes(a.end_time);
    if (s < WORKING_DAY_START_MIN || e > WORKING_DAY_END_MIN) return false;
    const windows = availability.get(`${a.employee_id}-${a.day_id}`) ?? [];
    if (
      a.employee_id !== null &&
      !windows.some(
        (w) =>
          timeToMinutes(w.start_time) <= s && e <= timeToMinutes(w.end_time),
      )
    )
      return false;

    let dayH = 0;
    let weekH = 0;
    for (let i = 0; i < A.length; i++) {
      if (i === skip) continue;
      const o = A[i]!;
      const os = timeToMinutes(o.start_time);
      const oe = timeToMinutes(o.end_time);
      if (a.employee_id !== null && o.employee_id === a.employee_id) {
        weekH += (oe - os) / 60;
        if (o.day_id === a.day_id) dayH += (oe - os) / 60;
      }
      if (o.day_id !== a.day_id) continue;
      if (o.section_id === a.section_id && o.course_code === a.course_code)
        return false;
      if (!timeRangesOverlap(s, e, os, oe)) continue;
      if (
        (a.employee_id !== null && o.employee_id === a.employee_id) ||
        o.section_id === a.section_id ||
        o.room_id === a.room_id
      )
        return false;
    }
    const emp =
      a.employee_id === null ? undefined : employeeMap.get(a.employee_id);
    const h = (e - s) / 60;
    if (emp?.max_hours_per_day != null && dayH + h > emp.max_hours_per_day)
      return false;
    if (emp?.max_hours_per_week != null && weekH + h > emp.max_hours_per_week)
      return false;
    return true;
  };

  const deadline = Date.now() + 20_000;
  const freeSpot = (idx: number): ClassAssignment | null => {
    if (Date.now() > deadline) return null;
    const c = A[idx]!;
    const course = courseMap.get(c.course_code);
    const section = sectionMap.get(c.section_id);
    const pool = roomPoolForRequirement(
      {
        section_id: c.section_id,
        course_code: c.course_code,
        session_number: c.session_number,
        session_duration_hours: c.session_duration_hours,
      },
      (course?.course_type_description ?? "").toLowerCase(),
      input,
      section?.program_id ?? 0,
    );
    const d = Math.round(c.session_duration_hours * 60);
    for (const day of shuffle(input.days))
      for (
        let st = WORKING_DAY_START_MIN;
        st + d <= WORKING_DAY_END_MIN;
        st += SLOT_GRANULARITY_MIN
      )
        for (const room of pool) {
          const cand = {
            ...c,
            day_id: day.day_id,
            room_id: room.room_id,
            start_time: minutesToTime(st),
            end_time: minutesToTime(st + d),
          };
          if (valid(cand, idx)) return cand;
        }
    return null;
  };

  const bad = A.map((a, i) => (valid(a, i) ? -1 : i)).filter((i) => i >= 0);
  if (bad.length === 0) return;

  for (let pass = 0; pass < 5; pass++) {
    let fixed = 0;
    for (let i = 0; i < A.length; i++) {
      const cur = A[i]!;
      if (valid(cur, i)) continue;
      if (cur.employee_id === null) {
        const course = courseMap.get(cur.course_code);
        const section = sectionMap.get(cur.section_id);
        const req = reqByKey.get(
          `${cur.section_id}|${cur.course_code}|${cur.session_number}`,
        ) ?? {
          section_id: cur.section_id,
          course_code: cur.course_code,
          session_number: cur.session_number,
          session_duration_hours: cur.session_duration_hours,
        };
        const roomPool = roomPoolForRequirement(
          req,
          (course?.course_type_description ?? "").toLowerCase(),
          input,
          section?.program_id ?? 0,
        );
        const dur = Math.round(cur.session_duration_hours * 60);
        const options: ClassAssignment[] = [];
        search: for (const day of shuffle(input.days)) {
          for (
            let st = WORKING_DAY_START_MIN;
            st + dur <= WORKING_DAY_END_MIN;
            st += SLOT_GRANULARITY_MIN
          ) {
            for (const room of roomPool) {
              const cand: ClassAssignment = {
                ...cur,
                employee_id: null,
                day_id: day.day_id,
                room_id: room.room_id,
                start_time: minutesToTime(st),
                end_time: minutesToTime(st + dur),
              };
              if (valid(cand, i)) {
                options.push(cand);
                if (options.length >= 25) break search;
              }
            }
          }
        }
        if (options.length === 0) {
          let tries = 0;
          eject: for (const day of shuffle(input.days))
            for (
              let st = WORKING_DAY_START_MIN;
              st + dur <= WORKING_DAY_END_MIN;
              st += SLOT_GRANULARITY_MIN
            )
              for (const room of roomPool) {
                const blockers: number[] = [];
                for (let j = 0; j < A.length; j++) {
                  const o = A[j]!;
                  if (
                    j !== i &&
                    o.day_id === day.day_id &&
                    o.room_id === room.room_id &&
                    timeRangesOverlap(
                      st,
                      st + dur,
                      timeToMinutes(o.start_time),
                      timeToMinutes(o.end_time),
                    )
                  )
                    blockers.push(j);
                }
                if (blockers.length !== 1) continue;
                const j = blockers[0]!;
                const oldJ = A[j]!;
                if (oldJ.employee_id !== null) continue;
                if (++tries > 40) break eject;
                const cand = {
                  ...cur,
                  employee_id: null,
                  day_id: day.day_id,
                  room_id: room.room_id,
                  start_time: minutesToTime(st),
                  end_time: minutesToTime(st + dur),
                };
                A[i] = cand;
                const alt = freeSpot(j);
                if (alt) {
                  A[j] = alt;
                  if (valid(cand, i)) {
                    fixed++;
                    break eject;
                  }
                  A[j] = oldJ;
                }
                A[i] = cur;
              }
          continue;
        }
        const students = section?.number_of_students ?? 0;
        const fitting = options.filter(
          (o) => (roomMap.get(o.room_id)?.capacity ?? 0) >= students,
        );
        A[i] = randomFrom(fitting.length > 0 ? fitting : options);
        fixed++;
        continue;
      }

      const course = courseMap.get(cur.course_code);
      const section = sectionMap.get(cur.section_id);
      const req = reqByKey.get(
        `${cur.section_id}|${cur.course_code}|${cur.session_number}`,
      ) ?? {
        section_id: cur.section_id,
        course_code: cur.course_code,
        session_number: cur.session_number,
        session_duration_hours: cur.session_duration_hours,
      };
      const roomPool = roomPoolForRequirement(
        req,
        (course?.course_type_description ?? "").toLowerCase(),
        input,
        section?.program_id ?? 0,
      );
      const dur = Math.round(cur.session_duration_hours * 60);
      const emps = eligibleByCourse.get(cur.course_code) ?? input.employees;

      const options: ClassAssignment[] = [];
      search: for (const day of shuffle(input.days)) {
        for (const emp of shuffle(emps)) {
          for (const w of availability.get(
            `${emp.employee_id}-${day.day_id}`,
          ) ?? []) {
            const from = Math.max(
              timeToMinutes(w.start_time),
              WORKING_DAY_START_MIN,
            );
            const to = Math.min(timeToMinutes(w.end_time), WORKING_DAY_END_MIN);
            for (let st = from; st + dur <= to; st += SLOT_GRANULARITY_MIN) {
              for (const room of roomPool) {
                const cand: ClassAssignment = {
                  ...cur,
                  employee_id: emp.employee_id,
                  day_id: day.day_id,
                  room_id: room.room_id,
                  start_time: minutesToTime(st),
                  end_time: minutesToTime(st + dur),
                };
                if (valid(cand, i)) {
                  options.push(cand);
                  if (options.length >= 25) break search;
                }
              }
            }
          }
        }
      }

      if (options.length === 0) {
        console.log(
          "repair: no valid spot for",
          cur.course_code,
          cur.section_id,
        );
        continue;
      }
      const students = section?.number_of_students ?? 0;
      const fitting = options.filter(
        (o) => (roomMap.get(o.room_id)?.capacity ?? 0) >= students,
      );
      A[i] = randomFrom(fitting.length > 0 ? fitting : options);
      fixed++;
    }
    if (fixed === 0) break;
  }
}
export interface GAResult {
  best: Candidate;
  generationsRun: number;
  fitnessHistory: number[];
  feasible: boolean;
  hardViolationCount: number;
}

//
function compactCandidate(candidate: Candidate, input: SchedulingInput): void {
  const A = candidate.assignments;
  const availability = buildAvailabilityByEmployeeDay(input);
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));
  const sectionMap = new Map(input.sections.map((s) => [s.section_id, s]));
  const roomMap = new Map(input.rooms.map((r) => [r.room_id, r]));

  const canPlace = (
    i: number,
    s: number,
    e: number,
    roomId: number,
  ): boolean => {
    const a = A[i]!;
    if (a.employee_id !== null) {
      const windows = availability.get(`${a.employee_id}-${a.day_id}`) ?? [];
      if (
        !windows.some(
          (w) =>
            timeToMinutes(w.start_time) <= s && e <= timeToMinutes(w.end_time),
        )
      )
        return false;
    }
    for (let j = 0; j < A.length; j++) {
      if (j === i) continue;
      const o = A[j]!;
      if (o.day_id !== a.day_id) continue;
      if (
        !timeRangesOverlap(
          s,
          e,
          timeToMinutes(o.start_time),
          timeToMinutes(o.end_time),
        )
      )
        continue;
      if (
        o.section_id === a.section_id ||
        o.room_id === roomId ||
        (a.employee_id !== null && o.employee_id === a.employee_id)
      )
        return false;
    }
    return true;
  };

  // current room first, then other same-type rooms (labs are never switched)
  const roomOptions = (i: number): number[] => {
    const a = A[i]!;
    const cur = roomMap.get(a.room_id);
    if (!cur || cur.type?.toLowerCase() === "laboratory") return [a.room_id];
    const course = courseMap.get(a.course_code);
    const section = sectionMap.get(a.section_id);
    const pool = roomPoolForRequirement(
      {
        section_id: a.section_id,
        course_code: a.course_code,
        session_number: a.session_number,
        session_duration_hours: a.session_duration_hours,
      },
      (course?.course_type_description ?? "").toLowerCase(),
      input,
      section?.program_id ?? 0,
    );
    const students = section?.number_of_students ?? 0;
    const others = pool.filter(
      (r) =>
        r.room_id !== a.room_id &&
        r.type?.toLowerCase() === cur.type?.toLowerCase() &&
        r.capacity >= students,
    );
    return [
      a.room_id,
      ...others.filter((r) => !isBackupRoom(r)).map((r) => r.room_id),
      ...others.filter(isBackupRoom).map((r) => r.room_id),
    ];
  };

  const gapPenalty = (idxs: number[]): number => {
    const s = idxs
      .map((i) => ({
        st: timeToMinutes(A[i]!.start_time),
        en: timeToMinutes(A[i]!.end_time),
      }))
      .sort((a, b) => a.st - b.st);
    let p = 0;
    for (let k = 0; k < s.length - 1; k++) {
      const gap = s[k + 1]!.st - s[k]!.en;
      if (gap > 30) p += Math.ceil((gap - 30) / 30);
    }
    return p;
  };

  const groups = new Map<string, number[]>();
  A.forEach((a, i) => {
    const k = `${a.section_id}-${a.day_id}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(i);
  });

  for (const idxs of groups.values()) {
    idxs.sort(
      (x, y) =>
        timeToMinutes(A[x]!.start_time) - timeToMinutes(A[y]!.start_time),
    );
    const before = gapPenalty(idxs);
    const backup = idxs.map((i) => A[i]!);
    for (const i of idxs) {
      const cur = A[i]!;
      const start = timeToMinutes(cur.start_time);
      const dur = timeToMinutes(cur.end_time) - start;
      const rooms = roomOptions(i);
      placed: for (
        let s = WORKING_DAY_START_MIN;
        s < start;
        s += SLOT_GRANULARITY_MIN
      ) {
        for (const rid of rooms) {
          if (canPlace(i, s, s + dur, rid)) {
            A[i] = {
              ...cur,
              room_id: rid,
              start_time: minutesToTime(s),
              end_time: minutesToTime(s + dur),
            };
            break placed;
          }
        }
      }
    }
    if (gapPenalty(idxs) > before) idxs.forEach((i, k) => (A[i] = backup[k]!));
  }
}
//
function preferPrimaryRooms(
  candidate: Candidate,
  input: SchedulingInput,
): void {
  const A = candidate.assignments;
  const availability = buildAvailabilityByEmployeeDay(input);
  const roomMap = new Map(input.rooms.map((r) => [r.room_id, r]));
  const sectionMap = new Map(input.sections.map((s) => [s.section_id, s]));

  const ok = (i: number, s: number, e: number, roomId: number): boolean => {
    const a = A[i]!;
    if (a.employee_id !== null) {
      const windows = availability.get(`${a.employee_id}-${a.day_id}`) ?? [];
      if (
        !windows.some(
          (w) =>
            timeToMinutes(w.start_time) <= s && e <= timeToMinutes(w.end_time),
        )
      )
        return false;
    }
    for (let j = 0; j < A.length; j++) {
      if (j === i) continue;
      const o = A[j]!;
      if (o.day_id !== a.day_id) continue;
      if (
        !timeRangesOverlap(
          s,
          e,
          timeToMinutes(o.start_time),
          timeToMinutes(o.end_time),
        )
      )
        continue;
      if (
        o.section_id === a.section_id ||
        o.room_id === roomId ||
        (a.employee_id !== null && o.employee_id === a.employee_id)
      )
        return false;
    }
    return true;
  };

  const gaps = (sectionId: number, dayId: number): number => {
    const s = A.filter((x) => x.section_id === sectionId && x.day_id === dayId)
      .map((x) => ({
        st: timeToMinutes(x.start_time),
        en: timeToMinutes(x.end_time),
      }))
      .sort((a, b) => a.st - b.st);
    let p = 0;
    for (let k = 0; k < s.length - 1; k++) {
      const gap = s[k + 1]!.st - s[k]!.en;
      if (gap > 30) p += Math.ceil((gap - 30) / 30);
    }
    return p;
  };

  for (let i = 0; i < A.length; i++) {
    const a = A[i]!;
    const cur = roomMap.get(a.room_id);
    if (!cur || !isBackupRoom(cur)) continue;
    const students = sectionMap.get(a.section_id)?.number_of_students ?? 0;
    const primaries = input.rooms.filter(
      (r) =>
        !isBackupRoom(r) &&
        r.type?.toLowerCase() === cur.type?.toLowerCase() &&
        r.capacity >= students,
    );
    const start = timeToMinutes(a.start_time);
    const dur = timeToMinutes(a.end_time) - start;
    const starts = [start];
    for (
      let s = WORKING_DAY_START_MIN;
      s + dur <= WORKING_DAY_END_MIN;
      s += SLOT_GRANULARITY_MIN
    )
      if (s !== start) starts.push(s);

    placed: for (const s of starts) {
      for (const r of primaries) {
        if (!ok(i, s, s + dur, r.room_id)) continue;
        A[i] = {
          ...a,
          room_id: r.room_id,
          start_time: minutesToTime(s),
          end_time: minutesToTime(s + dur),
        };
        break placed;
      }
    }
  }
}
function packLabs(candidate: Candidate, input: SchedulingInput): void {
  const A = candidate.assignments;
  const availability = buildAvailabilityByEmployeeDay(input);
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));
  const sectionMap = new Map(input.sections.map((s) => [s.section_id, s]));
  const roomMap = new Map(input.rooms.map((r) => [r.room_id, r]));
  const labs = input.rooms.filter(
    (r) => r.type?.toLowerCase() === "laboratory",
  );

  const isLabClass = (a: ClassAssignment) =>
    a.session_number === 1 &&
    (
      courseMap.get(a.course_code)?.course_type_description ?? ""
    ).toLowerCase() === "laboratory" &&
    roomMap.get(a.room_id)?.type?.toLowerCase() === "laboratory";

  const allowed = (a: ClassAssignment, roomId: number) =>
    roomPoolForRequirement(
      {
        section_id: a.section_id,
        course_code: a.course_code,
        session_number: 1,
        session_duration_hours: a.session_duration_hours,
        prefers_lab_room: true,
      },
      "laboratory",
      input,
      sectionMap.get(a.section_id)?.program_id ?? 0,
    ).some((r) => r.room_id === roomId);

  const canMove = (
    i: number,
    day: number,
    s: number,
    e: number,
    roomId: number,
  ) => {
    const a = A[i]!;
    if (a.employee_id !== null) {
      if (day !== a.day_id) return false;
      const w = availability.get(`${a.employee_id}-${day}`) ?? [];
      if (
        !w.some(
          (x) =>
            timeToMinutes(x.start_time) <= s && e <= timeToMinutes(x.end_time),
        )
      )
        return false;
    }
    return !A.some(
      (o, j) =>
        j !== i &&
        o.day_id === day &&
        ((o.section_id === a.section_id && o.course_code === a.course_code) ||
          (timeRangesOverlap(
            s,
            e,
            timeToMinutes(o.start_time),
            timeToMinutes(o.end_time),
          ) &&
            (o.section_id === a.section_id ||
              o.room_id === roomId ||
              (a.employee_id !== null && o.employee_id === a.employee_id)))),
    );
  };

  for (let pass = 0; pass < 3; pass++) {
    for (const room of labs) {
      for (const day of input.days) {
        for (let guard = 0; guard < 20; guard++) {
          const busy = A.filter(
            (a) => a.room_id === room.room_id && a.day_id === day.day_id,
          );
          let s = WORKING_DAY_START_MIN;
          while (
            s < WORKING_DAY_END_MIN &&
            busy.some(
              (b) =>
                timeToMinutes(b.start_time) <= s &&
                s < timeToMinutes(b.end_time),
            )
          )
            s += SLOT_GRANULARITY_MIN;
          if (s >= WORKING_DAY_END_MIN) break;

          const pick = A.findIndex((a, i) => {
            if (!isLabClass(a) || !allowed(a, room.room_id)) return false;
            const st = timeToMinutes(a.start_time);
            const dur = timeToMinutes(a.end_time) - st;
            if (st <= WORKING_DAY_START_MIN) return false;
            const sameSpot =
              a.room_id === room.room_id && a.day_id === day.day_id;
            if (sameSpot && st <= s) return false;
            if (s + dur > WORKING_DAY_END_MIN) return false;
            return canMove(i, day.day_id, s, s + dur, room.room_id);
          });
          if (pick < 0) break;
          const a = A[pick]!;
          const dur = timeToMinutes(a.end_time) - timeToMinutes(a.start_time);
          A[pick] = {
            ...a,
            room_id: room.room_id,
            day_id: day.day_id,
            start_time: minutesToTime(s),
            end_time: minutesToTime(s + dur),
          };
        }
      }
    }
  }
}
function balanceLectureRooms(
  candidate: Candidate,
  input: SchedulingInput,
): void {
  const A = candidate.assignments;
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));
  const sectionMap = new Map(input.sections.map((s) => [s.section_id, s]));
  const roomMap = new Map(input.rooms.map((r) => [r.room_id, r]));
  const isLecture = (a: ClassAssignment) =>
    roomMap.get(a.room_id)?.type?.toLowerCase() === "lecture";
  const hrs = (a: ClassAssignment) =>
    (timeToMinutes(a.end_time) - timeToMinutes(a.start_time)) / 60;

  const load = new Map<number, number>();
  for (const a of A)
    if (isLecture(a)) load.set(a.room_id, (load.get(a.room_id) ?? 0) + hrs(a));

  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < A.length; i++) {
      const a = A[i]!;
      if (!isLecture(a)) continue;
      const s = timeToMinutes(a.start_time);
      const e = timeToMinutes(a.end_time);
      const section = sectionMap.get(a.section_id);
      const type = (
        courseMap.get(a.course_code)?.course_type_description ?? ""
      ).toLowerCase();
      const pool = roomPoolForRequirement(
        {
          section_id: a.section_id,
          course_code: a.course_code,
          session_number: a.session_number,
          session_duration_hours: a.session_duration_hours,
        },
        type,
        input,
        section?.program_id ?? 0,
      ).filter(
        (r) =>
          r.room_id === a.room_id ||
          (r.type?.toLowerCase() === "lecture" &&
            !isBackupRoom(r) &&
            r.capacity >= (section?.number_of_students ?? 0)),
      );
      const free = pool.filter(
        (r) =>
          r.room_id === a.room_id ||
          !A.some(
            (o, j) =>
              j !== i &&
              o.day_id === a.day_id &&
              o.room_id === r.room_id &&
              timeRangesOverlap(
                s,
                e,
                timeToMinutes(o.start_time),
                timeToMinutes(o.end_time),
              ),
          ),
      );
      if (free.length === 0) continue;
      const best = free.reduce((x, y) =>
        (load.get(y.room_id) ?? 0) < (load.get(x.room_id) ?? 0) ? y : x,
      );
      const h = hrs(a);
      if (
        best.room_id !== a.room_id &&
        (load.get(best.room_id) ?? 0) + h < (load.get(a.room_id) ?? 0)
      ) {
        load.set(a.room_id, (load.get(a.room_id) ?? 0) - h);
        load.set(best.room_id, (load.get(best.room_id) ?? 0) + h);
        A[i] = { ...a, room_id: best.room_id };
      }
    }
  }
}
function packRooms(candidate: Candidate, input: SchedulingInput): void {
  const A = candidate.assignments;
  const availability = buildAvailabilityByEmployeeDay(input);
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));
  const sectionMap = new Map(input.sections.map((s) => [s.section_id, s]));
  const roomMap = new Map(input.rooms.map((r) => [r.room_id, r]));
  const ordered = [
    ...input.rooms.filter((r) => !isBackupRoom(r)),
    ...input.rooms.filter(isBackupRoom),
  ];
  const roomIdx = new Map(ordered.map((r, i) => [r.room_id, i]));
  const dayIdx = new Map(input.days.map((d, i) => [d.day_id, i]));
  const targets = input.rooms.filter((r) => !isBackupRoom(r));
  const deadline = Date.now() + 15_000;

  const key = (room: number, day: number, start: number) =>
    (roomIdx.get(room) ?? 0) * 1e7 + (dayIdx.get(day) ?? 0) * 1e4 + start;

  const allowed = (a: ClassAssignment, roomId: number): boolean => {
    if (a.room_id === roomId) return true;
    const cur = roomMap.get(a.room_id);
    const tgt = roomMap.get(roomId);
    if (!cur || !tgt || cur.type?.toLowerCase() !== tgt.type?.toLowerCase())
      return false;
    if (cur.type?.toLowerCase() === "lecture") return false;
    const section = sectionMap.get(a.section_id);
    if (tgt.capacity < (section?.number_of_students ?? 0)) return false;
    const type = (
      courseMap.get(a.course_code)?.course_type_description ?? ""
    ).toLowerCase();
    return roomPoolForRequirement(
      {
        section_id: a.section_id,
        course_code: a.course_code,
        session_number: a.session_number,
        session_duration_hours: a.session_duration_hours,
        prefers_lab_room: type === "laboratory" && a.session_number === 1,
      },
      type,
      input,
      section?.program_id ?? 0,
    ).some((r) => r.room_id === roomId);
  };

  const canMove = (
    i: number,
    day: number,
    s: number,
    e: number,
    roomId: number,
  ) => {
    const a = A[i]!;
    if (
      roomMap.get(a.room_id)?.type?.toLowerCase() === "lecture" &&
      day !== a.day_id
    )
      return false;
    if (a.employee_id !== null) {
      if (day !== a.day_id) return false;
      const w = availability.get(`${a.employee_id}-${day}`) ?? [];
      if (
        !w.some(
          (x) =>
            timeToMinutes(x.start_time) <= s && e <= timeToMinutes(x.end_time),
        )
      )
        return false;
    }
    return !A.some(
      (o, j) =>
        j !== i &&
        o.day_id === day &&
        ((o.section_id === a.section_id && o.course_code === a.course_code) ||
          (timeRangesOverlap(
            s,
            e,
            timeToMinutes(o.start_time),
            timeToMinutes(o.end_time),
          ) &&
            (o.section_id === a.section_id ||
              o.room_id === roomId ||
              (a.employee_id !== null && o.employee_id === a.employee_id)))),
    );
  };

  for (let pass = 0; pass < 4; pass++) {
    for (const room of targets) {
      for (const day of input.days) {
        for (
          let s = WORKING_DAY_START_MIN;
          s < WORKING_DAY_END_MIN;
          s += SLOT_GRANULARITY_MIN
        ) {
          if (Date.now() > deadline) return;
          const busy = A.some(
            (b) =>
              b.room_id === room.room_id &&
              b.day_id === day.day_id &&
              timeToMinutes(b.start_time) <= s &&
              s < timeToMinutes(b.end_time),
          );
          if (busy) continue;

          const target = key(room.room_id, day.day_id, s);
          const fits = (i: number) => {
            const a = A[i]!;
            const st = timeToMinutes(a.start_time);
            const dur = timeToMinutes(a.end_time) - st;
            if (key(a.room_id, a.day_id, st) <= target) return false;
            if (s + dur > WORKING_DAY_END_MIN) return false;
            if (!allowed(a, room.room_id)) return false;
            return canMove(i, day.day_id, s, s + dur, room.room_id);
          };
          // prefer sliding a later class of this same room/day, else pull from elsewhere
          let pick = A.findIndex(
            (a, i) =>
              a.room_id === room.room_id && a.day_id === day.day_id && fits(i),
          );
          if (pick < 0) pick = A.findIndex((_, i) => fits(i));
          if (pick < 0) continue;

          const a = A[pick]!;
          const dur = timeToMinutes(a.end_time) - timeToMinutes(a.start_time);
          A[pick] = {
            ...a,
            room_id: room.room_id,
            day_id: day.day_id,
            start_time: minutesToTime(s),
            end_time: minutesToTime(s + dur),
          };
        }
      }
    }
  }
}
export function runGA(
  requirements: SchedulingRequirement[],
  input: SchedulingInput,
  options: {
    populationSize?: number | undefined;
    maxGenerations?: number | undefined;
    timeBudgetMs?: number | undefined;
  } = {},
): GAResult {
  const startTime = Date.now();
  const populationSize = options.populationSize ?? 50;
  const maxGenerations = options.maxGenerations ?? 200;
  console.time("Initial population");
  console.log(`[GA CONFIG] Crossover Rate: ${CROSSOVER_RATE}`);
  let population = initializePopulation(populationSize, requirements, input);

  console.timeEnd("Initial population");

  const fitnessHistory: number[] = [];

  let generationsRun = 0;
  let bestSoFar = Infinity;
  let stale = 0;
  let bestFeasible: Candidate | null = null;

  for (let gen = 0; gen < maxGenerations; gen++) {
    generationsRun = gen + 1;

    const currentBest = population.reduce((best, c) =>
      c.fitness < best.fitness ? c : best,
    );
    fitnessHistory.push(currentBest.fitness);

    if (currentBest.fitness < bestSoFar) {
      bestSoFar = currentBest.fitness;
      stale = 0;
    } else {
      stale++;
    }
    const res = scoreCandidate(currentBest, input);
    if (currentBest.fitness === 0 || stale >= 40) {
      break;
    }
    const elapsed = Date.now() - startTime;
    if (elapsed > (options.timeBudgetMs ?? 100_000)) break;
    const hasHard = hasHardViolations(res.violations);
    if (
      !hasHard &&
      (bestFeasible === null || currentBest.fitness < bestFeasible.fitness)
    ) {
      bestFeasible = currentBest;
    }

    console.log({
      generation: gen + 1,
      elapsedSeconds: Math.round(elapsed / 1000),
      feasible: !hasHard,
    });

    if (elapsed > 90_000 && !hasHard) {
      break;
    }
    const nextPopulation: Candidate[] = [...population]
      .sort((a, b) => a.fitness - b.fitness)
      .slice(0, ELITE_COUNT);

    console.time(`Mutation - Generation ${gen + 1}`);

    while (nextPopulation.length < populationSize) {
      const parentA = tournamentSelect(population);
      let childAssignments = parentA.assignments;
      if (Math.random() < CROSSOVER_RATE) {
        const parentB = tournamentSelect(population);
        childAssignments = parentA.assignments.map((a, i) =>
          Math.random() < 0.5 ? a : parentB.assignments[i]!,
        );
      }
      const mutatedChild = mutate(
        { assignments: childAssignments, fitness: 0 },
        input,
      );
      nextPopulation.push(mutatedChild);
    }

    console.timeEnd(`Mutation - Generation ${gen + 1}`);

    population = nextPopulation;
  }

  let finalBest = population.reduce((best, c) =>
    c.fitness < best.fitness ? c : best,
  );
  console.time("Final fitness evaluation");

  let finalResult = scoreCandidate(finalBest, input);

  console.timeEnd("Final fitness evaluation");
  if (hasHardViolations(finalResult.violations) && bestFeasible) {
    finalBest = bestFeasible;
    finalResult = scoreCandidate(finalBest, input);
  }
  if (hasHardViolations(finalResult.violations)) {
    console.time("Repair Candidate");

    const ranked = [...population].sort((a, b) => a.fitness - b.fitness);
    for (const cand of ranked.slice(0, 3)) {
      repairCandidate(cand, requirements, input);
      const r = scoreCandidate(cand, input);

      if (!hasHardViolations(r.violations)) {
        finalBest = cand;
        finalResult = r;
        break;
      }
    }

    console.timeEnd("Repair Candidate");
  }
  console.log(
    finalResult.violations
      .filter((v) => v.type === "EMPLOYEE_UNAVAILABLE")
      .map((v) => v.message),
  );
  if (!hasHardViolations(finalResult.violations)) {
    const backup = finalBest.assignments.map((a) => ({ ...a }));
    console.time("packLabs");
    packLabs(finalBest, input);
    console.timeEnd("packLabs");
    console.time("compactCandidate");
    compactCandidate(finalBest, input);
    console.timeEnd("compactCandidate");
    console.time("preferPrimaryRooms");
    preferPrimaryRooms(finalBest, input);
    console.timeEnd("preferPrimaryRooms");
    console.time("balanceLectureRooms");
    balanceLectureRooms(finalBest, input);
    console.timeEnd("balanceLectureRooms");
    console.time("packRooms");
    packRooms(finalBest, input);
    console.timeEnd("packRooms");
    finalResult = scoreCandidate(finalBest, input);
    if (hasHardViolations(finalResult.violations)) {
      finalBest.assignments = backup;
      finalResult = scoreCandidate(finalBest, input);
    }
  }
  const feasible = !hasHardViolations(finalResult.violations);

  const hardViolationCount = finalResult.violations.filter((v) =>
    hasHardViolations([v]),
  ).length; // FIX: Use the same hard-constraint rules as feasibility validation.

  console.log(
    "fitness every 20 gens:",
    fitnessHistory.filter((_, i) => i % 20 === 0),
  );
  const el = buildEligibleEmployeesByCourse(input);
  console.log({
    total: finalBest.assignments.length,
    noProfessor: finalBest.assignments.filter((a) => a.employee_id === null)
      .length,
    noEligibleMapping: requirements.filter((r) => !el.has(r.course_code))
      .length,
  });

  return {
    best: finalBest,
    generationsRun,
    fitnessHistory,
    feasible,
    hardViolationCount,
  };
}
