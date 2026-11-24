import { zodResolver } from '@hookform/resolvers/zod';
import type { StaffView } from '@business-software/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { liveBranches, useBranches } from '../../api/branches';
import { ApiError } from '../../api/client';
import { setStaffPermissions, STAFF_KEY, updateStaff, useStaffList } from '../../api/staff';
import { OwnerPasswordDialog } from '../../components/owner-password-dialog';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { AccountCard } from '../../settings/account-card';
import { accessOf, limitOf, sameAccess } from '../../staff/access';
import { AccessCard } from '../../staff/access-card';
import { BranchAccessCard } from '../../staff/branch-access-card';
import { StaffDialogs } from '../../staff/dialogs';
import { useStaffDialogs } from '../../staff/use-staff-dialogs';
import { failureText, showFieldErrors } from '../../staff/errors';
import { LoadGate } from '../../staff/load-gate';
import { LoginCard } from '../../staff/login-card';
import { PersonFields } from '../../staff/person-fields';
import {
  personFormOf,
  personFormSchema,
  recordPayload,
  type PersonForm,
} from '../../staff/record-form';
import { SalaryCard } from '../../staff/salary-card';

/** One staff login (P1.5 design §6): the person, and what they may do. */
export const Route = createFileRoute('/_app/staff/$id')({
  component: EditStaff,
  staticData: { titleKey: 'staff.editTitle', permission: 'staff.manage' },
});

// The same checks as the server's, with no password box (it is only for adding), so one form
// type serves both pages.
const personSchema = personFormSchema({ password: false });

function EditStaff() {
  const { id } = Route.useParams();
  // Everyone, former staff included: the page opens a deactivated login too.
  const list = useStaffList(true);
  const branches = useBranches();
  return (
    <LoadGate queries={[list, branches]}>
      {() => {
        const person = list.data?.find((row) => row.id === id);
        if (person === undefined) return <NotFound />;
        return (
          <StaffEditor
            key={person.id}
            person={person}
            branches={liveBranches(branches.data ?? [])}
          />
        );
      }}
    </LoadGate>
  );
}

function NotFound() {
  const { t } = useTranslation();
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t('staff.notFound.title')}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3 text-muted">
        <p>{t('staff.notFound.body')}</p>
        <Link to="/staff" className="text-accent underline-offset-4 hover:underline">
          {t('staff.back')}
        </Link>
      </CardContent>
    </Card>
  );
}

function StaffEditor({
  person,
  branches,
}: {
  person: StaffView;
  branches: readonly { id: string; name: string }[];
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const dialogs = useStaffDialogs();
  const { ask, notice } = dialogs;
  const hasLogin = person.username !== null;
  const [banner, setBanner] = useState<string | null>(null);

  // The Person card.
  const {
    register,
    handleSubmit,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<PersonForm>({
    resolver: zodResolver(personSchema),
    defaultValues: personFormOf(person),
  });
  const [personSaved, setPersonSaved] = useState(false);
  const savePerson = handleSubmit(async (values) => {
    setBanner(null);
    setPersonSaved(false);
    try {
      const view = await updateStaff(person.id, {
        name: values.name,
        // A person without a login has no username to change.
        ...(hasLogin && { username: values.username }),
        homeBranchId: values.homeBranchId,
        ...recordPayload(values),
        version: person.version,
      });
      reset(personFormOf(view));
      setPersonSaved(true);
      void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
    } catch (error) {
      if (
        !showFieldErrors(error, setError, [
          'name',
          'username',
          'homeBranchId',
          'phone',
          'joiningDate',
          'weeklyOffDay',
          'paidLeavesPerMonth',
          'overtimeRatePaise',
        ])
      ) {
        setBanner(failureText(t, error));
      }
    }
  });

  // The Access card: its own save, which asks for the owner's password (#17).
  const [saved, setSaved] = useState(() => accessOf(person));
  const [access, setAccess] = useState(saved);
  const [limitInvalid, setLimitInvalid] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [accessSaved, setAccessSaved] = useState(false);
  const changed = !sameAccess(access, saved);

  const reviewAccess = () => {
    if (limitOf(access) === 'invalid') {
      setLimitInvalid(true);
      return;
    }
    setBanner(null);
    setAccessSaved(false);
    setConfirming(true);
  };

  const saveAccess = async (ownerPassword: string) => {
    const limit = limitOf(access);
    try {
      const view = await setStaffPermissions(person.id, {
        ownerPassword,
        permissions: access.permissions,
        discountLimitBasisPoints: limit === 'invalid' ? null : limit,
      });
      const next = accessOf(view);
      setSaved(next);
      setAccess(next);
      setAccessSaved(true);
    } catch (error) {
      if (error instanceof ApiError && ['invalid_permissions', 'not_found'].includes(error.code)) {
        setBanner(failureText(t, error));
        setConfirming(false);
        return;
      }
      // A wrong owner's password stays in the dialog.
      throw error;
    }
    setConfirming(false);
    void queryClient.invalidateQueries({ queryKey: STAFF_KEY });
  };

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <Link
        to="/staff"
        className="inline-flex items-center gap-1.5 self-start text-muted hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('staff.back')}
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-3">
            <h2 className="text-title font-semibold">{person.name}</h2>
            <Badge tone={person.active ? 'success' : 'warning'}>
              {t(person.active ? 'staff.status.active' : 'staff.status.inactive')}
            </Badge>
          </div>
          {hasLogin ? (
            <p className="font-mono text-label text-muted">{person.username}</p>
          ) : (
            <p>
              <Badge>{t('staff.noLogin')}</Badge>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {hasLogin && (
            <Button
              variant="secondary"
              onClick={() => {
                ask('reset', person);
              }}
            >
              {t('staff.actions.reset')}
            </Button>
          )}
          {person.active ? (
            <Button
              variant="secondary"
              onClick={() => {
                ask('deactivate', person);
              }}
            >
              {t('staff.actions.deactivate')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              onClick={() => {
                ask('reactivate', person);
              }}
            >
              {t('staff.actions.reactivate')}
            </Button>
          )}
        </div>
      </header>

      {notice !== null && (
        <p role="status" className="rounded-lg bg-success-soft px-4 py-3 text-success">
          {notice}
        </p>
      )}
      {banner !== null && (
        <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-danger">
          {banner}
        </p>
      )}

      <AccountCard title={t('staff.person.title')} lead={t('staff.person.lead')}>
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => void savePerson(event)}
        >
          <PersonFields
            register={register}
            errors={errors}
            branches={branches}
            withUsername={hasLogin}
            withPassword={false}
            withSalary={false}
            loginSwitch={false}
          />
          <div className="flex items-center gap-4 border-t border-border pt-5">
            <Button type="submit" disabled={isSubmitting}>
              {t(isSubmitting ? 'settings.saving' : 'settings.save')}
            </Button>
            {personSaved && (
              <p role="status" className="text-label text-success">
                {t('settings.saved')}
              </p>
            )}
          </div>
        </form>
      </AccountCard>

      <SalaryCard person={person} />

      {/* A person without a login can be given one; no second record is made (00 #19). */}
      {!hasLogin && person.active && (
        <LoginCard
          person={person}
          onGiven={(view) => {
            reset(personFormOf(view));
            dialogs.done(t('staff.login.done', { name: view.name, username: view.username ?? '' }));
          }}
        />
      )}

      {/* Only with two or more branches: with one there is nowhere else to work. */}
      {hasLogin && branches.length > 1 && <BranchAccessCard person={person} branches={branches} />}

      {hasLogin && (
        <AccessCard
          value={access}
          limitInvalid={limitInvalid}
          onChange={(next) => {
            setAccess(next);
            setLimitInvalid(false);
            setAccessSaved(false);
          }}
          footer={
            <div className="flex items-center gap-4 border-t border-border pt-5">
              <Button disabled={!changed} onClick={reviewAccess}>
                {t('staff.access.save')}
              </Button>
              {accessSaved && (
                <p role="status" className="text-label text-success">
                  {t('staff.access.saved')}
                </p>
              )}
            </div>
          }
        />
      )}

      <OwnerPasswordDialog
        open={confirming}
        title={t('staff.access.confirmTitle', { name: person.name })}
        confirm={t('staff.access.confirm')}
        onSubmit={saveAccess}
        onClose={() => {
          setConfirming(false);
        }}
      >
        <p className="text-muted">{t('staff.access.confirmBody')}</p>
      </OwnerPasswordDialog>
      <StaffDialogs host={dialogs} />
    </div>
  );
}
