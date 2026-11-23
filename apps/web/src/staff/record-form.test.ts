// The staff form's checks and what it sends (P2.3 design §6; Module 05 #1, #30, #33).
import { describe, expect, test } from 'vitest';
import {
  monthOptions,
  personFormSchema,
  recordPayload,
  rupeesText,
  salaryPayload,
  type PersonForm,
} from './record-form';

const FORM: PersonForm = {
  canLogin: false,
  name: 'Meena Devi',
  username: '',
  password: '',
  homeBranchId: '00000000-0000-4000-8000-000000000003',
  phone: '',
  joiningDate: '2026-11-01',
  weeklyOffDay: '',
  paidLeavesPerMonth: '0',
  overtimeRatePaise: '',
  salaryKind: 'monthly',
  salaryAmount: '',
};

const problems = (form: PersonForm, password = true) => {
  const result = personFormSchema({ password }).safeParse(form);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join('.'), issue.message]));
};

describe('the person form', () => {
  test('a record without a login needs only a name, a branch and a joining date (#33)', () => {
    expect(problems(FORM)).toEqual({});
  });

  test('a login needs a username and a password; a record does not', () => {
    expect(problems({ ...FORM, canLogin: true })).toEqual({
      username: 'required',
      password: 'required',
    });
    expect(
      problems({ ...FORM, canLogin: true, username: 'meena', password: 'a brand new password' }),
    ).toEqual({});
    // Editing has no password box, so none is asked for.
    expect(problems({ ...FORM, canLogin: true, username: 'meena' }, false)).toEqual({});
  });

  test('a phone number is 10 digits or left empty', () => {
    expect(problems({ ...FORM, phone: '98765' })).toEqual({ phone: 'invalid' });
    expect(problems({ ...FORM, phone: '98765 43210' })).toEqual({});
  });

  test('the joining date must be a real date', () => {
    expect(problems({ ...FORM, joiningDate: '' })).toEqual({ joiningDate: 'required' });
    expect(problems({ ...FORM, joiningDate: '2026-02-30' })).toEqual({ joiningDate: 'invalid' });
  });

  test('paid leaves are a whole number from 0 to 31', () => {
    expect(problems({ ...FORM, paidLeavesPerMonth: '32' })).toEqual({
      paidLeavesPerMonth: 'too_big',
    });
    expect(problems({ ...FORM, paidLeavesPerMonth: '1.5' })).toEqual({
      paidLeavesPerMonth: 'invalid',
    });
    expect(problems({ ...FORM, paidLeavesPerMonth: '31' })).toEqual({});
  });

  test('the overtime rate is empty (off) or an amount above zero', () => {
    expect(problems({ ...FORM, overtimeRatePaise: 'lots' })).toEqual({
      overtimeRatePaise: 'invalid',
    });
    expect(problems({ ...FORM, overtimeRatePaise: '0' })).toEqual({
      overtimeRatePaise: 'too_small',
    });
    expect(problems({ ...FORM, overtimeRatePaise: '80' })).toEqual({});
  });

  test('a first salary is empty or an amount above zero', () => {
    expect(problems({ ...FORM, salaryAmount: '0' })).toEqual({ salaryAmount: 'too_small' });
    expect(problems({ ...FORM, salaryAmount: '12k' })).toEqual({ salaryAmount: 'invalid' });
    expect(problems({ ...FORM, salaryAmount: '12000' })).toEqual({});
  });
});

describe('what the form sends', () => {
  test('empty boxes mean none: no weekly off, no phone, no overtime', () => {
    expect(recordPayload(FORM)).toEqual({
      phone: null,
      joiningDate: '2026-11-01',
      weeklyOffDay: null,
      paidLeavesPerMonth: 0,
      overtimeRatePaise: null,
    });
  });

  test('rupees become whole paise and the weekday a number', () => {
    expect(
      recordPayload({
        ...FORM,
        phone: '98765 43210',
        weeklyOffDay: '0',
        paidLeavesPerMonth: '2',
        overtimeRatePaise: '80.50',
      }),
    ).toEqual({
      phone: '9876543210',
      joiningDate: '2026-11-01',
      weeklyOffDay: 0,
      paidLeavesPerMonth: 2,
      overtimeRatePaise: 8050,
    });
  });

  test('a salary is sent only when an amount was typed', () => {
    expect(salaryPayload(FORM)).toBeNull();
    expect(salaryPayload({ ...FORM, salaryKind: 'daily', salaryAmount: '500' })).toEqual({
      kind: 'daily',
      amountPaise: 50_000,
    });
  });
});

describe('what a salary looks like', () => {
  test('whole rupees drop the paise', () => {
    expect(rupeesText(1_200_000)).toBe('₹12,000');
    expect(rupeesText(150_050)).toBe('₹1,500.50');
  });

  test('a salary change can start this month or a later one, never earlier (#30)', () => {
    expect(monthOptions('2026-11-19', 3)).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});
