import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Field } from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Kbd, KbdGroup } from '../components/ui/kbd';
import { contrastRatio } from '../theme/contrast';

/** The design system on one page, to check every part in both modes and three languages. */
export const Route = createFileRoute('/design')({
  component: DesignSystem,
  staticData: { titleKey: 'design.title' },
});

// Whole class names: Tailwind only generates classes it can read in the source.
const SWATCHES = {
  background: 'bg-background',
  sidebar: 'bg-sidebar',
  surface: 'bg-surface',
  'surface-muted': 'bg-surface-muted',
  foreground: 'bg-foreground',
  muted: 'bg-muted',
  border: 'bg-border',
  'input-border': 'bg-input-border',
  primary: 'bg-primary',
  accent: 'bg-accent',
  success: 'bg-success',
  'success-soft': 'bg-success-soft',
  warning: 'bg-warning',
  'warning-soft': 'bg-warning-soft',
  danger: 'bg-danger',
  'danger-soft': 'bg-danger-soft',
  'danger-strong': 'bg-danger-strong',
};
const COLOUR_TOKENS = Object.keys(SWATCHES) as (keyof typeof SWATCHES)[];

const TEXT_SIZES = ['text-label', 'text-body', 'text-section', 'text-title', 'text-figure'];

// Made-up sample data, not UI text: in a real bill it comes from the database.
const SAMPLE_BILL = [
  { item: 'Atta 10 kg', quantity: '2 × ₹445.00', amount: '₹890.00' },
  { item: 'तूर दाल 1 kg', quantity: '3 × ₹168.00', amount: '₹504.00' },
  { item: 'Biscuits 800 g', quantity: '11 × ₹90.00', amount: '₹990.00' },
];
const SAMPLE_TOTAL = '₹2,384.00';

/** Each token's value as the browser sees it, re-read when the theme changes. */
function useTokenValues(): Record<string, string> {
  const read = () => {
    const style = getComputedStyle(document.documentElement);
    return Object.fromEntries(
      COLOUR_TOKENS.map((name) => [name, style.getPropertyValue(`--${name}`).trim()]),
    );
  };
  const [values, setValues] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setValues(read());
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
    };
  }, []);
  return values;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className="text-section font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function DesignSystem() {
  const { t } = useTranslation();
  const values = useTokenValues();
  const surface = values.surface ?? '';

  return (
    <div className="flex max-w-5xl flex-col gap-10">
      <Section title={t('design.sections.colours')}>
        <p className="text-label text-muted">{t('design.contrastNote')}</p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3">
          {COLOUR_TOKENS.map((name) => {
            const value = values[name] ?? '';
            return (
              <div key={name} className="overflow-hidden rounded-lg bg-surface shadow-card">
                <div className={`h-12 border-b border-border ${SWATCHES[name]}`} />
                <div className="px-3 py-2 text-label">
                  <code className="font-medium">{name}</code>
                  <div className="text-muted tabular-nums">
                    {value || '—'} ·{' '}
                    {value && surface ? `${contrastRatio(value, surface).toFixed(1)} : 1` : '—'}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={t('design.sections.text')}>
        <Card>
          <CardContent className="flex flex-col gap-3">
            {TEXT_SIZES.map((size) => (
              <div key={size} className="flex items-baseline gap-4">
                <code className="w-28 shrink-0 text-label text-muted">{size}</code>
                <span className={size}>{t('design.sampleSentence')}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </Section>

      <Section title={t('design.sections.buttons')}>
        <div className="flex flex-wrap items-center gap-3">
          <Button>{t('design.buttons.save')}</Button>
          <Button variant="secondary">{t('design.buttons.hold')}</Button>
          <Button variant="ghost">{t('design.buttons.more')}</Button>
          <Button variant="danger">{t('design.buttons.cancelBill')}</Button>
          <Button size="sm">{t('design.buttons.save')}</Button>
          <Button disabled>{t('design.buttons.unavailable')}</Button>
        </div>
      </Section>

      <Section title={t('design.sections.inputs')}>
        <div className="grid max-w-3xl grid-cols-3 gap-4">
          <Field label={t('design.inputs.customer')}>{(props) => <Input {...props} />}</Field>
          <Field label={t('design.inputs.phone')} error={t('design.inputs.phoneError')}>
            {(props) => <Input {...props} defaultValue="98765" />}
          </Field>
          <Field label={t('design.inputs.invoice')}>
            {(props) => <Input {...props} defaultValue="INV-0412" disabled />}
          </Field>
        </div>
      </Section>

      <Section title={t('design.sections.badges')}>
        <div className="flex flex-wrap gap-2">
          <Badge>{t('design.badges.cash')}</Badge>
          <Badge tone="info">{t('design.badges.upi')}</Badge>
          <Badge tone="success">{t('design.badges.paid')}</Badge>
          <Badge tone="warning">{t('design.badges.udhaar')}</Badge>
          <Badge tone="danger">{t('design.badges.cancelled')}</Badge>
        </div>
      </Section>

      <Section title={t('design.sections.cards')}>
        <Card className="max-w-sm">
          <CardHeader>
            <CardTitle>{t('design.cards.title')}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted">{t('design.cards.body')}</CardContent>
        </Card>
      </Section>

      <Section title={t('design.sections.keys')}>
        <div className="flex flex-wrap items-center gap-4">
          <Kbd>F2</Kbd>
          <KbdGroup>
            <Kbd>Alt</Kbd>
            <Kbd>H</Kbd>
          </KbdGroup>
          <Kbd>?</Kbd>
        </div>
      </Section>

      <Section title={t('design.sections.sample')}>
        <div className="grid max-w-4xl grid-cols-[1fr_2fr] gap-4">
          <Card>
            <CardContent>
              <div className="text-label text-muted">{t('design.cards.title')}</div>
              <div className="text-figure font-semibold tabular-nums">₹1,24,580</div>
              <div className="text-label text-success">{t('design.cards.body')}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('design.sample.bill')}</CardTitle>
            </CardHeader>
            <CardContent>
              <table className="w-full tabular-nums">
                <thead className="text-label text-muted">
                  <tr>
                    <th className="pb-2 text-left font-medium">{t('design.sample.item')}</th>
                    <th className="pb-2 text-left font-medium">{t('design.sample.quantity')}</th>
                    <th className="pb-2 text-right font-medium">{t('design.sample.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_BILL.map((row) => (
                    <tr key={row.item} className="border-t border-border">
                      <td className="py-2">{row.item}</td>
                      <td className="py-2 text-muted">{row.quantity}</td>
                      <td className="py-2 text-right font-medium">{row.amount}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="pt-2" colSpan={2}>
                      {t('design.sample.total')}
                    </td>
                    <td className="pt-2 text-right">{SAMPLE_TOTAL}</td>
                  </tr>
                </tfoot>
              </table>
            </CardContent>
          </Card>
        </div>
      </Section>
    </div>
  );
}
