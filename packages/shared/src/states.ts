/**
 * Indian states and Union Territories with their two-digit GST state codes, the first two
 * digits of every GSTIN. Used for the business's state at signup (Module 00 #7), branch states,
 * place of supply (Module 02 #3) and the GSTIN check (Module 02 #2).
 *
 * Left out on purpose: 25 (Daman and Diu, merged into 26 in 2020), 28 (Andhra Pradesh before
 * 2014, now 37), 96 (Foreign Country: exports aren't in v1) and 99 (Centre Jurisdiction, not
 * a place). Names are in English; the web app translates them by code.
 */
export interface IndianState {
  readonly code: string;
  readonly name: string;
  /**
   * True for the Union Territories without a legislature, where the state half of GST is
   * UTGST instead of SGST (UTGST Act s. 7). Delhi, Puducherry and Jammu and Kashmir have
   * legislatures, so they charge SGST.
   */
  readonly utgst: boolean;
}

// `as const`: TypeScript keeps each exact code ('01', '27'…), so StateCode is the list of
// real codes and the web app's translation keys (`states.27`) are checked.
export const INDIAN_STATES = [
  { code: '01', name: 'Jammu and Kashmir', utgst: false },
  { code: '02', name: 'Himachal Pradesh', utgst: false },
  { code: '03', name: 'Punjab', utgst: false },
  { code: '04', name: 'Chandigarh', utgst: true },
  { code: '05', name: 'Uttarakhand', utgst: false },
  { code: '06', name: 'Haryana', utgst: false },
  { code: '07', name: 'Delhi', utgst: false },
  { code: '08', name: 'Rajasthan', utgst: false },
  { code: '09', name: 'Uttar Pradesh', utgst: false },
  { code: '10', name: 'Bihar', utgst: false },
  { code: '11', name: 'Sikkim', utgst: false },
  { code: '12', name: 'Arunachal Pradesh', utgst: false },
  { code: '13', name: 'Nagaland', utgst: false },
  { code: '14', name: 'Manipur', utgst: false },
  { code: '15', name: 'Mizoram', utgst: false },
  { code: '16', name: 'Tripura', utgst: false },
  { code: '17', name: 'Meghalaya', utgst: false },
  { code: '18', name: 'Assam', utgst: false },
  { code: '19', name: 'West Bengal', utgst: false },
  { code: '20', name: 'Jharkhand', utgst: false },
  { code: '21', name: 'Odisha', utgst: false },
  { code: '22', name: 'Chhattisgarh', utgst: false },
  { code: '23', name: 'Madhya Pradesh', utgst: false },
  { code: '24', name: 'Gujarat', utgst: false },
  { code: '26', name: 'Dadra and Nagar Haveli and Daman and Diu', utgst: true },
  { code: '27', name: 'Maharashtra', utgst: false },
  { code: '29', name: 'Karnataka', utgst: false },
  { code: '30', name: 'Goa', utgst: false },
  { code: '31', name: 'Lakshadweep', utgst: true },
  { code: '32', name: 'Kerala', utgst: false },
  { code: '33', name: 'Tamil Nadu', utgst: false },
  { code: '34', name: 'Puducherry', utgst: false },
  { code: '35', name: 'Andaman and Nicobar Islands', utgst: true },
  { code: '36', name: 'Telangana', utgst: false },
  { code: '37', name: 'Andhra Pradesh', utgst: false },
  { code: '38', name: 'Ladakh', utgst: true },
  { code: '97', name: 'Other Territory', utgst: true },
] as const satisfies readonly IndianState[];

/** One of the GST state codes in `INDIAN_STATES`. */
export type StateCode = (typeof INDIAN_STATES)[number]['code'];

const BY_CODE: ReadonlyMap<string, IndianState> = new Map(
  INDIAN_STATES.map((state) => [state.code, state]),
);

/** True when `code` is one of the GST state codes in `INDIAN_STATES`. */
export function isStateCode(code: string): code is StateCode {
  return BY_CODE.has(code);
}

/** The state or UT with this GST code, or undefined. */
export function stateByCode(code: string): IndianState | undefined {
  return BY_CODE.get(code);
}
