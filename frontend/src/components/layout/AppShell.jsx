import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  Activity,
  BellRing,
  FlaskConical,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Radio,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useLiveFeed } from '../../hooks/useLiveFeed';

const NAV = [
  { to: '/', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/transactions', label: 'Transactions', icon: Activity },
  { to: '/alerts', label: 'Alerts', icon: BellRing },
  { to: '/rules', label: 'Rule engine', icon: ListFilter },
  { to: '/simulator', label: 'Simulator', icon: FlaskConical },
];

export default function AppShell() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const { connected } = useLiveFeed({ limit: 1 });

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <ShieldAlert size={18} className="text-ml" />
          <span className="font-display text-[15px] font-extrabold tracking-tight">FraudGuard</span>
        </div>

        <nav className="flex-1 px-3">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `focusable mb-0.5 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition ${
                  isActive ? 'bg-ink text-white' : 'text-slate1 hover:bg-paper hover:text-ink'
                }`
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-line px-5 py-4">
          <div className="mb-3 flex items-center gap-2 text-[11px]">
            <Radio size={12} className={connected ? 'text-rules' : 'text-slate1'} />
            <span className="num text-slate1">
              {connected ? 'Live stream connected' : 'Stream offline'}
            </span>
          </div>
          <p className="truncate text-sm font-medium">{user?.name || 'Analyst'}</p>
          <p className="truncate text-xs text-slate1">{user?.role || 'fraud-ops'}</p>
          <button
            onClick={() => {
              signOut();
              navigate('/login');
            }}
            className="focusable mt-2 inline-flex items-center gap-1.5 text-xs text-slate1 hover:text-ink"
          >
            <LogOut size={12} /> Sign out
          </button>
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <div className="mx-auto max-w-[1180px] px-4 py-6 md:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
