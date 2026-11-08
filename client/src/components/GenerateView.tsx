import { useState, useEffect } from "react";
import {
  Zap,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Loader2,
  ArrowRight,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { authFetch } from "../lib/authFetch";
import { createPortal } from "react-dom";
import { useSchedulingStore } from "@/store/schedulingStore";

interface GeneratedClass {
  class_id: number;
  start_time: string;
  end_time: string;
  employee_id: number;
  room_id: number;
  section_id: number;
  course_code: string;
  day_id: number;
  schedule_id: number;
}

interface GenerateResult {
  success: boolean;
  fitness: number;
  isConflictFree: boolean;
  generationsRun: number;
  classesCreated: number;
  classes: GeneratedClass[];
  error?: string;
  capacityWarnings?: string[];
  unassignedCount?: number;
  unassignedNoSlot?: number;
  labRoomIssues?: number;
  longGaps?: number;
  warnings?: { text: string; hint: string }[];
}

interface SummaryCounts {
  rooms: number;
  employees: number;
  courses: number;
  sections: number;
}

export function GenerateView() {
  const [counts, setCounts] = useState<SummaryCounts>({
    rooms: 0,
    employees: 0,
    courses: 0,
    sections: 0,
  });
  const [countsLoading, setCountsLoading] = useState(true);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  const setActiveTab = useSchedulingStore((s) => s.setActiveTab);

  const fetchCounts = async () => {
    setCountsLoading(true);

    try {
      const res = await authFetch("/api/summary");
      setCounts(await res.json());
    } catch (err) {
      console.error("Failed to fetch summary counts", err);
    } finally {
      setCountsLoading(false);
    }
  };
  useEffect(() => {
    fetchCounts();
  }, []);
  const handleClick = async () => {
    setError(null);
    try {
      const res = await authFetch("/api/classes");
      if (!res.ok) throw new Error("check failed");
      const classes = await res.json();
      if (Array.isArray(classes) && classes.length > 0) {
        setConfirmCount(classes.length);
        return;
      }
    } catch {
      setError(
        "Could not check for an existing timetable. Is the backend running?",
      );
      return;
    }
    handleGenerate();
  };
  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setResult(null);
    await tryGenerate();
  };

  const tryGenerate = async (): Promise<void> => {
    try {
      const res = await authFetch("/api/generate-schedule", { method: "POST" });
      const data: GenerateResult = await res.json();

      if (res.status === 409) {
        setGenerating(false);
        setError(data.error ?? "A generation is already running.");
        return;
      }

      if (!res.ok || !data.success) {
        setGenerating(false);
        setError(data.error ?? "Failed to generate timetable");
        return;
      }

      setGenerating(false);
      setError(null);
      setResult(data);
    } catch (err) {
      console.error("Failed to generate schedule", err);
      setGenerating(false);
      setError("Failed to reach the server. Is the backend running?");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold"> Generate Timetable</h2>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="glass-card rounded-xl p-6 space-y-4"
      >
        <h3 className="font-heading font-semibold">Current Data</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div className="bg-secondary rounded-lg p-3 text-center">
            <p className="text-2xl font-bold">
              {countsLoading ? "…" : counts.employees}
            </p>
            <p className="text-muted-foreground">Employees</p>
          </div>
          <div className="bg-secondary rounded-lg p-3 text-center">
            <p className="text-2xl font-bold">
              {countsLoading ? "…" : counts.rooms}
            </p>
            <p className="text-muted-foreground">Rooms</p>
          </div>
          <div className="bg-secondary rounded-lg p-3 text-center">
            <p className="text-2xl font-bold">
              {countsLoading ? "…" : counts.courses}
            </p>
            <p className="text-muted-foreground">Courses</p>
          </div>
          <div className="bg-secondary rounded-lg p-3 text-center">
            <p className="text-2xl font-bold">
              {countsLoading ? "…" : counts.sections}
            </p>
            <p className="text-muted-foreground">Sections</p>
          </div>
        </div>

        <div className="text-sm text-muted-foreground space-y-1">
          <p>• Requires an active schedule (term) to already exist</p>
          <p>
            • Rooms that fit the section size are preferred; any section placed
            in a smaller room is flagged after generating
          </p>
          <p>• No instructor, room, or section double-booking</p>
          <p>• Lab courses go to Laboratory rooms, PE to the Gym, etc.</p>
        </div>
        <Button
          onClick={handleClick}
          disabled={generating}
          size="lg"
          className="w-full"
        >
          {generating ? "Generating…" : "Generate Timetable"}
        </Button>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 space-y-1">
            <p className="text-sm font-semibold text-destructive">
              Generation failed
            </p>
            <p className="whitespace-pre-line text-sm text-destructive">
              {error}
            </p>
          </div>
        )}
      </motion.div>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          <div className="glass-card rounded-xl p-5 flex items-center gap-3">
            {result.isConflictFree ? (
              <CheckCircle className="w-6 h-6 text-success" />
            ) : (
              <AlertTriangle className="w-6 h-6 text-amber" />
            )}
            <div>
              <p className="font-semibold">
                {result.classesCreated} classes scheduled
              </p>
              <p className="text-sm text-muted-foreground">
                {result.isConflictFree
                  ? "Conflict-free schedule found"
                  : `Best schedule found (fitness score: ${result.fitness}) — some soft preferences unmet`}
                {" · "}
                {result.generationsRun} generations
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab("timetable")}
              aria-label="View timetable"
              title="View timetable"
              className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-black transition-colors hover:bg-yellow-500"
            >
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          {result.warnings && result.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-3">
              <p className="text-sm font-medium">
                Schedule created, but please review
              </p>
              {result.warnings.map((w) => (
                <div key={w.text} className="text-sm">
                  <p>• {w.text}</p>
                  <p className="ml-4 text-muted-foreground">
                    What to do: {w.hint}
                  </p>
                </div>
              ))}
            </div>
          )}

          {(result.unassignedCount ?? 0) > 0 && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 space-y-1">
              <p className="text-sm font-medium">Professors still needed</p>
              <p className="text-sm text-muted-foreground">
                • {result.unassignedCount} classes have no professor yet. Assign
                them from the Timetable.
              </p>
            </div>
          )}

          {(result.longGaps ?? 0) > 0 && (
            <div className="rounded-lg border border-border bg-secondary p-4 space-y-1">
              <p className="text-sm font-medium">Minor notes</p>
              {(result.longGaps ?? 0) > 0 && (
                <p className="text-sm text-muted-foreground">
                  • {result.longGaps} long breaks between classes
                </p>
              )}
            </div>
          )}
        </motion.div>
      )}
      {confirmCount !== null &&
        createPortal(
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
            <div className="w-full max-w-md space-y-4 rounded-xl bg-white p-6 shadow-lg">
              <h3 className="font-heading text-lg font-semibold">
                Replace existing timetable?
              </h3>
              <p className="text-sm text-muted-foreground">
                This semester already has {confirmCount} scheduled classes.
                Generating again deletes them, including any classes you moved
                by hand, and builds a new timetable.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setConfirmCount(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setConfirmCount(null);
                    handleGenerate();
                  }}
                >
                  Generate anyway
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
      {(countsLoading || generating) &&
        createPortal(
          <div
            role="status"
            aria-busy="true"
            className={`fixed inset-y-0 right-0 ${
              generating ? "left-0 z-[300]" : "left-64 z-[60]"
            } flex cursor-wait items-center justify-center bg-gray-200/60`}
          >
            <div className="flex items-center gap-3 rounded-lg bg-white px-5 py-3 shadow-md">
              <Loader2 className="h-5 w-5 animate-spin text-gray-700" />
              <span className="text-sm text-gray-700">
                {generating
                  ? (error ?? "Generating timetable… this may take a moment.")
                  : "Loading..."}
              </span>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
