import {
  Check,
  Download,
  Gamepad2,
  Menu,
  RefreshCw,
  Undo2,
  WalletCards,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';

import { appName } from '../app-info';
import type { LocalStateController } from '../local-state';
import { formatServiceDate, type PublicConnectionState, type Toast } from '../ui-shared';

export function AppHeader({
  activeName,
  canInstall,
  cardCount,
  onInstall,
  onOpenCards,
  onOpenMenu,
}: {
  activeName: string | null;
  canInstall: boolean;
  cardCount: number;
  onInstall: () => void;
  onOpenCards: () => void;
  onOpenMenu: () => void;
}) {
  return (
    <header className="topbar">
      <button
        aria-label="Open menu"
        className="icon-button header-button"
        onClick={onOpenMenu}
        title="Menu"
        type="button"
      >
        <Menu aria-hidden="true" />
      </button>
      <Link aria-label={`${appName} home`} className="brand" to="/">
        <Gamepad2 aria-hidden="true" />
        <span>{appName}</span>
      </Link>
      <div className="header-actions">
        {canInstall ? (
          <button
            aria-label="Install app"
            className="icon-button header-button"
            onClick={onInstall}
            title="Install app"
            type="button"
          >
            <Download aria-hidden="true" />
          </button>
        ) : null}
        <button
          className="identity-button"
          onClick={onOpenCards}
          title="Manage name cards"
          type="button"
        >
          <WalletCards aria-hidden="true" />
          <span>{activeName ?? 'Choose name'}</span>
          <b>{cardCount}</b>
        </button>
      </div>
    </header>
  );
}

export function ConnectionBanner({
  serviceDate,
  state,
}: {
  serviceDate: string | null;
  state: PublicConnectionState;
}) {
  const content =
    state === 'live'
      ? { icon: Wifi, label: 'Live', copy: 'Queue updates are connected.' }
      : state === 'reconnecting'
        ? { icon: RefreshCw, label: 'Reconnecting', copy: 'Trying to restore live updates.' }
        : state === 'offline'
          ? { icon: WifiOff, label: 'Offline', copy: 'Showing the last queue state.' }
          : { icon: Wifi, label: 'Ready', copy: 'Live updates connect when you open a queue.' };
  const Icon = content.icon;

  return (
    <div aria-live="polite" className={`connection-banner is-${state}`}>
      <Icon aria-hidden="true" />
      <strong>{content.label}</strong>
      <span>{content.copy}</span>
      {serviceDate ? (
        <span className="service-date">{formatServiceDate(serviceDate)}</span>
      ) : null}
    </div>
  );
}

export function MenuDrawer({
  local,
  onClose,
}: {
  local: LocalStateController;
  onClose: () => void;
}) {
  return (
    <div className="drawer-backdrop menu-backdrop" onMouseDown={onClose} role="presentation">
      <aside
        aria-label="Menu"
        aria-modal="true"
        className="menu-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="dialog-heading">
          <h2>Menu</h2>
          <button
            aria-label="Close"
            className="icon-button compact"
            onClick={onClose}
            title="Close"
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
        <nav className="menu-links">
          <NavLink end onClick={onClose} to="/">
            Home
          </NavLink>
          <NavLink onClick={onClose} to="/cards">
            My name cards
          </NavLink>
          <NavLink onClick={onClose} to="/about">
            About this queue
          </NavLink>
        </nav>
        <div className="motion-setting">
          <span>Reduce motion</span>
          <div className="segmented-control">
            <button
              aria-pressed={local.state.prefs.reduceMotion === 'system'}
              onClick={() => local.setReduceMotion('system')}
              type="button"
            >
              System
            </button>
            <button
              aria-pressed={local.state.prefs.reduceMotion === true}
              onClick={() => local.setReduceMotion(true)}
              type="button"
            >
              On
            </button>
            <button
              aria-pressed={local.state.prefs.reduceMotion === false}
              onClick={() => local.setReduceMotion(false)}
              type="button"
            >
              Off
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function ToastMessage({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  return (
    <div aria-live="polite" className="toast-message" role="status">
      <Check aria-hidden="true" />
      <span>{toast.message}</span>
      {toast.action ? (
        <button onClick={toast.action.onClick} type="button">
          <Undo2 aria-hidden="true" /> {toast.action.label}
        </button>
      ) : null}
      <button
        aria-label="Dismiss notification"
        className="icon-button compact"
        onClick={onClose}
        title="Dismiss notification"
        type="button"
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
