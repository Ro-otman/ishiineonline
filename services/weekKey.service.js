function pad2(value) {
  return String(value).padStart(2, '0');
}

export function weekKeyFromDateUtc(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (!d || Number.isNaN(d.getTime())) return null;

  // Normalize to start-of-day (UTC)
  const startOfDayUtc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );

  // JS: 0=Sunday ... 6=Saturday. We want Monday as start of week.
  const day = startOfDayUtc.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  startOfDayUtc.setUTCDate(startOfDayUtc.getUTCDate() + diff);

  return `${startOfDayUtc.getUTCFullYear()}-${pad2(startOfDayUtc.getUTCMonth() + 1)}-${pad2(startOfDayUtc.getUTCDate())}`;
}
