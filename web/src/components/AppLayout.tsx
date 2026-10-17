import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { LayoutGrid, ScanLine, Users, History, LogOut, Menu, X, WifiOff } from 'lucide-react';
import { Wordmark } from './Brand';
import { useAuth } from '../hooks/useAuth';
import { useOnline } from '../hooks/useOnline';

const NAV = [
  { to: '/app', label: 'Events', icon: LayoutGrid, end: true, organizerOnly: false },
  { to: '/app/scan', label: 'Scan', icon: ScanLine, end: false, organizerOnly: false },
  { to: '/app/team', label: 'Team', icon: Users, end: false, organizerOnly: true },
  { to: '/app/activity', label: 'Activity', icon: History, end: false, organizerOnly: true }
];

export function AppLayout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const online = useOnline();
  const [menuOpen, setMenuOpen] = useState(false);

  const links = NAV.filter((item) => !item.organizerOnly || user?.role === 'organizer');

  async function handleSignOut() {
    await signOut();
    navigate('/signin');
  }

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {!online && (
        <div className="offline-strip" role="status">
          <WifiOff size={14} aria-hidden />
          <span>
            Offline — scans are being queued on this device and will be verified when the
            connection returns.
          </span>
        </div>
      )}

      <header className="appbar">
        <div className="shell appbar__inner">
          <NavLink to="/app" className="appbar__brand" aria-label="GateGuard home">
            <Wordmark size={20} />
          </NavLink>

          <nav className="appbar__nav" aria-label="Main">
            {links.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="appbar__link">
                <item.icon size={15} aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="appbar__right">
            <span className="appbar__who stamp">
              {user?.name}
              <span className="appbar__role">{user?.role}</span>
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={handleSignOut}>
              <LogOut size={14} aria-hidden />
              Sign out
            </button>
          </div>

          <button
            type="button"
            className="btn btn--ghost btn--icon appbar__burger"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            {menuOpen ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />}
          </button>
        </div>

        {menuOpen && (
          <nav className="appbar__drawer" aria-label="Main">
            {links.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="appbar__link"
                onClick={() => setMenuOpen(false)}
              >
                <item.icon size={16} aria-hidden />
                {item.label}
              </NavLink>
            ))}
            <div className="appbar__drawer-foot">
              <span className="stamp">
                {user?.name} · {user?.role}
              </span>
              <button type="button" className="btn btn--sm" onClick={handleSignOut}>
                <LogOut size={14} aria-hidden />
                Sign out
              </button>
            </div>
          </nav>
        )}
      </header>

      <main id="main" className="grow">
        <Outlet />
      </main>
    </>
  );
}
