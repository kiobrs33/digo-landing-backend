import {
  addBusinessDays,
  businessDaysUntil,
  easterSunday,
  isBusinessDay,
  limaIsoDate,
} from './business-days.js';

describe('business-days', () => {
  it('calcula el Domingo de Pascua', () => {
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(easterSunday(2027)).toBe('2027-03-28');
  });

  it('excluye fines de semana, feriados fijos y Semana Santa', () => {
    expect(isBusinessDay('2026-10-03')).toBe(false); // sábado
    expect(isBusinessDay('2026-10-08')).toBe(false); // Combate de Angamos
    expect(isBusinessDay('2026-04-02')).toBe(false); // Jueves Santo
    expect(isBusinessDay('2026-04-03')).toBe(false); // Viernes Santo
    expect(isBusinessDay('2026-10-05')).toBe(true); // lunes
  });

  it('suma 15 días hábiles saltando el feriado del 8 de octubre', () => {
    // Reclamo del lunes 5/10/2026: cuenta desde el 6, salta fines de semana y el 8/10.
    expect(addBusinessDays('2026-10-05', 15)).toBe('2026-10-27');
  });

  it('cuenta los días hábiles restantes y vencidos', () => {
    expect(businessDaysUntil('2026-10-27', '2026-10-05')).toBe(15);
    expect(businessDaysUntil('2026-10-05', '2026-10-07')).toBe(-2);
    expect(businessDaysUntil('2026-10-05', '2026-10-05')).toBe(0);
  });

  it('usa la fecha de Lima, no la UTC', () => {
    // 03:00 UTC del 5/10 son las 22:00 del 4/10 en Lima.
    expect(limaIsoDate(new Date('2026-10-05T03:00:00Z'))).toBe('2026-10-04');
  });
});
