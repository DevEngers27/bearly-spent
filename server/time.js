// Calendar keys use the family's IANA zone, falling back to the server's zone.
export const serverTimezone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function dayKey(now, tz = serverTimezone()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(now));
  const part = (type) => parts.find((p) => p.type === type).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// ISO 8601 weeks run Monday–Sunday; week 1 contains the year's first Thursday.
// Work with the zoned calendar date in UTC so DST cannot shorten a week.
export function weekKey(now, tz = serverTimezone()) {
  const date = new Date(`${dayKey(now, tz)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const first = Date.UTC(year, 0, 1);
  const week = Math.ceil(((date.getTime() - first) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
