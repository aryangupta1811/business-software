// The recovery key between the signup answer and the key screen (Module 00 #31). Only in this
// page load's memory: never in the URL, localStorage or sessionStorage, so a reload or a later
// visitor at the shared counter can't bring it back.

interface PendingKey {
  businessName: string;
  recoveryKey: string;
  createdAt: Date;
}

let pending: PendingKey | null = null;

export function holdRecoveryKey(key: Omit<PendingKey, 'createdAt'>): void {
  pending = { ...key, createdAt: new Date() };
}

/** Read, not taken: React may render the key screen twice in development. */
export function readRecoveryKey(): PendingKey | null {
  return pending;
}

export function forgetRecoveryKey(): void {
  pending = null;
}
