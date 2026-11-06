import { PROGRAM_HOME_LAB_ROOM_NUMBERS } from "./types";
import {
  Candidate,
  ClassAssignment,
  ConstraintViolation,
  FitnessResult,
  SchedulingInput,
  AvailabilityData,
} from "./types";

const WEIGHTS = {
  ROOM_CONFLICT: 100,
  EMPLOYEE_CONFLICT: 100,
  SECTION_CONFLICT: 100,
  ROOM_CAPACITY_EXCEEDED: 50,
  EMPLOYEE_UNAVAILABLE: 75,
  ROOM_TYPE_MISMATCH: 60,
  EMPLOYEE_MAX_HOURS_EXCEEDED: 65,
  HOME_LAB_PREFERENCE_UNMET: 15,
  LAB_PREFERENCE_UNMET: 15,
  LONG_VACANT_GAP_PER_30MIN: 5,
  SAME_COURSE_SAME_DAY: 100,
};
const HARD_VIOLATION_TYPES = new Set<ConstraintViolation["type"]>([
  "ROOM_CONFLICT",
  "EMPLOYEE_CONFLICT",
  "SECTION_CONFLICT",
  "EMPLOYEE_UNAVAILABLE",
  "ROOM_TYPE_MISMATCH",
  "EMPLOYEE_MAX_HOURS_EXCEEDED",
  "SAME_COURSE_SAME_DAY",
]);

export function hasHardViolations(violations: ConstraintViolation[]): boolean {
  return violations.some((v) => HARD_VIOLATION_TYPES.has(v.type));
}

const tmCache = new Map<string, number>();
function toMinutes(time: string): number {
  let v = tmCache.get(time);
  if (v === undefined) {
    const p = time.split(":").map(Number);
    tmCache.set(time, (v = (p[0] ?? 0) * 60 + (p[1] ?? 0)));
  }
  return v;
}

function buildCtx(input: SchedulingInput) {
  const availabilityByEmployeeDay = new Map<string, AvailabilityData[]>();
  for (const a of input.availability) {
    const key = `${a.employee_id}-${a.day_id}`;
    if (!availabilityByEmployeeDay.has(key)) {
      availabilityByEmployeeDay.set(key, []);
    }
    availabilityByEmployeeDay.get(key)!.push(a);
  }
  return {
    roomMap: new Map(input.rooms.map((r) => [r.room_id, r])),
    sectionMap: new Map(input.sections.map((s) => [s.section_id, s])),
    courseMap: new Map(input.courses.map((c) => [c.course_code, c])),
    employeeMap: new Map(input.employees.map((e) => [e.employee_id, e])),
    availabilityByEmployeeDay,
  };
}

const ctxCache = new WeakMap<SchedulingInput, ReturnType<typeof buildCtx>>();

function getCtx(input: SchedulingInput) {
  let ctx = ctxCache.get(input);
  if (!ctx) {
    ctx = buildCtx(input);
    ctxCache.set(input, ctx);
  }
  return ctx;
}

export function evaluateFitness(
  assignments: ClassAssignment[],
  input: SchedulingInput,
  detailed = true,
): FitnessResult {
  const violations: ConstraintViolation[] = [];
  let fitness = 0;
  const add = (
    type: ConstraintViolation["type"],
    weight: number,
    msg: () => string,
  ) => {
    fitness += weight;
    if (detailed) violations.push({ type, weight, message: msg() });
  };

  const {
    roomMap,
    sectionMap,
    courseMap,
    employeeMap,
    availabilityByEmployeeDay,
  } = getCtx(input);

  const startMin = assignments.map((a) => toMinutes(a.start_time));
  const endMin = assignments.map((a) => toMinutes(a.end_time));

  const indicesByDay = new Map<number, number[]>();
  assignments.forEach((a, idx) => {
    const list = indicesByDay.get(a.day_id);
    if (list) list.push(idx);
    else indicesByDay.set(a.day_id, [idx]);
  });
  for (const idxs of indicesByDay.values()) {
    for (let p = 0; p < idxs.length; p++) {
      for (let q = p + 1; q < idxs.length; q++) {
        const i = idxs[p]!;
        const j = idxs[q]!;
        const a = assignments[i]!;
        const b = assignments[j]!;

        if (!(startMin[i]! < endMin[j]! && startMin[j]! < endMin[i]!)) continue;

        if (a.room_id === b.room_id) {
          add(
            "ROOM_CONFLICT",
            WEIGHTS.ROOM_CONFLICT,
            () =>
              `Room ${a.room_id} double-booked on day ${a.day_id} between (${a.course_code}) and (${b.course_code})`,
          );
        }

        if (a.employee_id !== null && a.employee_id === b.employee_id) {
          add(
            "EMPLOYEE_CONFLICT",
            WEIGHTS.EMPLOYEE_CONFLICT,
            () =>
              `Employee ${a.employee_id} double-booked on day ${a.day_id} between (${a.course_code}) and (${b.course_code})`,
          );
        }

        if (a.section_id === b.section_id) {
          add(
            "SECTION_CONFLICT",
            WEIGHTS.SECTION_CONFLICT,
            () =>
              `Section ${a.section_id} double-booked on day ${a.day_id} between (${a.course_code}) and (${b.course_code})`,
          );
        }
      }
    }
  }

  for (const assignment of assignments) {
    const room = roomMap.get(assignment.room_id);
    const section = sectionMap.get(assignment.section_id);
    if (room && section && section.number_of_students > room.capacity) {
      const overflow = section.number_of_students - room.capacity;
      add(
        "ROOM_CAPACITY_EXCEEDED",
        WEIGHTS.ROOM_CAPACITY_EXCEEDED + overflow * 2,
        () =>
          `Section ${assignment.section_id} (${section.number_of_students} students) exceeds Room ${room.room_number} capacity (${room.capacity})`,
      );
    }
    const course = courseMap.get(assignment.course_code);
    if (room && course && room.type) {
      const courseType = course.course_type_description.toLowerCase();
      const roomType = room.type.toLowerCase();
      const isLabSession2InLectureRoom =
        courseType === "laboratory" &&
        assignment.session_number === 2 &&
        roomType === "lecture";
      if (courseType !== roomType && !isLabSession2InLectureRoom) {
        add(
          "ROOM_TYPE_MISMATCH",
          WEIGHTS.ROOM_TYPE_MISMATCH,
          () =>
            `Course ${assignment.course_code} (${course.course_type_description}) assigned to Room ${room.room_number} (${room.type})`,
        );
      }

      const homeRoomNumbers = section
        ? PROGRAM_HOME_LAB_ROOM_NUMBERS[section.program_id]
        : undefined;
      if (
        courseType === "laboratory" &&
        assignment.session_number === 1 &&
        homeRoomNumbers &&
        !homeRoomNumbers.some(
          (n) =>
            n.toLowerCase().trim() === room.room_number.toLowerCase().trim(),
        )
      ) {
        add(
          "HOME_LAB_PREFERENCE_UNMET",
          WEIGHTS.HOME_LAB_PREFERENCE_UNMET,
          () =>
            `Session 1 of ${assignment.course_code} (Section ${assignment.section_id}) assigned to Room ${room.room_number} instead of a home lab (${homeRoomNumbers.join(", ")})`,
        );
      }
    }
    if (assignment.employee_id === null) continue;
    const key = `${assignment.employee_id}-${assignment.day_id}`;
    const employeeAvailability = availabilityByEmployeeDay.get(key) || [];

    const assignStart = toMinutes(assignment.start_time);
    const assignEnd = toMinutes(assignment.end_time);
    const isWithinAvailability = employeeAvailability.some((avail) => {
      return (
        assignStart >= toMinutes(avail.start_time) &&
        assignEnd <= toMinutes(avail.end_time)
      );
    });

    if (!isWithinAvailability) {
      add("EMPLOYEE_UNAVAILABLE", WEIGHTS.EMPLOYEE_UNAVAILABLE, () =>
        employeeAvailability.length === 0
          ? `Employee ${assignment.employee_id} has no declared availability on day ${assignment.day_id}`
          : `Employee ${assignment.employee_id} assigned outside declared availability on day ${assignment.day_id}`,
      );
    }
  }

  const hoursByEmployeeDay = new Map<string, number>();
  const hoursByEmployeeWeek = new Map<number, number>();

  assignments.forEach((assignment, i) => {
    if (assignment.employee_id === null) return;
    const dayKey = `${assignment.employee_id}-${assignment.day_id}`;
    const hours = (endMin[i]! - startMin[i]!) / 60;
    hoursByEmployeeDay.set(
      dayKey,
      (hoursByEmployeeDay.get(dayKey) ?? 0) + hours,
    );
    hoursByEmployeeWeek.set(
      assignment.employee_id,
      (hoursByEmployeeWeek.get(assignment.employee_id) ?? 0) + hours,
    );
  });

  for (const [dayKey, totalHours] of hoursByEmployeeDay) {
    const [employeeIdStr, dayIdStr] = dayKey.split("-");
    const employeeId = Number(employeeIdStr);
    const employee = employeeMap.get(employeeId);
    if (
      employee?.max_hours_per_day != null &&
      totalHours > employee.max_hours_per_day
    ) {
      add(
        "EMPLOYEE_MAX_HOURS_EXCEEDED",
        WEIGHTS.EMPLOYEE_MAX_HOURS_EXCEEDED,
        () =>
          `Employee ${employeeId} scheduled ${totalHours}hrs on day ${dayIdStr}, exceeding their daily max of ${employee.max_hours_per_day}hrs`,
      );
    }
  }

  for (const [employeeId, totalHours] of hoursByEmployeeWeek) {
    const employee = employeeMap.get(employeeId);
    if (
      employee?.max_hours_per_week != null &&
      totalHours > employee.max_hours_per_week
    ) {
      add(
        "EMPLOYEE_MAX_HOURS_EXCEEDED",
        WEIGHTS.EMPLOYEE_MAX_HOURS_EXCEEDED,
        () =>
          `Employee ${employeeId} scheduled ${totalHours}hrs this week, exceeding their weekly max of ${employee.max_hours_per_week}hrs`,
      );
    }
  }

  const GAP_GRACE_MINUTES = 30;

  const assignmentsBySectionDay = new Map<string, ClassAssignment[]>();
  for (const assignment of assignments) {
    const key = `${assignment.section_id}-${assignment.day_id}`;
    if (!assignmentsBySectionDay.has(key)) {
      assignmentsBySectionDay.set(key, []);
    }
    assignmentsBySectionDay.get(key)!.push(assignment);
  }

  for (const [key, dayAssignments] of assignmentsBySectionDay) {
    if (dayAssignments.length < 2) continue;
    const sorted = [...dayAssignments].sort(
      (a, b) => toMinutes(a.start_time) - toMinutes(b.start_time),
    );
    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i]!;
      const next = sorted[i + 1]!;
      const gapMinutes =
        toMinutes(next.start_time) - toMinutes(current.end_time);
      if (gapMinutes > GAP_GRACE_MINUTES) {
        const excessMinutes = gapMinutes - GAP_GRACE_MINUTES;
        const penaltyUnits = Math.ceil(excessMinutes / 30);
        const [sectionIdStr, dayIdStr] = key.split("-");
        add(
          "LONG_VACANT_GAP",
          penaltyUnits * WEIGHTS.LONG_VACANT_GAP_PER_30MIN,
          () =>
            `Section ${sectionIdStr} has a ${gapMinutes}-minute gap on day ${dayIdStr} between (${current.course_code}) and (${next.course_code})`,
        );
      }
    }
  }
  const sessionDayKey = new Map<string, number>();
  for (const a of assignments) {
    const key = `${a.section_id}-${a.course_code}`;
    const prev = sessionDayKey.get(key);
    if (prev === undefined) {
      sessionDayKey.set(key, a.day_id);
    } else if (prev !== a.day_id) {
    } else {
      add(
        "SAME_COURSE_SAME_DAY",
        WEIGHTS.SAME_COURSE_SAME_DAY,
        () =>
          `Section ${a.section_id}: both sessions of ${a.course_code} are on day ${a.day_id}`,
      );
    }
  }
  return { fitness, violations };
}

export function scoreCandidate(
  candidate: Candidate,
  input: SchedulingInput,
  detailed = true,
): FitnessResult {
  const result = evaluateFitness(candidate.assignments, input, detailed);
  candidate.fitness = result.fitness;
  return result;
}
