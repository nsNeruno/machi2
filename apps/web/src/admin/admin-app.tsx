import {
  createContext,
  useContext,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Link,
  NavLink,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Gamepad2,
  ListChecks,
  LogOut,
  MapPin,
  Plus,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react';
import {
  adminGameCreateSchema,
  adminLocationCreateSchema,
  adminUserCreateSchema,
  suggestSlug,
  type AdminGameResponse,
  type AdminLocationResponse,
  type AdminMeResponse,
  type AdminQueueEntryResponse,
  type AdminUserResponse,
  type BoardMode,
  type DoneReason,
  type LoadLevel,
} from '@machi2/shared';

import * as api from './admin-api';
import { AdminApiError } from './admin-api';

const doneReasons: Array<{ reason: DoneReason; label: string }> = [
  { reason: 'played', label: 'Played' },
  { reason: 'left', label: 'Left' },
  { reason: 'skipped', label: 'Skipped' },
  { reason: 'other', label: 'Other' },
];

const timezones: string[] = (() => {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    if (supported && supported.length > 0) {
      return supported;
    }
  } catch {
    // fall through to a small default set
  }
  return [
    'Asia/Jakarta',
    'Asia/Tokyo',
    'Asia/Singapore',
    'Europe/London',
    'America/New_York',
    'UTC',
  ];
})();

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

const LOGIN_PATH = '/admin/login';
const AFTER_LOGIN_PATH = '/admin/locations';

/**
 * Where an open redirect would otherwise live. Only same-origin admin paths are
 * allowed back out of the `redirect` param, and never the login screen itself.
 */
function safeRedirect(raw: string | null): string {
  if (!raw) {
    return AFTER_LOGIN_PATH;
  }
  let url: URL;
  try {
    url = new URL(raw, window.location.origin);
  } catch {
    return AFTER_LOGIN_PATH;
  }
  if (url.origin !== window.location.origin) {
    return AFTER_LOGIN_PATH;
  }
  if (url.pathname !== '/admin' && !url.pathname.startsWith('/admin/')) {
    return AFTER_LOGIN_PATH;
  }
  if (url.pathname === LOGIN_PATH) {
    return AFTER_LOGIN_PATH;
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The login URL that remembers where a signed-out visitor was heading. */
function loginPathFor(pathname: string, search: string): string {
  const next = `${pathname}${search}`;
  if (pathname === '/admin' || pathname === '/admin/') {
    return LOGIN_PATH;
  }
  return `${LOGIN_PATH}?redirect=${encodeURIComponent(next)}`;
}

type AdminAuth = { me: AdminMeResponse; onLogout: () => void };
const AdminAuthContext = createContext<AdminAuth | null>(null);
function useAdminAuth(): AdminAuth {
  const value = useContext(AdminAuthContext);
  if (!value) {
    throw new Error('useAdminAuth used outside the admin shell.');
  }
  return value;
}

export function AdminApp() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useQuery({
    queryKey: ['admin', 'me'],
    queryFn: api.fetchMe,
    retry: false,
    refetchOnWindowFocus: false,
  });

  if (me.isPending) {
    return <AdminSplash label="Loading admin console" />;
  }

  if (me.isError) {
    const status = me.error instanceof AdminApiError ? me.error.status : 0;
    if (status !== 401 && status !== 0) {
      return (
        <AdminSplash label={errorMessage(me.error)}>
          <button className="primary-button" onClick={() => void me.refetch()} type="button">
            Try again
          </button>
        </AdminSplash>
      );
    }
  }

  const atLogin = location.pathname === LOGIN_PATH;

  if (me.isError || !me.data) {
    // Signed out: move the URL to the login screen rather than rendering it under
    // a deep admin path, and carry that path along so login can land back on it.
    if (!atLogin) {
      return <Navigate replace to={loginPathFor(location.pathname, location.search)} />;
    }
    return <AdminLogin onSuccess={(data) => queryClient.setQueryData(['admin', 'me'], data)} />;
  }

  if (atLogin) {
    return (
      <Navigate replace to={safeRedirect(new URLSearchParams(location.search).get('redirect'))} />
    );
  }

  const onLogout = () => {
    const csrfToken = me.data.csrfToken;
    // Drop the session and the deep admin path in the same render, so the URL bar
    // never keeps pointing at a screen the signed-out user can no longer see — and
    // so the still-authenticated shell doesn't bounce straight back off /admin/login.
    queryClient.setQueryData(['admin', 'me'], null);
    navigate(LOGIN_PATH, { replace: true });
    void api.logout(csrfToken).finally(() => {
      queryClient.removeQueries({ queryKey: ['admin'] });
      void me.refetch();
    });
  };

  return (
    <AdminAuthContext.Provider value={{ me: me.data, onLogout }}>
      <AdminShell />
    </AdminAuthContext.Provider>
  );
}

function AdminLogin({ onSuccess }: { onSuccess: (me: AdminMeResponse) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess,
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate();
  };

  return (
    <main className="admin-auth">
      <form className="admin-card admin-login" onSubmit={submit}>
        <div className="admin-brand">
          <Gamepad2 aria-hidden="true" />
          <span>Queue admin</span>
        </div>
        <label className="admin-field">
          <span>Email</span>
          <input
            autoComplete="username"
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            value={email}
          />
        </label>
        <label className="admin-field">
          <span>Password</span>
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            value={password}
          />
        </label>
        {mutation.isError ? (
          <p className="admin-error" role="alert">
            {errorMessage(mutation.error)}
          </p>
        ) : null}
        <button className="primary-button" disabled={mutation.isPending} type="submit">
          {mutation.isPending ? 'Signing in…' : 'Log in'}
        </button>
      </form>
    </main>
  );
}

function AdminShell() {
  const { me, onLogout } = useAdminAuth();
  const [maintenanceOpen, setMaintenanceOpen] = useState(false);
  return (
    <div className="admin-frame">
      <header className="admin-topbar">
        <div className="admin-brand">
          <Gamepad2 aria-hidden="true" />
          <span>Queue admin</span>
        </div>
        <nav className="admin-nav">
          <NavLink to="/admin/locations">
            <MapPin aria-hidden="true" /> Locations
          </NavLink>
          {me.role === 'superadmin' ? (
            <NavLink to="/admin/users">
              <Users aria-hidden="true" /> Users
            </NavLink>
          ) : null}
        </nav>
        <div className="admin-account">
          {me.role === 'superadmin' ? (
            <button
              className="secondary-button compact"
              onClick={() => setMaintenanceOpen(true)}
              type="button"
            >
              <Activity aria-hidden="true" /> Load
            </button>
          ) : null}
          <span>{me.email}</span>
          <button className="secondary-button compact" onClick={onLogout} type="button">
            <LogOut aria-hidden="true" /> Log out
          </button>
        </div>
      </header>
      {maintenanceOpen ? <MaintenanceDialog onClose={() => setMaintenanceOpen(false)} /> : null}
      <Routes>
        <Route element={<LocationsScreen />} path="/admin" />
        <Route element={<LocationsScreen />} path="/admin/locations" />
        <Route element={<GamesScreen />} path="/admin/locations/:id/games" />
        <Route element={<QueueScreen />} path="/admin/locations/:id/queue" />
        <Route
          element={me.role === 'superadmin' ? <UsersScreen /> : <Forbidden />}
          path="/admin/users"
        />
        <Route element={<Forbidden />} path="*" />
      </Routes>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Locations
// ---------------------------------------------------------------------------

function LocationsScreen() {
  const { me } = useAdminAuth();
  const [editing, setEditing] = useState<AdminLocationResponse | 'new' | null>(null);
  const locations = useQuery({ queryKey: ['admin', 'locations'], queryFn: api.fetchLocations });

  return (
    <main className="admin-main">
      <div className="admin-heading">
        <div>
          <h1>Locations</h1>
          <p>Game centers you can manage.</p>
        </div>
        {me.role === 'superadmin' ? (
          <button className="primary-button" onClick={() => setEditing('new')} type="button">
            <Plus aria-hidden="true" /> Add location
          </button>
        ) : null}
      </div>
      {locations.isPending ? <AdminSplash label="Loading locations" inline /> : null}
      {locations.isError ? <p className="admin-error">{errorMessage(locations.error)}</p> : null}
      {locations.data ? (
        <div className="admin-table" role="table">
          <div className="admin-row admin-row-head" role="row">
            <span>Name</span>
            <span>Timezone</span>
            <span>Games</span>
            <span>State</span>
            <span />
          </div>
          {locations.data.map((location) => (
            <div className="admin-row" key={location.id} role="row">
              <span>
                <strong>{location.name}</strong>
                <small>/{location.slug}</small>
              </span>
              <span>{location.timezone}</span>
              <span>{location.gameCount}</span>
              <span>
                {location.isActive ? 'Active' : 'Closed'}
                <small>
                  {location.latitude === null
                    ? 'Location check off'
                    : `Location check · ${location.locationValidationRadiusMeters} m`}
                </small>
              </span>
              <span className="admin-row-actions">
                <Link
                  className="secondary-button compact"
                  to={`/admin/locations/${location.id}/games`}
                >
                  Games
                </Link>
                <Link
                  className="secondary-button compact"
                  to={`/admin/locations/${location.id}/queue`}
                >
                  Queue
                </Link>
                <button
                  className="secondary-button compact"
                  onClick={() => setEditing(location)}
                  type="button"
                >
                  Edit
                </button>
              </span>
            </div>
          ))}
          {locations.data.length === 0 ? <p className="admin-empty">No locations yet.</p> : null}
        </div>
      ) : null}
      {editing ? (
        <LocationDialog
          location={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </main>
  );
}

function LocationDialog({
  location,
  onClose,
}: {
  location: AdminLocationResponse | null;
  onClose: () => void;
}) {
  const { me } = useAdminAuth();
  const csrf = me.csrfToken;
  const queryClient = useQueryClient();
  const isNew = location === null;
  const [name, setName] = useState(location?.name ?? '');
  const [slug, setSlug] = useState(location?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!isNew);
  const [address, setAddress] = useState(location?.address ?? '');
  const [timezone, setTimezone] = useState(
    location?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  const [latitude, setLatitude] = useState(location?.latitude?.toString() ?? '');
  const [longitude, setLongitude] = useState(location?.longitude?.toString() ?? '');
  const [locationRadius, setLocationRadius] = useState(
    String(location?.locationValidationRadiusMeters ?? 5),
  );
  const [isActive, setIsActive] = useState(location?.isActive ?? true);
  const [requireApproval, setRequireApproval] = useState(
    location?.requireApprovalForOthers ?? false,
  );
  const [staffPin, setStaffPin] = useState('');
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  const [confirmDelete, setConfirmDelete] = useState('');
  const coordinatePairValid =
    (latitude === '' && longitude === '') || (latitude !== '' && longitude !== '');
  const parsedLocationRadius = Number(locationRadius);
  const locationRadiusValid = Number.isInteger(parsedLocationRadius) && parsedLocationRadius > 0;

  useEffect(() => {
    if (!slugTouched && name) {
      setSlug(suggestSlug(name));
    }
  }, [name, slugTouched]);

  useEffect(() => {
    if (!slug) {
      setSlugState('idle');
      return;
    }
    if (!isNew && slug === location?.slug) {
      setSlugState('ok');
      return;
    }
    setSlugState('checking');
    const timer = window.setTimeout(() => {
      void api
        .checkSlug(slug, location?.id)
        .then((result) => setSlugState(result.available ? 'ok' : 'taken'))
        .catch(() => setSlugState('idle'));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [slug, isNew, location?.id, location?.slug]);

  const save = useMutation({
    mutationFn: () => {
      if (isNew) {
        const parsed = adminLocationCreateSchema.parse({
          name,
          slug,
          address: address || undefined,
          timezone,
          latitude: latitude === '' ? null : Number(latitude),
          longitude: longitude === '' ? null : Number(longitude),
          locationValidationRadiusMeters: parsedLocationRadius,
          isActive,
          requireApprovalForOthers: requireApproval,
          staffPin: staffPin || undefined,
        });
        return api.createLocation(parsed, csrf);
      }
      return api.updateLocation(
        location.id,
        {
          name,
          slug,
          address: address || null,
          timezone,
          latitude: latitude === '' ? null : Number(latitude),
          longitude: longitude === '' ? null : Number(longitude),
          locationValidationRadiusMeters: parsedLocationRadius,
          isActive,
          requireApprovalForOthers: requireApproval,
          ...(staffPin ? { staffPin } : {}),
        },
        csrf,
      );
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'locations'] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteLocation(location!.id, csrf),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'locations'] });
      onClose();
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <AdminModal onClose={onClose} title={isNew ? 'Add location' : `Edit ${location.name}`}>
      <form className="admin-form" onSubmit={submit}>
        <label className="admin-field">
          <span>Name</span>
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="admin-field">
          <span>
            Slug{' '}
            {slugState === 'taken' ? (
              <em className="admin-inline-error">already in use</em>
            ) : slugState === 'ok' ? (
              <em className="admin-inline-ok">available</em>
            ) : slugState === 'checking' ? (
              <em>checking…</em>
            ) : null}
          </span>
          <input
            onChange={(event) => {
              setSlugTouched(true);
              setSlug(event.target.value);
            }}
            value={slug}
          />
        </label>
        <label className="admin-field">
          <span>Address (optional)</span>
          <input onChange={(event) => setAddress(event.target.value)} value={address} />
        </label>
        <label className="admin-field">
          <span>Timezone — drives the daily reset</span>
          <input
            list="admin-timezones"
            onChange={(event) => setTimezone(event.target.value)}
            value={timezone}
          />
          <datalist id="admin-timezones">
            {timezones.map((zone) => (
              <option key={zone} value={zone} />
            ))}
          </datalist>
        </label>
        <div className="admin-coordinate-grid">
          <label className="admin-field">
            <span>Latitude (optional)</span>
            <input
              inputMode="decimal"
              max="90"
              min="-90"
              onChange={(event) => setLatitude(event.target.value)}
              step="any"
              type="number"
              value={latitude}
            />
          </label>
          <label className="admin-field">
            <span>Longitude (optional)</span>
            <input
              inputMode="decimal"
              max="180"
              min="-180"
              onChange={(event) => setLongitude(event.target.value)}
              step="any"
              type="number"
              value={longitude}
            />
          </label>
        </div>
        <label className="admin-field">
          <span>Location check radius (metres)</span>
          <input
            inputMode="numeric"
            min="1"
            onChange={(event) => setLocationRadius(event.target.value)}
            step="1"
            type="number"
            value={locationRadius}
          />
        </label>
        <p className="admin-help">
          Enter both coordinates to require nearby players to verify their location before updating
          a public queue. Clear both coordinates to turn the check off.
        </p>
        {!coordinatePairValid ? (
          <p className="admin-error">Enter both latitude and longitude, or clear both.</p>
        ) : null}
        {!locationRadiusValid ? (
          <p className="admin-error">Location check radius must be a positive whole number.</p>
        ) : null}
        <label className="admin-checkbox">
          <input
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            type="checkbox"
          />
          Active (inactive locations show as closed publicly)
        </label>
        <label className="admin-checkbox">
          <input
            checked={requireApproval}
            onChange={(event) => setRequireApproval(event.target.checked)}
            type="checkbox"
          />
          Require approval to mark others’ entries done
        </label>
        {requireApproval ? (
          <>
            <p className="admin-help">
              Approval hides the public integrity notice and gates marking others’ entries behind a
              staff PIN.{' '}
              {location?.hasStaffPin
                ? 'A PIN is already set — leave blank to keep it.'
                : 'Set a PIN below.'}
            </p>
            <label className="admin-field">
              <span>Staff PIN {location?.hasStaffPin ? '(leave blank to keep current)' : ''}</span>
              <input
                autoComplete="new-password"
                onChange={(event) => setStaffPin(event.target.value)}
                type="password"
                value={staffPin}
              />
            </label>
          </>
        ) : null}
        {save.isError ? <p className="admin-error">{errorMessage(save.error)}</p> : null}
        <div className="admin-form-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={
              save.isPending ||
              slugState === 'taken' ||
              !coordinatePairValid ||
              !locationRadiusValid
            }
            type="submit"
          >
            {save.isPending ? 'Saving…' : isNew ? 'Create location' : 'Save changes'}
          </button>
        </div>
      </form>
      {!isNew && me.role === 'superadmin' ? (
        <div className="admin-danger">
          <h3>Delete this location</h3>
          <p>
            Its games and today’s queue go with it. Type <strong>{location.slug}</strong> to
            confirm.
          </p>
          <div className="admin-form-actions">
            <input
              onChange={(event) => setConfirmDelete(event.target.value)}
              placeholder={location.slug}
              value={confirmDelete}
            />
            <button
              className="danger-button"
              disabled={confirmDelete !== location.slug || remove.isPending}
              onClick={() => remove.mutate()}
              type="button"
            >
              <Trash2 aria-hidden="true" /> Delete
            </button>
          </div>
          {remove.isError ? <p className="admin-error">{errorMessage(remove.error)}</p> : null}
        </div>
      ) : null}
    </AdminModal>
  );
}

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

function GamesScreen() {
  const { id = '' } = useParams();
  const { me } = useAdminAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AdminGameResponse | 'new' | null>(null);
  const [noteFor, setNoteFor] = useState<AdminGameResponse | null>(null);
  const games = useQuery({ queryKey: ['admin', 'games', id], queryFn: () => api.fetchGames(id) });

  const reorder = useMutation({
    mutationFn: (order: string[]) => api.reorderGames(id, order, me.csrfToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'games', id] }),
  });

  const move = (index: number, direction: -1 | 1) => {
    if (!games.data) {
      return;
    }
    const next = [...games.data];
    const target = index + direction;
    if (target < 0 || target >= next.length) {
      return;
    }
    [next[index], next[target]] = [next[target]!, next[index]!];
    reorder.mutate(next.map((game) => game.id));
  };

  return (
    <main className="admin-main">
      <Link className="admin-back" to="/admin/locations">
        <ArrowLeft aria-hidden="true" /> Locations
      </Link>
      <div className="admin-heading">
        <div>
          <h1>Games</h1>
          <p>Reorder with the arrows. Board mode and limits are per game.</p>
        </div>
        <button className="primary-button" onClick={() => setEditing('new')} type="button">
          <Plus aria-hidden="true" /> Add game
        </button>
      </div>
      {games.isPending ? <AdminSplash inline label="Loading games" /> : null}
      {games.isError ? <p className="admin-error">{errorMessage(games.error)}</p> : null}
      {games.data ? (
        <div className="admin-cards">
          {games.data.map((game, index) => (
            <article className={`admin-game-card${game.isActive ? '' : ' is-dim'}`} key={game.id}>
              <div className="admin-game-order">
                <button aria-label="Move up" onClick={() => move(index, -1)} type="button">
                  ▲
                </button>
                <button aria-label="Move down" onClick={() => move(index, 1)} type="button">
                  ▼
                </button>
              </div>
              <div className="admin-game-body">
                <strong>
                  {game.name}
                  {game.cabinetLabel ? <small> · {game.cabinetLabel}</small> : null}
                </strong>
                <span className="admin-game-meta">
                  {game.boardMode === 'now_playing' ? 'Now playing' : 'Self serve'} ·{' '}
                  {game.maxQueueLen ? `max ${game.maxQueueLen}` : 'unbounded'} ·{' '}
                  {game.isActive ? 'active' : 'inactive'}
                  {game.communityNoteVisible ? ' · note shown' : ''}
                </span>
              </div>
              <div className="admin-game-actions">
                <button
                  className="secondary-button compact"
                  onClick={() => setNoteFor(game)}
                  type="button"
                >
                  Note
                </button>
                <button
                  className="secondary-button compact"
                  onClick={() => setEditing(game)}
                  type="button"
                >
                  Edit
                </button>
              </div>
            </article>
          ))}
          {games.data.length === 0 ? <p className="admin-empty">No games yet.</p> : null}
        </div>
      ) : null}
      {editing ? (
        <GameDialog
          game={editing === 'new' ? null : editing}
          locationId={id}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {noteFor ? <CommunityNoteDialog game={noteFor} onClose={() => setNoteFor(null)} /> : null}
    </main>
  );
}

function GameDialog({
  game,
  locationId,
  onClose,
}: {
  game: AdminGameResponse | null;
  locationId: string;
  onClose: () => void;
}) {
  const { me } = useAdminAuth();
  const queryClient = useQueryClient();
  const isNew = game === null;
  const [name, setName] = useState(game?.name ?? '');
  const [cabinetLabel, setCabinetLabel] = useState(game?.cabinetLabel ?? '');
  const [boardMode, setBoardMode] = useState<BoardMode>(game?.boardMode ?? 'self_serve');
  const [maxQueueLen, setMaxQueueLen] = useState(game?.maxQueueLen ? String(game.maxQueueLen) : '');
  const [isActive, setIsActive] = useState(game?.isActive ?? true);
  const [confirmDelete, setConfirmDelete] = useState('');

  const parsedMax = maxQueueLen.trim() === '' ? null : Number(maxQueueLen);

  const save = useMutation({
    mutationFn: () => {
      const shared = {
        name,
        cabinetLabel: cabinetLabel || null,
        boardMode,
        maxQueueLen: parsedMax,
        isActive,
      };
      if (isNew) {
        const parsed = adminGameCreateSchema.parse({
          ...shared,
          cabinetLabel: cabinetLabel || undefined,
          maxQueueLen: parsedMax ?? undefined,
        });
        return api.createGame(locationId, parsed, me.csrfToken);
      }
      return api.updateGame(game.id, shared, me.csrfToken);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'games', locationId] });
      onClose();
    },
  });

  const remove = useMutation({
    mutationFn: () => api.deleteGame(game!.id, me.csrfToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'games', locationId] });
      onClose();
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <AdminModal onClose={onClose} title={isNew ? 'Add game' : `Edit ${game.name}`}>
      <form className="admin-form" onSubmit={submit}>
        <label className="admin-field">
          <span>Name</span>
          <input onChange={(event) => setName(event.target.value)} value={name} />
        </label>
        <label className="admin-field">
          <span>Cabinet label (optional)</span>
          <input onChange={(event) => setCabinetLabel(event.target.value)} value={cabinetLabel} />
        </label>
        <label className="admin-field">
          <span>Queue strategy</span>
          <input disabled value="simple_fifo (locked)" />
        </label>
        <fieldset className="admin-field">
          <span>Board mode</span>
          <label className="admin-radio">
            <input
              checked={boardMode === 'self_serve'}
              name="board-mode"
              onChange={() => setBoardMode('self_serve')}
              type="radio"
            />
            Self serve — players mark themselves played; no explicit “now playing” slot.
          </label>
          <label className="admin-radio">
            <input
              checked={boardMode === 'now_playing'}
              name="board-mode"
              onChange={() => setBoardMode('now_playing')}
              type="radio"
            />
            Now playing — an explicit current-player card that staff/players clear.
          </label>
        </fieldset>
        <label className="admin-field">
          <span>Max queue length (blank = unbounded)</span>
          <input
            inputMode="numeric"
            onChange={(event) => setMaxQueueLen(event.target.value.replace(/[^0-9]/g, ''))}
            value={maxQueueLen}
          />
        </label>
        <label className="admin-checkbox">
          <input
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            type="checkbox"
          />
          Active (inactive games are unjoinable publicly)
        </label>
        {save.isError ? <p className="admin-error">{errorMessage(save.error)}</p> : null}
        <div className="admin-form-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={save.isPending} type="submit">
            {save.isPending ? 'Saving…' : isNew ? 'Create game' : 'Save changes'}
          </button>
        </div>
      </form>
      {!isNew ? (
        <div className="admin-danger">
          <h3>Delete this game</h3>
          <p>
            Removes the game and its queue. Type <strong>{game.name}</strong> to confirm.
          </p>
          <div className="admin-form-actions">
            <input
              onChange={(event) => setConfirmDelete(event.target.value)}
              placeholder={game.name}
              value={confirmDelete}
            />
            <button
              className="danger-button"
              disabled={confirmDelete !== game.name || remove.isPending}
              onClick={() => remove.mutate()}
              type="button"
            >
              <Trash2 aria-hidden="true" /> Delete
            </button>
          </div>
          {remove.isError ? <p className="admin-error">{errorMessage(remove.error)}</p> : null}
        </div>
      ) : null}
    </AdminModal>
  );
}

function CommunityNoteDialog({ game, onClose }: { game: AdminGameResponse; onClose: () => void }) {
  const { me } = useAdminAuth();
  const queryClient = useQueryClient();
  const [body, setBody] = useState(game.communityNote ?? '');
  const [visible, setVisible] = useState(game.communityNoteVisible);

  const save = useMutation({
    mutationFn: () => api.setCommunityNote(game.id, { body, visible }, me.csrfToken),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'games', game.locationId] });
      onClose();
    },
  });

  return (
    <AdminModal onClose={onClose} title={`Community note — ${game.name}`}>
      <div className="admin-form">
        <label className="admin-field">
          <span>Note (plain text, hidden when empty)</span>
          <textarea onChange={(event) => setBody(event.target.value)} rows={5} value={body} />
        </label>
        <label className="admin-checkbox">
          <input
            checked={visible}
            onChange={(event) => setVisible(event.target.checked)}
            type="checkbox"
          />
          Show on the public board
        </label>
        {game.communityNoteUpdatedAt ? (
          <p className="admin-help">
            Last updated {new Date(game.communityNoteUpdatedAt).toLocaleString()}
            {game.communityNoteUpdatedByName ? ` by ${game.communityNoteUpdatedByName}` : ''}.
          </p>
        ) : null}
        {save.isError ? <p className="admin-error">{errorMessage(save.error)}</p> : null}
        <div className="admin-form-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            type="button"
          >
            {save.isPending ? 'Saving…' : 'Save note'}
          </button>
        </div>
      </div>
    </AdminModal>
  );
}

// ---------------------------------------------------------------------------
// Live queue
// ---------------------------------------------------------------------------

function QueueScreen() {
  const { id: locationId = '' } = useParams();
  const { me } = useAdminAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const games = useQuery({
    queryKey: ['admin', 'games', locationId],
    queryFn: () => api.fetchGames(locationId),
  });
  const [gameId, setGameId] = useState('');
  const [reasonFor, setReasonFor] = useState<AdminQueueEntryResponse | null>(null);
  const [clearing, setClearing] = useState(false);

  const activeGameId = gameId || games.data?.[0]?.id || '';
  const [streamState, setStreamState] = useState<api.AdminStreamState>('reconnecting');

  const board = useQuery({
    queryKey: ['admin', 'queue', activeGameId],
    queryFn: () => api.fetchAdminQueue(activeGameId),
    enabled: Boolean(activeGameId),
    // SSE drives live updates; this is a cheap 5s backstop if a stream silently drops.
    refetchInterval: 5_000,
  });

  useEffect(() => {
    if (!activeGameId) {
      return;
    }
    setStreamState('reconnecting');
    const unsubscribe = api.subscribeToAdminQueue(activeGameId, {
      onEvent: (event) => {
        if (event.type === 'queue-updated' || event.type === 'day-rollover') {
          queryClient.setQueryData(['admin', 'queue', activeGameId], event.board);
        }
      },
      onState: setStreamState,
    });
    return () => {
      unsubscribe();
      setStreamState('reconnecting');
    };
  }, [activeGameId, queryClient]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['admin', 'queue', activeGameId] });

  const markDone = useMutation({
    mutationFn: (input: { entryId: string; reason: DoneReason }) =>
      api.markEntryDone(input.entryId, { reason: input.reason }, me.csrfToken),
    onSuccess: () => {
      setReasonFor(null);
      void invalidate();
    },
  });
  const removeEntry = useMutation({
    mutationFn: (entryId: string) => api.deleteEntry(entryId, me.csrfToken),
    onSuccess: () => void invalidate(),
  });
  const clearQueue = useMutation({
    mutationFn: () => api.clearQueue(activeGameId, me.csrfToken),
    onSuccess: () => {
      setClearing(false);
      void invalidate();
    },
  });

  return (
    <main className="admin-main">
      <Link className="admin-back" to="/admin/locations">
        <ArrowLeft aria-hidden="true" /> Locations
      </Link>
      <div className="admin-heading">
        <div>
          <h1>Live queue</h1>
          <p>Done entries stay visible. Actions stream to public boards instantly.</p>
        </div>
        <div className="admin-queue-controls">
          <span className={`admin-stream-pill is-${streamState}`}>
            {streamState === 'live'
              ? 'Live'
              : streamState === 'offline'
                ? 'Offline'
                : 'Reconnecting'}
          </span>
          <select onChange={(event) => setGameId(event.target.value)} value={activeGameId}>
            {games.data?.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name}
                {game.cabinetLabel ? ` · ${game.cabinetLabel}` : ''}
              </option>
            ))}
          </select>
          <button
            aria-label="Refresh"
            className="secondary-button compact"
            onClick={() => void board.refetch()}
            type="button"
          >
            <RefreshCw aria-hidden="true" />
          </button>
        </div>
      </div>
      {board.isPending && activeGameId ? <AdminSplash inline label="Loading queue" /> : null}
      {board.data ? (
        <>
          <p className="admin-help">
            Service date {board.data.serviceDate} · {board.data.locationTimezone} ·{' '}
            {board.data.entries.filter((entry) => entry.status === 'waiting').length} waiting
          </p>
          <div className="admin-table" role="table">
            <div className="admin-row admin-row-head" role="row">
              <span>#</span>
              <span>Name</span>
              <span>Status</span>
              <span>Meta</span>
              <span />
            </div>
            {board.data.entries.map((entry) => (
              <div
                className={`admin-row${entry.status === 'done' ? ' is-done' : ''}`}
                key={entry.id}
                role="row"
              >
                <span>#{entry.ticketNumber}</span>
                <span>
                  <strong>{entry.displayName}</strong>
                  {entry.roundNumber > 1 ? <small> · round {entry.roundNumber}</small> : null}
                </span>
                <span>{entry.status === 'done' ? (entry.doneReason ?? 'done') : 'waiting'}</span>
                <span className="admin-entry-meta">
                  {entry.status === 'done'
                    ? `by ${entry.doneByRole ?? '—'}${entry.doneByName ? ` (${entry.doneByName})` : ''}`
                    : `joined ${new Date(entry.createdAt).toLocaleTimeString()}`}
                </span>
                <span className="admin-row-actions">
                  {entry.status === 'waiting' ? (
                    <button
                      className="secondary-button compact"
                      onClick={() => setReasonFor(entry)}
                      type="button"
                    >
                      Mark done
                    </button>
                  ) : null}
                  <button
                    aria-label={`Delete entry ${entry.ticketNumber}`}
                    className="danger-button compact"
                    onClick={() => removeEntry.mutate(entry.id)}
                    type="button"
                  >
                    <Trash2 aria-hidden="true" />
                  </button>
                </span>
              </div>
            ))}
            {board.data.entries.length === 0 ? (
              <p className="admin-empty">Queue is empty.</p>
            ) : null}
          </div>
          <div className="admin-danger">
            <h3>Clear this queue</h3>
            <p>Empties today’s queue for {board.data.game.name}. People can re-join afterwards.</p>
            <button className="danger-button" onClick={() => setClearing(true)} type="button">
              <ListChecks aria-hidden="true" /> Clear queue
            </button>
          </div>
        </>
      ) : null}
      {reasonFor ? (
        <AdminModal
          onClose={() => setReasonFor(null)}
          title={`Mark #${reasonFor.ticketNumber} ${reasonFor.displayName}`}
        >
          <div className="admin-reason-grid">
            {doneReasons.map((reason) => (
              <button
                className="secondary-button"
                disabled={markDone.isPending}
                key={reason.reason}
                onClick={() => markDone.mutate({ entryId: reasonFor.id, reason: reason.reason })}
                type="button"
              >
                {reason.label}
              </button>
            ))}
          </div>
          {markDone.isError ? <p className="admin-error">{errorMessage(markDone.error)}</p> : null}
        </AdminModal>
      ) : null}
      {clearing && board.data ? (
        <AdminModal onClose={() => setClearing(false)} title="Clear queue?">
          <p className="admin-help">
            This removes {board.data.entries.length} entries for {board.data.game.name}.
          </p>
          <div className="admin-form-actions">
            <button className="secondary-button" onClick={() => setClearing(false)} type="button">
              Cancel
            </button>
            <button
              className="danger-button"
              disabled={clearQueue.isPending}
              onClick={() => clearQueue.mutate()}
              type="button"
            >
              {clearQueue.isPending ? 'Clearing…' : 'Clear queue'}
            </button>
          </div>
          {clearQueue.isError ? (
            <p className="admin-error">{errorMessage(clearQueue.error)}</p>
          ) : null}
        </AdminModal>
      ) : null}
      {!games.isPending && (games.data?.length ?? 0) === 0 ? (
        <p className="admin-empty">
          No games here yet.{' '}
          <button
            className="link-button"
            onClick={() => navigate(`/admin/locations/${locationId}/games`)}
            type="button"
          >
            Add one
          </button>
          .
        </p>
      ) : null}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Users (superadmin)
// ---------------------------------------------------------------------------

function UsersScreen() {
  const { me } = useAdminAuth();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AdminUserResponse | null>(null);
  const users = useQuery({ queryKey: ['admin', 'users'], queryFn: api.fetchUsers });
  const locations = useQuery({ queryKey: ['admin', 'locations'], queryFn: api.fetchLocations });

  const toggleActive = useMutation({
    mutationFn: (user: AdminUserResponse) =>
      api.updateUser(user.id, { isActive: !user.isActive }, me.csrfToken),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  return (
    <main className="admin-main">
      <div className="admin-heading">
        <div>
          <h1>Admin users</h1>
          <p>Superadmins manage every location; operators only their grants.</p>
        </div>
        <button className="primary-button" onClick={() => setCreating(true)} type="button">
          <Plus aria-hidden="true" /> Add user
        </button>
      </div>
      {users.isError ? <p className="admin-error">{errorMessage(users.error)}</p> : null}
      {users.data ? (
        <div className="admin-table" role="table">
          <div className="admin-row admin-row-head" role="row">
            <span>Email</span>
            <span>Role</span>
            <span>Grants</span>
            <span>State</span>
            <span />
          </div>
          {users.data.map((user) => (
            <div className="admin-row" key={user.id} role="row">
              <span>
                <strong>{user.email}</strong>
                {user.id === me.id ? <small> · you</small> : null}
              </span>
              <span>{user.role}</span>
              <span>{user.role === 'superadmin' ? 'all' : user.grantedLocationIds.length}</span>
              <span>{user.isActive ? 'active' : 'inactive'}</span>
              <span className="admin-row-actions">
                <button
                  className="secondary-button compact"
                  onClick={() => setEditing(user)}
                  type="button"
                >
                  Manage
                </button>
                <button
                  className="secondary-button compact"
                  disabled={user.id === me.id || toggleActive.isPending}
                  onClick={() => toggleActive.mutate(user)}
                  type="button"
                >
                  {user.isActive ? 'Deactivate' : 'Activate'}
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {creating ? (
        <UserCreateDialog locations={locations.data ?? []} onClose={() => setCreating(false)} />
      ) : null}
      {editing ? (
        <UserManageDialog
          locations={locations.data ?? []}
          onClose={() => setEditing(null)}
          user={editing}
        />
      ) : null}
    </main>
  );
}

function UserCreateDialog({
  locations,
  onClose,
}: {
  locations: AdminLocationResponse[];
  onClose: () => void;
}) {
  const { me } = useAdminAuth();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'superadmin' | 'operator'>('operator');
  const [grants, setGrants] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () => {
      const parsed = adminUserCreateSchema.parse({
        email,
        password,
        role,
        grantedLocationIds: role === 'operator' ? grants : [],
      });
      return api.createUser(parsed, me.csrfToken);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
      onClose();
    },
  });

  return (
    <AdminModal onClose={onClose} title="Add admin user">
      <form
        className="admin-form"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <label className="admin-field">
          <span>Email</span>
          <input onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
        </label>
        <label className="admin-field">
          <span>Temporary password (min 10 chars)</span>
          <input
            onChange={(event) => setPassword(event.target.value)}
            type="text"
            value={password}
          />
        </label>
        <label className="admin-field">
          <span>Role</span>
          <select
            onChange={(event) => setRole(event.target.value as 'superadmin' | 'operator')}
            value={role}
          >
            <option value="operator">Operator</option>
            <option value="superadmin">Superadmin</option>
          </select>
        </label>
        {role === 'operator' ? (
          <GrantsPicker locations={locations} onChange={setGrants} value={grants} />
        ) : null}
        {create.isError ? <p className="admin-error">{errorMessage(create.error)}</p> : null}
        <div className="admin-form-actions">
          <button className="secondary-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="primary-button" disabled={create.isPending} type="submit">
            {create.isPending ? 'Creating…' : 'Create user'}
          </button>
        </div>
      </form>
    </AdminModal>
  );
}

function UserManageDialog({
  locations,
  onClose,
  user,
}: {
  locations: AdminLocationResponse[];
  onClose: () => void;
  user: AdminUserResponse;
}) {
  const { me } = useAdminAuth();
  const queryClient = useQueryClient();
  const [grants, setGrants] = useState<string[]>(user.grantedLocationIds);
  const [password, setPassword] = useState('');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });

  const saveGrants = useMutation({
    mutationFn: () => api.setGrants(user.id, { locationIds: grants }, me.csrfToken),
    onSuccess: invalidate,
  });
  const changeRole = useMutation({
    mutationFn: (role: 'superadmin' | 'operator') =>
      api.updateUser(user.id, { role }, me.csrfToken),
    onSuccess: invalidate,
  });
  const resetPassword = useMutation({
    mutationFn: () => api.setUserPassword(user.id, password, me.csrfToken),
    onSuccess: () => setPassword(''),
  });

  return (
    <AdminModal onClose={onClose} title={`Manage ${user.email}`}>
      <div className="admin-form">
        <label className="admin-field">
          <span>Role</span>
          <select
            disabled={user.id === me.id}
            onChange={(event) => changeRole.mutate(event.target.value as 'superadmin' | 'operator')}
            value={user.role}
          >
            <option value="operator">Operator</option>
            <option value="superadmin">Superadmin</option>
          </select>
        </label>
        {changeRole.isError ? (
          <p className="admin-error">{errorMessage(changeRole.error)}</p>
        ) : null}

        {user.role === 'operator' ? (
          <>
            <GrantsPicker locations={locations} onChange={setGrants} value={grants} />
            <button
              className="secondary-button"
              disabled={saveGrants.isPending}
              onClick={() => saveGrants.mutate()}
              type="button"
            >
              {saveGrants.isPending ? 'Saving…' : 'Save grants'}
            </button>
            {saveGrants.isError ? (
              <p className="admin-error">{errorMessage(saveGrants.error)}</p>
            ) : null}
          </>
        ) : (
          <p className="admin-help">
            Superadmins have access to every location; grants do not apply.
          </p>
        )}

        <div className="admin-danger">
          <h3>Reset password</h3>
          <p>Sets a new password and signs this user out everywhere.</p>
          <div className="admin-form-actions">
            <input
              onChange={(event) => setPassword(event.target.value)}
              placeholder="New password (min 10)"
              value={password}
            />
            <button
              className="secondary-button"
              disabled={password.length < 10 || resetPassword.isPending}
              onClick={() => resetPassword.mutate()}
              type="button"
            >
              {resetPassword.isSuccess ? 'Updated' : 'Set password'}
            </button>
          </div>
          {resetPassword.isError ? (
            <p className="admin-error">{errorMessage(resetPassword.error)}</p>
          ) : null}
        </div>
      </div>
    </AdminModal>
  );
}

function GrantsPicker({
  locations,
  onChange,
  value,
}: {
  locations: AdminLocationResponse[];
  onChange: (ids: string[]) => void;
  value: string[];
}) {
  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((item) => item !== id) : [...value, id]);
  };
  return (
    <fieldset className="admin-field">
      <span>Granted locations</span>
      {locations.length === 0 ? <p className="admin-help">No locations to grant yet.</p> : null}
      {locations.map((location) => (
        <label className="admin-checkbox" key={location.id}>
          <input
            checked={value.includes(location.id)}
            onChange={() => toggle(location.id)}
            type="checkbox"
          />
          {location.name}
        </label>
      ))}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Maintenance / load governor
// ---------------------------------------------------------------------------

function MaintenanceDialog({ onClose }: { onClose: () => void }) {
  const { me } = useAdminAuth();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const status = useQuery({
    queryKey: ['admin', 'maintenance'],
    queryFn: api.fetchMaintenance,
    refetchInterval: 4_000,
  });

  const setLevel = useMutation({
    mutationFn: (level: LoadLevel | null) =>
      api.setMaintenance(level, reason || undefined, me.csrfToken),
    onSuccess: (next) => queryClient.setQueryData(['admin', 'maintenance'], next),
  });

  const s = status.data;
  return (
    <AdminModal onClose={onClose} title="Load & maintenance">
      {s ? (
        <div className="admin-form">
          <p className="admin-help">
            Effective level <strong>{s.level}</strong> (auto {s.autoLevel}
            {s.manualLevel ? `, manual ${s.manualLevel}` : ''}). A manual level can only raise the
            floor — it never masks a real overload. Writes are shed at <em>shed</em> and{' '}
            <em>maintenance</em>; reads always serve.
          </p>
          <div className="admin-signals">
            <span>req/s {s.signals.requestsPerSecond}</span>
            <span>enq/s {s.signals.enqueuesPerSecond}</span>
            <span>SSE {s.signals.openStreams}</span>
            <span>RSS {s.signals.rssMb} MB</span>
            <span>loop {s.signals.eventLoopLagMs} ms</span>
          </div>
          <label className="admin-field">
            <span>Reason (shown in logs / console)</span>
            <input onChange={(event) => setReason(event.target.value)} value={reason} />
          </label>
          <div className="admin-form-actions">
            <button
              className="danger-button"
              disabled={setLevel.isPending}
              onClick={() => setLevel.mutate('maintenance')}
              type="button"
            >
              Enter maintenance
            </button>
            <button
              className="secondary-button"
              disabled={setLevel.isPending}
              onClick={() => setLevel.mutate('shed')}
              type="button"
            >
              Force shed
            </button>
            <button
              className="primary-button"
              disabled={setLevel.isPending}
              onClick={() => setLevel.mutate(null)}
              type="button"
            >
              Clear override
            </button>
          </div>
          {setLevel.isError ? <p className="admin-error">{errorMessage(setLevel.error)}</p> : null}
        </div>
      ) : (
        <AdminSplash inline label="Loading load status" />
      )}
    </AdminModal>
  );
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

function AdminModal({
  children,
  onClose,
  title,
}: {
  children: ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="admin-modal-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label={title}
        aria-modal="true"
        className="admin-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header className="admin-modal-head">
          <h2>{title}</h2>
          <button
            aria-label="Close"
            className="secondary-button compact"
            onClick={onClose}
            type="button"
          >
            ✕
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function AdminSplash({
  children,
  inline,
  label,
}: {
  children?: ReactNode;
  inline?: boolean;
  label: string;
}) {
  return (
    <div className={inline ? 'admin-splash inline' : 'admin-splash'}>
      <span className="loading-indicator" />
      <p>{label}</p>
      {children}
    </div>
  );
}

function Forbidden() {
  return (
    <main className="admin-main">
      <div className="admin-splash">
        <AlertTriangle aria-hidden="true" />
        <p>You do not have access to this section.</p>
        <Link className="secondary-button" to="/admin/locations">
          Back to locations
        </Link>
      </div>
    </main>
  );
}
