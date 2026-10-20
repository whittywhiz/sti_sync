import express, { Request, Response } from "express";
import cors from "cors";
import { pool } from "./db";
import { buildSchedulingInputFromDB } from "./scheduling-data";
import { buildRequirements } from "./ga";
import { runGAInWorker } from "./run-ga-worker";
import bcrypt from "bcrypt";
import { randomInt } from "crypto";
import dotenv from "dotenv";
import multer from "multer";
import * as XLSX from "xlsx";
import type { PoolClient } from "pg";
import { cacheMiddleware, clearCache } from "./cache";

dotenv.config();

const upload = multer({ storage: multer.memoryStorage() });
const YEAR_LEVELS = ["1st Year", "2nd Year", "3rd Year", "4th Year"];
const TERMS = ["1st Semester", "2nd Semester"];
function toHHMM(v: any): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "number") {
    const mins = Math.round(v * 24 * 60);
    const h = Math.floor(mins / 60) % 24;
    return `${String(h).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
  }
  const m = String(v)
    .trim()
    .match(/^(\d{1,2})[:.\s]+(\d{2})\s*([AaPp][Mm])?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[3]?.toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  if (h > 23 || Number(m[2]) > 59) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

const PORT = (process.env as any).PORT || 3000;

const app = express();

app.use(cors());

app.use(express.json());

app.use(cacheMiddleware);

app.get("/timetable-history", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT s.schedule_id, s.academic_year AS year, s.school_term AS term, s.status
      FROM schedule s
      WHERE EXISTS (SELECT 1 FROM class c WHERE c.schedule_id = s.schedule_id)
      ORDER BY s.academic_year DESC, s.school_term`);
    res.json(r.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load history" });
  }
});

app.post("/employees/import", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  let rows: any[];
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return res
        .status(400)
        .json({ error: "The uploaded file has no sheets." });
    }
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      return res
        .status(400)
        .json({ error: "The uploaded file has no sheets." });
    }
    rows = XLSX.utils.sheet_to_json<any>(sheet);
  } catch {
    return res.status(400).json({
      error:
        "Could not read the Excel file. Make sure it's a valid .xlsx/.xls.",
    });
  }

  const keyOf = (r: any) =>
    `${String(r.lname || "").trim()}|${String(r.fname || "").trim()}|${String(r.mname || "").trim()}`.toLowerCase();
  const byEmp = new Map<string, any[]>();
  for (const row of rows) {
    if (!row.lname || !row.fname) continue;
    const key = keyOf(row);
    if (!byEmp.has(key)) byEmp.set(key, []);
    byEmp.get(key)!.push(row);
  }

  const inconsistent: string[] = [];
  for (const [, empRows] of byEmp) {
    const dayVals = new Set(empRows.map((r) => r.max_hours_per_day ?? ""));
    const weekVals = new Set(empRows.map((r) => r.max_hours_per_week ?? ""));
    if (dayVals.size > 1 || weekVals.size > 1) {
      inconsistent.push(`${empRows[0].fname} ${empRows[0].lname}`);
    }
  }

  if (inconsistent.length > 0) {
    return res.status(400).json({
      error: `Inconsistent max_hours values for: ${inconsistent.join(", ")}. Fix the sheet so every row for a professor has the same value, then re-upload.`,
    });
  }
  const deptResult = await pool.query("SELECT description FROM department");
  const deptMap = new Map<string, string>(
    deptResult.rows.map((r: any) => [
      r.description.trim().toLowerCase(),
      r.description,
    ]),
  );
  const unmatchedDepts: string[] = [];

  const dayResult = await pool.query("SELECT day_id, name FROM day");
  const dayMap = new Map<string, number>(
    dayResult.rows.map((r: any) => [r.name, r.day_id]),
  );

  const existingResult = await pool.query(
    "SELECT lname, fname, COALESCE(mname, '') AS mname FROM employee",
  );
  const existingKeys = new Set(
    existingResult.rows.map((r: any) =>
      `${(r.lname ?? "").trim()}|${(r.fname ?? "").trim()}|${r.mname.trim()}`.toLowerCase(),
    ),
  );
  const skippedExisting: string[] = [];

  const toMin = (t: string) =>
    Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const toStr = (m: number) =>
    `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    const skippedAvailability: string[] = [];
    const unknownDays: string[] = [];

    for (const [key, empRows] of byEmp) {
      const first = empRows[0];
      const fullName = `${first.fname} ${first.lname}`
        .replace(/\s+/g, " ")
        .trim();
      if (existingKeys.has(key)) {
        skippedExisting.push(fullName);
        continue;
      }
      const rawDept = String(first.department ?? "").trim();
      const dept = deptMap.get(rawDept.toLowerCase()) ?? "Unassigned";
      if (rawDept && dept === "Unassigned") {
        unmatchedDepts.push(`${fullName} (${rawDept})`);
      }
      const result = await client.query(
        `INSERT INTO employee (department, lname, mname, fname, position, username, max_hours_per_day, max_hours_per_week)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING employee_id`,
        [
          dept,

          String(first.lname).trim(),
          first.mname ? String(first.mname).trim() : null,
          String(first.fname).trim(),
          first.position ? String(first.position).trim() : null,
          null,
          first.max_hours_per_day ?? null,
          first.max_hours_per_week ?? null,
        ],
      );
      const empId = result.rows[0].employee_id;
      inserted++;

      const slotsByDay = new Map<number, { start: number; end: number }[]>();
      for (const row of empRows) {
        if (
          row.availability_day &&
          row.availability_start &&
          row.availability_end
        ) {
          const dayId = dayMap.get(row.availability_day);
          if (!dayId) {
            unknownDays.push(`${fullName} (${row.availability_day})`);
            continue;
          }
          const start = toHHMM(row.availability_start);
          const end = toHHMM(row.availability_end);
          if (!start || !end) {
            unknownDays.push(
              `${fullName} (bad time on ${row.availability_day})`,
            );
            continue;
          }
          if (!slotsByDay.has(dayId)) slotsByDay.set(dayId, []);
          slotsByDay.get(dayId)!.push({ start: toMin(start), end: toMin(end) });
        } else {
          skippedAvailability.push(fullName);
        }
      }

      for (const [dayId, list] of slotsByDay) {
        list.sort((a, b) => a.start - b.start);
        const merged = [{ ...list[0]! }];
        for (const s of list.slice(1)) {
          const last = merged[merged.length - 1]!;
          if (s.start <= last.end) last.end = Math.max(last.end, s.end);
          else merged.push({ ...s });
        }
        for (const m of merged) {
          await client.query(
            `INSERT INTO availability (start_time, end_time, day_id, employee_id) VALUES ($1, $2, $3, $4)`,
            [toStr(m.start), toStr(m.end), dayId, empId],
          );
        }
      }
    }
    await client.query("COMMIT");
    res.json({
      success: true,
      inserted,
      skippedExisting,
      skippedAvailability: [...new Set(skippedAvailability)],
      unknownDays: [...new Set(unknownDays)],
      unmatchedDepartments: [...new Set(unmatchedDepts)],
    });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
app.post("/courses/import", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  let rows: any[];
  try {
    const wb = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) {
      return res
        .status(400)
        .json({ error: "The uploaded file has no sheets." });
    }
    const sheet = wb.Sheets[sheetName];
    if (!sheet) {
      return res
        .status(400)
        .json({ error: "The uploaded file has no sheets." });
    }
    rows = XLSX.utils.sheet_to_json<any>(sheet);
  } catch {
    return res.status(400).json({
      error:
        "Could not read the Excel file. Make sure it's a valid .xlsx/.xls.",
    });
  }

  const TYPE_ALIASES: Record<string, string> = {
    lec: "Lecture",
    lecture: "Lecture",
    lab: "Laboratory",
    laboratory: "Laboratory",
    pe: "PE",
  };
  const TERM_ALIASES: Record<string, string> = {
    "1st term": "1st Semester",
    "1st semester": "1st Semester",
    "2nd term": "2nd Semester",
    "2nd semester": "2nd Semester",
  };
  const clean = (v: any) =>
    String(v ?? "")
      .replace(/\s+/g, " ")
      .trim();

  const byCode = new Map<string, any[]>();
  for (const row of rows) {
    row.course_code = clean(row.course_code);
    if (!row.course_code) continue;
    row.course_description = clean(row.course_description);
    const type = clean(row.course_type);
    row.course_type = TYPE_ALIASES[type.toLowerCase()] ?? type;
    row.program = clean(row.program);
    row.year_level = clean(row.year_level);
    const term = clean(row.term ?? row.school_term);
    row.term = TERM_ALIASES[term.toLowerCase()] ?? term;
    if (!byCode.has(row.course_code)) byCode.set(row.course_code, []);
    byCode.get(row.course_code)!.push(row);
  }

  const courseTypeResult = await pool.query(
    "SELECT course_type_id, course_type_description FROM course_type",
  );
  const courseTypeMap = new Map<string, number>(
    courseTypeResult.rows.map((r: any) => [
      r.course_type_description,
      r.course_type_id,
    ]),
  );

  const programResult = await pool.query(
    "SELECT program_id, description FROM program",
  );
  const programMap = new Map<string, number>(
    programResult.rows.map((r: any) => [r.description, r.program_id]),
  );

  const errors: string[] = [];
  for (const [code, courseRows] of byCode) {
    const descVals = new Set(courseRows.map((r) => r.course_description ?? ""));
    const typeVals = new Set(courseRows.map((r) => r.course_type ?? ""));
    if (descVals.size > 1 || typeVals.size > 1) {
      errors.push(`${code}: course_description/course_type differ across rows`);
      continue;
    }
    for (const row of courseRows) {
      if (!row.program || !row.year_level) {
        errors.push(`${code}: program and year_level are required`);
        continue;
      }
      if (!courseTypeMap.has(row.course_type)) {
        errors.push(`${code}: unknown course_type "${row.course_type}"`);
      }
      if (!programMap.has(row.program)) {
        errors.push(`${code}: unknown program "${row.program}"`);
      }
      if (!YEAR_LEVELS.includes(row.year_level)) {
        errors.push(`${code}: invalid year_level "${row.year_level}"`);
      }
      if (!TERMS.includes(row.term)) {
        errors.push(`${code}: invalid term "${row.term}"`);
      }
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: `Import stopped — fix these and re-upload:\n${[...new Set(errors)].join("\n")}`,
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let inserted = 0;
    let curriculumInserted = 0;

    for (const [code, courseRows] of byCode) {
      const first = courseRows[0];
      const courseTypeId = courseTypeMap.get(first.course_type);
      const c = await client.query(
        `INSERT INTO course (course_code, course_description, course_type_id)
         VALUES ($1, $2, $3) ON CONFLICT (course_code) DO NOTHING`,
        [code, first.course_description, courseTypeId],
      );
      inserted += c.rowCount ?? 0;

      for (const row of courseRows) {
        const programId = programMap.get(row.program);
        const r = await client.query(
          `INSERT INTO curriculum (year_level, program_id, course_code, term)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
          [row.year_level, programId, code, row.term],
        );
        curriculumInserted += r.rowCount ?? 0;
      }
    }

    await client.query("COMMIT");
    res.json({ success: true, inserted, curriculumInserted });
  } catch (err: any) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});
app.get("/", (req: Request, res: Response) => {
  res.json({ message: "STI-Sync API is running" });
});
app.get("/schedules", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT schedule_id, academic_year as year, school_term as term, status, is_hidden FROM schedule ORDER BY academic_year DESC, school_term DESC",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch schedules" });
  }
});

app.put("/schedules/:id/activate", async (req, res) => {
  try {
    const { id } = req.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE schedule SET status = 'archived'");
      await client.query(
        "UPDATE schedule SET status = 'active' WHERE schedule_id = $1",
        [id],
      );
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to activate schedule" });
  }
});

app.put("/schedules/:id/hide", async (req: Request, res: Response) => {
  try {
    if (req.query.force !== "1") {
      const hasClasses = await pool.query(
        "SELECT 1 FROM class WHERE schedule_id = $1 LIMIT 1",
        [req.params.id],
      );
      if (hasClasses.rows.length === 0) {
        return res.status(409).json({
          success: false,
          needsConfirm: true,
          error:
            "This semester has no generated timetable. Once archived, it won't appear in the dropdown or in History, so you can't open it again. Archive anyway?",
        });
      }
    }
    const result = await pool.query(
      "UPDATE schedule SET is_hidden = true, status = 'archived' WHERE schedule_id = $1 RETURNING *",
      [req.params.id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Schedule not found" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to archive schedule" });
  }
});

app.post("/login", async (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res
        .status(400)
        .json({ success: false, error: "Password required" });
    }

    const result = await pool.query("SELECT password_hash FROM login LIMIT 1");

    if (result.rows.length === 0) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid password" });
    }

    const storedHash = result.rows[0].password_hash;
    const match = await bcrypt.compare(password, storedHash);

    if (!match) {
      return res
        .status(401)
        .json({ success: false, error: "Invalid password" });
    }

    return res.json({ success: true, token: "logged-in-" + Date.now() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});
const RESET_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
let generateInProgress = false;
let lastGenerateResult: any = null;
let pendingReset: {
  code: string;
  expiresAt: number;
  sentAt: number;
  attempts: number;
} | null = null;

function maskEmail(email: string): string {
  const [user = "", domain = ""] = email.split("@");
  return `${user.charAt(0)}***@${domain}`;
}

app.post("/change-password/request", async (req: Request, res: Response) => {
  const apiKey = (process.env as any).RESEND_API_KEY;
  const to = (process.env as any).ADMIN_EMAIL;
  if (!apiKey || !to) {
    return res.status(500).json({
      success: false,
      error: "Email is not configured on the server",
    });
  }
  if (pendingReset && Date.now() - pendingReset.sentAt < RESEND_COOLDOWN_MS) {
    return res.status(429).json({
      success: false,
      error: "Please wait a minute before requesting another code",
    });
  }

  const code = String(randomInt(100000, 1000000));
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from:
          (process.env as any).RESEND_FROM ||
          "STI-Sync <onboarding@resend.dev>",
        to: [to],
        subject: "STI-Sync password change code",
        html: `<p>Your STI-Sync verification code is:</p>
<p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>
<p>It expires in 10 minutes. If you did not request this, ignore this email.</p>`,
      }),
    });
    if (!r.ok) {
      console.error("Resend error:", await r.text());
      return res
        .status(502)
        .json({ success: false, error: "Could not send the email" });
    }
    pendingReset = {
      code,
      expiresAt: Date.now() + RESET_TTL_MS,
      sentAt: Date.now(),
      attempts: 0,
    };
    res.json({ success: true, sentTo: maskEmail(to) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Could not send the email" });
  }
});

app.put("/change-password/confirm", async (req: Request, res: Response) => {
  const { code, new_password } = req.body;
  if (!code || !new_password) {
    return res
      .status(400)
      .json({ success: false, error: "Code and new password are required" });
  }
  if (String(new_password).length < 8) {
    return res.status(400).json({
      success: false,
      error: "New password must be at least 8 characters",
    });
  }
  if (!pendingReset || Date.now() > pendingReset.expiresAt) {
    pendingReset = null;
    return res.status(400).json({
      success: false,
      error: "Code expired. Request a new one.",
    });
  }
  pendingReset.attempts += 1;
  if (pendingReset.attempts > MAX_CODE_ATTEMPTS) {
    pendingReset = null;
    return res.status(429).json({
      success: false,
      error: "Too many attempts. Request a new code.",
    });
  }
  if (String(code) !== pendingReset.code) {
    return res.status(401).json({ success: false, error: "Incorrect code" });
  }
  try {
    const result = await pool.query("SELECT id FROM login LIMIT 1");
    const hash = await bcrypt.hash(String(new_password), 10);
    if (result.rows.length === 0) {
      await pool.query("INSERT INTO login (password_hash) VALUES ($1)", [hash]);
    } else {
      await pool.query("UPDATE login SET password_hash = $1 WHERE id = $2", [
        hash,
        result.rows[0].id,
      ]);
    }
    pendingReset = null;
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/test-db", async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ success: true, time: result.rows[0] });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Database connection failed" });
  }
});

app.get("/rooms", async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM room ORDER BY room_number");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch rooms" });
  }
});

app.get("/programs", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM program ORDER BY program_id",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch programs" });
  }
});

app.get("/days", async (req: Request, res: Response) => {
  try {
    const result = await pool.query("SELECT * FROM day ORDER BY day_id");
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch days" });
  }
});

app.get("/course-types", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM course_type ORDER BY course_type_id",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch course types" });
  }
});

app.get("/employees", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM employee ORDER BY employee_id",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch employees" });
  }
});

app.get("/courses", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM course ORDER BY course_code",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch courses" });
  }
});

app.get("/courses/:code/employees", async (req: Request, res: Response) => {
  try {
    const { code } = req.params;
    const result = await pool.query(
      `SELECT e.employee_id, e.name, e.department
       FROM course_employee ce
       JOIN employee e ON e.employee_id = ce.employee_id
       WHERE ce.course_code = $1`,
      [code],
    );
    res.json(result.rows);
  } catch (err: any) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch course professors" });
  }
});

app.put("/courses/:code/employees", async (req: Request, res: Response) => {
  const { code } = req.params;
  const { employee_ids } = req.body;

  if (!Array.isArray(employee_ids)) {
    return res
      .status(400)
      .json({ success: false, error: "employee_ids must be an array" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM course_employee WHERE course_code = $1", [
      code,
    ]);

    for (const empId of employee_ids) {
      await client.query(
        "INSERT INTO course_employee (course_code, employee_id) VALUES ($1, $2)",
        [code, empId],
      );
    }

    await client.query("COMMIT");
    res.json({ success: true, count: employee_ids.length });
  } catch (err: any) {
    await client.query("ROLLBACK");
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to update course professors" });
  } finally {
    client.release();
  }
});

app.get("/sections", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM section WHERE schedule_id = (SELECT schedule_id FROM schedule WHERE status = 'active' LIMIT 1) ORDER BY section_id",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch sections" });
  }
});

app.post("/sections", async (req: Request, res: Response) => {
  const { number_of_students, year_level, program_id, section_name } = req.body;
  if (!YEAR_LEVELS.includes(year_level)) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid year level" });
  }
  try {
    const dup = await pool.query(
      `SELECT 1 FROM section
       WHERE schedule_id = (SELECT schedule_id FROM schedule WHERE status = 'active' LIMIT 1)
         AND program_id = $1 AND year_level = $2
         AND COALESCE(section_name, '') = COALESCE($3::text, '')
       LIMIT 1`,
      [program_id, year_level, section_name || null],
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "This section already exists in the active semester.",
      });
    }
    const result = await pool.query(
      `INSERT INTO section (number_of_students, year_level, program_id, section_name, schedule_id)
 VALUES ($1, $2, $3, $4, (SELECT schedule_id FROM schedule WHERE status = 'active' LIMIT 1))
 RETURNING *`,
      [number_of_students, year_level, program_id, section_name || null],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to create section" });
  }
});

async function autoAssignMinorProfessors(courseCode: string) {
  await pool.query(
    `INSERT INTO course_employee (course_code, employee_id)
     SELECT $1::varchar, e.employee_id
     FROM employee e
            WHERE e.department = 'GE'
       AND NOT EXISTS (
         SELECT 1 FROM course_employee WHERE course_code = $1::varchar
       )
     ON CONFLICT DO NOTHING`,
    [courseCode],
  );
}
app.post("/sections/copy", async (req: Request, res: Response) => {
  const fromId = Number(req.body.from_schedule_id);
  if (!Number.isInteger(fromId)) {
    return res
      .status(400)
      .json({ success: false, error: "from_schedule_id is required" });
  }
  try {
    const active = await pool.query(
      "SELECT schedule_id FROM schedule WHERE status = 'active' LIMIT 1",
    );
    if (active.rows.length === 0) {
      return res
        .status(400)
        .json({ success: false, error: "No active semester." });
    }
    const toId = active.rows[0].schedule_id;
    if (toId === fromId) {
      return res.status(400).json({
        success: false,
        error: "Pick a different semester to copy from.",
      });
    }

    const total = await pool.query(
      "SELECT COUNT(*)::int AS n FROM section WHERE schedule_id = $1",
      [fromId],
    );
    const r = await pool.query(
      `INSERT INTO section (number_of_students, year_level, program_id, section_name, schedule_id)
       SELECT s.number_of_students, s.year_level, s.program_id, s.section_name, $2::int
       FROM section s
       WHERE s.schedule_id = $1::int
         AND NOT EXISTS (
           SELECT 1 FROM section t
           WHERE t.schedule_id = $2::int
             AND t.program_id = s.program_id
             AND t.year_level = s.year_level
             AND COALESCE(t.section_name, '') = COALESCE(s.section_name, '')
         )
       RETURNING section_id`,
      [fromId, toId],
    );
    const copied = r.rowCount ?? 0;
    res.json({ success: true, copied, skipped: total.rows[0].n - copied });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to copy sections" });
  }
});

app.put("/curriculum/:id/subject-type", async (req: Request, res: Response) => {
  const { subject_type } = req.body;
  if (!["Major", "Minor"].includes(subject_type))
    return res
      .status(400)
      .json({ error: "subject_type must be Major or Minor" });
  try {
    const r = await pool.query(
      "UPDATE curriculum SET subject_type = $1 WHERE curriculum_id = $2 RETURNING course_code",
      [subject_type, req.params.id],
    );
    if (r.rowCount === 0) return res.status(404).json({ error: "Not found" });
    if (subject_type === "Minor")
      await autoAssignMinorProfessors(r.rows[0].course_code);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/curriculum", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM curriculum ORDER BY curriculum_id",
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/availability", async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM availability ORDER BY availability_id",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch availability" });
  }
});

app.get("/classes", async (req: Request, res: Response) => {
  const sid = Number(req.query.schedule_id);
  try {
    const result = await pool.query(
      `
      SELECT 
        c.class_id,
        c.employee_id,
        c.room_id,
        c.day_id,
        c.schedule_id,
        c.start_time,
        c.end_time,
        e.name AS professor,
        r.room_number AS room,
        sec.section_id,
        sec.year_level,
        sec.section_name,
        p.description AS program,
        p.code,
        co.course_code,
        co.course_description AS course,
        d.name AS day,
        s.academic_year,
        s.school_term
      FROM class c
      JOIN employee e ON c.employee_id = e.employee_id
      JOIN room r ON c.room_id = r.room_id
      JOIN section sec ON c.section_id = sec.section_id
      JOIN program p ON sec.program_id = p.program_id
      JOIN course co ON c.course_code = co.course_code
      JOIN day d ON c.day_id = d.day_id
      JOIN schedule s ON c.schedule_id = s.schedule_id
      WHERE (($1::int IS NULL AND s.status = 'active') OR s.schedule_id = $1::int)
      ORDER BY d.day_id, c.start_time
    `,
      [Number.isInteger(sid) ? sid : null],
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to fetch classes" });
  }
});
async function roomExists(roomNumber: any, excludeId?: string) {
  const r = await pool.query(
    `SELECT 1 FROM room
     WHERE LOWER(REGEXP_REPLACE(room_number, '\\s', '', 'g')) = $1
       AND ($2::int IS NULL OR room_id <> $2::int)
     LIMIT 1`,
    [
      String(roomNumber ?? "")
        .toLowerCase()
        .replace(/\s+/g, ""),
      excludeId ?? null,
    ],
  );
  return r.rows.length > 0;
}

app.post("/rooms", async (req: Request, res: Response) => {
  const { room_number, capacity, type } = req.body;
  try {
    if (await roomExists(room_number)) {
      return res.status(409).json({
        success: false,
        error: "A room with this number already exists.",
      });
    }
    const result = await pool.query(
      "INSERT INTO room (room_number, capacity, type) VALUES ($1, $2, $3) RETURNING *",
      [room_number, capacity, type],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to create room" });
  }
});

app.post("/programs", async (req: Request, res: Response) => {
  const description = (req.body.description ?? "").trim().replace(/\s+/g, " ");
  const code = (req.body.code ?? "").trim().toUpperCase();
  try {
    const result = await pool.query(
      "INSERT INTO program (description, code) VALUES ($1, $2) RETURNING *",
      [description, code],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A program with this name already exists.",
      });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to create program" });
  }
});

app.post("/days", async (req: Request, res: Response) => {
  const { name } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO day (name) VALUES ($1) RETURNING *",
      [name],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to create day" });
  }
});

app.post("/course-types", async (req: Request, res: Response) => {
  const { course_type_description, total_hours } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO course_type (course_type_description, total_hours) VALUES ($1, $2) RETURNING *",
      [course_type_description, total_hours],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create course type" });
  }
});
async function employeeExists(
  lname: any,
  fname: any,
  mname: any,
  excludeId?: string,
) {
  const r = await pool.query(
    `SELECT 1 FROM employee
     WHERE LOWER(TRIM(lname)) = LOWER(TRIM($1))
       AND LOWER(TRIM(fname)) = LOWER(TRIM($2))
       AND LOWER(TRIM(COALESCE(mname, ''))) = LOWER(TRIM($3))
       AND ($4::int IS NULL OR employee_id <> $4::int)
     LIMIT 1`,
    [lname ?? "", fname ?? "", mname ?? "", excludeId ?? null],
  );
  return r.rows.length > 0;
}
async function departmentExists(name: any) {
  const r = await pool.query(
    "SELECT 1 FROM department WHERE description = $1 OR $1 = 'Unassigned'",
    [String(name ?? "").trim()],
  );
  return r.rows.length > 0;
}

app.post("/employees", async (req: Request, res: Response) => {
  const {
    department,
    lname,
    mname,
    fname,
    position,
    username,
    max_hours_per_day,
    max_hours_per_week,
  } = req.body;
  try {
    if (!(await departmentExists(department))) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid department" });
    }
    if (await employeeExists(lname, fname, mname)) {
      return res.status(409).json({
        success: false,
        error: "A professor with this name already exists.",
      });
    }
    const result = await pool.query(
      `INSERT INTO employee
        (department, lname, mname, fname, position, username, max_hours_per_day, max_hours_per_week)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        department,
        lname,
        mname,
        fname,
        position,
        username || null,
        max_hours_per_day ?? null,
        max_hours_per_week ?? null,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create employee" });
  }
});
app.put("/employees/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    department,
    lname,
    mname,
    fname,
    position,
    username,
    max_hours_per_day,
    max_hours_per_week,
  } = req.body;
  try {
    if (!(await departmentExists(department))) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid department" });
    }
    if (await employeeExists(lname, fname, mname, String(id))) {
      return res.status(409).json({
        success: false,
        error: "Another professor with this name already exists.",
      });
    }
    const result = await pool.query(
      `UPDATE employee
       SET department = $1, lname = $2, mname = $3, fname = $4, position = $5,
           username = $6, max_hours_per_day = $7, max_hours_per_week = $8
       WHERE employee_id = $9 RETURNING *`,
      [
        department,
        lname,
        mname,
        fname,
        position,
        username || null,
        max_hours_per_day ?? null,
        max_hours_per_week ?? null,
        id,
      ],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Employee not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to update employee" });
  }
});

app.post("/courses", async (req: Request, res: Response) => {
  const course_code = String(req.body.course_code ?? "").trim();
  const { course_description, course_type_id } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO course (course_code, course_description, course_type_id) VALUES ($1, $2, $3) RETURNING *",
      [course_code, course_description, course_type_id],
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A course with this code already exists.",
      });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to create course" });
  }
});

app.post("/curriculum", async (req: Request, res: Response) => {
  const {
    year_level,
    program_id,
    course_code,
    term = "1st Semester",
    subject_type = null,
  } = req.body;
  if (!YEAR_LEVELS.includes(year_level)) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid year level" });
  }
  if (!TERMS.includes(term)) {
    return res.status(400).json({ success: false, error: "Invalid term" });
  }
  if (subject_type !== null && !["Major", "Minor"].includes(subject_type)) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid subject type" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO curriculum (year_level, program_id, course_code, term, subject_type)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT ON CONSTRAINT curriculum_program_year_course_term_key
       DO UPDATE SET subject_type = COALESCE(EXCLUDED.subject_type, curriculum.subject_type)
       RETURNING *`,
      [year_level, program_id, course_code, term, subject_type],
    );
    if (result.rows[0].subject_type === "Minor")
      await autoAssignMinorProfessors(course_code);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create curriculum entry" });
  }
});
app.post("/schedules", async (req: Request, res: Response) => {
  const { academic_year, school_term, start_date, end_date } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO schedule (academic_year, school_term, status, start_date, end_date) VALUES ($1, $2, 'archived', $3, $4) RETURNING *",
      [academic_year, school_term, start_date, end_date],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create schedule" });
  }
});

app.post("/availability", async (req: Request, res: Response) => {
  const { start_time, end_time, day_id, employee_id } = req.body;
  try {
    const result = await pool.query(
      "INSERT INTO availability (start_time, end_time, day_id, employee_id) VALUES ($1, $2, $3, $4) RETURNING *",
      [start_time, end_time, day_id, employee_id],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to create availability" });
  }
});

app.post("/classes", async (req: Request, res: Response) => {
  const {
    start_time,
    end_time,
    employee_id,
    room_id,
    section_id,
    course_code,
    day_id,
    schedule_id,
  } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO class (start_time, end_time, employee_id, room_id, section_id, course_code, day_id, schedule_id) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        start_time,
        end_time,
        employee_id,
        room_id,
        section_id,
        course_code,
        day_id,
        schedule_id,
      ],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to create class" });
  }
});

app.put("/rooms/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { room_number, capacity, type } = req.body;
  try {
    if (await roomExists(room_number, String(id))) {
      return res.status(409).json({
        success: false,
        error: "Another room with this number already exists.",
      });
    }
    const result = await pool.query(
      "UPDATE room SET room_number = $1, capacity = $2, type = $3 WHERE room_id = $4 RETURNING *",
      [room_number, capacity, type, id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to update room" });
  }
});

app.put("/programs/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const description = (req.body.description ?? "").trim().replace(/\s+/g, " ");
  const code = (req.body.code ?? "").trim().toUpperCase();
  try {
    const result = await pool.query(
      "UPDATE program SET description = $1, code = $2 WHERE program_id = $3 RETURNING *",
      [description, code, id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Program not found" });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(409).json({
        success: false,
        error: "A program with this name already exists.",
      });
    }
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to update program" });
  }
});
app.put("/course-types/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { course_type_description, total_hours } = req.body;
  try {
    const result = await pool.query(
      "UPDATE course_type SET course_type_description = $1, total_hours = $2 WHERE course_type_id = $3 RETURNING *",
      [course_type_description, total_hours, id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Course type not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to update course type" });
  }
});

app.put("/courses/:code", async (req: Request, res: Response) => {
  const { code } = req.params;
  const { course_description, course_type_id } = req.body;
  try {
    const result = await pool.query(
      "UPDATE course SET course_description = $1, course_type_id = $2 WHERE course_code = $3 RETURNING *",
      [course_description, course_type_id, code],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Course not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to update course" });
  }
});
app.put("/courses/:code/curriculum", async (req: Request, res: Response) => {
  const { code } = req.params;
  const { placements } = req.body;
  if (!Array.isArray(placements)) {
    return res
      .status(400)
      .json({ success: false, error: "placements must be an array" });
  }
  for (const p of placements) {
    if (!YEAR_LEVELS.includes(p.year_level) || !TERMS.includes(p.term)) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid year level or term" });
    }
    if (
      p.subject_type !== null &&
      !["Major", "Minor"].includes(p.subject_type)
    ) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid subject type" });
    }
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM curriculum WHERE course_code = $1", [code]);
    for (const p of placements) {
      await client.query(
        `INSERT INTO curriculum (year_level, program_id, course_code, term, subject_type)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ON CONSTRAINT curriculum_program_year_course_term_key DO NOTHING`,
        [p.year_level, p.program_id, code, p.term, p.subject_type],
      );
    }
    await client.query("COMMIT");
    if (placements.some((p: any) => p.subject_type === "Minor")) {
      await autoAssignMinorProfessors(String(code));
    }
    res.json({ success: true });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to save curriculum placements" });
  } finally {
    client.release();
  }
});

app.put("/sections/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { number_of_students, year_level, program_id, section_name } = req.body;
  if (!YEAR_LEVELS.includes(year_level)) {
    return res
      .status(400)
      .json({ success: false, error: "Invalid year level" });
  }
  try {
    const dup = await pool.query(
      `SELECT 1 FROM section
       WHERE schedule_id = (SELECT schedule_id FROM section WHERE section_id = $4::int)
         AND section_id <> $4::int
         AND program_id = $1 AND year_level = $2
         AND COALESCE(section_name, '') = COALESCE($3::text, '')
       LIMIT 1`,
      [program_id, year_level, section_name || null, id],
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({
        success: false,
        error: "This section already exists in this semester.",
      });
    }
    const result = await pool.query(
      "UPDATE section SET number_of_students = $1, year_level = $2, program_id = $3, section_name = $4 WHERE section_id = $5 RETURNING *",
      [number_of_students, year_level, program_id, section_name || null, id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Section not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to update section" });
  }
});

app.put("/schedules/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { academic_year, school_term, status, start_date, end_date } = req.body;
  try {
    const result = await pool.query(
      `UPDATE schedule
       SET academic_year = COALESCE($1, academic_year),
           school_term   = COALESCE($2, school_term),
           status        = COALESCE($3, status),
           start_date    = COALESCE($4, start_date),
           end_date      = COALESCE($5, end_date)
       WHERE schedule_id = $6 RETURNING *`,
      [academic_year, school_term, status, start_date, end_date, id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Schedule not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to update schedule" });
  }
});

app.put("/availability/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { start_time, end_time, day_id, employee_id } = req.body;
  try {
    const result = await pool.query(
      "UPDATE availability SET start_time = $1, end_time = $2, day_id = $3, employee_id = $4 WHERE availability_id = $5 RETURNING *",
      [start_time, end_time, day_id, employee_id, id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Availability not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to update availability" });
  }
});

app.put("/classes/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    start_time,
    end_time,
    employee_id,
    room_id,
    section_id,
    course_code,
    day_id,
    schedule_id,
  } = req.body;
  try {
    const result = await pool.query(
      `UPDATE class 
       SET start_time = $1, end_time = $2, employee_id = $3, room_id = $4, section_id = $5, course_code = $6, day_id = $7, schedule_id = $8 
       WHERE class_id = $9 RETURNING *`,
      [
        start_time,
        end_time,
        employee_id,
        room_id,
        section_id,
        course_code,
        day_id,
        schedule_id,
        id,
      ],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Class not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to update class" });
  }
});

app.delete("/rooms/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM room WHERE room_id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to delete room" });
  }
});

app.delete("/programs/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM curriculum WHERE program_id = $1", [
      req.params.id,
    ]);
    await pool.query("DELETE FROM program WHERE program_id = $1", [
      req.params.id,
    ]);
    res.json({ success: true });
  } catch (err: any) {
    if (err.code === "23503" || err.code === "23001") {
      return res.status(409).json({
        error:
          "Can't delete: this program is used by sections. Delete its sections first.",
      });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete("/course-types/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM course_type WHERE course_type_id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Course type not found" });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete course type" });
  }
});

app.delete("/employees/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM employee WHERE employee_id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Employee not found" });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err: any) {
    if (err.code === "23503" || err.code === "23001" || err.code === "23P01") {
      return res.status(409).json({
        error:
          "Can't delete: this professor is scheduled in classes or assigned to courses.",
      });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete("/courses/:code", async (req: Request, res: Response) => {
  const { code } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM curriculum WHERE course_code = $1", [code]);
    await client.query("DELETE FROM course_employee WHERE course_code = $1", [
      code,
    ]);
    const result = await client.query(
      "DELETE FROM course WHERE course_code = $1 RETURNING *",
      [code],
    );
    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ success: false, error: "Course not found" });
    }
    await client.query("COMMIT");
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err: any) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    if (err.code === "23503" || err.code === "23001") {
      return res.status(409).json({
        success: false,
        error:
          "This course is used by scheduled classes. Regenerate or remove them first.",
      });
    }
    res.status(500).json({ success: false, error: "Failed to delete course" });
  } finally {
    client.release();
  }
});

app.delete("/sections/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM class WHERE section_id = $1", [id]);
    const result = await client.query(
      "DELETE FROM section WHERE section_id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res
        .status(404)
        .json({ success: false, error: "Section not found" });
    }
    await client.query("COMMIT");
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to delete section" });
  } finally {
    client.release();
  }
});

app.delete("/curriculum/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM curriculum WHERE curriculum_id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Curriculum entry not found" });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete curriculum entry" });
  }
});

app.delete("/schedules/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM schedule WHERE schedule_id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Schedule not found" });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete schedule" });
  }
});

app.delete("/availability/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM availability WHERE availability_id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, error: "Availability not found" });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to delete availability" });
  }
});

app.delete("/classes/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM class WHERE class_id = $1 RETURNING *",
      [id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Class not found" });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Failed to delete class" });
  }
});

app.get("/generate-schedule/status", (req: Request, res: Response) => {
  res.json({ running: generateInProgress, result: lastGenerateResult });
});

app.post("/generate-schedule", async (req: Request, res: Response) => {
  if (generateInProgress) {
    return res.status(409).json({
      success: false,
      error:
        "A schedule generation is already running. Please wait for it to finish.",
    });
  }
  generateInProgress = true;
  lastGenerateResult = null;

  let client: PoolClient | undefined;

  try {
    const activeScheduleResult = await pool.query(
      "SELECT schedule_id FROM schedule WHERE status = 'active' LIMIT 1",
    );

    if (activeScheduleResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: "No active schedule found. Create an active schedule first.",
      });
    }

    const scheduleId = activeScheduleResult.rows[0].schedule_id;

    const input = await buildSchedulingInputFromDB(scheduleId);
    const requirements = buildRequirements(input);

    if (requirements.length === 0) {
      return res.status(400).json({
        success: false,
        error:
          "No scheduling requirements found. Check that curriculum entries match section program_id + year_level.",
      });
    }

    const gaStart = Date.now();
    const gaResult = await runGAInWorker(input, 50, 200);
    console.log(
      `GA took ${((Date.now() - gaStart) / 1000).toFixed(1)}s, ${gaResult.generationsRun} generations`,
    );
    console.log("Final fitness:", gaResult.best.fitness);

    client = await pool.connect();
    await client.query("BEGIN");

    await client.query("DELETE FROM class WHERE schedule_id = $1", [
      scheduleId,
    ]);

    const insertedClasses = [];
    for (const assignment of gaResult.best.assignments) {
      const insertResult = await client.query(
        `INSERT INTO class (start_time, end_time, employee_id, room_id, section_id, course_code, day_id, schedule_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          assignment.start_time,
          assignment.end_time,
          assignment.employee_id,
          assignment.room_id,
          assignment.section_id,
          assignment.course_code,
          assignment.day_id,
          scheduleId,
        ],
      );
      insertedClasses.push(insertResult.rows[0]);
    }

    await client.query("COMMIT");

    const responsePayload = {
      success: true,
      fitness: gaResult.best.fitness,
      isConflictFree: gaResult.best.fitness === 0,
      generationsRun: gaResult.generationsRun,
      classesCreated: insertedClasses.length,
      classes: insertedClasses,
    };
    lastGenerateResult = responsePayload;
    res.json(responsePayload);
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    const message =
      err instanceof Error ? err.message : "Failed to generate schedule";
    lastGenerateResult = { success: false, error: message };
    res.status(500).json({ success: false, error: message });
  } finally {
    client?.release();
    generateInProgress = false;
  }
});
app.get("/course-employees", async (_req: Request, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT course_code, employee_id FROM course_employee",
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res
      .status(500)
      .json({ success: false, error: "Failed to fetch course professors" });
  }
});
app.get("/summary", async (_req, res) => {
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM room)::int AS rooms,
        (SELECT COUNT(*) FROM employee)::int AS employees,
        (SELECT COUNT(*) FROM course)::int AS courses,
        (SELECT COUNT(*) FROM section
           WHERE schedule_id = (SELECT schedule_id FROM schedule WHERE status = 'active' LIMIT 1))::int AS sections
    `);
    res.json(r.rows[0]);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
app.get("/departments", async (req, res) => {
  try {
    const r = await pool.query(
      "SELECT department_id, description FROM department ORDER BY department_id",
    );
    res.json(r.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
