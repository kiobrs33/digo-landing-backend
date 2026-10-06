/**
 * Días hábiles en Perú (zona America/Lima) para el plazo de respuesta del Libro de
 * Reclamaciones. Excluye sábados, domingos y feriados nacionales. Los feriados
 * extraordinarios que decrete el Gobierno se agregan en `EXTRA_HOLIDAYS`.
 */

/** Feriados nacionales fijos (MM-DD). */
const FIXED_HOLIDAYS = [
  '01-01', // Año Nuevo
  '05-01', // Día del Trabajo
  '06-07', // Batalla de Arica y Día de la Bandera
  '06-29', // San Pedro y San Pablo
  '07-23', // Día de la Fuerza Aérea del Perú
  '07-28', // Fiestas Patrias
  '07-29', // Fiestas Patrias
  '08-06', // Batalla de Junín
  '08-30', // Santa Rosa de Lima
  '10-08', // Combate de Angamos
  '11-01', // Todos los Santos
  '12-08', // Inmaculada Concepción
  '12-09', // Batalla de Ayacucho
  '12-25', // Navidad
];

/** Feriados o días no laborables extraordinarios (YYYY-MM-DD). */
const EXTRA_HOLIDAYS: string[] = [];

/** Fecha de hoy (o de `date`) en Lima, como 'YYYY-MM-DD'. */
export function limaIsoDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Domingo de Pascua (algoritmo gregoriano anónimo), como 'YYYY-MM-DD'. */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toIso(new Date(Date.UTC(year, month - 1, day)));
}

export function isPeruHoliday(iso: string): boolean {
  if (FIXED_HOLIDAYS.includes(iso.slice(5)) || EXTRA_HOLIDAYS.includes(iso)) {
    return true;
  }
  // Jueves y Viernes Santo
  const easter = fromIso(easterSunday(Number(iso.slice(0, 4))));
  return [addDays(easter, -3), addDays(easter, -2)].map(toIso).includes(iso);
}

export function isBusinessDay(iso: string): boolean {
  const weekday = fromIso(iso).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isPeruHoliday(iso);
}

/** Suma `count` días hábiles a partir del día siguiente a `startIso`. */
export function addBusinessDays(startIso: string, count: number): string {
  let date = fromIso(startIso);
  let added = 0;
  while (added < count) {
    date = addDays(date, 1);
    if (isBusinessDay(toIso(date))) added++;
  }
  return toIso(date);
}

/** Días hábiles que faltan desde hoy hasta `dueIso` (negativo si ya venció). */
export function businessDaysUntil(
  dueIso: string,
  todayIso: string = limaIsoDate(),
): number {
  if (dueIso === todayIso) return 0;
  const forward = dueIso > todayIso;
  const [from, to] = forward ? [todayIso, dueIso] : [dueIso, todayIso];
  let count = 0;
  let date = fromIso(from);
  while (toIso(date) < to) {
    date = addDays(date, 1);
    if (isBusinessDay(toIso(date))) count++;
  }
  return forward ? count : -count;
}

export function fromIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
