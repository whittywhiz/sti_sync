import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { authFetch } from "../lib/authFetch";
import {
  Plus,
  Trash2,
  Pencil,
  Check,
  X,
  ChevronDown,
  Search,
  Copy,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Modal } from "@/components/Modal";
import { createPortal } from "react-dom";

interface Section {
  section_id: number;
  number_of_students: number;
  year_level: string;
  program_id: number;
  section_name: string | null;
}
interface Program {
  program_id: number;
  description: string;
  code: string;
}

interface Course {
  course_code: string;
  course_description: string;
}

interface Curriculum {
  curriculum_id: number;
  year_level: string;
  program_id: number;
  course_code: string;
}

interface Schedule {
  schedule_id: number;
  term: string;
  year: string;
  status: string;
  is_hidden: boolean;
}

const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const MAX_STUDENTS = 100;

interface SectionFormValues {
  section_name: string;
  program_id: number | "";
  year_level: string;
  number_of_students: number;
}

interface SectionFormProps {
  initial: SectionFormValues;
  programs: Program[];
  courses: Course[];
  curriculums: Curriculum[];
  onSave: (v: SectionFormValues) => void;
  onCancel: () => void;
}

function SectionForm({
  initial,
  programs,
  courses,
  curriculums,
  onSave,
  onCancel,
}: SectionFormProps) {
  const [sectionName, setSectionName] = useState(initial.section_name);
  const [programId, setProgramId] = useState<number | "">(initial.program_id);
  const [yearLevel, setYearLevel] = useState(initial.year_level);

  const [studentCount, setStudentCount] = useState(
    initial.number_of_students ? String(initial.number_of_students) : "",
  );
  const [error, setError] = useState("");

  const handleSave = () => {
    if (!programId) {
      setError("Program is required.");
      return;
    }
    const trimmedName = sectionName.trim().toUpperCase();
    if (!trimmedName) {
      setError("Section letter is required.");
      return;
    }
    if (trimmedName.length > 20) {
      setError("Section letter must be 20 characters or less.");
      return;
    }
    const countNum = Number(studentCount);
    if (
      !studentCount.trim() ||
      !Number.isInteger(countNum) ||
      countNum <= 0 ||
      countNum > MAX_STUDENTS
    ) {
      setError(
        `Number of students must be an integer between 1 and ${MAX_STUDENTS}.`,
      );
      return;
    }
    setError("");
    onSave({
      section_name: trimmedName,
      program_id: programId,
      year_level: yearLevel,
      number_of_students: countNum,
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
        <Select
          value={programId ? String(programId) : ""}
          onValueChange={(v) => setProgramId(Number(v))}
        >
          <SelectTrigger className="col-span-2">
            <SelectValue placeholder="Select Program" />
          </SelectTrigger>
          <SelectContent>
            {programs.map((p) => (
              <SelectItem key={p.program_id} value={String(p.program_id)}>
                {p.description}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={yearLevel} onValueChange={setYearLevel}>
          <SelectTrigger>
            <SelectValue placeholder="Year Level" />
          </SelectTrigger>
          <SelectContent>
            {YEAR_LEVELS.map((y) => (
              <SelectItem key={y} value={y}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Section Letter (e.g. A)"
          value={sectionName}
          onChange={(e) => setSectionName(e.target.value)}
          maxLength={20}
        />
        <Input
          type="number"
          placeholder="Number of Students"
          value={studentCount}
          onChange={(e) => setStudentCount(e.target.value)}
          min="1"
          max={MAX_STUDENTS}
        />
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

export function SectionsView() {
  const [sections, setSections] = useState<Section[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [curriculums, setCurriculums] = useState<Curriculum[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [activeSemester, setActiveSemester] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!dropdownOpen) return;

    const handleClickOutside = (e: PointerEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
      }
    };

    document.addEventListener("pointerdown", handleClickOutside, true);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handleClickOutside, true);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [dropdownOpen]);

  const [error, setError] = useState<string | null>(null);
  const [showSemForm, setShowSemForm] = useState(false);
  const [showCopy, setShowCopy] = useState(false);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [copyFrom, setCopyFrom] = useState("");
  const [semYear, setSemYear] = useState("");
  const [semTerm, setSemTerm] = useState("1st Semester");
  const [semStart, setSemStart] = useState("");
  const [semEnd, setSemEnd] = useState("");
  const [semError, setSemError] = useState("");
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Section | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [programFilter, setProgramFilter] = useState("");
  const [archiveTarget, setArchiveTarget] = useState<{
    s: Schedule;
    isActive: boolean;
  } | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [
        sectionsRes,
        programsRes,
        coursesRes,
        curriculumRes,
        schedulesRes,
      ] = await Promise.all([
        fetch("/api/sections"),
        fetch("/api/programs"),
        fetch("/api/courses"),
        fetch("/api/curriculum"),
        fetch("/api/schedules"),
      ]);
      setSections(await sectionsRes.json());
      setPrograms(await programsRes.json());
      setCourses(await coursesRes.json());
      setCurriculums(await curriculumRes.json());

      const schedulesData = await schedulesRes.json();
      setSchedules(schedulesData);

      const active = schedulesData.find((s: Schedule) => s.status === "active");
      setActiveSemester(active ? `${active.term} ${active.year}` : "");
    } catch (err) {
      console.error("Failed to fetch sections data", err);
      setError("Failed to load sections data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const handleAdd = async (v: SectionFormValues) => {
    if (!v.program_id || !v.year_level) return;
    try {
      const res = await fetch("/api/sections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_name: v.section_name,
          program_id: v.program_id,
          year_level: v.year_level,
          number_of_students: v.number_of_students,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorModal(data.error || "Failed to create section");
        return;
      }
      setShowForm(false);
      fetchAll();
    } catch (err) {
      console.error("Failed to create section", err);
      setError("Error creating section");
    }
  };

  const handleEdit = async (v: SectionFormValues) => {
    if (!editingId || !v.program_id || !v.year_level) return;
    try {
      const res = await fetch(`/api/sections/${editingId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          section_name: v.section_name,
          program_id: v.program_id,
          year_level: v.year_level,
          number_of_students: v.number_of_students,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErrorModal(data.error || "Failed to update section");
        return;
      }
      setEditingId(null);
      fetchAll();
    } catch (err) {
      console.error("Failed to update section", err);
      setError("Error updating section");
    }
  };

  const removeSection = async (id: number) => {
    try {
      const res = await fetch(`/api/sections/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Failed to delete section");
        return;
      }
      setSelected((s) => s.filter((x) => x !== id));
      fetchAll();
    } catch (err) {
      console.error("Failed to delete section", err);
      toast.error("Failed to delete section");
    }
  };

  const toggleSelect = (id: number) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id],
    );

  const removeSelected = async () => {
    const ids = [...selected];
    const failed: number[] = [];
    let firstError = "";
    for (const id of ids) {
      try {
        const res = await fetch(`/api/sections/${id}`, { method: "DELETE" });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          failed.push(id);
          if (!firstError) firstError = data.error ?? "";
        }
      } catch {
        failed.push(id);
      }
    }
    const deleted = ids.length - failed.length;
    if (deleted > 0) {
      toast.success(`Deleted ${deleted} section${deleted !== 1 ? "s" : ""}`);
    }
    if (failed.length > 0) {
      toast.error(
        `Could not delete ${failed.length} section${failed.length !== 1 ? "s" : ""}${firstError ? `: ${firstError}` : ""}`,
      );
    }
    setSelected(failed);
    fetchAll();
  };

  const handleActivateSemester = async (schedule: Schedule) => {
    const previous = activeSemester;
    setActiveSemester(`${schedule.term} ${schedule.year}`);
    setDropdownOpen(false);
    setSelected([]);
    try {
      const res = await fetch(
        `/api/schedules/${schedule.schedule_id}/activate`,
        { method: "PUT" },
      );
      if (!res.ok) {
        setActiveSemester(previous);
        setError(`Failed to activate semester: ${res.statusText}`);
        return;
      }
      fetchAll();
    } catch (err) {
      console.error("Failed to activate semester", err);
      setActiveSemester(previous);
      setError("Error activating semester");
    }
  };

  const archiveSemester = async (
    s: Schedule,
    isActive: boolean,
    force = false,
  ): Promise<void> => {
    try {
      const res = await fetch(
        `/api/schedules/${s.schedule_id}/hide${force ? "?force=1" : ""}`,
        { method: "PUT" },
      );
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}));
        if (data.needsConfirm) {
          setDropdownOpen(false);
          setArchiveTarget({ s, isActive });
        }
        return;
      }
      if (!res.ok) {
        setError("Failed to archive semester");
        return;
      }
      if (isActive) setActiveSemester("");
      fetchAll();
    } catch (err) {
      console.error("Failed to archive semester", err);
      setError("Error archiving semester");
    }
  };

  const createSemester = async () => {
    if (!/^\d{4}$/.test(semYear))
      return setSemError("Enter a 4-digit year, e.g. 2025.");
    if (!semStart || !semEnd)
      return setSemError("Start and end dates are required.");
    if (semEnd <= semStart)
      return setSemError("End date must be after the start date.");
    setSemError("");
    try {
      const res = await fetch("/api/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          academic_year: semYear,
          school_term: semTerm,
          start_date: semStart,
          end_date: semEnd,
        }),
      });
      if (!res.ok)
        return setSemError("Failed to create semester. It may already exist.");
      setShowSemForm(false);
      setSemYear("");
      setSemStart("");
      setSemEnd("");
      fetchAll();
    } catch {
      setSemError("Error creating semester");
    }
  };

  const copySections = async () => {
    if (!copyFrom) return;
    try {
      const res = await fetch("/api/sections/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ from_schedule_id: Number(copyFrom) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data.error || "Failed to copy sections");
        return;
      }
      toast.success(
        `Copied ${data.copied} section${data.copied !== 1 ? "s" : ""}${
          data.skipped ? `, skipped ${data.skipped} already here` : ""
        }`,
      );
      setShowCopy(false);
      setCopyFrom("");
      fetchAll();
    } catch {
      toast.error("Failed to copy sections");
    }
  };

  const programCode = useCallback(
    (id: number) => {
      const p = programs.find((pr) => pr.program_id === id);
      return p ? p.description : "";
    },
    [programs],
  );

  const sectionDisplayName = useCallback(
    (s: Section) => {
      const p = programs.find((pr) => pr.program_id === s.program_id);
      const code = p?.code ?? p?.description ?? "";
      const yearDigit = s.year_level.match(/\d/)?.[0] ?? "";
      return `${code}${yearDigit}${s.section_name ?? ""}`;
    },
    [programs],
  );
  const courseCountFor = useCallback(
    (s: Section) =>
      curriculums.filter(
        (c) => c.program_id === s.program_id && c.year_level === s.year_level,
      ).length,
    [curriculums],
  );

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return sections.filter((s) => {
      if (programFilter && String(s.program_id) !== programFilter) return false;
      if (!search) return true;
      return sectionDisplayName(s).toLowerCase().includes(q);
    });
  }, [sections, search, programFilter, sectionDisplayName]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        const pa = programCode(a.program_id);
        const pb = programCode(b.program_id);
        return (
          pa.localeCompare(pb) ||
          a.year_level.localeCompare(b.year_level) ||
          (a.section_name ?? "").localeCompare(b.section_name ?? "")
        );
      }),
    [filtered, programCode],
  );

  const editingSection = sections.find((s) => s.section_id === editingId);

  return (
    <div className="space-y-6">
      <div className="sticky top-0 z-50 bg-background pt-4 pb-4 -mx-6 px-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div>
            <h2 className="font-heading text-2xl font-bold">Sections</h2>
            <p className="text-muted-foreground mt-1">
              Student groups by program & year level
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setDropdownOpen(!dropdownOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-yellow-400 text-black rounded-md font-medium text-sm hover:bg-yellow-500 transition-colors"
              >
                {activeSemester && (
                  <span className="inline-block w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                )}

                {activeSemester || "Select Semester"}

                <ChevronDown className="w-4 h-4" />
              </button>
              {dropdownOpen && (
                <div className="absolute top-full right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 w-[280px] p-1">
                  {Array.from(
                    new Map(
                      schedules
                        .filter((s) => !s.is_hidden)
                        .map((s) => [`${s.term} ${s.year}`, s]),
                    ).values(),
                  )
                    .sort((a, b) => {
                      if (a.status === "active") return -1;
                      if (b.status === "active") return 1;
                      return `${b.term} ${b.year}`.localeCompare(
                        `${a.term} ${a.year}`,
                      );
                    })
                    .map((s) => {
                      const label = `${s.term} ${s.year}`;
                      const isActive = activeSemester === label;
                      return (
                        <div
                          key={s.schedule_id}
                          className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${
                            isActive ? "bg-yellow-400" : "hover:bg-gray-100"
                          }`}
                        >
                          <button
                            onClick={() => handleActivateSemester(s)}
                            className={`flex-1 text-left text-sm whitespace-nowrap flex items-center gap-2 py-1 ${
                              isActive
                                ? "text-black font-semibold"
                                : "text-gray-700"
                            }`}
                          >
                            <span
                              className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                                s.status === "active"
                                  ? "bg-green-500"
                                  : "bg-gray-300"
                              }`}
                            />
                            {label}
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              archiveSemester(s, isActive);
                            }}
                            className="text-xs px-2 py-1 rounded text-gray-700 hover:bg-red-100 hover:text-red-700 transition-colors"
                          >
                            Archive
                          </button>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            <Button
              className="bg-white text-black hover:bg-gray-100 border border-gray-300"
              onClick={() => {
                setSemError("");
                setShowSemForm(true);
              }}
            >
              <Plus className="w-4 h-4 mr-1" /> New Semester
            </Button>
            <Button
              className="bg-white text-black hover:bg-gray-100 border border-gray-300"
              onClick={() => setShowCopy(true)}
            >
              <Copy className="w-4 h-4 mr-1" /> Copy Sections
            </Button>
            <Button
              onClick={() => {
                setShowForm(true);
                setEditingId(null);
              }}
            >
              <Plus className="w-4 h-4 mr-1" /> Add Section
            </Button>
          </div>
        </div>
        <div className="glass-card rounded-xl p-4 flex gap-3">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by program, year level, or section…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setEditingId(null);
              }}
              className="pl-9"
            />
          </div>
          <select
            value={programFilter}
            onChange={(e) => setProgramFilter(e.target.value)}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">All programs</option>
            {programs.map((p) => (
              <option key={p.program_id} value={String(p.program_id)}>
                {p.description}
              </option>
            ))}
          </select>
        </div>

        {selected.length > 0 && (
          <div className="glass-card rounded-xl mt-3 px-4 py-2 flex items-center justify-between text-sm">
            <span className="font-medium">{selected.length} selected</span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelected(sorted.map((s) => s.section_id))}
              >
                Select all ({sorted.length})
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
                Clear
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => setBulkDeleteOpen(true)}
              >
                <Trash2 className="w-4 h-4 mr-1" /> Delete selected
              </Button>
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="glass-card rounded-xl p-4 text-sm text-destructive bg-destructive/10 border border-destructive/20">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-xs underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {!loading && filtered.length === 0 && sections.length > 0 && (
        <div className="glass-card rounded-xl p-10 text-center text-sm text-muted-foreground">
          No sections match your search.
        </div>
      )}

      {sorted.length > 0 && (
        <div className="glass-card rounded-xl max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-background text-xs font-semibold text-muted-foreground">
              <tr className="border-b">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={
                      sorted.length > 0 && selected.length === sorted.length
                    }
                    onChange={(e) =>
                      setSelected(
                        e.target.checked ? sorted.map((s) => s.section_id) : [],
                      )
                    }
                    aria-label="Select all sections"
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                </th>
                <th className="px-4 py-3 text-left">Section</th>
                <th className="px-4 py-3 text-left">Courses</th>
                <th className="px-4 py-3 text-left">Students</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {sorted.map((s) => {
                  const courseCount = courseCountFor(s);
                  return (
                    <motion.tr
                      key={s.section_id}
                      initial={search ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className={`border-b last:border-0 hover:bg-muted/40 ${
                        selected.includes(s.section_id) ? "bg-primary/5" : ""
                      }`}
                    >
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selected.includes(s.section_id)}
                          onChange={() => toggleSelect(s.section_id)}
                          aria-label={`Select ${sectionDisplayName(s)}`}
                          className="h-4 w-4 cursor-pointer accent-primary"
                        />
                      </td>
                      <td className="px-4 py-3 font-medium">
                        {sectionDisplayName(s)}
                      </td>
                      <td
                        className={`px-4 py-3 ${
                          courseCount === 0
                            ? "text-destructive"
                            : "text-muted-foreground"
                        }`}
                      >
                        {courseCount === 0
                          ? "No courses for this year yet"
                          : courseCount}
                      </td>
                      <td className="px-4 py-3">{s.number_of_students}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setEditingId(s.section_id);
                              setShowForm(false);
                            }}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(s)}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={showForm}
        onClose={() => setShowForm(false)}
        title="Add Section"
        className="max-w-lg"
      >
        <SectionForm
          initial={{
            section_name: "",
            program_id: "",
            year_level: "1st Year",
            number_of_students: 0,
          }}
          programs={programs}
          courses={courses}
          curriculums={curriculums}
          onSave={handleAdd}
          onCancel={() => setShowForm(false)}
        />
      </Modal>

      <Modal
        open={!!editingSection}
        onClose={() => setEditingId(null)}
        title="Edit Section"
        className="max-w-lg"
      >
        {editingSection && (
          <SectionForm
            initial={{
              section_name: editingSection.section_name ?? "",
              program_id: editingSection.program_id,
              year_level: editingSection.year_level,
              number_of_students: editingSection.number_of_students,
            }}
            programs={programs}
            courses={courses}
            curriculums={curriculums}
            onSave={handleEdit}
            onCancel={() => setEditingId(null)}
          />
        )}
      </Modal>

      <Modal
        open={showSemForm}
        onClose={() => setShowSemForm(false)}
        title="New Semester"
        className="max-w-lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              placeholder="Academic year (e.g. 2025)"
              value={semYear}
              maxLength={4}
              onChange={(e) => setSemYear(e.target.value)}
            />
            <select
              value={semTerm}
              onChange={(e) => setSemTerm(e.target.value)}
              className="h-10 border rounded-md px-3 text-sm bg-background"
            >
              <option>1st Semester</option>
              <option>2nd Semester</option>
            </select>
            <Input
              type="date"
              value={semStart}
              onChange={(e) => setSemStart(e.target.value)}
            />
            <Input
              type="date"
              value={semEnd}
              onChange={(e) => setSemEnd(e.target.value)}
            />
          </div>
          {semError && <p className="text-xs text-destructive">{semError}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={createSemester}>
              <Check className="w-4 h-4 mr-1" /> Create
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowSemForm(false)}
            >
              <X className="w-4 h-4 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={showCopy}
        onClose={() => setShowCopy(false)}
        title="Copy Sections"
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Copy sections into {activeSemester || "the active semester"} from:
          </p>
          <select
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            className="border rounded-md px-3 py-2 text-sm bg-background w-full"
          >
            <option value="" disabled hidden>
              Select a semester
            </option>
            {schedules
              .filter((s) => !s.is_hidden && s.status !== "active")
              .map((s) => (
                <option key={s.schedule_id} value={s.schedule_id}>
                  {s.term} {s.year}
                </option>
              ))}
          </select>
          <div className="flex gap-2">
            <Button size="sm" onClick={copySections} disabled={!copyFrom}>
              <Check className="w-4 h-4 mr-1" /> Copy
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCopy(false)}
            >
              <X className="w-4 h-4 mr-1" /> Cancel
            </Button>
          </div>
        </div>
      </Modal>

      {errorModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={() => setErrorModal(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border bg-background p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-heading text-lg font-semibold">
              Can't save section
            </h3>
            <p className="text-sm text-muted-foreground mt-2">{errorModal}</p>
            <div className="flex justify-end mt-5">
              <Button size="sm" onClick={() => setErrorModal(null)}>
                OK
              </Button>
            </div>
          </div>
        </div>
      )}

      {archiveTarget && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          onClick={() => setArchiveTarget(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border bg-background p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-heading text-lg font-semibold">
              Archive {archiveTarget.s.term} {archiveTarget.s.year}?
            </h3>
            <p className="text-sm text-muted-foreground mt-2">
              This semester has no generated timetable yet. Once archived, it
              disappears from the dropdown and won't appear in History, so you
              won't be able to open it again.
            </p>
            <div className="flex justify-end gap-2 mt-5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setArchiveTarget(null)}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  const t = archiveTarget;
                  setArchiveTarget(null);
                  archiveSemester(t.s, t.isActive, true);
                }}
              >
                Archive anyway
              </Button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        title="Delete this Section?"
        description={`Are you sure you want to delete ${deleteTarget ? sectionDisplayName(deleteTarget) : ""}? Its scheduled classes will be deleted too.`}
        onConfirm={() => {
          if (deleteTarget) removeSection(deleteTarget.section_id);
          setDeleteTarget(null);
        }}
        onCancel={() => setDeleteTarget(null)}
      />
      <ConfirmDeleteDialog
        open={bulkDeleteOpen}
        title={`Delete ${selected.length} selected section${selected.length !== 1 ? "s" : ""}?`}
        description="Their scheduled classes will be deleted too."
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
