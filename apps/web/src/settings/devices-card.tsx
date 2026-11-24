import { zodResolver } from '@hookform/resolvers/zod';
import {
  deviceNameSchema,
  ownerPasswordSchema,
  type BranchView,
  type DeviceNameInput,
  type DeviceView,
  type OwnerPasswordInput,
} from '@business-software/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { Monitor } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { DEVICES_KEY, forgetDevice, listDevices, renameDevice } from '../api/account';
import { DevicePrinting } from './device-printing';
import { BRANCHES_KEY, liveBranches, moveDevice, useBranches } from '../api/branches';
import { ApiError } from '../api/client';
import { forgetSession } from '../api/session';
import { OwnerPasswordDialog } from '../components/owner-password-dialog';
import { PasswordInput } from '../components/password-input';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Select } from '../components/ui/select';
import { useFieldError } from '../lib/field-error';
import { formText } from '../lib/form-data';
import { useRetryTime } from '../lib/retry-time';
import { AccountCard } from './account-card';
import { failureKey } from './failure-key';

/**
 * Module 00 #44: the computers that remember this business. Forgetting one needs the owner's
 * password; staff can't log in there again until the owner does.
 */
export function DevicesCard() {
  const { t } = useTranslation();
  const devices = useQuery({ queryKey: DEVICES_KEY, queryFn: listDevices, retry: false });
  // A computer can be moved only when there is another branch to move it to (P1.6).
  const branches = liveBranches(useBranches().data ?? []);

  return (
    <AccountCard title={t('account.devices.title')} lead={t('account.devices.lead')}>
      {devices.isPending ? (
        <p className="text-muted">{t('settings.loading')}</p>
      ) : devices.isError ? (
        <div role="alert" className="flex flex-col items-start gap-3">
          <p>{t('account.devices.loadFailed')}</p>
          <Button variant="secondary" onClick={() => void devices.refetch()}>
            {t('settings.retry')}
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {devices.data.map((device) => (
            <DeviceRow key={device.id} device={device} branches={branches} />
          ))}
        </ul>
      )}
    </AccountCard>
  );
}

type Mode = 'view' | 'rename' | 'forget';

function DeviceRow({ device, branches }: { device: DeviceView; branches: readonly BranchView[] }) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<Mode>('view');
  const [moving, setMoving] = useState(false);
  // The button that opened a form disappears while it is open, so focus would fall to the
  // page: each form takes focus when it opens, and closing it puts focus back on its button.
  const renameButton = useRef<HTMLButtonElement>(null);
  const forgetButton = useRef<HTMLButtonElement>(null);
  const reopen = useRef<Mode>('view');
  useEffect(() => {
    if (mode !== 'view') {
      reopen.current = mode;
      return;
    }
    if (reopen.current === 'rename') renameButton.current?.focus();
    if (reopen.current === 'forget') forgetButton.current?.focus();
    reopen.current = 'view';
  }, [mode]);
  const lastUsed = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(device.lastSeenAt));
  const name = device.name ?? t('account.devices.unnamed');
  const done = () => {
    setMode('view');
  };

  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-center gap-3">
        <Monitor aria-hidden="true" className="size-5 shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="flex items-center gap-2 font-medium">
            <span className="truncate">{name}</span>
            {device.thisComputer && <Badge tone="info">{t('account.devices.thisComputer')}</Badge>}
          </p>
          <p className="text-label text-muted">
            {t('account.devices.details', { branch: device.branchName, time: lastUsed })}
          </p>
        </div>
        {mode === 'view' && (
          <div className="flex gap-2">
            <Button
              ref={renameButton}
              size="sm"
              variant="ghost"
              aria-label={t('account.devices.renameNamed', { name })}
              onClick={() => {
                setMode('rename');
              }}
            >
              {t('account.devices.rename')}
            </Button>
            {branches.length > 1 && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={t('account.devices.moveNamed', { name })}
                onClick={() => {
                  setMoving(true);
                }}
              >
                {t('account.devices.move')}
              </Button>
            )}
            <Button
              ref={forgetButton}
              size="sm"
              variant="ghost"
              aria-label={t('account.devices.forgetNamed', { name })}
              onClick={() => {
                setMode('forget');
              }}
            >
              {t('account.devices.forget')}
            </Button>
          </div>
        )}
      </div>
      <DevicePrinting device={device} />
      <MoveDialog
        open={moving}
        device={device}
        branches={branches}
        onClose={() => {
          setMoving(false);
        }}
      />
      {mode === 'rename' && <RenameForm device={device} onDone={done} />}
      {mode === 'forget' && <ForgetForm device={device} onCancel={done} />}
    </li>
  );
}

/**
 * Moves a computer to another branch (P1.6 design §8, #56): it decides where bills and stock go,
 * so it asks for the owner's password, and everyone logged in on it is logged out.
 */
function MoveDialog({
  open,
  device,
  branches,
  onClose,
}: {
  open: boolean;
  device: DeviceView;
  branches: readonly BranchView[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const name = device.name ?? t('account.devices.unnamed');
  const targets = branches.filter((branch) => branch.id !== device.branchId);
  return (
    <OwnerPasswordDialog
      open={open}
      title={t('account.devices.moveTitle', { name })}
      confirm={t('account.devices.moveConfirm')}
      autoFocusOwner={false}
      onSubmit={async (ownerPassword, form) => {
        const moved = await moveDevice(device.id, formText(form, 'branchId'), ownerPassword);
        void queryClient.invalidateQueries({ queryKey: BRANCHES_KEY });
        if (device.thisComputer) {
          // The server ended this computer's sessions, ours too: back to the login page.
          forgetSession(queryClient);
          await navigate({ to: '/login' });
          return;
        }
        queryClient.setQueryData<DeviceView[]>(DEVICES_KEY, (list) =>
          list?.map((row) => (row.id === moved.id ? moved : row)),
        );
        onClose();
      }}
      onClose={onClose}
    >
      {(fieldErrors) => (
        <>
          <p className="text-muted">
            {t(device.thisComputer ? 'account.devices.moveBodyThis' : 'account.devices.moveBody')}
          </p>
          <Field
            label={t('account.devices.moveTarget')}
            error={errorText('branchId', fieldErrors.branchId)}
          >
            {(props) => (
              <Select {...props} name="branchId" defaultValue={targets[0]?.id}>
                {targets.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </>
      )}
    </OwnerPasswordDialog>
  );
}

function RenameForm({ device, onDone }: { device: DeviceView; onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<DeviceNameInput>({
    resolver: zodResolver(deviceNameSchema),
    defaultValues: { name: device.name ?? '' },
  });
  useEffect(() => {
    setFocus('name');
  }, [setFocus]);

  const onSubmit = async ({ name }: DeviceNameInput) => {
    setFailed(false);
    try {
      const saved = await renameDevice(device.id, name);
      queryClient.setQueryData<DeviceView[]>(DEVICES_KEY, (list) =>
        list?.map((row) => (row.id === saved.id ? saved : row)),
      );
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'invalid_body') {
        setError('name', { message: error.fields.name ?? 'invalid' });
      } else {
        setFailed(true);
      }
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-3 pl-8"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <div className="max-w-xs">
        <Field
          label={t('account.devices.name')}
          hint={t('account.devices.nameHint')}
          error={errorText('name', errors.name?.message)}
        >
          {(props) => <Input {...props} autoComplete="off" {...register('name')} />}
        </Field>
      </div>
      {failed && (
        <p role="alert" className="text-danger">
          {t('account.failed')}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={isSubmitting}>
          {t('account.devices.saveName')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t('account.cancel')}
        </Button>
      </div>
    </form>
  );
}

function ForgetForm({ device, onCancel }: { device: DeviceView; onCancel: () => void }) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const retryTime = useRetryTime();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [failure, setFailure] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<OwnerPasswordInput>({
    resolver: zodResolver(ownerPasswordSchema),
    defaultValues: { ownerPassword: '' },
  });
  useEffect(() => {
    setFocus('ownerPassword');
  }, [setFocus]);

  const onSubmit = async ({ ownerPassword }: OwnerPasswordInput) => {
    setFailure(null);
    try {
      await forgetDevice(device.id, ownerPassword);
      if (device.thisComputer) {
        // This computer's session and memory are gone: back to the login page.
        forgetSession(queryClient);
        await navigate({ to: '/login' });
        return;
      }
      queryClient.setQueryData<DeviceView[]>(DEVICES_KEY, (list) =>
        list?.filter((row) => row.id !== device.id),
      );
    } catch (error) {
      if (error instanceof ApiError && error.code === 'wrong_password') {
        setError('ownerPassword', { message: 'wrong' });
      } else {
        const code = error instanceof ApiError ? error.code : undefined;
        setFailure(
          t(failureKey(code), { time: error instanceof ApiError ? retryTime(error) : '' }),
        );
      }
    }
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-3 rounded-lg bg-danger-soft/40 py-3 pr-3 pl-8"
      onSubmit={(event) => void handleSubmit(onSubmit)(event)}
    >
      <p>{t(device.thisComputer ? 'account.devices.forgetThis' : 'account.devices.forgetOther')}</p>
      <div className="max-w-xs">
        <Field
          label={t('account.ownerPassword')}
          error={errorText('ownerPassword', errors.ownerPassword?.message)}
        >
          {(props) => (
            <PasswordInput
              {...props}
              autoComplete="current-password"
              {...register('ownerPassword')}
            />
          )}
        </Field>
      </div>
      {failure !== null && (
        <p role="alert" className="text-danger">
          {failure}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="danger" disabled={isSubmitting}>
          {t('account.devices.confirmForget')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          {t('account.cancel')}
        </Button>
      </div>
    </form>
  );
}
