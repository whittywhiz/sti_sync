import { parentPort, workerData } from "worker_threads";
import { runGA, buildRequirements } from "./ga";
import { SchedulingInput } from "./types";
import { scoreCandidate, hasHardViolations } from "./csp";

interface WorkerInput {
  schedulingInput: SchedulingInput;
  populationSize?: number;
  maxGenerations?: number;
}

function main() {
  const { schedulingInput, populationSize, maxGenerations } =
    workerData as WorkerInput;

  const requirements = buildRequirements(schedulingInput);

  const result = runGA(requirements, schedulingInput, {
    populationSize,
    maxGenerations,
  });

  if (!result.feasible) {
    const { violations } = scoreCandidate(result.best, schedulingInput);
    const counts: Record<string, number> = {};
    for (const v of violations) {
      if (hasHardViolations([v])) {
        counts[v.type] = (counts[v.type] ?? 0) + 1;
      }
    }
    const summary = Object.entries(counts)
      .map(([type, n]) => `${type} x${n}`)
      .join(", ");

    parentPort?.postMessage({
      success: false,
      error: `GA could not find a conflict-free schedule after ${result.generationsRun} generations. Remaining hard violations: ${summary}. Try again, or check for infeasible data.`,
    });
    return;
  }

  parentPort?.postMessage({ success: true, result });
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  parentPort?.postMessage({ success: false, error: message });
}
