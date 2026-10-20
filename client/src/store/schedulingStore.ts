import { create } from "zustand";
import type {
  Professor,
  Room,
  Course,
  CourseType,
  Section,
  ScheduleEntry,
  Program,
  Semester,
  Curriculum,
  ScheduleHistoryEntry,
} from "@/types/scheduling";

interface SchedulingState {
  professors: Professor[];
  rooms: Room[];
  courses: Course[];
  courseTypes: CourseType[];
  sections: Section[];
  programs: Program[];
  curriculums: Curriculum[];
  schedule: ScheduleEntry[];
  activeTab: string;
  currentSemester: Semester;
  scheduleHistory: ScheduleHistoryEntry[];

  setCurrentSemester: (s: Semester) => void;

  updateScheduleEntry: (id: string, updates: Partial<ScheduleEntry>) => void;

  setProfessors: (p: Professor[]) => void;
  addProfessor: (p: Professor) => void;
  updateProfessor: (id: string, updates: Partial<Professor>) => void;
  removeProfessor: (id: string) => void;

  setRooms: (r: Room[]) => void;
  addRoom: (r: Room) => void;
  updateRoom: (id: string, updates: Partial<Room>) => void;
  removeRoom: (id: string) => void;

  setCourseTypes: (ct: CourseType[]) => void;
  addCourseType: (ct: CourseType) => void;
  updateCourseType: (id: string, updates: Partial<CourseType>) => void;
  removeCourseType: (id: string) => void;

  setPrograms: (p: Program[]) => void;
  addProgram: (p: Program) => void;
  updateProgram: (id: string, updates: Partial<Program>) => void;
  removeProgram: (id: string) => void;

  setCourses: (c: Course[]) => void;
  addCourse: (c: Course) => void;
  updateCourse: (id: string, updates: Partial<Course>) => void;
  removeCourse: (id: string) => void;

  setCurriculums: (c: Curriculum[]) => void;
  addCurriculum: (c: Curriculum) => void;
  removeCurriculum: (id: string) => void;
  removeCurriculumsForCourse: (courseId: string) => void;
  replaceCurriculumsForCourse: (
    courseId: string,
    entries: Omit<Curriculum, "id" | "courseId">[],
  ) => void;

  setSections: (s: Section[]) => void;
  addSection: (s: Section) => void;
  updateSection: (id: string, updates: Partial<Section>) => void;
  removeSection: (id: string) => void;

  setSchedule: (s: ScheduleEntry[]) => void;
  setActiveTab: (tab: string) => void;
  pushScheduleHistory: (entry: ScheduleHistoryEntry) => void;
  restoreScheduleHistory: (id: string) => void;
  removeScheduleHistory: (id: string) => void;
  clearScheduleHistory: () => void;
}

const sampleCourseTypes: CourseType[] = [
  {
    id: "1",
    name: "Lecture",
    description: "Regular lecture class",
    totalHours: 3,
  },
  {
    id: "2",
    name: "Laboratory",
    description: "Hands-on lab session",
    totalHours: 5,
  },
];

const samplePrograms: Program[] = [
  { id: "p1", code: "BSIT", name: "BS Information Technology" },
  { id: "p2", code: "BSCS", name: "BS Computer Science" },
  { id: "p3", code: "BSBA", name: "BS Business Administration" },
  { id: "p4", code: "BSTM", name: "BS Tourism Management" },
  { id: "p5", code: "BSHM", name: "BS Hospitality Management" },
];

const sampleProfessors: Professor[] = [
  {
    id: "1",
    instructorId: "INS-0001",
    firstName: "Maria",
    middleName: "L",
    lastName: "Santos",
    department: "Computer Science",
    availability: [
      { day: "Monday", startHour: 7, endHour: 17 },
      { day: "Tuesday", startHour: 7, endHour: 17 },
      { day: "Wednesday", startHour: 7, endHour: 17 },
      { day: "Thursday", startHour: 7, endHour: 17 },
      { day: "Friday", startHour: 7, endHour: 12 },
    ],
  },
  {
    id: "2",
    instructorId: "INS-0002",
    firstName: "Juan",
    lastName: "Cruz",
    department: "Information Technology",
    availability: [
      { day: "Monday", startHour: 8, endHour: 18 },
      { day: "Tuesday", startHour: 8, endHour: 18 },
      { day: "Wednesday", startHour: 8, endHour: 18 },
      { day: "Thursday", startHour: 8, endHour: 18 },
    ],
  },
  {
    id: "3",
    instructorId: "INS-0003",
    firstName: "Ana",
    middleName: "R",
    lastName: "Reyes",
    department: "Computer Science",
    availability: [
      { day: "Monday", startHour: 9, endHour: 17 },
      { day: "Wednesday", startHour: 9, endHour: 17 },
      { day: "Friday", startHour: 9, endHour: 17 },
    ],
  },
];

const sampleCourses: Course[] = [
  {
    id: "1",
    code: "CS101",
    name: "Intro to Programming",
    courseTypeId: "1",
    professorIds: ["1"],
  },
  {
    id: "2",
    code: "CS101L",
    name: "Intro to Programming Lab",
    courseTypeId: "2",
    professorIds: ["1"],
  },
  {
    id: "3",
    code: "IT201",
    name: "Database Systems",
    courseTypeId: "1",
    professorIds: ["2"],
  },
  {
    id: "4",
    code: "IT201L",
    name: "Database Systems Lab",
    courseTypeId: "2",
    professorIds: ["2"],
  },
  {
    id: "5",
    code: "CS301",
    name: "Algorithms",
    courseTypeId: "1",
    professorIds: ["3"],
  },
];

const sampleCurriculums: Curriculum[] = [
  { id: "cu1", courseId: "1", programId: "p2", yearLevel: 1, semester: 1 },
  { id: "cu2", courseId: "1", programId: "p1", yearLevel: 1, semester: 1 },
  { id: "cu3", courseId: "2", programId: "p2", yearLevel: 1, semester: 1 },
  { id: "cu4", courseId: "2", programId: "p1", yearLevel: 1, semester: 1 },
  { id: "cu5", courseId: "3", programId: "p1", yearLevel: 2, semester: 1 },
  { id: "cu6", courseId: "4", programId: "p1", yearLevel: 2, semester: 1 },
  { id: "cu7", courseId: "5", programId: "p2", yearLevel: 3, semester: 1 },
];

const sampleSections: Section[] = [
  { id: "1", name: "A", programId: "p2", yearLevel: 1, studentCount: 35 },
  { id: "2", name: "A", programId: "p1", yearLevel: 2, studentCount: 30 },
  { id: "3", name: "A", programId: "p2", yearLevel: 3, studentCount: 25 },
];

export const useSchedulingStore = create<SchedulingState>((set) => ({
  professors: sampleProfessors,
  rooms: [],
  courseTypes: sampleCourseTypes,
  programs: samplePrograms,
  courses: sampleCourses,
  curriculums: sampleCurriculums,
  sections: sampleSections,
  schedule: [],
  activeTab: "dashboard",
  currentSemester: 1,
  scheduleHistory: [],

  setCurrentSemester: (s) => set({ currentSemester: s }),

  setProfessors: (p) => set({ professors: p }),
  addProfessor: (p) => set((s) => ({ professors: [...s.professors, p] })),
  updateProfessor: (id, updates) =>
    set((s) => ({
      professors: s.professors.map((p) =>
        p.id === id ? { ...p, ...updates } : p,
      ),
    })),
  removeProfessor: (id) =>
    set((s) => ({ professors: s.professors.filter((p) => p.id !== id) })),

  setRooms: (r) => set({ rooms: r }),
  addRoom: (r) => set((s) => ({ rooms: [...s.rooms, r] })),
  updateRoom: (id, updates) =>
    set((s) => ({
      rooms: s.rooms.map((r) => (r.id === id ? { ...r, ...updates } : r)),
    })),
  removeRoom: (id) =>
    set((s) => ({ rooms: s.rooms.filter((r) => r.id !== id) })),

  setCourseTypes: (ct) => set({ courseTypes: ct }),
  addCourseType: (ct) => set((s) => ({ courseTypes: [...s.courseTypes, ct] })),
  updateCourseType: (id, updates) =>
    set((s) => ({
      courseTypes: s.courseTypes.map((ct) =>
        ct.id === id ? { ...ct, ...updates } : ct,
      ),
    })),
  removeCourseType: (id) =>
    set((s) => ({ courseTypes: s.courseTypes.filter((ct) => ct.id !== id) })),

  setPrograms: (p) => set({ programs: p }),
  addProgram: (p) => set((s) => ({ programs: [...s.programs, p] })),
  updateProgram: (id, updates) =>
    set((s) => ({
      programs: s.programs.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    })),
  removeProgram: (id) =>
    set((s) => ({ programs: s.programs.filter((p) => p.id !== id) })),

  setCourses: (c) => set({ courses: c }),
  addCourse: (c) => set((s) => ({ courses: [...s.courses, c] })),
  updateCourse: (id, updates) =>
    set((s) => ({
      courses: s.courses.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),
  removeCourse: (id) =>
    set((s) => ({
      courses: s.courses.filter((c) => c.id !== id),
      curriculums: s.curriculums.filter((cu) => cu.courseId !== id),
    })),

  setCurriculums: (c) => set({ curriculums: c }),
  addCurriculum: (c) => set((s) => ({ curriculums: [...s.curriculums, c] })),
  removeCurriculum: (id) =>
    set((s) => ({ curriculums: s.curriculums.filter((cu) => cu.id !== id) })),
  removeCurriculumsForCourse: (courseId) =>
    set((s) => ({
      curriculums: s.curriculums.filter((cu) => cu.courseId !== courseId),
    })),
  replaceCurriculumsForCourse: (courseId, entries) =>
    set((s) => {
      const others = s.curriculums.filter((cu) => cu.courseId !== courseId);
      const added: Curriculum[] = entries.map((e, i) => ({
        id: `cu-${courseId}-${Date.now()}-${i}`,
        courseId,
        programId: e.programId,
        yearLevel: e.yearLevel,
        semester: e.semester,
      }));
      return { curriculums: [...others, ...added] };
    }),

  setSections: (s) => set({ sections: s }),
  addSection: (sec) => set((s) => ({ sections: [...s.sections, sec] })),
  updateSection: (id, updates) =>
    set((s) => ({
      sections: s.sections.map((sec) =>
        sec.id === id ? { ...sec, ...updates } : sec,
      ),
    })),
  removeSection: (id) =>
    set((s) => ({ sections: s.sections.filter((sec) => sec.id !== id) })),

  setSchedule: (s) => set({ schedule: s }),
  updateScheduleEntry: (id, updates) =>
    set((s) => ({
      schedule: s.schedule.map((e) => (e.id === id ? { ...e, ...updates } : e)),
    })),
  setActiveTab: (tab) => set({ activeTab: tab }),

  pushScheduleHistory: (entry) =>
    set((s) => ({
      scheduleHistory: [entry, ...s.scheduleHistory].slice(0, 20),
    })),
  restoreScheduleHistory: (id) =>
    set((s) => {
      const h = s.scheduleHistory.find((x) => x.id === id);
      return h
        ? {
            schedule: h.entries.map((e) => ({ ...e })),
            currentSemester: h.semester,
          }
        : {};
    }),
  removeScheduleHistory: (id) =>
    set((s) => ({
      scheduleHistory: s.scheduleHistory.filter((x) => x.id !== id),
    })),
  clearScheduleHistory: () => set({ scheduleHistory: [] }),
}));
