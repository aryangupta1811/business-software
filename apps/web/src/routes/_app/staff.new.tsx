import { zodResolver } from '@hookform/resolvers/zod';
import { businessDate } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { liveBranches, useBranches } from '../../api/branches';
import { ApiError } from '../../api/client';
import { useSession } from '../../api/session';
import { createStaff, STAFF_KEY } from '../../api/staff';
import { OwnerPasswordDialog } from '../../components/owner-password-dialog';
import { Button } from '../../components/ui/button';
import { AccessCard } from '../../staff/access-card';
import { defaultAccess, limitOf } from '../../staff/access';
import { failureText, showFieldErrors } from '../../staff/errors';
import { LoadGate } from '../../staff/load-gate';
import { PersonFields } from '../../staff/person-fields';
import {
  emptyPersonForm,
  personFormSchema,
  recordPayload,
  salaryPayload,
  type PersonForm,
} from '../../staff/record-form';
import { AccountCard } from '../../settings/account-card';

/**
 * Add a staff member (P1.5 design §6, P2.3 design §6; Module 00 #15, #19, #28, #43; Module 05
 * #1, #33): a person, with or without a login, then what a login may do.
 */
export const Route = createFileRoute('/_app/staff/new')({
  component: NewStaff,
  staticData: { titleKey: 'staff.newTitle', permission: 'staff.manage' },
});

const schema = personFormSchema({ password: true });
const FORM_FIELDS = [
  'name',
  'username',
  'password',
  'homeBranchId',
  'phone',
  'joiningDate',
  'weeklyOffDay',
  'paidLeavesPerMonth',
  'overtimeRatePaise',
] as const;

function NewStaff() {
  const branches = useBranches();
  return (
    <LoadGate queries={[branches]}>
      {() => branches.data && <NewStaffForm branches={liveBranches(branches.data)} />}
    </LoadGate>
  );
}

function NewStaffForm({ branches }: { branches: readonly { id: string; name: string }[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useSession().data;
  const here = session?.state === 'none' ? undefined : session?.branch.id;
  const {
    register,
    handleSubmit,
    setError,
    getValues,
    control,
    formState: { errors },
  } = useForm<PersonForm>({
    resolver: zodResolver(schema),
    // The branch this counter is in, or the only one there is.
    defaultValues: emptyPersonForm(
      branches.find((branch) => branch.id === here)?.id ?? branches[0]?.id ?? '',
      businessDate(new Date()),
    ),
  });
  const canLogin = useWatch({ control, name: 'canLogin' });
  const [access, setAccess] = useState(defaultAccess);
  const [limitInvalid, setLimitInvalid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  /** What every new person has, with a login or without (`05` #1, #33). */
  const record = () => {
    const person = getValues();
    const salary = salaryPayload(person);
    return {
      name: person.name,
      homeBranchId: person.homeBranchId,
      ...recordPayload(person),
      ...(salary !== null && { salary }),
    };
  };

  /** What the owner can fix on the form shows under its field; a few others are a banner. */
  const refused = (error: unknown): boolean => {
    if (showFieldErrors(error, setError, FORM_FIELDS)) return true;
    if (error instanceof ApiError && ['invalid_permissions', 'not_found'].includes(error.code)) {
      setBanner(failureText(t, error));
      return true;
    }
    return false;
  };

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: STAFF_KEY });
    await navigate({ to: '/staff' });
  };

  // A record only gives no one access, so it needs no owner's password; a login asks for it.
  const review = handleSubmit(async () => {
    setBanner(null);
    if (!canLogin) {
      try {
        await createStaff(record());
      } catch (error) {
        if (!refused(error)) setBanner(failureText(t, error));
        return;
      }
      await finish();
      return;
    }
    if (limitOf(access) === 'invalid') return;
    setConfirming(true);
  });

  const create = async (ownerPassword: string) => {
    const person = getValues();
    const limit = limitOf(access);
    try {
      await createStaff({
        ...record(),
        ownerPassword,
        username: person.username,
        password: person.password,
        permissions: access.permissions,
        discountLimitBasisPoints: limit === 'invalid' ? null : limit,
      });
    } catch (error) {
      // What the owner can fix on the form closes the dialog and shows under its field; a
      // wrong owner's password is thrown on, so the dialog shows it and stays open.
      if (refused(error)) {
        setConfirming(false);
        return;
      }
      throw error;
    }
    await finish();
  };

  return (
    <>
      <form
        noValidate
        className="flex max-w-4xl flex-col gap-6"
        onSubmit={(event) => {
          setLimitInvalid(canLogin && limitOf(access) === 'invalid');
          void review(event);
        }}
      >
        <Link
          to="/staff"
          className="inline-flex items-center gap-1.5 self-start text-muted hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t('staff.back')}
        </Link>
        <AccountCard title={t('staff.person.title')} lead={t('staff.person.lead')}>
          <PersonFields
            register={register}
            errors={errors}
            branches={branches}
            withUsername={canLogin}
            withPassword={canLogin}
            withSalary
            loginSwitch
          />
        </AccountCard>
        {canLogin && (
          <AccessCard
            value={access}
            limitInvalid={limitInvalid}
            onChange={(next) => {
              setAccess(next);
              setLimitInvalid(false);
            }}
          />
        )}
        {banner !== null && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
            {banner}
          </p>
        )}
        <div className="flex items-center gap-4">
          <Button type="submit">
            {t(canLogin ? 'staff.new.submit' : 'staff.new.submitRecord')}
          </Button>
          <Link to="/staff" className="text-muted hover:text-foreground">
            {t('dialog.cancel')}
          </Link>
        </div>
      </form>
      <OwnerPasswordDialog
        open={confirming}
        title={t('staff.new.confirmTitle')}
        confirm={t('staff.new.confirm')}
        onSubmit={create}
        onClose={() => {
          setConfirming(false);
        }}
      >
        <p className="text-muted">{t('staff.new.confirmBody')}</p>
      </OwnerPasswordDialog>
    </>
  );
}
