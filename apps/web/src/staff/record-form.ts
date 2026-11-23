import {
  formatPaise,
  isCalendarDate,
  MAX_OVERTIME_RATE_PAISE,
  MAX_SALARY_PAISE,
  newPassword,
  normalizePhone,
  parseRupees,
  SALARY_KINDS,
  text,
  username,
  uuid,
  type Paise,
  type SalaryInput,
  type SalaryKind,
  type StaffView,
} from '@business-software/shared';
import { z } from 'zod';

/**
 * What the staff form edits, as typed: every box is a string, and `recordPayload` turns them
 * into what the API takes once `personFormSchema` has passed them (P2.3 design §6). The password
 * is only asked, and only sent, when adding a login.
 */
export interface PersonForm {
  /** True for a person with a login or one being given one; false for a record only (`00` #19). */
  canLogin: boolean;
  name: string;
  username: string;
  password: string;
  homeBranchId: string;
  phone: string;
  joiningDate: string;
  /** '' = no weekly off, else '0' (Sunday) to '6' (Saturday). */
  weeklyOffDay: string;
  paidLeavesPerMonth: string;
  /** Rupees an hour; empty = no overtime (`05` #15). */
  overtimeRatePaise: string;
  salaryKind: SalaryKind;
  /** Rupees; empty = "Salary not set". Only the add page has it. */
  salaryAmount: string;
}

type Context = z.RefinementCtx;

const problem = (context: Context, path: keyof PersonForm, message: string) => {
  context.addIssue({ code: 'custom', path: [path], message });
};

/** An optional amount in rupees: empty is fine, else more than 0 and at most `max` paise. */
function checkAmount(context: Context, path: keyof PersonForm, input: string, max: Paise) {
  if (input.trim() === '') return;
  const paise = parseRupees(input);
  if (paise === null) problem(context, path, 'invalid');
  else if (paise < 1) problem(context, path, 'too_small');
  else if (paise > max) problem(context, path, 'too_big');
}

/** The same checks as the server's, so a mistake shows before anything is sent. */
export const personFormSchema = ({ password }: { password: boolean }) =>
  z
    .strictObject({
      canLogin: z.boolean(),
      name: text(100),
      username: z.string(),
      password: z.string(),
      homeBranchId: uuid(),
      phone: z.string(),
      joiningDate: z.string(),
      weeklyOffDay: z.string(),
      paidLeavesPerMonth: z.string(),
      overtimeRatePaise: z.string(),
      salaryKind: z.enum(SALARY_KINDS),
      salaryAmount: z.string(),
    })
    .superRefine((form, context) => {
      if (form.canLogin) {
        const name = username().safeParse(form.username);
        if (!name.success) problem(context, 'username', name.error.issues[0]?.message ?? 'invalid');
        if (password) {
          const secret = newPassword().safeParse(form.password);
          if (!secret.success) {
            problem(context, 'password', secret.error.issues[0]?.message ?? 'invalid');
          }
        }
      }
      if (form.phone.trim() !== '' && normalizePhone(form.phone) === null) {
        problem(context, 'phone', 'invalid');
      }
      if (form.joiningDate === '') problem(context, 'joiningDate', 'required');
      else if (!isCalendarDate(form.joiningDate)) problem(context, 'joiningDate', 'invalid');
      if (!/^[0-6]?$/.test(form.weeklyOffDay)) problem(context, 'weeklyOffDay', 'invalid');
      if (form.paidLeavesPerMonth.trim() === '') problem(context, 'paidLeavesPerMonth', 'required');
      else if (!/^\d+$/.test(form.paidLeavesPerMonth.trim())) {
        problem(context, 'paidLeavesPerMonth', 'invalid');
      } else if (Number(form.paidLeavesPerMonth) > 31) {
        problem(context, 'paidLeavesPerMonth', 'too_big');
      }
      checkAmount(context, 'overtimeRatePaise', form.overtimeRatePaise, MAX_OVERTIME_RATE_PAISE);
      checkAmount(context, 'salaryAmount', form.salaryAmount, MAX_SALARY_PAISE);
    });

/** The record fields a request takes, from a form that passed `personFormSchema`. */
export function recordPayload(form: PersonForm) {
  return {
    phone: form.phone.trim() === '' ? null : normalizePhone(form.phone),
    joiningDate: form.joiningDate,
    weeklyOffDay: form.weeklyOffDay === '' ? null : Number(form.weeklyOffDay),
    paidLeavesPerMonth: Number(form.paidLeavesPerMonth),
    overtimeRatePaise:
      form.overtimeRatePaise.trim() === '' ? null : parseRupees(form.overtimeRatePaise),
  };
}

/** A first salary, or null while no amount was typed ("Salary not set"). */
export function salaryPayload(form: PersonForm): SalaryInput | null {
  const amountPaise = form.salaryAmount.trim() === '' ? null : parseRupees(form.salaryAmount);
  return amountPaise === null ? null : { kind: form.salaryKind, amountPaise };
}

/** A new person's form: this counter's branch, joining today, no weekly off. */
export const emptyPersonForm = (homeBranchId: string, today: string): PersonForm => ({
  canLogin: true,
  name: '',
  username: '',
  password: '',
  homeBranchId,
  phone: '',
  joiningDate: today,
  weeklyOffDay: '',
  paidLeavesPerMonth: '0',
  overtimeRatePaise: '',
  salaryKind: 'monthly',
  salaryAmount: '',
});

const rupeeBox = (paise: Paise | null) =>
  paise === null
    ? ''
    : formatPaise(paise).replace(/^₹/, '').replaceAll(',', '').replace(/\.00$/, '');

/** An existing person's form. */
export const personFormOf = (person: StaffView): PersonForm => ({
  canLogin: person.username !== null,
  name: person.name,
  username: person.username ?? '',
  password: '',
  homeBranchId: person.homeBranchId,
  phone: person.phone ?? '',
  joiningDate: person.joiningDate,
  weeklyOffDay: person.weeklyOffDay === null ? '' : String(person.weeklyOffDay),
  paidLeavesPerMonth: String(person.paidLeavesPerMonth),
  overtimeRatePaise: rupeeBox(person.overtimeRatePaise),
  salaryKind: 'monthly',
  salaryAmount: '',
});

/** ₹12,000, or ₹1,500.50 when there are paise. */
export const rupeesText = (paise: Paise): string => formatPaise(paise).replace(/\.00$/, '');

/** `count` months from this one, as `YYYY-MM`: where a salary change may start (`05` #30). */
export function monthOptions(today: string, count: number): string[] {
  const [year = 0, month = 1] = today.split('-').map(Number);
  return Array.from({ length: count }, (_, index) => {
    const at = new Date(Date.UTC(year, month - 1 + index, 1));
    return `${String(at.getUTCFullYear())}-${String(at.getUTCMonth() + 1).padStart(2, '0')}`;
  });
}
