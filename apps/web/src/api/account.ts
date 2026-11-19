// Account recovery, your own password and remembered computers (Module 00 #30-#32, #44, #46).
import type {
  ChangePasswordInput,
  DeviceView,
  RecoveryKeyResult,
  RecoveryResetInput,
  ResetCompleteInput,
} from '@business-software/shared';
import { apiRequest } from './client';

export const DEVICES_KEY = ['devices'];

/** #30: always accepted, whether or not the email has an account. */
export function requestReset(email: string) {
  return apiRequest<null>('POST', '/api/password-reset/request', { email });
}

export function completeReset(input: ResetCompleteInput) {
  return apiRequest<null>('POST', '/api/password-reset/complete', input);
}

/** #31: answers the next recovery key, shown once. */
export function resetWithRecoveryKey(input: RecoveryResetInput) {
  return apiRequest<RecoveryKeyResult>('POST', '/api/recovery/reset', input);
}

export function confirmEmail(businessId: string, token: string) {
  return apiRequest<null>('POST', '/api/email/confirm', { businessId, token });
}

/** #32's "Send again". */
export function sendConfirmation() {
  return apiRequest<null>('POST', '/api/email/confirm/send');
}

export function newRecoveryKey(ownerPassword: string) {
  return apiRequest<RecoveryKeyResult>('POST', '/api/recovery-key', { ownerPassword });
}

export function changePassword(input: ChangePasswordInput) {
  return apiRequest<null>('POST', '/api/password', input);
}

export function listDevices() {
  return apiRequest<DeviceView[]>('GET', '/api/devices');
}

export function renameDevice(id: string, name: string) {
  return apiRequest<DeviceView>('PUT', `/api/devices/${id}/name`, { name });
}

export function forgetDevice(id: string, ownerPassword: string) {
  return apiRequest<null>('POST', `/api/devices/${id}/forget`, { ownerPassword });
}
