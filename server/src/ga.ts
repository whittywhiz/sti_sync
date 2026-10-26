import {
  SchedulingInput,
  CurriculumEntry,
  ClassAssignment,
  Candidate,
  EmployeeData,
  DayData,
  AvailabilityData,
  PROGRAM_HOME_LAB_ROOM_NUMBERS,
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

  if (isLab && reservedForSection.length > 0) {
    if (req.session_number === 2) {
      const lectureRooms = input.rooms.filter(
        (r) =>
          r.type?.toLowerCase() === "lecture" &&
          (r.program_id == null || r.program_id === sectionProgramId),
      );
      return [...reservedForSection, ...lectureRooms];
    }
    return reservedForSection;
  }

  const matchingTypeRooms = input.rooms.filter(
    (r) => r.type?.toLowerCase() === courseType,
  );
  const labRooms = input.rooms.filter(
    (r) => r.type?.toLowerCase() === "laboratory",
  );
  if (req.prefers_lab_room && labRooms.length > 0) {
    if (req.session_number === 2) {
      const lectureRooms = input.rooms.filter(
        (r) =>
          r.type?.toLowerCase() === "lecture" &&
          (r.program_id == null || r.program_id === sectionProgramId),
      );
      return [...filterReserved(labRooms), ...lectureRooms];
    }
    return filterReserved(labRooms);
  }
  if (matchingTypeRooms.length > 0) return filterReserved(matchingTypeRooms);
  return filterReserved(input.rooms);
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

    let chosenDay: DayData | null = null;
    let chosenEmployee: EmployeeData | null = null;
    let chosenStart: number | null = null;

    dayAttempts: for (
      let dAttempt = 0;
      dAttempt < DAY_ATTEMPT_LIMIT;
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

    if (chosenDay === null || chosenEmployee === null || chosenStart === null) {
      chosenDay = pickDayWithAvailableEmployees(input, employeesByDay);
      chosenEmployee = pickEmployeeForDay(
        input,
        chosenDay.day_id,
        employeesByDay,
        eligibleByCourse.get(req.course_code),
      );
      const slot = pickTimeSlotForEmployeeDay(
        chosenEmployee.employee_id,
        chosenDay.day_id,
        durationHours,
        availabilityByEmployeeDay,
      );
      chosenStart = timeToMinutes(slot.start_time);
    }

    const dayId = chosenDay.day_id;
    const employeeId = chosenEmployee.employee_id;
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
    const roomsToPickFrom =
      freeLabRooms.length > 0
        ? freeLabRooms
        : freeRooms.length > 0
          ? freeRooms
          : roomPool;
    const room = pickRoomForSection(
      roomsToPickFrom,
      sectionMap.get(req.section_id)?.number_of_students ?? 0,
    );

    const interval = { start: startMin, end: endMin };
    const empKey = `${employeeId}-${dayId}`;
    addInterval(bookedIntervalsByEmployeeDay, empKey, interval);
    addInterval(
      bookedIntervalsBySectionDay,
      `${req.section_id}-${dayId}`,
      interval,
    );
    addInterval(bookedIntervalsByRoomDay, `${room.room_id}-${dayId}`, interval);
    hoursByEmployeeDay.set(
      empKey,
      (hoursByEmployeeDay.get(empKey) ?? 0) + durationMin / 60,
    );
    hoursByEmployeeWeek.set(
      employeeId,
      (hoursByEmployeeWeek.get(employeeId) ?? 0) + durationMin / 60,
    );

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

const MUTATION_RATE = 0.1;

export function mutate(
  candidate: Candidate,
  input: SchedulingInput,
): Candidate {
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));

  const sectionMap = new Map(input.sections.map((s) => [s.section_id, s]));
  const employeeMap = new Map(input.employees.map((e) => [e.employee_id, e]));
  const employeesByDay = buildEmployeesByDay(input);
  const availabilityByEmployeeDay = buildAvailabilityByEmployeeDay(input);
  const eligibleByCourse = buildEligibleEmployeesByCourse(input);

  const original = candidate.assignments;

  function getSiblingBookings(
    employeeId: number,
    dayId: number,
    excludeIndex: number,
  ): { intervals: Interval[]; dayHours: number; weekHours: number } {
    const intervals: Interval[] = [];
    let dayHours = 0;
    let weekHours = 0;
    original.forEach((a, idx) => {
      if (idx === excludeIndex) return;
      if (a.employee_id !== employeeId) return;
      const hrs =
        (timeToMinutes(a.end_time) - timeToMinutes(a.start_time)) / 60;
      weekHours += hrs;
      if (a.day_id === dayId) {
        dayHours += hrs;
        intervals.push({
          start: timeToMinutes(a.start_time),
          end: timeToMinutes(a.end_time),
        });
      }
    });
    return { intervals, dayHours, weekHours };
  }

  function getOtherIntervals(
    dayId: number,
    excludeIndex: number,
    match: (a: ClassAssignment) => boolean,
  ): Interval[] {
    const out: Interval[] = [];
    original.forEach((a, idx) => {
      if (idx === excludeIndex || a.day_id !== dayId || !match(a)) return;
      out.push({
        start: timeToMinutes(a.start_time),
        end: timeToMinutes(a.end_time),
      });
    });
    return out;
  }

  const mutatedAssignments: ClassAssignment[] = original.map(
    (assignment, index) => {
      if (Math.random() > MUTATION_RATE) {
        return assignment;
      }

      const sameSection = (a: ClassAssignment) =>
        a.section_id === assignment.section_id;
      const sameRoom = (a: ClassAssignment) => a.room_id === assignment.room_id;

      const mutationChoice = Math.floor(Math.random() * 4);
      switch (mutationChoice) {
        case 0: {
          const course = courseMap.get(assignment.course_code);
          const section = sectionMap.get(assignment.section_id);
          const courseType = (
            course?.course_type_description ?? ""
          ).toLowerCase();
          const isLab = courseType === "laboratory";
          const prefersLabRoom = isLab && assignment.session_number === 2;
          const labRooms = input.rooms.filter(
            (r) => r.type?.toLowerCase() === "laboratory",
          );
          const homeRoomNumbers = section
            ? PROGRAM_HOME_LAB_ROOM_NUMBERS[section.program_id]
            : undefined;
          const homeLabRooms = homeRoomNumbers
            ? labRooms.filter((r) => homeRoomNumbers.includes(r.room_number))
            : [];
          const matchingTypeRooms = input.rooms.filter(
            (r) => r.type?.toLowerCase() === courseType,
          );
          const sectionProgramId = section?.program_id ?? 0;
          const reservedForSection = input.rooms.filter(
            (r) => r.program_id === sectionProgramId,
          );
          const filterReserved = (rooms: SchedulingInput["rooms"]) =>
            rooms.filter(
              (r) => r.program_id == null || r.program_id === sectionProgramId,
            );

          const roomPool =
            isLab && reservedForSection.length > 0
              ? reservedForSection
              : prefersLabRoom && homeLabRooms.length > 0
                ? homeLabRooms
                : prefersLabRoom && labRooms.length > 0
                  ? filterReserved(labRooms)
                  : matchingTypeRooms.length > 0
                    ? filterReserved(matchingTypeRooms)
                    : filterReserved(input.rooms);

          const s = timeToMinutes(assignment.start_time);
          const e = timeToMinutes(assignment.end_time);
          const freeRooms = roomPool.filter(
            (r) =>
              !original.some(
                (a, idx) =>
                  idx !== index &&
                  a.room_id === r.room_id &&
                  a.day_id === assignment.day_id &&
                  timeRangesOverlap(
                    s,
                    e,
                    timeToMinutes(a.start_time),
                    timeToMinutes(a.end_time),
                  ),
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
            const siblingDay = original.find(
              (a, i) =>
                i !== index &&
                a.section_id === assignment.section_id &&
                a.course_code === assignment.course_code,
            )?.day_id;
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
  } = {},
): GAResult {
  const populationSize = options.populationSize ?? 50;
  const maxGenerations = options.maxGenerations ?? 200;

  let population = initializePopulation(populationSize, requirements, input);
  const fitnessHistory: number[] = [];

  let generationsRun = 0;
  let bestSoFar = Infinity;
  let stale = 0;

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
    if (
      currentBest.fitness === 0 ||
      (stale >= 40 &&
        !hasHardViolations(scoreCandidate(currentBest, input).violations))
    ) {
      break;
    }

    const nextPopulation: Candidate[] = [currentBest];
    while (nextPopulation.length < populationSize) {
      const parent = tournamentSelect(population);
      const mutatedChild = mutate(
        { assignments: parent.assignments, fitness: 0 },
        input,
      );
      nextPopulation.push(mutatedChild);
    }

    population = nextPopulation;
  }

  const finalBest = population.reduce((best, c) =>
    c.fitness < best.fitness ? c : best,
  );
  const finalResult = scoreCandidate(finalBest, input);
  const feasible = !hasHardViolations(finalResult.violations);
  const hardViolationCount = finalResult.violations.filter((v) =>
    [
      "ROOM_CONFLICT",
      "EMPLOYEE_CONFLICT",
      "SECTION_CONFLICT",
      "EMPLOYEE_UNAVAILABLE",
      "ROOM_TYPE_MISMATCH",
      "EMPLOYEE_MAX_HOURS_EXCEEDED",
    ].includes(v.type),
  ).length;
  console.log(
    "fitness every 20 gens:",
    fitnessHistory.filter((_, i) => i % 20 === 0),
  );

  return {
    best: finalBest,
    generationsRun,
    fitnessHistory,
    feasible,
    hardViolationCount,
  };
}
