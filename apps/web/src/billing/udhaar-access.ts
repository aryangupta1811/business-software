import type { OverCreditLimitSetting, Paise } from '@business-software/shared';
import type { Standing } from '../udhaar/standing';

/**
 * What the panel may offer of the customer's account (P1.18 design §5). `hidden`: this login
 * can't give udhaar. `needs_customer`: it can, but the bill has no customer with a phone yet.
 */
export interface UdhaarAccess {
  state: 'hidden' | 'needs_customer' | 'ready';
  customerName: string;
  /** The customer's advance: "From advance" shows only when this is above 0. */
  advancePaise: Paise;
  /** Their balance and limit, when the counter could read them (it needs `customers.view`). */
  standing: Standing | null;
  who: 'owner' | 'staff';
  setting: OverCreditLimitSetting;
}

/** No udhaar: the panel as it was. */
export const NO_UDHAAR: UdhaarAccess = {
  state: 'hidden',
  customerName: '',
  advancePaise: 0,
  standing: null,
  who: 'owner',
  setting: 'warn',
};
