import { parentPort, workerData } from "worker_threads";
import { runGA, buildRequirements } from "./ga";
import { SchedulingInput } from "./types";
import { scoreCandidate, hasHardViolations } from "./csp";

interface WorkerInput {
  schedulingInput: SchedulingInput;
  populationSize?: number;
  maxGenerations?: number;
}

const MAX_ATTEMPTS = 3;

function main() {
  const { schedulingInput, populationSize, maxGenerations } =
    workerData as WorkerInput;

  const requirements = buildRequirements(schedulingInput);
  const t0 = Date.now();

  let result = runGA(requirements, schedulingInput, {
    populationSize,
    maxGenerations,
  });

  for (
    let attempt = 2;
    attempt <= MAX_ATTEMPTS && !result.feasible;
    attempt++
  ) {
    console.log(
      `Attempt ${attempt - 1} infeasible, retrying (${attempt}/${MAX_ATTEMPTS})...`,
    );
    const budget = 150_000 - (Date.now() - t0) - 20_000;
    if (budget < 10_000) break;
    const next = runGA(requirements, schedulingInput, {
      populationSize,
      maxGenerations,
      timeBudgetMs: budget,
    });
    if (next.feasible || next.hardViolationCount < result.hardViolationCount) {
      result = next;
    }
  }

  if (!result.feasible) {
    const { violations } = scoreCandidate(result.best, schedulingInput);
    const counts: Record<string, number> = {};
    for (const v of violations) {
      if (hasHardViolations([v])) {
        counts[v.type] = (counts[v.type] ?? 0) + 1;
      }
    }
    const LABELS: Record<string, string> = {
      ROOM_CONFLICT: "rooms double-booked",
      EMPLOYEE_CONFLICT: "professors double-booked",
      SECTION_CONFLICT: "sections with overlapping classes",
      EMPLOYEE_UNAVAILABLE:
        "professors scheduled outside their available times",
      ROOM_TYPE_MISMATCH: "classes in the wrong type of room",
      EMPLOYEE_MAX_HOURS_EXCEEDED: "professors over their maximum hours",
      SAME_COURSE_SAME_DAY: "courses with both sessions on the same day",
    };
    const summary = Object.entries(counts)
      .map(([type, n]) => `${n} ${LABELS[type] ?? type}`)
      .join(", ");
    parentPort?.postMessage({
      success: false,
      error: `Could not build a conflict-free schedule. Problems left: ${summary}. Try again, or check the professors' availability and room data.`,
    });
    return;
  }

  const { violations } = scoreCandidate(result.best, schedulingInput);
  const capacityWarnings = Array.from(
    new Set(
      violations
        .filter((v) => v.type === "ROOM_CAPACITY_EXCEEDED")
        .map((v) => v.message),
    ),
  );

  parentPort?.postMessage({ success: true, result, capacityWarnings });
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  parentPort?.postMessage({ success: false, error: message });
}
