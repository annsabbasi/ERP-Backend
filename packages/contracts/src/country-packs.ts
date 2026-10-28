import { z } from 'zod';

// Country packs (Part 02 §2.6, Part 03 §3.11): a country's rules as versioned data with an
// effective date. This stage ships the skeleton; tax types and rates, withholding and payroll
// statutory data arrive in Phase 1.

export const CountryPackDataSchema = z.object({
  name: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z.string().min(1),
  /** 1 = January … 7 = July (Pakistan's fiscal year starts in July). */
  fiscal_year_start_month: z.number().int().min(1).max(12),
  languages: z.array(z.string().min(2)),
  /** Identity numbers the country uses, with a pattern to check them. */
  id_formats: z.record(
    z.string().regex(/^[a-z_]+$/),
    z.object({ label: z.string(), pattern: z.string(), example: z.string() }),
  ),
  holidays: z.array(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      name: z.string().min(1),
      /** Depends on the moon or a notification not issued yet: confirm before relying on it. */
      tentative: z.boolean(),
    }),
  ),
  /** Phase 1: tax types and rates, withholding rules, payroll statutory items, income-tax slabs. */
  tax: z.null(),
});
export type CountryPackData = z.infer<typeof CountryPackDataSchema>;

/** Every id format pattern compiles and accepts its own example. */
export function countryPackProblems(data: CountryPackData): string[] {
  const problems: string[] = [];
  for (const [key, format] of Object.entries(data.id_formats)) {
    try {
      if (!new RegExp(format.pattern).test(format.example)) {
        problems.push(`id format ${key}: its example does not match its pattern`);
      }
    } catch {
      problems.push(`id format ${key}: the pattern is not a valid regular expression`);
    }
  }
  const dates = data.holidays.map((h) => h.date);
  if (new Set(dates.map((d, i) => `${d}|${data.holidays[i]!.name}`)).size !== dates.length) {
    problems.push('a holiday is listed twice');
  }
  return problems;
}

/**
 * Pakistan 1.0 (fiscal year 2026–27). Fixed-date public holidays are certain; Islamic holidays
 * follow the moon and the federal notification, so their dates here are estimates marked
 * tentative until the government announces them.
 */
export const PAKISTAN_1_0: {
  country: 'PK';
  version: '1.0';
  effective_from: string;
  data: CountryPackData;
} = {
  country: 'PK',
  version: '1.0',
  effective_from: '2026-07-01',
  data: {
    name: 'Pakistan',
    currency: 'PKR',
    timezone: 'Asia/Karachi',
    fiscal_year_start_month: 7,
    languages: ['en'],
    id_formats: {
      cnic: { label: 'CNIC', pattern: '^\\d{5}-\\d{7}-\\d$', example: '35202-1234567-1' },
      ntn: { label: 'NTN', pattern: '^\\d{7}-\\d$', example: '1234567-8' },
      strn: {
        label: 'STRN',
        pattern: '^(\\d{13}|\\d{2}-\\d{2}-\\d{4}-\\d{3}-\\d{2})$',
        example: '32-77-8761-234-56',
      },
    },
    holidays: [
      { date: '2026-08-14', name: 'Independence Day', tentative: false },
      { date: '2026-08-26', name: 'Eid Milad-un-Nabi (12 Rabi-ul-Awwal)', tentative: true },
      { date: '2026-11-09', name: 'Iqbal Day', tentative: false },
      { date: '2026-12-25', name: 'Quaid-e-Azam Day', tentative: false },
      { date: '2027-02-05', name: 'Kashmir Solidarity Day', tentative: false },
      { date: '2027-03-10', name: 'Eid-ul-Fitr', tentative: true },
      { date: '2027-03-11', name: 'Eid-ul-Fitr', tentative: true },
      { date: '2027-03-12', name: 'Eid-ul-Fitr', tentative: true },
      { date: '2027-03-23', name: 'Pakistan Day', tentative: false },
      { date: '2027-05-01', name: 'Labour Day', tentative: false },
      { date: '2027-05-17', name: 'Eid-ul-Adha', tentative: true },
      { date: '2027-05-18', name: 'Eid-ul-Adha', tentative: true },
      { date: '2027-05-19', name: 'Eid-ul-Adha', tentative: true },
      { date: '2027-05-28', name: 'Youm-e-Takbeer', tentative: false },
      { date: '2027-06-14', name: 'Ashura (9 Muharram)', tentative: true },
      { date: '2027-06-15', name: 'Ashura (10 Muharram)', tentative: true },
    ],
    tax: null,
  },
};
