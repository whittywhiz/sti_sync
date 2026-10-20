export interface Professor {
  id: string;
  instructorId: string;
  firstName: string;
  middleName?: string;
  lastName: string;
  department: string;
  availability: DayTimeSlot[];
}

export interface DayTimeSlot {
  day: Day;
  startHour: number;
  endHour: number;
}

export type Day =
  | "Monday"
  | "Tuesday"
  | "Wednesday"
  | "Thursday"
  | "Friday"
  | "Saturday";

export type Semester = 1 | 2;
export type YearLevel = 1 | 2 | 3 | 4;

export interface Program {
  id: string;
  code: string;
  name: string;
}

export interface Room {
  id: string;
  name: string;
  capacity: number;
  type: "lecture" | "lab" | "both";
}

export interface CourseType {
  id: string;
  name: string;
  description: string;
  totalHours: number;
}

export interface Course {
  id: string;
  code: string;
  name: string;
  courseTypeId: string;
  professorIds: string[];
}

export interface Curriculum {
  id: string;
  courseId: string;
  programId: string;
  yearLevel: YearLevel;
  semester: Semester;
}

export interface Section {
  id: string;
  name: string;
  programId: string;
  yearLevel: YearLevel;
  studentCount: number;
}

export interface ScheduleEntry {
  id: string;
  courseId: string;
  sectionId: string;
  professorId: string;
  roomId: string;
  day: Day;
  startHour: number;
  endHour: number;
}

export interface ScheduleConflict {
  type: "professor" | "room" | "capacity" | "availability";
  message: string;
  entries: string[];
}

export interface ScheduleHistoryEntry {
  id: string;
  generatedAt: number;
  semester: Semester;
  label: string;
  entries: ScheduleEntry[];
  unscheduledCount: number;
}

export function professorDisplayName(
  p: Pick<Professor, "firstName" | "middleName" | "lastName">,
): string {
  const mid = p.middleName?.trim() ? ` ${p.middleName.trim()[0]}.` : "";
  return `${p.firstName}${mid} ${p.lastName}`.trim();
}

export function sectionDisplayName(
  s: Pick<Section, "name" | "programId" | "yearLevel">,
  programs: Program[],
): string {
  const program = programs.find((p) => p.id === s.programId);
  return `${program?.code ?? "?"} ${s.yearLevel}${s.name}`;
}

export function coursesForPlacement(
  courses: Course[],
  curriculums: Curriculum[],
  programId: string,
  yearLevel: YearLevel,
  semester: Semester,
): Course[] {
  const courseIds = new Set(
    curriculums
      .filter(
        (cu) =>
          cu.programId === programId &&
          cu.yearLevel === yearLevel &&
          cu.semester === semester,
      )
      .map((cu) => cu.courseId),
  );
  return courses.filter((c) => courseIds.has(c.id));
}

export function placementsOfCourse(
  curriculums: Curriculum[],
  courseId: string,
): Curriculum[] {
  return curriculums.filter((cu) => cu.courseId === courseId);
}
