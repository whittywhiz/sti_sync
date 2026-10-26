import { Worker } from "worker_threads";
import path from "path";
import { SchedulingInput, Candidate } from "./types";

export interface GAWorkerResult {
  best: Candidate;
  generationsRun: number;
  fitnessHistory: number[];
  capacityWarnings: string[];
}

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

    worker.on("message", (message) => {
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
      reject(err);
    });

    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`GA worker stopped with exit code ${code}`));
      }
    });
  });
}
