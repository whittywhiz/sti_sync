import { pool } from "./db";
import { SchedulingInput } from "./types";

export async function buildSchedulingInputFromDB(
  scheduleId: number,
): Promise<SchedulingInput> {
  const [
    roomsResult,
    employeesResult,
    sectionsResult,
    coursesResult,
    curriculumResult,
    courseEmployeesResult,
    availabilityResult,
    daysResult,
  ] = await Promise.all([
    pool.query(
      "SELECT room_id, room_number, capacity, type, program_id FROM room WHERE is_archived = false",
    ),
    pool.query(
      "SELECT employee_id, department, name, max_hours_per_day, max_hours_per_week FROM employee WHERE is_archived = false",
    ),
    pool.query(
      "SELECT section_id, number_of_students, year_level, program_id FROM section WHERE schedule_id = $1 AND program_id IN (SELECT program_id FROM program WHERE is_archived = false)",
      [scheduleId],
    ),
    pool.query(`
      SELECT
        c.course_code,
        c.course_description,
        c.course_type_id,
        ct.course_type_description,
        ct.total_hours
      FROM course c
           JOIN course_type ct ON c.course_type_id = ct.course_type_id
      WHERE c.is_archived = false
    `),
    pool.query(
      `SELECT c.curriculum_id, c.year_level, c.program_id, c.course_code
       FROM curriculum c
       JOIN schedule s ON s.schedule_id = $1
      WHERE c.term = s.school_term
         AND EXISTS (SELECT 1 FROM course co WHERE co.course_code = c.course_code AND co.is_archived = false)
         AND EXISTS (SELECT 1 FROM program p WHERE p.program_id = c.program_id AND p.is_archived = false)`,
      [scheduleId],
    ),
    pool.query(
      "SELECT course_code, employee_id FROM course_employee WHERE employee_id IN (SELECT employee_id FROM employee WHERE is_archived = false)",
    ),
    pool.query(
      "SELECT availability_id, employee_id, day_id, start_time, end_time FROM availability WHERE employee_id IN (SELECT employee_id FROM employee WHERE is_archived = false)",
    ),
    pool.query("SELECT day_id, name FROM day"),
  ]);

  return {
    rooms: roomsResult.rows,
    employees: employeesResult.rows,
    sections: sectionsResult.rows,
    courses: coursesResult.rows,
    curriculum: curriculumResult.rows,
    course_employees: courseEmployeesResult.rows,
    availability: availabilityResult.rows,
    days: daysResult.rows,
    schedule_id: scheduleId,
  };
}
