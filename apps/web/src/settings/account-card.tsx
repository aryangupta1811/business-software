import { useId, type ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';

/** A Settings card for the login's own safety: a named region, a heading and a lead line. */
export function AccountCard({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <Card role="region" aria-labelledby={titleId}>
      <CardHeader className="flex flex-col gap-1 px-7 pt-6">
        <CardTitle id={titleId}>{title}</CardTitle>
        <p className="text-muted">{lead}</p>
      </CardHeader>
      <CardContent className="px-7 pb-6">{children}</CardContent>
    </Card>
  );
}
