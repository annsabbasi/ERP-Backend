import { Button } from '@erp/ui';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { fetchHealth } from '../api';

export function HomePage() {
  const { t } = useTranslation();
  const health = useQuery({ queryKey: ['health'], queryFn: fetchHealth, retry: false });

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold">{t('app.title')}</h1>
      <p data-testid="api-status" className="text-lg font-medium">
        {health.isPending ? (
          <span>API: checking…</span>
        ) : health.isSuccess ? (
          <span style={{ color: 'var(--erp-color-success)' }}>API: ok</span>
        ) : (
          <span style={{ color: 'var(--erp-color-danger)' }}>API: unreachable</span>
        )}
      </p>
      <Button onClick={() => void health.refetch()} disabled={health.isFetching}>
        Check again
      </Button>
    </main>
  );
}
