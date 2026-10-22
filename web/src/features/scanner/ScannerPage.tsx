import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Camera, CameraOff, CheckCircle2, CloudOff, Keyboard, Loader2, RefreshCw,
  ShieldX, Clock, Play, Square, Download, ScanFace, ThumbsUp, ThumbsDown
} from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import type { EventStats, GateEvent } from '../../lib/types';
import { useOnline } from '../../hooks/useOnline';
import { useToast } from '../../hooks/useToast';
import { PageLoader } from '../../components/PageLoader';
import { useCamera } from './useCamera';
import { useGate, type GateResult } from './useGate';
import { fmtTime } from '../../lib/format';

const VERDICT_ICON = { admit: CheckCircle2, reject: ShieldX, pending: Clock, review: ScanFace };

export function ScannerPage() {
  const { eventId = '' } = useParams();
  const navigate = useNavigate();
  const online = useOnline();
  const toast = useToast();
  const queryClient = useQueryClient();
  const manualRef = useRef<HTMLInputElement>(null);
  const [manualCode, setManualCode] = useState('');
  const [gate, setGate] = useState('');
  const [stats, setStats] = useState<EventStats | undefined>();

  const { data, isLoading, error } = useQuery({
    queryKey: ['event', eventId],
    queryFn: () => api.get<{ event: GateEvent }>(`/events/${eventId}`),
    refetchInterval: online ? 15000 : false,
    retry: false
  });

  const event = data?.event;

  const handleStats = useCallback(
    (next: EventStats) => {
      setStats(next);
      queryClient.invalidateQueries({ queryKey: ['events'] });
    },
    [queryClient]
  );

  const {
    result, history, queued, manifest, syncing, busy, stalled,
    submit, confirmFace, rejectFace, sync, refreshManifest
  } = useGate({
    eventId,
    gate,
    online,
    onStats: handleStats
  });

  const camera = useCamera((text) => submit(text, 'camera'));

  // With no network the event record is unreachable, but the cached manifest
  // carries everything the gate actually needs: the name and the gate list.
  const eventName = event?.name ?? manifest?.eventName ?? 'Event';
  const gates = event?.gates ?? manifest?.gates ?? ['Main Gate'];

  useEffect(() => {
    if (event?.stats) setStats((current) => current ?? event.stats);
  }, [event]);

  useEffect(() => {
    if (!gate && gates.length) setGate(gates[0]);
  }, [gate, gates]);

  const prepare = useMutation({
    mutationFn: refreshManifest,
    onSuccess: (fresh) =>
      toast.push('ok', `Cached ${fresh.count} tickets — this gate can now work offline.`),
    onError: () => toast.push('error', 'Could not download the offline ticket list.')
  });

  const manualSubmit = (submitEvent: React.FormEvent) => {
    submitEvent.preventDefault();
    const code = manualCode.trim();
    if (!code) return;
    submit(code, 'manual');
    setManualCode('');
    manualRef.current?.focus();
  };

  // Only block when the refusal is definitive and there is no cached event to
  // fall back on. A gate that lost wifi keeps scanning.
  const unreachable = error instanceof ApiError && (error.offline || error.status >= 500);
  const blocked = !event && (!unreachable || !manifest);

  if (isLoading && !manifest) return <PageLoader label="Opening the gate" />;
  if (blocked) {
    return (
      <div className="shell page" style={{ maxWidth: 560 }}>
        <h1>{unreachable ? 'Cannot reach the server' : 'Event not available'}</h1>
        <p className="muted" style={{ marginBlock: 'var(--s3) var(--s5)' }}>
          {unreachable
            ? 'This device has no cached ticket list for the event either, so it cannot judge tickets on its own. Reconnect and try again — next time, tap “Prepare for offline” before doors open.'
            : 'You may not have access to this event, or it no longer exists.'}
        </p>
        <div className="row" style={{ gap: 'var(--s2)' }}>
          <button className="btn btn--primary" onClick={() => window.location.reload()}>
            Try again
          </button>
          <button className="btn" onClick={() => navigate('/app/scan')}>
            Pick another event
          </button>
        </div>
      </div>
    );
  }

  const Icon = result ? VERDICT_ICON[result.verdict] : null;

  return (
    <div className="scanner">
      {/* Bar and verdict stick together, so the last result stays on screen
          whatever the operator has scrolled to and whatever the bar wraps to. */}
      <div className="scanner__head">
      <div className="scanner__bar">
        <div className="scanner__event grow">
          <span className="stamp stamp--on-carbon">Gate scanner</span>
          <b className="truncate">{eventName}</b>
        </div>

        <label className="sr-only" htmlFor="gate-select">
          Gate
        </label>
        <select
          id="gate-select"
          className="scanner__gate"
          value={gate}
          onChange={(gateEvent) => setGate(gateEvent.target.value)}
        >
          {gates.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <div className="scanner__status">
          <span className={`chip ${online ? 'chip--live' : 'chip--wait'}`}>
            {online ? <span className="dot" aria-hidden /> : <CloudOff size={11} aria-hidden />}
            {online ? 'Online' : 'Offline'}
          </span>
          {stalled && (
            <span className="chip chip--reject" title="Automatic retries stopped">
              Sync stalled
            </span>
          )}
          {queued.length > 0 && (
            <span className="chip chip--wait">
              {syncing ? <Loader2 size={11} className="spin" aria-hidden /> : <Clock size={11} aria-hidden />}
              {syncing ? 'Syncing' : `${queued.length} queued`}
            </span>
          )}
          {manifest && (
            <span className="chip chip--quiet" title={`Cached ${manifest.count} tickets`}>
              Offline ready
            </span>
          )}
        </div>
      </div>

      {/* The verdict band. Colour, word and icon all say the same thing, so it
          survives both sunlight and colour blindness. */}
      <div
        className={`verdict verdict--${result ? result.verdict : 'idle'} ${result ? 'verdict--flash' : ''}`}
        key={result?.id ?? 'idle'}
        role="status"
        aria-live="assertive"
      >
        {result && Icon ? (
          <>
            <Icon size={48} strokeWidth={1.75} className="verdict__icon" aria-hidden />
            <div style={{ minWidth: 0 }}>
              <div className="verdict__word">{result.word}</div>
              {result.name && <div className="verdict__name">{result.name}</div>}
              <div className="verdict__why">{result.why}</div>
            </div>
          </>
        ) : (
          <div>
            <div className="stamp stamp--on-carbon">Ready</div>
            <p style={{ marginTop: 'var(--s2)', fontSize: 'var(--text-sm)' }}>
              Start the camera and hold a ticket QR inside the frame.
            </p>
          </div>
        )}
      </div>
      {result?.verdict === 'review' && result.photo && (
        <div className="face-review">
          <img src={result.photo} alt={`Registration photo for ${result.name ?? 'this attendee'}`} />
          <div className="face-review__ask">
            <span className="stamp stamp--on-carbon">Does the person in front of you match?</span>
            <div className="face-review__buttons">
              <button
                type="button"
                className="btn btn--primary btn--lg"
                onClick={() => confirmFace()}
                disabled={busy}
              >
                <ThumbsUp size={17} aria-hidden /> Match — admit
              </button>
              <button
                type="button"
                className="btn btn--lg btn--danger"
                onClick={() => rejectFace()}
                disabled={busy}
              >
                <ThumbsDown size={17} aria-hidden /> Not them
              </button>
            </div>
            <p className="face-review__note">
              The ticket is not used up until you choose. “Not them” leaves it valid and sends
              them to the desk.
            </p>
          </div>
        </div>
      )}

      </div>

      <div className="viewfinder">
        <video ref={camera.videoRef} muted playsInline aria-label="Camera preview" />
        {camera.state === 'running' && (
          <>
            <div className="viewfinder__reticle" aria-hidden>
              <svg viewBox="0 0 100 100" fill="none">
                <path
                  d="M4 26V4h22M74 4h22v22M96 74v22H74M26 96H4V74"
                  stroke="currentColor"
                  strokeWidth="3"
                />
              </svg>
            </div>
            {busy && (
              <span className="viewfinder__busy">
                <Loader2 size={11} className="spin" aria-hidden /> Checking
              </span>
            )}
          </>
        )}
        {camera.state !== 'running' && (
          <div className="viewfinder__placeholder">
            {camera.state === 'starting' ? (
              <>
                <Loader2 size={24} className="spin" aria-hidden />
                <p>Starting the camera…</p>
              </>
            ) : camera.message ? (
              <>
                <CameraOff size={24} strokeWidth={1.5} aria-hidden />
                <p>{camera.message}</p>
              </>
            ) : (
              <>
                <Camera size={24} strokeWidth={1.5} aria-hidden />
                <p>
                  The camera is off. Start it to scan tickets, or type a code in manual entry
                  below.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <div className="scanner__controls">
        {camera.state === 'running' ? (
          <button type="button" className="btn" onClick={camera.stop}>
            <Square size={15} aria-hidden /> Stop camera
          </button>
        ) : (
          <button
            type="button"
            className="btn btn--primary"
            onClick={camera.start}
            disabled={camera.state === 'starting'}
          >
            <Play size={15} aria-hidden />
            {camera.state === 'idle' ? 'Start camera' : 'Try the camera again'}
          </button>
        )}

        <button
          type="button"
          className="btn"
          onClick={() => prepare.mutate()}
          disabled={prepare.isPending || !online}
        >
          {prepare.isPending ? (
            <Loader2 size={15} className="spin" aria-hidden />
          ) : (
            <Download size={15} aria-hidden />
          )}
          {manifest ? 'Refresh offline list' : 'Prepare for offline'}
        </button>

        {queued.length > 0 && (
          <button
            type="button"
            className="btn"
            onClick={() =>
              sync()
                .then((summary) =>
                  toast.push(
                    summary.conflicts ? 'error' : 'ok',
                    summary.conflicts
                      ? `Synced ${summary.synced} scans — ${summary.conflicts} were already checked in elsewhere.`
                      : `Synced ${summary.synced} queued scans.`
                  )
                )
                .catch(() => toast.push('error', 'Sync failed. The queue is still on this device.'))
            }
            disabled={!online || syncing}
          >
            <RefreshCw size={15} className={syncing ? 'spin' : undefined} aria-hidden />
            Sync {queued.length} now
          </button>
        )}
      </div>

      <form className="manual" onSubmit={manualSubmit}>
        <div className="field">
          <label htmlFor="manual-code">
            <Keyboard size={11} aria-hidden style={{ display: 'inline', marginRight: 4 }} />
            Manual ticket code
          </label>
          <input
            id="manual-code"
            ref={manualRef}
            className="input"
            value={manualCode}
            onChange={(changeEvent) => setManualCode(changeEvent.target.value)}
            placeholder="Paste or type the code from the ticket"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            inputMode="text"
          />
        </div>
        <button type="submit" className="btn btn--primary" disabled={!manualCode.trim() || busy}>
          Check in
        </button>
      </form>

      <div className="scanner__count">
        <div>
          <span className="stamp">Checked in</span>
          <b>{stats?.checkedIn ?? '—'}</b>
        </div>
        <div>
          <span className="stamp">Registered</span>
          <b>{stats?.registered ?? '—'}</b>
        </div>
        <div>
          <span className="stamp">Remaining</span>
          <b>{stats?.remaining ?? '—'}</b>
        </div>
      </div>

      <div className="scanner__recent">
        <span className="stamp stamp--on-carbon">Recent scans at this gate</span>
        {history.length === 0 ? (
          <p style={{ marginTop: 'var(--s3)', color: 'var(--on-carbon-2)', fontSize: 'var(--text-sm)' }}>
            Nothing scanned yet on this device.
          </p>
        ) : (
          <div className="feed" style={{ marginTop: 'var(--s3)' }}>
            {history.map((entry) => (
              <ScanRow key={entry.id} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ScanRow({ entry }: { entry: GateResult }) {
  const chip =
    entry.verdict === 'admit' ? 'chip--ok' : entry.verdict === 'pending' ? 'chip--wait' : 'chip--reject';
  return (
    <div className="feed__row">
      <span className="feed__time">{fmtTime(entry.at)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="feed__who truncate">{entry.name ?? entry.why}</div>
        {entry.name && <div className="feed__why truncate">{entry.why}</div>}
      </div>
      <span className={`chip ${chip}`}>{entry.word}</span>
    </div>
  );
}
