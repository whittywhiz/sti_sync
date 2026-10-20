import { buildSchedulingInputFromDB } from "./scheduling-data";
import { buildRequirements, runGA } from "./ga";
import { evaluateFitness } from "./csp";
import { formatTime12hr } from "./format-utils";
import { pool } from "./db";

async function main() {
  console.log("Fetching real data from database...");
  const input = await buildSchedulingInputFromDB(5);

  console.log("\n===== Data pulled from DB =====");
  console.log(`Rooms: ${input.rooms.length}`);
  console.log(`Employees: ${input.employees.length}`);
  console.log(`Sections: ${input.sections.length}`);
  console.log(`Courses: ${input.courses.length}`);
  console.log(`Curriculum entries: ${input.curriculum.length}`);
  console.log(`Availability records: ${input.availability.length}`);
  console.log(`Days: ${input.days.length}`);

  const requirements = buildRequirements(input);
  console.log(`\nRequirements built: ${requirements.length}`);
  console.log(requirements);

  if (requirements.length === 0) {
    console.log(
      "\nNo requirements found — check that your curriculum entries actually match a section's program_id + year_level.",
    );
    await pool.end();
    return;
  }

  console.log("\nRunning GA against real data...");
  const startTime = Date.now();
  const result = runGA(requirements, input, {
    populationSize: 50,
    maxGenerations: 200,
  });
  const elapsedMs = Date.now() - startTime;

  console.log(`\nGenerations run: ${result.generationsRun}`);
  console.log(`Time taken: ${elapsedMs}ms`);
  console.log(`Best fitness found: ${result.best.fitness}`);

  const displaySchedule = result.best.assignments.map((a) => ({
    ...a,
    start_time: formatTime12hr(a.start_time),
    end_time: formatTime12hr(a.end_time),
  }));
  console.log("\nBest schedule found:");
  console.table(displaySchedule);

  const finalCheck = evaluateFitness(result.best.assignments, input);
  console.log("\nRemaining violations:");
  console.log(finalCheck.violations);

  await pool.end();
}

main().catch((err) => {
  console.error("Error running test:", err);
  process.exit(1);
});
