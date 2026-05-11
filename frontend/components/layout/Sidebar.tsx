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
  Zap,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/idle-resources', label: 'Idle Resources', icon: Trash2 },
  { href: '/rightsizing', label: 'VM Rightsizing', icon: Server },
  { href: '/reservations', label: 'Reservations', icon: BookMarked },
  { href: '/hybrid-benefit', label: 'Hybrid Benefit', icon: Award },
  { href: '/storage', label: 'Storage', icon: HardDrive },
  { href: '/databases', label: 'Databases', icon: Database },
  { href: '/budgets', label: 'Budgets', icon: Wallet },
  { href: '/savings', label: 'Savings', icon: TrendingUp },
  { href: '/reports', label: 'Reports', icon: FileSpreadsheet },
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
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-700">
        <div className="flex items-center justify-center w-8 h-8 bg-blue-600 rounded-lg shrink-0">
          <Zap className="w-5 h-5 text-white" />
        </div>
        {!collapsed && (
          <div>
            <p className="font-bold text-sm leading-tight">AzureOptimize</p>
            <p className="text-xs text-slate-400">Pro</p>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 space-y-1 px-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              )}
              title={collapsed ? label : undefined}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-center p-3 border-t border-slate-700 hover:bg-slate-800 transition-colors"
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? (
          <ChevronRight className="w-4 h-4 text-slate-400" />
        ) : (
          <div className="flex items-center gap-2 w-full px-1">
            <ChevronLeft className="w-4 h-4 text-slate-400" />
            <span className="text-xs text-slate-400">Collapse</span>
          </div>
        )}
      </button>
    </aside>
  );
}
