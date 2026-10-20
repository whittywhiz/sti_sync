export function formatTime12hr(time24: string): string {
  const parts = time24.split(":").map(Number);
  const hour24 = parts[0] ?? 0;
  const minute = parts[1] ?? 0;

  const period = hour24 >= 12 ? "PM" : "AM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;

  const minuteStr = minute.toString().padStart(2, "0");
  return `${hour12}:${minuteStr} ${period}`;
}
