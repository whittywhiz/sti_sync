export interface RoomData {
  room_id: number;
  room_number: string;
  capacity: number;
  type: string | null;
}

export interface EmployeeData {
  employee_id: number;
  department: string | null;
  name: string;
  max_hours_per_day: number | null;
  max_hours_per_week: number | null;
}

export interface SectionData {
  section_id: number;
  number_of_students: number;
  year_level: string;
  program_id: number;
}

export interface CourseData {
  course_code: string;
  course_description: string;
  course_type_id: number;
  course_type_description: string;
  total_hours: number;
}

export interface CurriculumEntry {
  curriculum_id: number;
  year_level: string;
  program_id: number;
  course_code: string;
}

export interface CourseEmployeeEntry {
  course_code: string;
  employee_id: number;
}

export interface AvailabilityData {
  availability_id: number;
  employee_id: number;
  day_id: number;
  start_time: string;
  end_time: string;
}

export interface DayData {
  day_id: number;
  name: string;
}

export interface SchedulingInput {
  rooms: RoomData[];
  employees: EmployeeData[];
  sections: SectionData[];
  courses: CourseData[];
  curriculum: CurriculumEntry[];
  course_employees: CourseEmployeeEntry[];
  availability: AvailabilityData[];
  days: DayData[];
  schedule_id: number;
}

export interface ClassAssignment {
  course_code: string;
  section_id: number;
  employee_id: number;
  room_id: number;
  day_id: number;
  start_time: string;
  end_time: string;
  session_number: 1 | 2;
  session_duration_hours: number;
}

export interface Candidate {
  assignments: ClassAssignment[];
  fitness: number;
}

export interface ConstraintViolation {
  type:
    | "ROOM_CONFLICT"
    | "EMPLOYEE_CONFLICT"
    | "SECTION_CONFLICT"
    | "ROOM_CAPACITY_EXCEEDED"
    | "EMPLOYEE_UNAVAILABLE"
    | "ROOM_TYPE_MISMATCH"
    | "EMPLOYEE_MAX_HOURS_EXCEEDED"
    | "LAB_PREFERENCE_UNMET"
    | "HOME_LAB_PREFERENCE_UNMET"
    | "LONG_VACANT_GAP";
  message: string;
  weight: number;
}
export interface FitnessResult {
  fitness: number;
  violations: ConstraintViolation[];
}

export const PROGRAM_HOME_LAB_ROOM_NUMBERS: Record<number, string[]> = {
  4: ["Lab-1", "Lab-2"],
  5: ["Lab-1", "Lab-2"],
  6: ["Lab-1", "Lab-2"],
};
