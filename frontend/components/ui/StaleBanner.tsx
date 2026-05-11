import { AlertTriangle } from 'lucide-react';
import { formatRelativeTime, isDataStale } from '@/lib/utils';

interface StaleBannerProps {
  lastUpdated: string | null | undefined;
  maxAgeHours?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function StaleBanner({
  lastUpdated,
  maxAgeHours = 6,
  onRefresh,
  refreshing,
}: StaleBannerProps) {
  const stale = isDataStale(lastUpdated, maxAgeHours);
  const relTime = formatRelativeTime(lastUpdated);

  if (!stale) {
    return (
      <p className="text-xs text-slate-400">
        Last updated {relTime}
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
      <p className="text-xs text-amber-700">
        Data is {relTime} old and may be stale.
      </p>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={refreshing}
          className="ml-auto text-xs text-amber-700 font-medium underline disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh now'}
        </button>
      )}
    </div>
  );
}
