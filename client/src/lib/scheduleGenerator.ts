import type {
  Professor,
  Room,
  Course,
  CourseType,
  Section,
  ScheduleEntry,
  Day,
  ScheduleConflict,
  Semester,
  Curriculum,
} from "@/types/scheduling";
import { coursesForPlacement } from "@/types/scheduling";

const DAYS: Day[] = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const START_HOUR = 7;
const END_HOUR = 20;

interface GeneratorInput {
  professors: Professor[];
  rooms: Room[];
  courses: Course[];
  courseTypes: CourseType[];
  sections: Section[];
  curriculums: Curriculum[];
  currentSemester: Semester;
}

interface GeneratorResult {
  schedule: ScheduleEntry[];
  conflicts: ScheduleConflict[];
  unscheduled: { courseId: string; sectionId: string; reason: string }[];
}

interface AssignmentTask {
  course: Course;
  section: Section;
  ct: CourseType;
}

function isRoomCompatible(room: Room, isLab: boolean): boolean {
  if (room.type === "both") return true;
  return isLab ? room.type === "lab" : room.type === "lecture";
}

function isProfAvailable(
  prof: Professor,
  day: Day,
  start: number,
  end: number,
): boolean {
  return prof.availability.some(
    (slot) =>
      slot.day === day && slot.startHour <= start && slot.endHour >= end,
  );
}

function overlaps(s1: number, e1: number, s2: number, e2: number) {
  return s1 < e2 && e1 > s2;
}

function hasConflict(
  schedule: ScheduleEntry[],
  day: Day,
  start: number,
  end: number,
  key: "professorId" | "roomId" | "sectionId",
  value: string,
): boolean {
  return schedule.some(
    (e) =>
      e.day === day &&
      e[key] === value &&
      overlaps(start, end, e.startHour, e.endHour),
  );
}

export function generateSchedule(input: GeneratorInput): GeneratorResult {
  const {
    professors,
    rooms,
    courses,
    courseTypes,
    sections,
    curriculums,
    currentSemester,
  } = input;
  const schedule: ScheduleEntry[] = [];
  const conflicts: ScheduleConflict[] = [];
  const unscheduled: { courseId: string; sectionId: string; reason: string }[] =
    [];

  const tasks: AssignmentTask[] = [];
  for (const section of sections) {
    const sectionCourses = coursesForPlacement(
      courses,
      curriculums,
      section.programId,
      section.yearLevel,
      currentSemester,
    );
    for (const course of sectionCourses) {
      const ct = courseTypes.find((t) => t.id === course.courseTypeId);
      if (!ct) {
        unscheduled.push({
          courseId: course.id,
          sectionId: section.id,
          reason: "Course type not found",
        });
        continue;
      }
      tasks.push({ course, section, ct });
    }
  }

  tasks.sort((a, b) => b.ct.totalHours - a.ct.totalHours);

  let entryId = 1;

  for (const { course, section, ct } of tasks) {
    const hoursPerWeek = ct.totalHours;
    const isLab = ct.name.toLowerCase().includes("lab");

    const candidateProfs = (course.professorIds ?? [])
      .map((id) => professors.find((p) => p.id === id))
      .filter((p): p is Professor => !!p);

    if (candidateProfs.length === 0) {
      unscheduled.push({
        courseId: course.id,
        sectionId: section.id,
        reason: "No professor assigned to course",
      });
      continue;
    }

    const compatibleRooms = rooms
      .filter(
        (r) => isRoomCompatible(r, isLab) && r.capacity >= section.studentCount,
      )
      .sort((a, b) => a.capacity - b.capacity);

    if (compatibleRooms.length === 0) {
      unscheduled.push({
        courseId: course.id,
        sectionId: section.id,
        reason: `No ${isLab ? "lab" : "lecture"} room with capacity >= ${section.studentCount}`,
      });
      continue;
    }

    let placed = false;

    outer: for (const professor of candidateProfs) {
      for (const day of DAYS) {
        for (
          let startHour = START_HOUR;
          startHour + hoursPerWeek <= END_HOUR;
          startHour++
        ) {
          const endHour = startHour + hoursPerWeek;

          if (!isProfAvailable(professor, day, startHour, endHour)) continue;
          if (
            hasConflict(
              schedule,
              day,
              startHour,
              endHour,
              "professorId",
              professor.id,
            )
          )
            continue;
          if (
            hasConflict(
              schedule,
              day,
              startHour,
              endHour,
              "sectionId",
              section.id,
            )
          )
            continue;

          for (const room of compatibleRooms) {
            if (
              hasConflict(schedule, day, startHour, endHour, "roomId", room.id)
            )
              continue;

            schedule.push({
              id: String(entryId++),
              courseId: course.id,
              sectionId: section.id,
              professorId: professor.id,
              roomId: room.id,
              day,
              startHour,
              endHour,
            });
            placed = true;
            break outer;
          }
        }
      }
    }

    if (!placed && !isLab && hoursPerWeek >= 3) {
      const splits = [
        { h1: 2, h2: 1 },
        { h1: 1, h2: 2 },
      ];
      outer2: for (const professor of candidateProfs) {
        for (const split of splits) {
          for (let d1 = 0; d1 < DAYS.length; d1++) {
            for (let d2 = d1 + 1; d2 < DAYS.length; d2++) {
              const day1 = DAYS[d1];
              const day2 = DAYS[d2];
              for (let s1 = START_HOUR; s1 + split.h1 <= END_HOUR; s1++) {
                if (!isProfAvailable(professor, day1, s1, s1 + split.h1))
                  continue;
                if (
                  hasConflict(
                    schedule,
                    day1,
                    s1,
                    s1 + split.h1,
                    "professorId",
                    professor.id,
                  )
                )
                  continue;
                if (
                  hasConflict(
                    schedule,
                    day1,
                    s1,
                    s1 + split.h1,
                    "sectionId",
                    section.id,
                  )
                )
                  continue;

                for (const room1 of compatibleRooms) {
                  if (
                    hasConflict(
                      schedule,
                      day1,
                      s1,
                      s1 + split.h1,
                      "roomId",
                      room1.id,
                    )
                  )
                    continue;

                  for (let s2 = START_HOUR; s2 + split.h2 <= END_HOUR; s2++) {
                    if (!isProfAvailable(professor, day2, s2, s2 + split.h2))
                      continue;
                    if (
                      hasConflict(
                        schedule,
                        day2,
                        s2,
                        s2 + split.h2,
                        "professorId",
                        professor.id,
                      )
                    )
                      continue;
                    if (
                      hasConflict(
                        schedule,
                        day2,
                        s2,
                        s2 + split.h2,
                        "sectionId",
                        section.id,
                      )
                    )
                      continue;

                    for (const room2 of compatibleRooms) {
                      if (
                        hasConflict(
                          schedule,
                          day2,
                          s2,
                          s2 + split.h2,
                          "roomId",
                          room2.id,
                        )
                      )
                        continue;

                      schedule.push({
                        id: String(entryId++),
                        courseId: course.id,
                        sectionId: section.id,
                        professorId: professor.id,
                        roomId: room1.id,
                        day: day1,
                        startHour: s1,
                        endHour: s1 + split.h1,
                      });
                      schedule.push({
                        id: String(entryId++),
                        courseId: course.id,
                        sectionId: section.id,
                        professorId: professor.id,
                        roomId: room2.id,
                        day: day2,
                        startHour: s2,
                        endHour: s2 + split.h2,
                      });
                      placed = true;
                      break outer2;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    if (!placed) {
      unscheduled.push({
        courseId: course.id,
        sectionId: section.id,
        reason: "No available time slot found",
      });
    }
  }

  return { schedule, conflicts, unscheduled };
}

export function formatHour(hour: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
  return `${h}:00 ${period}`;
}
