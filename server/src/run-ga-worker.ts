import { Worker } from "worker_threads";
import path from "path";
import { SchedulingInput, Candidate } from "./types";

export interface GAWorkerResult {
  best: Candidate;
  generationsRun: number;
  fitnessHistory: number[];
  feasible: boolean;
  hardViolationCount: number;
  capacityWarnings: string[];
}

const WORKER_TIMEOUT_MS = 3 * 60 * 1000;

export function runGAInWorker(
  schedulingInput: SchedulingInput,
  populationSize?: number,
  maxGenerations?: number,
): Promise<GAWorkerResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.resolve(__dirname, "worker.ts"), {
      workerData: { schedulingInput, populationSize, maxGenerations },
      execArgv: ["-r", "ts-node/register"],
    });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error("GA timed out after 3 minutes. Try again or check the data."),
      );
    }, WORKER_TIMEOUT_MS);

    worker.on("message", (message) => {
      clearTimeout(timer);
      if (message.success) {
        resolve({
          ...message.result,
          capacityWarnings: message.capacityWarnings ?? [],
        });
      } else {
        reject(new Error(message.error));
      }
    });

    worker.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    worker.on("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`GA worker stopped with exit code ${code}`));
      }
    });
  });
}
