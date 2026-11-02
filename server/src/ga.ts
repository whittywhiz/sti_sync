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
const DAY_ATTEMPT_LIMIT = 8;

function minutesToTime(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

function timeToMinutes(time: string): number {
  const parts = time.split(":").map(Number);
  return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
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

function roomPoolForRequirement(
  req: SchedulingRequirement,
  courseType: string,
  input: SchedulingInput,
  sectionProgramId: number,
): SchedulingInput["rooms"] {
  const isLab = courseType === "laboratory";

  const filterReserved = (rooms: SchedulingInput["rooms"]) =>
    rooms.filter(
      (r) => r.program_id == null || r.program_id === sectionProgramId,
    );

  const reservedForSection = input.rooms.filter(
    (r) => r.program_id === sectionProgramId,
  );
  if (
    reservedForSection.length > 0 &&
    (isLab || req.prefers_lab_room) &&
    req.session_number !== 2
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
      const combined = [
        ...reservedForSection,
        ...filterReserved(labRooms),
        ...lectureRooms,
      ];
      return Array.from(new Map(combined.map((r) => [r.room_id, r])).values());
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
    if (req.session_number !== 1) continue;
    const type = (
      courseMap.get(req.course_code)?.course_type_description ?? ""
    ).toLowerCase();
    if (type !== "laboratory") continue;
    const pid = sectionMap.get(req.section_id)?.program_id ?? 0;
    const labs = roomPoolForRequirement(req, type, input, pid).filter(
      (r) => r.type?.toLowerCase() === "laboratory",
    );
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
    if (need > cap)
      return `Lab demand ${need}h exceeds capacity ${cap}h for: ${[...rooms.values()].join(", ") || "no lab room"}. Add a lab room or change course type. `;
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
  if (fitting.length > 0) return randomFrom(fitting);
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

  const ordered = [...requirements].sort(
    (a, b) =>
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
      const cands = shuffle(homeOpts.length > 0 ? homeOpts : options);
      const eligible = eligibleByCourse.get(req.course_code);
      let found = false;
      search: for (const o of cands.slice(0, 30)) {
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
      } else if (unassigned) {
        const days = input.days.filter((d) => d.day_id !== usedDay);
        chosenDay = randomFrom(days.length > 0 ? days : input.days);
        chosenStart = timeToMinutes(
          pickRandomTimeSlot(durationHours).start_time,
        );
      } else {
        chosenDay = pickDayWithAvailableEmployees(input, employeesByDay);
        chosenEmployee = null;
        chosenStart = timeToMinutes(
          pickRandomTimeSlot(durationHours).start_time,
        );
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

    const roomsToPickFrom = isMandatoryLabSession
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
const CROSSOVER_RATE = 0;

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
  scoreCandidate(mutated, input);
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
