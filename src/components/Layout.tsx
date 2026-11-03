import clsx from 'clsx';
import { CalendarRange, ClipboardCheck, Compass, Download, FilePlus2, FileScan, FolderKanban, LayoutDashboard, Network } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/studies', label: 'Studies', icon: FolderKanban },
  { to: '/digitisation', label: 'Protocol Digitisation', icon: FileScan },
  { to: '/builder', label: 'Protocol Builder', icon: FilePlus2 },
  { to: '/explorer', label: 'Protocol Explorer', icon: Compass },
  { to: '/soa', label: 'Schedule of Activities', icon: CalendarRange },
  { to: '/relationships', label: 'Relationship Map', icon: Network },
  { to: '/review', label: 'Review & Validation', icon: ClipboardCheck },
  { to: '/export', label: 'Export Center', icon: Download },
];

export function Layout() {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col bg-navy-900 text-slate-300">
        <div className="flex items-center gap-2 px-5 py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand-500 text-sm font-bold text-white">PQ</div>
          <div>
            <div className="text-[15px] font-semibold leading-tight text-white">ProtocolIQ</div>
            <div className="text-[11px] text-slate-400">Structured protocol platform</div>
          </div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                clsx('flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors', isActive ? 'bg-navy-700 font-medium text-white' : 'hover:bg-navy-800 hover:text-white')
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-navy-700 px-5 py-4 text-[11px] leading-relaxed text-slate-500">
          Rule-based authoring and parsing. OCR runs locally with PaddleOCR; no generative AI is used.
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  );
}

export function Page({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <div className={clsx('mx-auto px-8 py-8', wide ? 'max-w-[1600px]' : 'max-w-6xl')}>{children}</div>;
}
