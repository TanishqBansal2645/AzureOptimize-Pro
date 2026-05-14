import { formatRelativeTime } from '@/lib/utils';

interface StaleBannerProps {
  lastUpdated: string | null | undefined;
  maxAgeHours?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function StaleBanner({
  lastUpdated,
  maxAgeHours,
  onRefresh,
  refreshing,
}: StaleBannerProps) {
  const relTime = formatRelativeTime(lastUpdated);

  const isStale =
    maxAgeHours !== undefined &&
    lastUpdated != null &&
    Date.now() - new Date(lastUpdated).getTime() > maxAgeHours * 60 * 60 * 1000;

  if (refreshing) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-400">
        <svg
          className="h-3 w-3 animate-spin"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
          />
        </svg>
        <span>Refreshing…</span>
      </div>
    );
  }

  if (isStale && onRefresh) {
    return (
      <button
        onClick={onRefresh}
        className="flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors"
      >
        <svg
          className="h-3 w-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <span>Data may be stale — click to refresh</span>
      </button>
    );
  }

  return (
    <p className="text-xs text-slate-400">
      Last updated {relTime}
    </p>
  );
}
