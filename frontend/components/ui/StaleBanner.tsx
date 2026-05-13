import { formatRelativeTime } from '@/lib/utils';

interface StaleBannerProps {
  lastUpdated: string | null | undefined;
  maxAgeHours?: number;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function StaleBanner({ lastUpdated }: StaleBannerProps) {
  const relTime = formatRelativeTime(lastUpdated);
  return (
    <p className="text-xs text-slate-400">
      Last updated {relTime}
    </p>
  );
}
