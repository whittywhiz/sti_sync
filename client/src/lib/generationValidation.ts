import type {
  Professor,
  Room,
  Course,
  CourseType,
  Section,
  Program,
  Curriculum,
  Semester,
} from "@/types/scheduling";
import { coursesForPlacement, sectionDisplayName } from "@/types/scheduling";

export interface ValidationIssue {
  severity: "error" | "warning";
  message: string;
}

interface ValidateInput {
  professors: Professor[];
  rooms: Room[];
  courses: Course[];
  courseTypes: CourseType[];
  sections: Section[];
  programs: Program[];
  curriculums: Curriculum[];
  currentSemester: Semester;
}

export function validateGeneration(input: ValidateInput): ValidationIssue[] {
  const { courses, sections, curriculums, currentSemester } = input;
  const issues: ValidationIssue[] = [];

  const neededCourseIds = new Set<string>();
  for (const section of sections) {
    const sectionCourses = coursesForPlacement(
      courses,
      curriculums,
      section.programId,
      section.yearLevel,
      currentSemester,
    );
    sectionCourses.forEach((c) => neededCourseIds.add(c.id));
  }

  for (const course of courses) {
    if (!neededCourseIds.has(course.id)) continue;
    if (!course.professorIds || course.professorIds.length === 0) {
      issues.push({
        severity: "error",
        message: `Course ${course.code} has no assigned professor.`,
      });
    }
  }

  return issues;
}
