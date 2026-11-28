import { formatPaise, type Paise } from '@business-software/shared';
import { useTranslation } from 'react-i18next';
import { Badge } from '../components/ui/badge';
import { balanceKind } from './standing';

/** "Owes ₹1,240", "Advance ₹300" or "Nothing owed": words and colour, never colour alone. */
export function BalanceBadge({ paise }: { paise: Paise }) {
  const { t } = useTranslation();
  const kind = balanceKind(paise);
  const tone = kind === 'owes' ? 'warning' : kind === 'advance' ? 'success' : 'neutral';
  return (
    <Badge tone={tone} className="tabular-nums">
      {t(`udhaar.balance.${kind}`, { amount: formatPaise(Math.abs(paise)) })}
    </Badge>
  );
}
