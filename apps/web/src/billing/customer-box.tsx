import {
  customerSchema,
  fieldErrors,
  INDIAN_STATES,
  normalizePhone,
  stateByCode,
  type BillingContext,
  type CustomerView,
  type FieldErrors,
  type StateCode,
} from '@business-software/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { UserRound } from 'lucide-react';
import { useEffect, useId, useRef, useState, type SyntheticEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, apiRequest } from '../api/client';
import { Button } from '../components/ui/button';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Kbd } from '../components/ui/kbd';
import { Select } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { useFieldError } from '../lib/field-error';

/** The customer on the open bill: what the bill and the footer need, not the whole record. */
export interface BillCustomer {
  id: string;
  name: string;
  phone: string | null;
  gstin: string | null;
  stateCode: string | null;
}

const NAME_SEARCH_DELAY_MS = 250;
/** Digits with the usual separators: what a phone number looks like while it's typed. */
const PHONE_TEXT = /^[\d\s()+-]+$/;

type Lookup = { kind: 'phone'; value: string } | { kind: 'name'; value: string };

/** Ten digits (with or without +91) look up by phone; any other text of 2+ letters, by name. */
function lookupFor(text: string, phoneOnly: boolean): Lookup | null {
  const typed = text.trim();
  if (PHONE_TEXT.test(typed)) {
    const phone = normalizePhone(typed);
    if (phone !== null) return { kind: 'phone', value: phone };
  }
  if (phoneOnly || typed.length < 2) return null;
  return { kind: 'name', value: typed };
}

function toBillCustomer(view: CustomerView): BillCustomer {
  return {
    id: view.id,
    name: view.name,
    phone: view.phone,
    gstin: view.gstin,
    stateCode: view.stateCode,
  };
}

/**
 * Where a customer's bill is supplied by default (design §7, question 9 A): a business customer
 * from another state gets IGST, so their state; everyone else, the shop's own state.
 */
function defaultPlaceOfSupply(customer: BillCustomer, branchStateCode: string): string {
  return customer.gstin !== null && customer.stateCode !== null
    ? customer.stateCode
    : branchStateCode;
}

/** The state's name in the chosen language. */
function useStateName(): (code: string) => string {
  const { t } = useTranslation();
  return (code) => (stateByCode(code) ? t(`states.${code as StateCode}`) : code);
}

/** "CGST + SGST", or "IGST, supplied to Karnataka" when the place of supply isn't the shop's. */
function useTaxText(): (placeOfSupplyStateCode: string, branchStateCode: string) => string {
  const { t } = useTranslation();
  const stateName = useStateName();
  return (place, branch) =>
    place === branch
      ? t('billing.customer.tax.cgstSgst')
      : t('billing.customer.tax.igst', { state: stateName(place) });
}

/** One line for the page's footer: "Customer (F3): walk-in" or the name and phone, and the tax type. */
export function CustomerSummary({
  customer,
  placeOfSupplyStateCode,
  branchStateCode,
  onOpen,
}: {
  customer: BillCustomer | null;
  placeOfSupplyStateCode: string;
  branchStateCode: string;
  /** Makes the line a button that opens the box, for the mouse. */
  onOpen?: () => void;
}) {
  const { t } = useTranslation();
  const taxText = useTaxText();
  const content = (
    <>
      <span className="text-muted">{t('billing.customer.label')}</span>
      <Kbd aria-hidden="true">F3</Kbd>
      {customer === null ? (
        <span className="font-medium">{t('billing.customer.walkIn')}</span>
      ) : (
        <>
          <span className="font-medium">{customer.name}</span>
          {customer.phone !== null && (
            <span className="tabular-nums text-muted">{customer.phone}</span>
          )}
        </>
      )}
      <span className="rounded-md bg-surface-muted px-2 py-0.5 text-label text-muted">
        {taxText(placeOfSupplyStateCode, branchStateCode)}
      </span>
    </>
  );
  const className = 'flex flex-wrap items-center gap-x-2.5 gap-y-1';
  return onOpen === undefined ? (
    <div className={className}>{content}</div>
  ) : (
    <button
      type="button"
      onClick={onOpen}
      aria-keyshortcuts="F3"
      className={`${className} rounded-lg text-left hover:bg-surface-muted`}
    >
      {content}
    </button>
  );
}

/**
 * The customer box (P1.13 design §7): find a customer by phone or name, add one, and settle the
 * place of supply (CGST + SGST or IGST). A native `<dialog>` (ADR 0026); Esc closes it without
 * changing the bill. The page opens it with F3.
 */
export function CustomerBox({
  open,
  context,
  customer,
  placeOfSupplyStateCode,
  onClose,
  onChange,
}: {
  open: boolean;
  context: BillingContext;
  /** Null: a walk-in bill. */
  customer: BillCustomer | null;
  placeOfSupplyStateCode: string;
  onClose: () => void;
  onChange: (customer: BillCustomer | null, placeOfSupplyStateCode: string) => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      element.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      className="m-auto w-full max-w-xl overflow-hidden rounded-lg bg-surface p-0 text-foreground shadow-card"
    >
      {open && (
        <div className="flex flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
            <h2 id={titleId} className="flex items-center gap-2 text-section font-semibold">
              <UserRound aria-hidden="true" className="size-5 text-muted" />
              {t('billing.customer.title')}
            </h2>
            <Kbd aria-hidden="true">Esc</Kbd>
          </header>
          <Body
            context={context}
            customer={customer}
            placeOfSupplyStateCode={placeOfSupplyStateCode}
            onClose={onClose}
            onChange={onChange}
          />
        </div>
      )}
    </dialog>
  );
}

function Body({
  context,
  customer,
  placeOfSupplyStateCode,
  onClose,
  onChange,
}: {
  context: BillingContext;
  customer: BillCustomer | null;
  placeOfSupplyStateCode: string;
  onClose: () => void;
  onChange: (customer: BillCustomer | null, placeOfSupplyStateCode: string) => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState<string | null>(null);
  const { branchStateCode } = context;

  function choose(picked: BillCustomer) {
    onChange(picked, defaultPlaceOfSupply(picked, branchStateCode));
    onClose();
  }

  if (adding !== null) {
    return (
      <AddForm
        typed={adding}
        onBack={() => {
          setAdding(null);
        }}
        onSaved={(view) => {
          choose(toBillCustomer(view));
        }}
      />
    );
  }
  return (
    <>
      {context.canViewCustomers ? (
        <Finder
          canAdd={context.canManageCustomers}
          onPick={(view) => {
            choose(toBillCustomer(view));
          }}
          onAdd={setAdding}
        />
      ) : (
        <p className="px-6 py-5 text-muted">{t('billing.customer.noAccess')}</p>
      )}
      <OnThisBill
        context={context}
        customer={customer}
        placeOfSupplyStateCode={placeOfSupplyStateCode}
        onClose={onClose}
        onChange={onChange}
      />
    </>
  );
}

/** The phone or name box with its results. */
function Finder({
  canAdd,
  onPick,
  onAdd,
}: {
  canAdd: boolean;
  onPick: (customer: CustomerView) => void;
  onAdd: (typed: string) => void;
}) {
  const { t } = useTranslation();
  const inputId = useId();
  const resultsId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [settled, setSettled] = useState('');
  const [highlight, setHighlight] = useState(0);

  // A name is searched once typing pauses; a full phone number goes at once.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(text);
    }, NAME_SEARCH_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  const now = lookupFor(text, true);
  const lookup = now ?? (lookupFor(text, false) === null ? null : lookupFor(settled, false));
  const found = useQuery({
    queryKey: ['customers', lookup],
    queryFn: () =>
      apiRequest<CustomerView[]>(
        'GET',
        `/api/customers?${new URLSearchParams(lookup?.kind === 'phone' ? { phone: lookup.value } : { q: lookup?.value ?? '' }).toString()}`,
      ),
    enabled: lookup !== null,
    retry: false,
    gcTime: 0,
  });
  const results = lookup !== null && found.data ? found.data : [];
  const selected = Math.min(highlight, Math.max(results.length - 1, 0));
  const none = lookup !== null && found.isSuccess && results.length === 0;

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setHighlight((selected + step + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const picked = results[selected];
      if (picked) onPick(picked);
      else if (none && canAdd) onAdd(text.trim());
    }
  }

  return (
    <section className="flex flex-col gap-3 px-6 py-5">
      <label htmlFor={inputId} className="text-label font-medium">
        {t('billing.customer.search')}
      </label>
      <Input
        ref={input}
        id={inputId}
        data-autofocus
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={resultsId}
        aria-activedescendant={results.length > 0 ? `${resultsId}-${String(selected)}` : undefined}
        aria-keyshortcuts="F3"
        autoComplete="off"
        spellCheck={false}
        placeholder={t('billing.customer.searchHint')}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
        className="h-12 text-section"
      />
      <ul
        id={resultsId}
        role="listbox"
        aria-label={t('billing.customer.results')}
        hidden={results.length === 0}
        className="max-h-64 overflow-y-auto rounded-lg border border-border py-1"
      >
        {results.map((view, index) => (
          <li
            key={view.id}
            id={`${resultsId}-${String(index)}`}
            role="option"
            aria-selected={index === selected}
            onMouseDown={(event) => {
              event.preventDefault();
              onPick(view);
            }}
            className="flex cursor-pointer items-center justify-between gap-4 px-3 py-2 aria-selected:bg-surface-muted"
          >
            <span className="min-w-0 truncate font-medium">{view.name}</span>
            <span className="flex shrink-0 items-center gap-3 text-label tabular-nums text-muted">
              {view.gstin !== null && (
                <span className="rounded-md bg-surface-muted px-2 py-0.5">
                  {t('billing.customer.business')}
                </span>
              )}
              {view.phone ?? view.gstin}
            </span>
          </li>
        ))}
      </ul>
      <div role="status" className="min-h-6 text-muted">
        {found.isFetching && results.length === 0 && t('billing.customer.searching')}
        {found.isError && <span className="text-danger">{t('billing.customer.searchFailed')}</span>}
        {none && t('billing.customer.none')}
      </div>
      {none && canAdd && (
        <Button
          variant="secondary"
          onClick={() => {
            onAdd(text.trim());
          }}
          className="self-start"
        >
          {t('billing.customer.add')}
        </Button>
      )}
    </section>
  );
}

/** Who is on the bill, the tax type, and the place of supply controls. */
function OnThisBill({
  context,
  customer,
  placeOfSupplyStateCode,
  onClose,
  onChange,
}: {
  context: BillingContext;
  customer: BillCustomer | null;
  placeOfSupplyStateCode: string;
  onClose: () => void;
  onChange: (customer: BillCustomer | null, placeOfSupplyStateCode: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const taxText = useTaxText();
  const stateName = useStateName();
  const { branchStateCode } = context;
  const switchId = useId();
  // Question 9 A: a business customer from another state is IGST unless the goods are handed
  // over at the counter.
  const businessState = customer?.gstin ? customer.stateCode : null;
  const theirState =
    businessState !== null && businessState !== branchStateCode ? businessState : null;
  const states = INDIAN_STATES.map(({ code }) => ({
    code,
    name: stateName(code),
  })).sort((a, b) => a.name.localeCompare(b.name, i18n.language));
  const atShop = placeOfSupplyStateCode === branchStateCode;

  return (
    <section
      aria-label={t('billing.customer.onThisBill')}
      className="flex flex-col gap-4 border-t border-border bg-surface-muted px-6 py-5"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-label text-muted">{t('billing.customer.onThisBill')}</p>
          {customer === null ? (
            <p className="text-section font-semibold">{t('billing.customer.walkIn')}</p>
          ) : (
            <>
              <p className="truncate text-section font-semibold">{customer.name}</p>
              <p className="text-label tabular-nums text-muted">
                {[
                  customer.phone,
                  customer.gstin === null
                    ? null
                    : t('billing.customer.gstin', { gstin: customer.gstin }),
                ]
                  .filter((part) => part !== null)
                  .join(' · ')}
              </p>
            </>
          )}
          <p className="mt-1 font-medium">{taxText(placeOfSupplyStateCode, branchStateCode)}</p>
        </div>
        <Button
          variant="secondary"
          disabled={customer === null && atShop}
          onClick={() => {
            onChange(null, branchStateCode);
            onClose();
          }}
        >
          {t('billing.customer.walkInButton')}
        </Button>
      </div>

      {customer !== null && theirState !== null ? (
        <div className="flex items-start gap-3">
          <input
            id={switchId}
            type="checkbox"
            role="switch"
            aria-describedby={`${switchId}-hint`}
            checked={atShop}
            onChange={(event) => {
              onChange(customer, event.target.checked ? branchStateCode : theirState);
            }}
            className="mt-1 size-4 accent-primary"
          />
          <div className="flex flex-col">
            <label htmlFor={switchId} className="font-medium">
              {t('billing.customer.tax.counter')}
            </label>
            <span id={`${switchId}-hint`} className="text-label text-muted">
              {t('billing.customer.tax.counterHint')}
            </span>
          </div>
        </div>
      ) : (
        <Field label={t('billing.customer.tax.sentTo')} hint={t('billing.customer.tax.sentToHint')}>
          {(props) => (
            <Select
              {...props}
              value={placeOfSupplyStateCode}
              onChange={(event) => {
                onChange(customer, event.target.value);
              }}
            >
              {states.map(({ code, name }) => (
                <option key={code} value={code}>
                  {code === branchStateCode
                    ? t('billing.customer.tax.thisShop', { state: name })
                    : name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}

      <div className="flex justify-end">
        <Button onClick={onClose}>{t('billing.customer.done')}</Button>
      </div>
    </section>
  );
}

interface FormValues {
  name: string;
  phone: string;
  business: boolean;
  gstin: string;
  legalName: string;
  address: string;
}

/** The codes only this box words: the API's 409s, plus the schema's GSTIN-state check. */
const OWN_ERRORS = new Set(['phone_taken', 'gstin_taken', 'gstin_state']);

/** Add a customer; a "Business customer" tick adds the GSTIN, legal name and address. */
function AddForm({
  typed,
  onBack,
  onSaved,
}: {
  typed: string;
  onBack: () => void;
  onSaved: (customer: CustomerView) => void;
}) {
  const { t } = useTranslation();
  const errorText = useFieldError();
  const name = useRef<HTMLInputElement>(null);
  // The typed text is a phone number or a name; the form starts with whichever it was.
  const typedPhone = PHONE_TEXT.test(typed) ? normalizePhone(typed) : null;
  const [values, setValues] = useState<FormValues>({
    name: typedPhone === null ? typed : '',
    phone: typedPhone ?? '',
    business: false,
    gstin: '',
    legalName: '',
    address: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    name.current?.focus();
  }, []);

  const save = useMutation({
    mutationFn: (body: unknown) => apiRequest<CustomerView>('POST', '/api/customers', body),
    onSuccess: onSaved,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        const field = error.code === 'gstin_taken' ? 'gstin' : 'phone';
        setErrors({ [field]: error.code });
      } else if (error instanceof ApiError && Object.keys(error.fields).length > 0) {
        setErrors(error.fields);
      } else {
        setFailed(true);
      }
    },
  });

  const set = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues({ ...values, [key]: value });
  };

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    setFailed(false);
    const body = {
      name: values.name,
      phone: values.phone,
      gstin: values.business ? values.gstin : '',
      legalName: values.business ? values.legalName : '',
      address: values.business ? values.address : '',
      pinCode: '',
      stateCode: null,
    };
    const parsed = customerSchema.safeParse(body);
    const found: FieldErrors = parsed.success ? {} : fieldErrors(parsed.error);
    // The schema reads a blank GSTIN as "not a business", so the tick's own rule is checked here.
    if (values.business) {
      for (const field of ['gstin', 'legalName', 'address'] as const) {
        if (values[field].trim() === '') found[field] = 'required';
      }
    }
    setErrors(found);
    if (parsed.success && Object.keys(found).length === 0) save.mutate(parsed.data);
  }

  const message = (field: string) => {
    const code = errors[field];
    if (code === undefined) return undefined;
    return OWN_ERRORS.has(code)
      ? t(`billing.customer.errors.${code as 'phone_taken' | 'gstin_taken' | 'gstin_state'}`)
      : errorText(field, code);
  };
  // An error on a field that isn't on this form (a PIN code, say) still needs saying.
  const stray = Object.keys(errors).some(
    (field) => !['name', 'phone', 'gstin', 'legalName', 'address'].includes(field),
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-6 py-5">
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-3 text-section font-semibold">
          {t('billing.customer.form.title')}
        </legend>
        <Field label={t('billing.customer.form.name')} error={message('name')}>
          {(props) => (
            <Input
              {...props}
              ref={name}
              autoComplete="off"
              value={values.name}
              onChange={(event) => {
                set('name', event.target.value);
              }}
            />
          )}
        </Field>
        <Field label={t('billing.customer.form.phone')} error={message('phone')}>
          {(props) => (
            <Input
              {...props}
              type="tel"
              autoComplete="off"
              className="tabular-nums"
              value={values.phone}
              onChange={(event) => {
                set('phone', event.target.value);
              }}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            checked={values.business}
            onChange={(event) => {
              set('business', event.target.checked);
            }}
            className="size-4 accent-primary"
          />
          {t('billing.customer.form.business')}
        </label>
        {values.business && (
          <>
            <Field label={t('billing.customer.form.gstin')} error={message('gstin')}>
              {(props) => (
                <Input
                  {...props}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={15}
                  className="uppercase tabular-nums"
                  value={values.gstin}
                  onChange={(event) => {
                    set('gstin', event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label={t('billing.customer.form.legalName')} error={message('legalName')}>
              {(props) => (
                <Input
                  {...props}
                  autoComplete="off"
                  value={values.legalName}
                  onChange={(event) => {
                    set('legalName', event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label={t('billing.customer.form.address')} error={message('address')}>
              {(props) => (
                <Textarea
                  {...props}
                  autoComplete="off"
                  rows={2}
                  value={values.address}
                  onChange={(event) => {
                    set('address', event.target.value);
                  }}
                />
              )}
            </Field>
          </>
        )}
      </fieldset>
      {(failed || stray) && (
        <p role="alert" className="text-danger">
          {t('billing.customer.errors.failed')}
        </p>
      )}
      <div className="flex justify-between gap-3">
        <Button variant="ghost" onClick={onBack}>
          {t('billing.customer.form.back')}
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? t('billing.customer.form.saving') : t('billing.customer.form.save')}
        </Button>
      </div>
    </form>
  );
}
