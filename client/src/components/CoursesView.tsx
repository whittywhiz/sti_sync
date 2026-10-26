import { useState, useMemo, useEffect } from "react";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  Search,
  BookOpen,
  ChevronDown,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authFetch } from "../lib/authFetch";
import { createPortal } from "react-dom";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ImportExcelButton } from "@/components/ImportExcelButton";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Modal } from "@/components/Modal";

interface Course {
  course_code: string;
  course_description: string;
  course_type_id: number;
}

interface CourseType {
  course_type_id: number;
  course_type_description: string;
  total_hours: number;
}

interface Program {
  program_id: number;
  description: string;
}

interface Curriculum {
  curriculum_id: number;
  year_level: string;
  program_id: number;
  course_code: string;
  term?: string;
  subject_type?: "Major" | "Minor";
}

interface Employee {
  employee_id: number;
  name: string;
  department: string;
}

interface Placement {
  program_id: number;
  year_level: string;
  term?: string;
  subject_type?: "Major" | "Minor";
}

interface CourseFormValues {
  course_code: string;
  course_description: string;
  course_type_id: number | "";
  placements: Placement[];
  employee_ids: number[];
}

interface CourseFormProps {
  initial: CourseFormValues;
  programs: Program[];
  courseTypes: CourseType[];
  employees: Employee[];
  onSave: (v: CourseFormValues) => void;
  onCancel: () => void;
}

const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const TERMS = ["1st Semester", "2nd Semester"];
const UNPLACED = 0;

function CourseForm({
  initial,
  programs,
  courseTypes,
  employees,
  onSave,
  onCancel,
}: CourseFormProps) {
  const [courseCode, setCourseCode] = useState(initial.course_code);
  const [description, setDescription] = useState(initial.course_description);
  const [courseTypeId, setCourseTypeId] = useState<number | "">(
    initial.course_type_id,
  );
  const [placements, setPlacements] = useState<Placement[]>(
    initial.placements.length
      ? initial.placements.map((p) => ({
          ...p,
          term: p.term ?? "1st Semester",
        }))
      : [
          {
            program_id: programs[0]?.program_id ?? 0,
            year_level: "1st Year",
            term: "1st Semester",
          },
        ],
  );
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<number[]>(
    initial.employee_ids,
  );
  const [error, setError] = useState("");
  const [profOpen, setProfOpen] = useState(false);
  const [profSearch, setProfSearch] = useState("");

  const filteredEmployees = employees.filter((e) => {
    const q = profSearch.trim().toLowerCase();
    if (!q) return true;
    const startsWord = (text: string) =>
      text
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(q));
    return startsWord(e.name) || startsWord(e.department ?? "");
  });

  const updatePlacement = (i: number, patch: Partial<Placement>) =>
    setPlacements((ps) =>
      ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)),
    );
  const addPlacement = () =>
    setPlacements((ps) => [
      ...ps,
      {
        program_id: programs[0]?.program_id ?? 0,
        year_level: "1st Year",
        term: "1st Semester",
      },
    ]);
  const removePlacement = (i: number) =>
    setPlacements((ps) => ps.filter((_, idx) => idx !== i));

  const toggleEmployee = (id: number) =>
    setSelectedEmployeeIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id],
    );

  const handleSave = () => {
    if (!courseCode.trim()) {
      setError("Course code is required.");
      return;
    }
    if (!description.trim()) {
      setError("Course description is required.");
      return;
    }
    if (!courseTypeId) {
      setError("Course type is required.");
      return;
    }
    const keys = placements.map(
      (p) => `${p.program_id}|${p.year_level}|${p.term}`,
    );
    if (new Set(keys).size !== keys.length) {
      setError(
        "Two placements have the same program, year level and term. Remove one.",
      );
      return;
    }
    setError("");
    onSave({
      course_code: courseCode,
      course_description: description,
      course_type_id: courseTypeId,
      placements,
      employee_ids: selectedEmployeeIds,
    });
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSave();
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-4">
        <Input
          placeholder="Course Code (e.g. CS101)"
          value={courseCode}
          onChange={(e) => setCourseCode(e.target.value)}
        />
        <Input
          placeholder="Course Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <Select
        value={courseTypeId ? String(courseTypeId) : ""}
        onValueChange={(v) => setCourseTypeId(Number(v))}
      >
        <SelectTrigger>
          <SelectValue placeholder="Course Type" />
        </SelectTrigger>
        <SelectContent>
          {courseTypes.map((ct) => (
            <SelectItem
              key={ct.course_type_id}
              value={String(ct.course_type_id)}
            >
              {ct.course_type_description} ({ct.total_hours} hrs)
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm font-medium">
            Curriculum Placements ({placements.length})
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addPlacement}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add Program
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mb-2">
          Add one row per program + year level + semester this course belongs
          to.
        </p>
        <div className="space-y-2">
          {placements.map((pl, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_130px_150px_120px_auto] gap-2 items-center"
            >
              <Select
                value={String(pl.program_id)}
                onValueChange={(v) =>
                  updatePlacement(i, { program_id: Number(v) })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Program" />
                </SelectTrigger>
                <SelectContent>
                  {programs.map((p) => (
                    <SelectItem key={p.program_id} value={String(p.program_id)}>
                      {p.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={pl.year_level}
                onValueChange={(v) => updatePlacement(i, { year_level: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {YEAR_LEVELS.map((y) => (
                    <SelectItem key={y} value={y}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={pl.term ?? "1st Semester"}
                onValueChange={(v) => updatePlacement(i, { term: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TERMS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={pl.subject_type ?? "Major"}
                onValueChange={(v) =>
                  updatePlacement(i, {
                    subject_type: v as "Major" | "Minor",
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Subject Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Major">Major</SelectItem>
                  <SelectItem value="Minor">Minor</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removePlacement(i)}
                disabled={placements.length === 1}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium mb-2">
          Assigned Professors ({selectedEmployeeIds.length})
        </p>
        <button
          type="button"
          onClick={() => setProfOpen((o) => !o)}
          className="flex w-full h-10 items-center justify-between rounded-md border border-input bg-background px-3 text-sm"
        >
          <span className="text-muted-foreground">
            {selectedEmployeeIds.length
              ? `${selectedEmployeeIds.length} selected`
              : "Select professors"}
          </span>
          <ChevronDown
            className={`w-4 h-4 transition-transform ${profOpen ? "rotate-180" : ""}`}
          />
        </button>

        {profOpen && (
          <div className="mt-1 rounded-md border bg-background">
            <div className="relative p-2 border-b">
              <Search className="w-4 h-4 absolute left-5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search professor or department…"
                value={profSearch}
                onChange={(e) => setProfSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                className="pl-9 h-9"
              />
            </div>
            <div className="max-h-48 overflow-y-auto">
              {filteredEmployees.length === 0 && (
                <p className="p-3 text-xs text-muted-foreground">
                  No professors found.
                </p>
              )}
              {filteredEmployees.map((e) => (
                <label
                  key={e.employee_id}
                  className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={selectedEmployeeIds.includes(e.employee_id)}
                    onChange={() => toggleEmployee(e.employee_id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span>{e.name}</span>
                  <span className="text-xs text-muted-foreground">
                    · {e.department}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {selectedEmployeeIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {employees
              .filter((e) => selectedEmployeeIds.includes(e.employee_id))
              .map((e) => (
                <button
                  type="button"
                  key={e.employee_id}
                  onClick={() => toggleEmployee(e.employee_id)}
                  className="text-xs px-2 py-1 rounded-full bg-secondary hover:bg-destructive/10"
                >
                  {e.name} ✕
                </button>
              ))}
          </div>
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex gap-2">
        <Button type="submit" size="sm">
          <Check className="w-4 h-4 mr-1" /> Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="!bg-white hover:!bg-accent"
          onClick={onCancel}
        >
          <X className="w-4 h-4 mr-1" /> Cancel
        </Button>
      </div>
    </form>
  );
}

export function CoursesView() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseTypes, setCourseTypes] = useState<CourseType[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [curriculums, setCurriculums] = useState<Curriculum[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingEmployeeIds, setEditingEmployeeIds] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [filterProgram, setFilterProgram] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [assignedCodes, setAssignedCodes] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const keyOf = (progId: number, code: string) => `${progId}|${code}`;
  const codeOf = (key: string) => key.slice(key.indexOf("|") + 1);

  const selectedCodes = useMemo(
    () => Array.from(new Set(selected.map(codeOf))),
    [selected],
  );

  const fetchAll = async () => {
    setLoading(true);

    try {
      const responses = await Promise.all([
        fetch("/api/courses"),
        fetch("/api/course-types"),
        fetch("/api/programs"),
        fetch("/api/curriculum"),
        fetch("/api/employees"),
        fetch("/api/course-employees"),
      ]);
      const [c, t, p, cu, e, a] = await Promise.all(
        responses.map((r) => r.json()),
      );
      setCourses(c);
      setCourseTypes(t);
      setPrograms(p);
      setCurriculums(cu);
      setEmployees(e);
      setAssignedCodes(
        new Set(Array.isArray(a) ? a.map((r: any) => r.course_code) : []),
      );
    } catch (err) {
      console.error("Failed to fetch courses data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const saveCurriculumForCourse = async (
    courseCode: string,
    placements: Placement[],
  ) => {
    const existing = curriculums.filter((c) => c.course_code === courseCode);

    const post = (p: {
      year_level: string;
      program_id: number;
      term?: string;
      subject_type?: "Major" | "Minor" | null;
    }) =>
      fetch("/api/curriculum", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          year_level: p.year_level,
          program_id: p.program_id,
          course_code: courseCode,
          term: p.term ?? "1st Semester",
          subject_type: p.subject_type ?? null,
        }),
      });

    await Promise.all(
      existing.map((c) =>
        fetch(`/api/curriculum/${c.curriculum_id}`, { method: "DELETE" }),
      ),
    );

    const results = await Promise.all(placements.map(post));
    const bad = results.find((r) => !r.ok);
    if (bad) {
      const data = await bad.json().catch(() => ({}));
      await Promise.all(
        existing.map((c) =>
          post({
            year_level: c.year_level,
            program_id: c.program_id,
            term: c.term,
            subject_type: c.subject_type,
          }),
        ),
      );
      throw new Error(data.error ?? "Could not save curriculum placements");
    }
  };

  const saveCourseEmployees = async (
    courseCode: string,
    employeeIds: number[],
  ) => {
    await fetch(`/api/courses/${courseCode}/employees`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employee_ids: employeeIds }),
    });
  };

  const changeSubjectType = async (curriculumId: number, value: string) => {
    const res = await fetch(`/api/curriculum/${curriculumId}/subject-type`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject_type: value }),
    });
    if (res.ok) fetchAll();
    else toast.error("Failed to update subject type");
  };

  const handleAdd = async (v: CourseFormValues) => {
    const code = v.course_code.trim();
    if (!code || !v.course_description || !v.course_type_id) return;
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_code: code,
          course_description: v.course_description,
          course_type_id: v.course_type_id,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not add the course.");
        return;
      }
      await saveCourseEmployees(code, v.employee_ids);
      await saveCurriculumForCourse(code, v.placements);
      setShowForm(false);
      fetchAll();
    } catch (err) {
      console.error("Failed to create course", err);
      toast.error(err instanceof Error ? err.message : "Could not save.");
    }
  };

  const handleEdit = async (v: CourseFormValues) => {
    if (!editingId || !v.course_description || !v.course_type_id) return;
    try {
      const res = await fetch(`/api/courses/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          course_description: v.course_description,
          course_type_id: v.course_type_id,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Could not update the course.");
        return;
      }
      await saveCurriculumForCourse(editingId, v.placements);
      await saveCourseEmployees(editingId, v.employee_ids);
      setEditingId(null);
      fetchAll();
    } catch (err) {
      console.error("Failed to update course", err);
      toast.error(
        err instanceof Error
          ? `${err.message}. Placements were restored.`
          : "Could not save the course placements.",
      );
    }
  };

  const startEdit = async (code: string) => {
    setShowForm(false);
    try {
      const res = await fetch(`/api/courses/${code}/employees`);
      const data = await res.json();
      setEditingEmployeeIds(
        Array.isArray(data) ? data.map((e: any) => e.employee_id) : [],
      );
    } catch (err) {
      console.error("Failed to fetch assigned professors", err);
      setEditingEmployeeIds([]);
    }
    setEditingId(code);
  };

  const removeCourse = async (code: string) => {
    try {
      const res = await fetch(`/api/courses/${code}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error ?? "Failed to delete course");
        return;
      }
      setSelected((s) => s.filter((k) => codeOf(k) !== code));
      fetchAll();
    } catch (err) {
      console.error("Failed to delete course", err);
      toast.error("Failed to delete course");
    }
  };

  const toggleSelect = (key: string) =>
    setSelected((s) =>
      s.includes(key) ? s.filter((x) => x !== key) : [...s, key],
    );

  const toggleGroup = (list: Course[], progId: number) => {
    const keys = list.map((c) => keyOf(progId, c.course_code));
    const allChecked = keys.every((k) => selected.includes(k));

    setSelected((s) =>
      allChecked
        ? s.filter((x) => !keys.includes(x))
        : Array.from(new Set([...s, ...keys])),
    );
  };

  const removeSelected = async () => {
    const codes = [...selectedCodes];
    const failed: string[] = [];
    let firstError = "";
    for (const code of codes) {
      try {
        const res = await fetch(`/api/courses/${code}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failed.push(code);
          if (!firstError) firstError = data.error ?? "";
        }
      } catch {
        failed.push(code);
      }
    }
    const deleted = codes.length - failed.length;
    if (deleted > 0) {
      toast.success(`Deleted ${deleted} course${deleted !== 1 ? "s" : ""}`);
    }
    if (failed.length > 0) {
      toast.error(
        `Could not delete ${failed.join(", ")}${firstError ? `: ${firstError}` : ""}`,
      );
    }
    setSelected((s) => s.filter((k) => failed.includes(codeOf(k))));
    fetchAll();
  };

  const placementsByCourse = useMemo(() => {
    const map = new Map<string, Curriculum[]>();
    for (const cu of curriculums) {
      const arr = map.get(cu.course_code) ?? [];
      arr.push(cu);
      map.set(cu.course_code, arr);
    }
    return map;
  }, [curriculums]);

  const placementsOfCourse = (code: string) =>
    placementsByCourse.get(code) ?? [];

  const matchesType = (cu: Curriculum) =>
    filterType === "all" || (cu.subject_type ?? "Major") === filterType;

  const filtered = useMemo(() => {
    const matchingCuls = curriculums.filter(
      (cu) =>
        (filterProgram === "all" || cu.program_id === Number(filterProgram)) &&
        matchesType(cu),
    );
    const matchedCodes = new Set(matchingCuls.map((cu) => cu.course_code));

    return courses
      .filter((c) => matchedCodes.has(c.course_code))
      .filter((c) => {
        if (!search) return true;
        const q = search.toLowerCase();
        return (
          c.course_code.toLowerCase().includes(q) ||
          c.course_description.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.course_code.localeCompare(b.course_code));
  }, [courses, curriculums, filterProgram, filterType, search]);

  const unplaced = useMemo(() => {
    if (filterProgram !== "all" || filterType !== "all") return [];
    const placed = new Set(curriculums.map((cu) => cu.course_code));
    const q = search.toLowerCase();
    return courses
      .filter((c) => !placed.has(c.course_code))
      .filter(
        (c) =>
          !q ||
          c.course_code.toLowerCase().includes(q) ||
          c.course_description.toLowerCase().includes(q),
      )
      .sort((a, b) => a.course_code.localeCompare(b.course_code));
  }, [courses, curriculums, filterProgram, filterType, search]);

  const grouped = useMemo(() => {
    const map = new Map<number, Course[]>();
    filtered.forEach((c) => {
      const cPlacements = placementsOfCourse(c.course_code).filter(matchesType);
      const progIds =
        filterProgram === "all"
          ? Array.from(new Set(cPlacements.map((cu) => cu.program_id)))
          : [Number(filterProgram)];
      progIds.forEach((pid) => {
        const arr = map.get(pid) ?? [];
        arr.push(c);
        map.set(pid, arr);
      });
    });
    return Array.from(map.entries()).sort((a, b) => {
      const pa = programs.find((p) => p.program_id === a[0])?.description ?? "";
      const pb = programs.find((p) => p.program_id === b[0])?.description ?? "";
      return pa.localeCompare(pb);
    });
  }, [filtered, programs, filterProgram, filterType, curriculums]);

  const allKeys = useMemo(
    () => [
      ...grouped.flatMap(([pid, list]) =>
        list.map((c) => keyOf(pid, c.course_code)),
      ),
      ...unplaced.map((c) => keyOf(UNPLACED, c.course_code)),
    ],
    [grouped, unplaced],
  );

  const editingCourse = courses.find((c) => c.course_code === editingId);

  const renderTable = (list: Course[], progId: number) => {
    const allChecked =
      list.length > 0 &&
      list.every((c) => selected.includes(keyOf(progId, c.course_code)));
    return (
      <div className="glass-card rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-background text-xs font-semibold text-muted-foreground">
            <tr className="border-b">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={() => toggleGroup(list, progId)}
                  aria-label="Select all courses in this group"
                  className="h-4 w-4 cursor-pointer accent-primary"
                />
              </th>
              <th className="px-4 py-3 text-left">Code</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Placement</th>
              <th className="px-4 py-3 text-left">Professor</th>
              <th className="px-4 py-0 text-right whitespace-nowrap">
                {list.some((c) =>
                  selected.includes(keyOf(progId, c.course_code)),
                ) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-7 px-2 text-xs"
                    onClick={() => setBulkDeleteOpen(true)}
                  >
                    <Trash2 className="w-3.5 h-3.5 mr-1" />
                    Delete ({selectedCodes.length})
                  </Button>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => {
              const ct = courseTypes.find(
                (t) => t.course_type_id === c.course_type_id,
              );
              const placementsHere =
                progId === UNPLACED
                  ? []
                  : placementsOfCourse(c.course_code).filter(
                      (cu) => cu.program_id === progId && matchesType(cu),
                    );
              const isSelected = selected.includes(
                keyOf(progId, c.course_code),
              );
              return (
                <tr
                  key={`${progId}-${c.course_code}`}
                  className={`border-b last:border-0 hover:bg-muted/40 ${
                    isSelected ? "bg-primary/5" : ""
                  }`}
                >
                  <td className="px-4 py-3 align-top">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() =>
                        toggleSelect(keyOf(progId, c.course_code))
                      }
                      aria-label={`Select ${c.course_code}`}
                      className="h-4 w-4 cursor-pointer accent-primary"
                    />
                  </td>
                  <td className="px-4 py-3 align-top font-mono font-semibold text-primary whitespace-nowrap">
                    {c.course_code}
                  </td>
                  <td className="px-4 py-3 align-top font-medium">
                    {c.course_description}
                  </td>
                  <td className="px-4 py-3 align-top text-muted-foreground whitespace-nowrap">
                    {ct?.course_type_description || "Unknown"}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {progId === UNPLACED ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 border border-red-200">
                        No program placement
                      </span>
                    ) : (
                      <div className="flex flex-col gap-1.5">
                        {placementsHere.map((cu) => (
                          <span
                            key={cu.curriculum_id}
                            className="flex items-center gap-1"
                          >
                            <span className="text-xs px-2 py-0.5 rounded-full bg-secondary whitespace-nowrap">
                              {cu.year_level}
                              {cu.term
                                ? ` · ${cu.term.replace(" Semester", " Sem")}`
                                : ""}
                            </span>
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    {!assignedCodes.has(c.course_code) && (
                      <span
                        title="No professor assigned. Any available professor can be scheduled."
                        className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 whitespace-nowrap"
                      >
                        No professor assigned
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => startEdit(c.course_code)}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setDeleteTarget(c.course_code)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-50 bg-background pt-4 pb-4 -mx-6 px-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-heading text-2xl font-bold">Courses</h2>
            <p className="text-muted-foreground mt-1">
              Catalog of courses with curriculum placements per program.
            </p>
          </div>
          <div className="flex gap-2">
            <span
              className="inline-block [&_button]:!bg-white [&_button]:!text-gray-800 [&_button]:!border
  [&_button]:!border-gray-300 hover:[&_button]:!bg-gray-100 [&_button]:rounded-md"
            >
              <ImportExcelButton
                endpoint="/api/courses/import"
                onDone={fetchAll}
              />
            </span>

            <Button
              onClick={() => {
                setShowForm(true);
                setEditingId(null);
              }}
            >
              <Plus className="w-4 h-4 mr-1" /> Add Course
            </Button>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search code or description…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setEditingId(null);
              }}
              className="pl-9"
            />
          </div>
          <Select value={filterProgram} onValueChange={setFilterProgram}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Programs</SelectItem>
              {programs.map((p) => (
                <SelectItem key={p.program_id} value={String(p.program_id)}>
                  {p.description}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subjects</SelectItem>
              <SelectItem value="Major">Major</SelectItem>
              <SelectItem value="Minor">Minor</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!loading && filtered.length === 0 && unplaced.length === 0 ? (
        <div className="glass-card rounded-xl p-10 text-center text-sm text-muted-foreground">
          <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-50" />
          No courses match the current filters.
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(([progId, list]) => {
            const program = programs.find((p) => p.program_id === progId);
            return (
              <div key={progId}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs text-muted-foreground">
                    {program?.description}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    • {list.length} course{list.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {renderTable(list, progId)}
              </div>
            );
          })}

          {unplaced.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-semibold text-destructive">
                  Unplaced courses
                </span>
                <span className="text-xs text-muted-foreground">
                  • {unplaced.length} course{unplaced.length !== 1 ? "s" : ""}{" "}
                  not in any program yet. Edit one to place it.
                </span>
              </div>
              {renderTable(unplaced, UNPLACED)}
            </div>
          )}
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Add Course"
        className="max-w-3xl"
      >
        <CourseForm
          initial={{
            course_code: "",
            course_description: "",
            course_type_id: "",
            placements: [],
            employee_ids: [],
          }}
          programs={programs}
          courseTypes={courseTypes}
          employees={employees}
          onSave={handleAdd}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      <Modal
        open={!!editingCourse}
        onClose={() => setEditingId(null)}
        title="Edit Course"
        className="max-w-3xl"
      >
        {editingCourse && (
          <CourseForm
            initial={{
              course_code: editingCourse.course_code,
              course_description: editingCourse.course_description,
              course_type_id: editingCourse.course_type_id,
              placements: placementsOfCourse(editingCourse.course_code).map(
                (cu) => ({
                  program_id: cu.program_id,
                  year_level: cu.year_level,
                  term: cu.term,
                  subject_type: cu.subject_type,
                }),
              ),
              employee_ids: editingEmployeeIds,
            }}
            programs={programs}
            courseTypes={courseTypes}
            employees={employees}
            onSave={handleEdit}
            onCancel={() => setEditingId(null)}
          />
        )}
      </Modal>

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title="Delete this course?"
        description={`Are you sure you want to delete ${deleteTarget}?`}
        onConfirm={() => {
          if (deleteTarget) removeCourse(deleteTarget);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDeleteDialog
        open={bulkDeleteOpen}
        title={`Delete ${selectedCodes.length} selected course${selectedCodes.length !== 1 ? "s" : ""}?`}
        description="Courses are shared across programs, so deleting a course removes it from every program it's placed in. Courses used by scheduled classes can't be deleted and will stay selected."
        onConfirm={() => {
          setBulkDeleteOpen(false);
          removeSelected();
        }}
        onCancel={() => setBulkDeleteOpen(false)}
      />
      {loading &&
        createPortal(
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
