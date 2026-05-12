import { cn } from '@/lib/utils';
import { LucideIcon, TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: {
    value: number;
    label: string;
    direction: 'up' | 'down' | 'flat';
    positiveIsGood?: boolean;
  };
  className?: string;
  iconClassName?: string;
  loading?: boolean;
  index?: number;
}

export function MetricCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  className,
  iconClassName,
  loading = false,
  index = 0,
}: MetricCardProps) {
  if (loading) {
    return (
      <div
        className={cn('bg-white rounded-xl border border-slate-200 p-5 animate-fade-in-up', className)}
        style={{ animationDelay: `${index * 80}ms` }}
      >
        <div className="skeleton h-4 w-24 mb-3" />
        <div className="skeleton h-8 w-32 mb-2" />
        <div className="skeleton h-3 w-20" />
      </div>
    );
  }

  const getTrendColor = () => {
    if (!trend) return '';
    const { direction, positiveIsGood = false } = trend;
    if (direction === 'flat') return 'text-slate-500';
    if (direction === 'up') return positiveIsGood ? 'text-green-600' : 'text-red-500';
    return positiveIsGood ? 'text-red-500' : 'text-green-600';
  };

  const TrendIcon =
    trend?.direction === 'up'
      ? TrendingUp
      : trend?.direction === 'down'
      ? TrendingDown
      : Minus;

  return (
    <div
      className={cn(
        'group bg-white rounded-xl border border-slate-200 p-5',
        'hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200',
        'animate-fade-in-up',
        className
      )}
      style={{ animationDelay: `${index * 80}ms` }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-500 mb-1">{title}</p>
          <p className="text-2xl font-bold text-slate-900 truncate">{value}</p>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-1 truncate">{subtitle}</p>
          )}
          {trend && (
            <div className={cn('flex items-center gap-1 mt-2', getTrendColor())}>
              <TrendIcon className="w-4 h-4" />
              <span className="text-xs font-medium">
                {trend.value > 0 ? '+' : ''}
                {trend.label}
              </span>
            </div>
          )}
        </div>
        {Icon && (
          <div
            className={cn(
              'flex items-center justify-center w-12 h-12 rounded-xl shrink-0',
              'group-hover:scale-110 transition-transform duration-200',
              iconClassName ?? 'bg-blue-50'
            )}
          >
            <Icon className={cn('w-6 h-6', iconClassName ? 'text-white' : 'text-blue-600')} />
          </div>
        )}
      </div>
    </div>
  );
}
