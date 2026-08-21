import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  BellRing,
  FlaskConical,
  LayoutDashboard,
  ListFilter,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  X,
} from 'lucide-react';
import logo from './t1.jpeg';
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
  const location = useLocation();
  const { connected } = useLiveFeed({ limit: 1 });

  // Collapsed rail on desktop, overlay drawer on small screens. The choice
  // persists, because someone who collapsed the nav to read a wide table does
  // not want it back on the next page.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('fg_nav_collapsed') === 'true'
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem('fg_nav_collapsed', String(collapsed));
  }, [collapsed]);

  // A drawer left open across a navigation would cover the page you just chose
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && setDrawerOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const width = collapsed ? 'md:w-[68px]' : 'md:w-60';

  return (
    <div className="flex min-h-screen">
      {/* Mobile scrim */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-ink/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-line bg-surface transition-transform duration-200 md:static md:translate-x-0 md:transition-[width] ${width} ${
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div
          className={`flex items-center gap-2 py-5 ${collapsed ? 'md:justify-center md:px-3' : ''} px-5`}
        >
          <img
            src={logo}
            alt=""
            className="h-6 w-6 shrink-0 rounded-md object-cover"
          />
          <span
            className={`font-display text-[15px] font-extrabold tracking-tight ${
              collapsed ? 'md:hidden' : ''
            }`}
          >
            Snow-Asgard
          </span>

          {/* Sits with the wordmark: the control and the thing it collapses read
              as one unit, and it stays reachable at the top of the rail. */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={`focusable hidden rounded-md p-1 text-slate1 transition hover:bg-paper hover:text-ink md:block ${
              collapsed ? '' : 'ml-auto'
            }`}
          >
            {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
          </button>

          <button
            onClick={() => setDrawerOpen(false)}
            className="focusable ml-auto text-slate1 md:hidden"
            aria-label="Close navigation"
          >
            <X size={16} />
          </button>
        </div>

        <nav className={`flex-1 ${collapsed ? 'md:px-2' : ''} px-3`}>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              title={collapsed ? label : undefined}
              className={({ isActive }) =>
                `focusable mb-0.5 flex items-center gap-2.5 rounded-md py-2 text-sm transition ${
                  collapsed ? 'md:justify-center md:px-0' : ''
                } px-3 ${
                  isActive ? 'bg-ink text-white' : 'text-slate1 hover:bg-paper hover:text-ink'
                }`
              }
            >
              <Icon size={15} className="shrink-0" />
              <span className={collapsed ? 'md:hidden' : ''}>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className={`border-t border-line py-4 ${collapsed ? 'md:px-2' : ''} px-5`}>
          <div
            className={`mb-3 flex items-center gap-2 text-[11px] ${
              collapsed ? 'md:justify-center' : ''
            }`}
            title={connected ? 'Live stream connected' : 'Stream offline'}
          >
            <Radio size={12} className={`shrink-0 ${connected ? 'text-rules' : 'text-slate1'}`} />
            <span className={`num text-slate1 ${collapsed ? 'md:hidden' : ''}`}>
              {connected ? 'Live stream connected' : 'Stream offline'}
            </span>
          </div>

          <div className={collapsed ? 'md:hidden' : ''}>
            <p className="truncate text-sm font-medium">{user?.name || 'Analyst'}</p>
            <p className="truncate text-xs text-slate1">{user?.role || 'fraud-ops'}</p>
          </div>

          <button
            onClick={() => {
              signOut();
              navigate('/login');
            }}
            title="Sign out"
            className={`focusable mt-2 inline-flex items-center gap-1.5 text-xs text-slate1 hover:text-ink ${
              collapsed ? 'md:mt-0 md:w-full md:justify-center' : ''
            }`}
          >
            <LogOut size={12} className="shrink-0" />
            <span className={collapsed ? 'md:hidden' : ''}>Sign out</span>
          </button>
        </div>

      </aside>

      <main className="min-w-0 flex-1">
        {/* Mobile bar: the only place the drawer can be opened from */}
        <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3 md:hidden">
          <button
            onClick={() => setDrawerOpen(true)}
            className="focusable text-slate1"
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>
          <img src={logo} alt="" className="h-5 w-5 rounded object-cover" />
          <span className="font-display text-sm font-extrabold tracking-tight">Snow-Asgard</span>
        </div>

        <div className="mx-auto max-w-[1440px] px-4 py-6 md:px-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
