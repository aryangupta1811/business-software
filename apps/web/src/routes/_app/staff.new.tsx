import { zodResolver } from '@hookform/resolvers/zod';
import { newStaffSchema } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { PersonFields, type PersonForm } from '../../staff/person-fields';
import { AccountCard } from '../../settings/account-card';

/** Add a staff login (P1.5 design §6, Module 00 #15, #28, #43): a person, then what they may do. */
export const Route = createFileRoute('/_app/staff/new')({
  component: NewStaff,
  staticData: { titleKey: 'staff.newTitle', permission: 'staff.manage' },
});

const personSchema = newStaffSchema.pick({
  name: true,
  username: true,
  password: true,
  homeBranchId: true,
});

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
    formState: { errors },
  } = useForm<PersonForm>({
    resolver: zodResolver(personSchema),
    defaultValues: {
      name: '',
      username: '',
      password: '',
      // The branch this counter is in, or the only one there is.
      homeBranchId: branches.find((branch) => branch.id === here)?.id ?? branches[0]?.id ?? '',
    },
  });
  const [access, setAccess] = useState(defaultAccess);
  const [limitInvalid, setLimitInvalid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  // Check the person's fields and the limit, then ask for the owner's password.
  const review = handleSubmit(() => {
    if (limitOf(access) === 'invalid') return;
    setBanner(null);
    setConfirming(true);
  });

  const create = async (ownerPassword: string) => {
    const person = getValues();
    const limit = limitOf(access);
    try {
      await createStaff({
        ownerPassword,
        name: person.name,
        username: person.username,
        password: person.password,
        homeBranchId: person.homeBranchId,
        permissions: access.permissions,
        discountLimitBasisPoints: limit === 'invalid' ? null : limit,
      });
    } catch (error) {
      // What the owner can fix on the form closes the dialog and shows under its field; a
      // wrong owner's password is thrown on, so the dialog shows it and stays open.
      if (showFieldErrors(error, setError, ['name', 'username', 'password', 'homeBranchId'])) {
        setConfirming(false);
        return;
      }
      if (error instanceof ApiError && ['invalid_permissions', 'not_found'].includes(error.code)) {
        setBanner(failureText(t, error));
        setConfirming(false);
        return;
      }
      throw error;
    }
    await queryClient.invalidateQueries({ queryKey: STAFF_KEY });
    await navigate({ to: '/staff' });
  };

  return (
    <>
      <form
        noValidate
        className="flex max-w-4xl flex-col gap-6"
        onSubmit={(event) => {
          setLimitInvalid(limitOf(access) === 'invalid');
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
          <PersonFields register={register} errors={errors} branches={branches} withPassword />
        </AccountCard>
        <AccessCard
          value={access}
          limitInvalid={limitInvalid}
          onChange={(next) => {
            setAccess(next);
            setLimitInvalid(false);
          }}
        />
        {banner !== null && (
          <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
            {banner}
          </p>
        )}
        <div className="flex items-center gap-4">
          <Button type="submit">{t('staff.new.submit')}</Button>
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
