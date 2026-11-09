import { buildSchedulingInputFromDB } from "./scheduling-data";
import { buildRequirements, runGA, checkLabCapacity } from "./ga";
import { evaluateFitness } from "./csp";
import { formatTime12hr } from "./format-utils";
import { pool } from "./db";

async function main() {
  console.log("Fetching real data from database...");
  const r = await pool.query(
    "SELECT schedule_id FROM schedule WHERE status = 'active' LIMIT 1",
  );
  const scheduleId = r.rows[0].schedule_id;
  console.log("Testing Schedule ID:", scheduleId);
  const input = await buildSchedulingInputFromDB(scheduleId);

  // ---- STRESS TEST (does nothing unless env vars are set) ----
  const mult = Number(
    (process.env as Record<string, string | undefined>).STRESS ?? 1,
  ); // 2 = double the sections
  if (mult > 1) {
    const base = [...input.sections];
    const extra = Math.round(base.length * (mult - 1));
    for (let i = 0; i < extra; i++) {
      input.sections.push({
        ...base[i % base.length]!,
        section_id: 100000 + i,
      });
    }
  }
  const profMult = Number(
    (process.env as Record<string, string | undefined>).PROFS ?? 0,
  ); // 3 = triple the professors
  if (profMult > 0) {
    const baseEmps = [...input.employees];
    const baseAvail = [...input.availability];
    for (let n = 1; n < profMult; n++) {
      for (const e of baseEmps)
        input.employees.push({ ...e, employee_id: e.employee_id + n * 100000 });
      for (const a of baseAvail)
        input.availability.push({
          ...a,
          availability_id: a.availability_id + n * 100000,
          employee_id: a.employee_id + n * 100000,
        });
    }
    input.course_employees = input.course_employees ?? [];
    const mapped = new Set(input.course_employees.map((c) => c.course_code));
    let k = 0;
    for (const c of input.courses) {
      if (mapped.has(c.course_code)) continue;
      for (let j = 0; j < 3; j++) {
        input.course_employees.push({
          course_code: c.course_code,
          employee_id:
            input.employees[k++ % input.employees.length]!.employee_id,
        });
      }
    }
  }

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
  console.log("Lab check:", checkLabCapacity(requirements, input));
  const needH = requirements.reduce((s, r) => s + r.session_duration_hours, 0);
  const capH = input.employees.reduce(
    (s, e) => s + (e.max_hours_per_week ?? 0),
    0,
  );
  console.log(
    `Teaching hours needed: ${needH} | professor weekly capacity: ${capH}`,
  );
  const labReqs = requirements.filter(
    (r) => r.prefers_lab_room && r.session_number === 1,
  );
  console.log(`\nLab Session 1 requirements: ${labReqs.length}`);
  const secMap = new Map(input.sections.map((s) => [s.section_id, s]));
  const progBreakdown = new Map<
    number,
    { count: number; courses: Set<string> }
  >();
  for (const r of labReqs) {
    const s = secMap.get(r.section_id);
    const pid = s?.program_id ?? -1;
    if (!progBreakdown.has(pid))
      progBreakdown.set(pid, { count: 0, courses: new Set() });
    progBreakdown.get(pid)!.count++;
    progBreakdown.get(pid)!.courses.add(r.course_code);
  }
  for (const [pid, data] of progBreakdown.entries()) {
    console.log(
      `  program_id ${pid}: ${data.count} lab requirements, courses: ${Array.from(data.courses).join(", ")}`,
    );
  }
  const labRooms = input.rooms.filter(
    (r) => r.type?.toLowerCase() === "laboratory",
  );
  console.log(
    "Lab rooms in DB:",
    labRooms.map((r) => ({
      id: r.room_id,
      number: r.room_number,
      program_id: r.program_id,
    })),
  );

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
    maxGenerations: 400,
  });
  // Check whether every requirement has an assignment.
  const assignmentCounts = new Map<string, number>();

  for (const a of result.best.assignments) {
    const key = `${a.section_id}|${a.course_code}|${a.session_number}`;
    assignmentCounts.set(key, (assignmentCounts.get(key) ?? 0) + 1);
  }

  const missingRequirements = [];

  for (const r of requirements) {
    const key = `${r.section_id}|${r.course_code}|${r.session_number}`;
    const count = assignmentCounts.get(key) ?? 0;

    if (count > 0) {
      assignmentCounts.set(key, count - 1);
    } else {
      missingRequirements.push(r);
    }
  }

  console.log("Required sessions:", requirements.length);
  console.log("Assigned sessions:", result.best.assignments.length);
  console.log("Missing sessions:", missingRequirements.length);

  console.table(
    missingRequirements.map((r) => ({
      course: r.course_code,
      section: r.section_id,
      session: r.session_number,
      hours: r.session_duration_hours,
    })),
  );
  const elapsedMs = Date.now() - startTime;
  // TEST: Check whether classes can remain scheduled without a professor.
  const unassigned = result.best.assignments.filter(
    (a) => a.employee_id === null,
  );

  console.log("\nUnassigned classes:", unassigned.length);
  // console.table(
  // unassigned.map((a) => ({
  // course: a.course_code,
  //     section: a.section_id,
  //   day: a.day_id,
  //   start: a.start_time,
  //    end: a.end_time,
  //  room: a.room_id,
  //   })),
  // );

  console.log("Schedule feasible:", result.feasible);
  console.log("Hard violations:", result.hardViolationCount);

  console.log(`\nGenerations run: ${result.generationsRun}`);
  console.log(`Time taken: ${elapsedMs}ms`);
  console.log(`Best fitness found: ${result.best.fitness}`);

  const displaySchedule = result.best.assignments.map((a) => ({
    ...a,
    start_time: formatTime12hr(a.start_time),
    end_time: formatTime12hr(a.end_time),
  }));
  console.log("\nBest schedule found:");
  // console.table(displaySchedule);

  const finalCheck = evaluateFitness(result.best.assignments, input);
  console.log("\nRemaining violations:");
  console.log(finalCheck.violations);
  const courseMap = new Map(input.courses.map((c) => [c.course_code, c]));
  const roomMap = new Map(input.rooms.map((r) => [r.room_id, r]));

  const BSHM = 98;
  const bshmLab = result.best.assignments.filter(
    (a) =>
      secMap.get(a.section_id)?.program_id === BSHM &&
      courseMap.get(a.course_code)?.course_type_description.toLowerCase() ===
        "laboratory",
  );
  console.log(
    "BSHM lab sessions:",
    bshmLab.length,
    "| outside Kitchen Lab:",
    bshmLab.filter((a) => a.room_id !== 46).length,
  );

  console.table(
    result.best.assignments
      .filter((a) => Number(courseMap.get(a.course_code)?.total_hours) >= 3)
      .map((a) => ({
        course: a.course_code,
        type: courseMap.get(a.course_code)?.course_type_description,
        section: a.section_id,
        session: a.session_number,
        hrs: a.session_duration_hours,
        day: a.day_id,
        room: roomMap.get(a.room_id)?.room_number,
        roomType: roomMap.get(a.room_id)?.type,
      }))
      .sort((x, y) =>
        `${x.course}${x.section}`.localeCompare(`${y.course}${y.section}`),
      ),
  );

  const labHrs = requirements
    .filter((r) => r.prefers_lab_room && r.session_number === 1)
    .reduce((s, r) => s + r.session_duration_hours, 0);
  console.log(
    "Lab S1 hours needed:",
    labHrs,
    "| lab capacity:",
    labRooms.length * input.days.length * 13,
  );
  const HARD = [
    "ROOM_CONFLICT",
    "EMPLOYEE_CONFLICT",
    "SECTION_CONFLICT",
    "EMPLOYEE_UNAVAILABLE",
    "ROOM_TYPE_MISMATCH",
    "EMPLOYEE_MAX_HOURS_EXCEEDED",
    "SAME_COURSE_SAME_DAY",
  ];
  console.log(
    "HARD:",
    finalCheck.violations
      .filter((v) => HARD.includes(v.type))
      .map((v) => v.message),
  );
  const LAB_NAMES = ["Lab 1", "Lab 2", "Lab 3", "Kitchen Lab"];
  const toMin = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    return h! * 60 + m!;
  };
  const slots = new Map<string, Set<number>>();
  for (const a of result.best.assignments) {
    const room = roomMap.get(a.room_id)?.room_number.trim();
    if (!room || !LAB_NAMES.includes(room)) continue;
    const k = `${room}|${a.day_id}`;
    const set = slots.get(k) ?? new Set<number>();
    for (let t = toMin(a.start_time); t < toMin(a.end_time); t += 30)
      set.add(t);
    slots.set(k, set);
  }
  console.table(
    LAB_NAMES.map((l) =>
      Object.fromEntries([
        ["lab", l],
        ...input.days.map((d) => {
          const s = slots.get(`${l}|${d.day_id}`);
          return [
            d.day_id,
            `${s?.has(420) ? "7AM ✔" : "7AM ✘"} ${(s?.size ?? 0) / 2}/13h`,
          ];
        }),
      ]),
    ),
  );
  for (const l of LAB_NAMES)
    for (const d of input.days) {
      const s = slots.get(`${l}|${d.day_id}`) ?? new Set<number>();
      if (s.has(420)) continue;
      const free: string[] = [];
      let from: number | null = null;
      for (let t = 420; t <= 1200; t += 30) {
        const open = t < 1200 && !s.has(t);
        if (open && from === null) from = t;
        if (!open && from !== null) {
          free.push(`${from / 60}-${t / 60}h`);
          from = null;
        }
      }
      console.log(l, "day", d.day_id, "free:", free.join(", "));
    }
  console.log(
    "9-hour violations:",
    finalCheck.violations.filter(
      (v) => v.type === "EMPLOYEE_NINE_HOUR_EXCEEDED",
    ).length,
  );

  const eligibleMap = new Map<string, number[]>();
  for (const ce of input.course_employees ?? []) {
    if (!eligibleMap.has(ce.course_code)) eligibleMap.set(ce.course_code, []);
    eligibleMap.get(ce.course_code)!.push(ce.employee_id);
  }
  const unmappedCourse = unassigned.filter(
    (a) => !eligibleMap.has(a.course_code),
  );
  const mappedButUnassigned = unassigned.filter((a) =>
    eligibleMap.has(a.course_code),
  );
  console.log(
    "Unassigned, course has no professor mapping:",
    unmappedCourse.length,
  );
  console.log(
    "Unassigned, course HAS eligible professors:",
    mappedButUnassigned.length,
  );
  await pool.end();
}

main().catch((err) => {
  console.error("Error running test:", err);
  process.exit(1);
});
