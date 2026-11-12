/** Finds calendar-day boundaries in the restaurant timezone, including DST days. */
export function localDayBounds(day: string, timeZone: string) {
  const anchor = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(anchor)) throw new Error('Fecha inválida');
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const calendarDay = (instant: number) => {
    const parts = formatter.formatToParts(new Date(instant));
    return ['year', 'month', 'day']
      .map((type) => parts.find((part) => part.type === type)!.value)
      .join('-');
  };
  const boundary = (after: boolean) => {
    let low = anchor - 36 * 3600_000;
    let high = anchor + 60 * 3600_000;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const value = calendarDay(mid);
      if (after ? value > day : value >= day) high = mid;
      else low = mid + 1;
    }
    return new Date(low);
  };
  return { gte: boundary(false), lt: boundary(true) };
}
