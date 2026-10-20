import { professorDisplayName, type ScheduleEntry, type Day, type Section, type Professor } from '@/types/scheduling';

export function checkMoveCollision(
  schedule: ScheduleEntry[],
  entryId: string,
  newDay: Day,
  newStartHour: number,
  _sections: Section[],
  professors?: Professor[]
): { allowed: boolean; reason?: string } {
  const entry = schedule.find((e) => e.id === entryId);
  if (!entry) return { allowed: false, reason: 'Entry not found' };

  const duration = entry.endHour - entry.startHour;
  const newEndHour = newStartHour + duration;

  if (newStartHour < 7 || newEndHour > 20) {
    return { allowed: false, reason: 'Outside allowed hours (7AM–8PM)' };
  }

  if (professors) {
    const prof = professors.find((p) => p.id === entry.professorId);
    if (prof) {
      const isAvailable = prof.availability.some(
        (slot) => slot.day === newDay && slot.startHour <= newStartHour && slot.endHour >= newEndHour
      );
      if (!isAvailable) {
        return { allowed: false, reason: `${professorDisplayName(prof)} is not available on ${newDay} at this time` };
      }
    }
  }

  const others = schedule.filter((e) => e.id !== entryId);

  if (others.some((e) => e.day === newDay && e.professorId === entry.professorId && newStartHour < e.endHour && newEndHour > e.startHour)) {
    return { allowed: false, reason: 'Professor has another class at this time' };
  }
  if (others.some((e) => e.day === newDay && e.roomId === entry.roomId && newStartHour < e.endHour && newEndHour > e.startHour)) {
    return { allowed: false, reason: 'Room is occupied at this time' };
  }
  if (others.some((e) => e.day === newDay && e.sectionId === entry.sectionId && newStartHour < e.endHour && newEndHour > e.startHour)) {
    return { allowed: false, reason: 'Section has another class at this time' };
  }

  return { allowed: true };
}
