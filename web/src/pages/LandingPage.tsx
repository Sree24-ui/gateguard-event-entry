import { Link } from 'react-router-dom';
import {
  ScanLine, ShieldX, CheckCircle2, Clock, QrCode, Gauge, CloudOff, ArrowRight, Github
} from 'lucide-react';
import { Wordmark, Mark } from '../components/Brand';

const OUTCOMES = [
  { word: 'Admit', why: 'Signature valid, ticket unused, right event.', tone: 'ok' },
  { word: 'Already in', why: 'Used at 19:04 via Main Gate. The screenshot was shared.', tone: 'reject' },
  { word: 'Forged', why: 'Decodes fine, but GateGuard never signed it.', tone: 'reject' },
  { word: 'Wrong event', why: 'A real ticket — for a different event.', tone: 'reject' },
  { word: 'Unknown', why: 'No such ticket in this event.', tone: 'reject' },
  { word: 'Queued', why: 'No network. Recorded here, verified on sync.', tone: 'wait' }
];

export function LandingPage() {
  return (
    <div className="landing">
      <header className="landing__nav band band--carbon">
        <div className="shell landing__nav-inner">
          <Wordmark size={20} />
          <nav className="row" style={{ gap: 'var(--s2)' }} aria-label="Main">
            <a className="landing__navlink" href="#how">
              How it works
            </a>
            <a className="landing__navlink" href="#refusals">
              Refusals
            </a>
            <a className="landing__navlink" href="#offline">
              Offline
            </a>
            <Link to="/signin" className="landing__navlink">
              Sign in
            </Link>
            <Link to="/signup" className="btn btn--primary btn--sm">
              Start free
            </Link>
          </nav>
        </div>
      </header>

      {/* --- Hero: carbon band, the product's own verdict strip as the image -- */}
      <section className="band band--carbon landing__hero">
        <div className="shell landing__hero-inner">
          <div>
            <span className="stamp stamp--on-carbon">Event entry · built for college clubs</span>
            <h1 className="landing__title">
              The queue moves. The list doesn’t lie.
            </h1>
            <p className="landing__lede">
              GateGuard issues one signed QR ticket per attendee, checks them in from a phone at
              the gate, and keeps a headcount the whole committee can watch — including when the
              campus wifi gives up.
            </p>
            <div className="row row--wrap" style={{ gap: 'var(--s3)', marginTop: 'var(--s6)' }}>
              <Link to="/signup" className="btn btn--primary btn--lg">
                Set up an event <ArrowRight size={16} aria-hidden />
              </Link>
              <Link to="/signin" className="btn btn--lg landing__ghost">
                Try the demo account
              </Link>
            </div>
            <p className="landing__fineprint">
              Demo organizer <code>demo@gateguard.app</code> · password <code>gateguard-demo</code>
            </p>
          </div>

          {/* Real interface, not a mockup: the same markup the scanner renders. */}
          <div className="landing__device" aria-label="The gate scanner showing a successful check-in">
            <div className="landing__device-bar">
              <span className="stamp stamp--on-carbon">TechFest 2026 · Main Gate</span>
              <span className="chip chip--live">
                <span className="dot" aria-hidden /> live
              </span>
            </div>
            <div className="verdict verdict--admit">
              <CheckCircle2 size={44} strokeWidth={1.75} aria-hidden />
              <div>
                <div className="verdict__word">Admit</div>
                <div className="verdict__name">Ananya Iyer</div>
                <div className="verdict__why">Checked in · Main Gate</div>
              </div>
            </div>
            <div className="scanner__count">
              <div>
                <span className="stamp">Checked in</span>
                <b>51</b>
              </div>
              <div>
                <span className="stamp">Registered</span>
                <b>84</b>
              </div>
              <div>
                <span className="stamp">Remaining</span>
                <b>33</b>
              </div>
            </div>
            <div className="landing__device-foot">
              <ScanLine size={14} aria-hidden /> Scanning — hold the next ticket in frame
            </div>
          </div>
        </div>
      </section>

      {/* --- The problem, as a ledger ---------------------------------------- */}
      <section className="band">
        <div className="shell landing__ledger">
          <h2 className="landing__h2">What goes wrong at a college gate</h2>
          <div className="landing__ledger-grid">
            <div>
              <span className="stamp">01 — The list</span>
              <p>
                A printed sheet and three volunteers reading names. The queue stops every time
                someone’s name is spelled differently.
              </p>
            </div>
            <div>
              <span className="stamp">02 — The screenshot</span>
              <p>
                One pass gets photographed and forwarded to six friends. Nothing on a paper list
                can tell you it has already walked in.
              </p>
            </div>
            <div>
              <span className="stamp">03 — The headcount</span>
              <p>
                Someone asks how many are inside. The honest answer is a guess, and the fire
                marshal is not interested in guesses.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* --- How it works ------------------------------------------------------ */}
      <section className="band" id="how">
        <div className="shell" style={{ paddingBlock: 'var(--s8)' }}>
          <h2 className="landing__h2">Four moves, start to finish</h2>
          <div className="landing__steps">
            <Step
              n="01"
              icon={QrCode}
              title="Issue"
              body="Add your attendee list, or share a registration link. Every valid registration gets a ticket code from a cryptographic random source and a QR signed by the server. The QR carries no name, email or phone."
            />
            <Step
              n="02"
              icon={ScanLine}
              title="Scan"
              body="Operators open the scanner on their own phone, pick their gate, and point the camera. The same code in frame will not fire twice, and there is a manual code field for the ticket that will not focus."
            />
            <Step
              n="03"
              icon={Gauge}
              title="Count"
              body="Registered, checked in, remaining and attendance percentage, read straight from the database. Two operators scanning the same ticket at once cannot both succeed — the check-in is a single conditional update."
            />
            <Step
              n="04"
              icon={ShieldX}
              title="Refuse"
              body="Every rejection names its reason and, for a duplicate, says when and where the ticket was already used. The operator never has to interpret a red box."
            />
          </div>
        </div>
      </section>

      {/* --- Refusal table: the differentiator -------------------------------- */}
      <section className="band" id="refusals">
        <div className="shell" style={{ paddingBlock: 'var(--s8)' }}>
          <h2 className="landing__h2">Six things a scan can mean</h2>
          <p className="landing__sub">
            A gate is no place for ambiguity. Every outcome has its own word, its own icon and its
            own explanation — colour is never the only signal.
          </p>
          <div className="landing__outcomes">
            {OUTCOMES.map((row) => (
              <div className="landing__outcome" key={row.word}>
                <span className={`chip chip--${row.tone}`}>
                  {row.tone === 'ok' ? (
                    <CheckCircle2 size={11} aria-hidden />
                  ) : row.tone === 'wait' ? (
                    <Clock size={11} aria-hidden />
                  ) : (
                    <ShieldX size={11} aria-hidden />
                  )}
                  {row.word}
                </span>
                <p>{row.why}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* --- Offline, told honestly -------------------------------------------- */}
      <section className="band band--carbon" id="offline">
        <div className="shell landing__offline">
          <div>
            <CloudOff size={28} strokeWidth={1.5} aria-hidden style={{ color: 'var(--volt)' }} />
            <h2 className="landing__h2" style={{ color: 'var(--on-carbon)', marginTop: 'var(--s4)' }}>
              Honest about the wifi
            </h2>
            <p className="landing__offline-body">
              Before doors open, each device caches a hashed list of this event’s valid ticket
              codes — no attendee data, and never the signing key. When the network drops, the
              scanner still recognises a real ticket and queues it in IndexedDB.
            </p>
            <p className="landing__offline-body">
              Those scans are labelled <b>queued</b>, not checked in. Two disconnected gates cannot
              agree with each other, so GateGuard does not pretend they can. On reconnect the queue
              replays against the server, exactly one check-in survives per ticket, and any gate
              that admitted a duplicate is flagged for the organizer to review.
            </p>
          </div>
          <div className="landing__offline-panel">
            <div className="verdict verdict--pending" style={{ minHeight: 0 }}>
              <Clock size={36} strokeWidth={1.75} aria-hidden />
              <div>
                <div className="verdict__word" style={{ fontSize: '1.75rem' }}>
                  Queued
                </div>
                <div className="verdict__why">Valid on this device — awaiting server verification</div>
              </div>
            </div>
            <div className="landing__offline-row">
              <span className="chip chip--wait">
                <Clock size={11} aria-hidden /> 7 queued
              </span>
              <span className="chip chip--quiet">Offline ready · 84 cached</span>
            </div>
          </div>
        </div>
      </section>

      {/* --- Close -------------------------------------------------------------- */}
      <section className="band landing__close">
        <div className="shell" style={{ textAlign: 'center', paddingBlock: 'var(--s9)' }}>
          <Mark size={32} />
          <h2 className="landing__h2" style={{ marginBlock: 'var(--s4) var(--s3)' }}>
            Your next event, counted properly
          </h2>
          <p className="landing__sub" style={{ marginInline: 'auto' }}>
            Free to set up, runs on the phones your committee already carries.
          </p>
          <Link to="/signup" className="btn btn--primary btn--lg" style={{ marginTop: 'var(--s5)' }}>
            Create an organizer account <ArrowRight size={16} aria-hidden />
          </Link>
        </div>
      </section>

      <footer className="band band--carbon landing__footer">
        <div className="shell landing__footer-inner">
          <div>
            <Wordmark size={18} />
            <p className="landing__footer-note">
              QR ticketing, gate scanning and live attendance for college events.
            </p>
          </div>
          <nav className="landing__footer-links" aria-label="Footer">
            <Link to="/signin">Sign in</Link>
            <Link to="/signup">Create account</Link>
            <a href="#how">How it works</a>
            <a
              href="https://github.com/Sree24-ui/gateguard-event-entry"
              target="_blank"
              rel="noreferrer"
            >
              <Github size={13} aria-hidden /> Source
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}

function Step({
  n,
  icon: Icon,
  title,
  body
}: {
  n: string;
  icon: typeof ScanLine;
  title: string;
  body: string;
}) {
  return (
    <div className="landing__step">
      <span className="stamp">{n}</span>
      <Icon size={22} strokeWidth={1.5} aria-hidden />
      <h3>{title}</h3>
      <p>{body}</p>
    </div>
  );
}
