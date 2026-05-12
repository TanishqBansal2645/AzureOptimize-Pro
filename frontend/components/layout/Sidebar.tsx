'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Trash2,
  Server,
  BookMarked,
  Award,
  Database,
  HardDrive,
  Wallet,
  TrendingUp,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
  CloudCog,
} from 'lucide-react';

const sections = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard', label: 'Savings Dashboard', icon: LayoutDashboard },
      { href: '/savings', label: 'Savings Tracker', icon: TrendingUp },
    ],
  },
  {
    label: 'Optimization',
    items: [
      { href: '/idle-resources', label: 'Idle Resources', icon: Trash2 },
      { href: '/rightsizing', label: 'VM Rightsizing', icon: Server },
      { href: '/hybrid-benefit', label: 'Hybrid Benefit', icon: Award },
      { href: '/reservations', label: 'Reservations', icon: BookMarked },
      { href: '/storage', label: 'Storage', icon: HardDrive },
      { href: '/databases', label: 'Databases', icon: Database },
    ],
  },
  {
    label: 'Management',
    items: [
      { href: '/budgets', label: 'Budgets', icon: Wallet },
      { href: '/reports', label: 'Reports', icon: FileSpreadsheet },
    ],
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={cn(
        'flex flex-col bg-slate-900 text-white transition-all duration-300 ease-in-out shrink-0',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-5 border-b border-slate-800',
          collapsed && 'justify-center'
        )}
      >
        <div
          className="flex items-center justify-center w-9 h-9 rounded-xl shrink-0"
          style={{ background: 'linear-gradient(145deg, #1d4ed8, #0ea5e9)' }}
        >
          <CloudCog className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="font-bold text-sm leading-tight tracking-tight text-white">
              AzureOptimize
            </p>
            <p
              className="text-xs font-semibold"
              style={{ background: 'linear-gradient(90deg, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}
            >
              Pro
            </p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 space-y-4 px-2">
        {sections.map((section) => (
          <div key={section.label}>
            {!collapsed && (
              <p className="px-3 mb-1 text-xs font-semibold text-slate-500 uppercase tracking-widest">
                {section.label}
              </p>
            )}
            <div className="space-y-0.5">
              {section.items.map(({ href, label, icon: Icon }) => {
                const isActive = pathname === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                      isActive
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/40'
                        : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                    )}
                    title={collapsed ? label : undefined}
                  >
                    <Icon className={cn('w-4 h-4 shrink-0', isActive ? 'text-white' : 'text-slate-400')} />
                    {!collapsed && <span className="truncate">{label}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={cn(
          'flex items-center p-3 border-t border-slate-800 hover:bg-slate-800 transition-colors',
          collapsed ? 'justify-center' : 'gap-2 px-4'
        )}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4 text-slate-500" />
        ) : (
          <>
            <ChevronLeft className="w-4 h-4 text-slate-500" />
            <span className="text-xs text-slate-500">Collapse</span>
          </>
        )}
      </button>
    </aside>
  );
}
