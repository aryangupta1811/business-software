import { describe, expect, it } from 'vitest';
import { INDIAN_STATES, isStateCode, stateByCode } from './states.js';

describe('INDIAN_STATES', () => {
  it('lists the 28 states, the 8 Union Territories and Other Territory', () => {
    expect(INDIAN_STATES).toHaveLength(37);
  });

  it('is sorted by code, with each code and name used once', () => {
    const codes = INDIAN_STATES.map((state) => state.code);
    expect(codes).toEqual([...codes].sort());
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(INDIAN_STATES.map((state) => state.name)).size).toBe(codes.length);
  });

  it.each([
    ['01', 'Jammu and Kashmir'],
    ['07', 'Delhi'],
    ['09', 'Uttar Pradesh'],
    ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
    ['27', 'Maharashtra'],
    ['29', 'Karnataka'],
    ['36', 'Telangana'],
    ['37', 'Andhra Pradesh'],
    ['38', 'Ladakh'],
    ['97', 'Other Territory'],
  ])('code %s is %s', (code, name) => {
    expect(INDIAN_STATES.find((state) => state.code === code)?.name).toBe(name);
  });

  it('marks exactly the Union Territories without a legislature as UTGST', () => {
    const utgst = INDIAN_STATES.filter((state) => state.utgst).map((state) => state.code);
    // Chandigarh, DNH and DD, Lakshadweep, Andaman and Nicobar, Ladakh, Other Territory
    expect(utgst).toEqual(['04', '26', '31', '35', '38', '97']);
  });
});

describe('isStateCode', () => {
  it.each(['01', '07', '24', '26', '38', '97'])('accepts %s', (code) => {
    expect(isStateCode(code)).toBe(true);
  });

  it.each([
    '00',
    '25', // Daman and Diu, merged into 26 in 2020
    '28', // Andhra Pradesh before 2014, now 37
    '39',
    '96', // Foreign Country: exports aren't in v1
    '99', // Centre Jurisdiction, not a place
    '9',
    '099',
    ' 09',
    '',
    'UP',
  ])('refuses %j', (code) => {
    expect(isStateCode(code)).toBe(false);
  });
});

describe('stateByCode', () => {
  it('finds a state by its code', () => {
    expect(stateByCode('04')).toEqual({ code: '04', name: 'Chandigarh', utgst: true });
  });

  it('gives undefined for an unknown code', () => {
    expect(stateByCode('25')).toBeUndefined();
  });
});
