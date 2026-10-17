import { Link } from 'react-router-dom';
import { Wordmark } from '../components/Brand';

export function NotFoundPage() {
  return (
    <div className="shell page" style={{ maxWidth: 560, paddingBlock: 'var(--s9)' }}>
      <Wordmark size={22} />
      <p className="stamp" style={{ marginTop: 'var(--s7)' }}>
        404
      </p>
      <h1 style={{ marginBlock: 'var(--s2) var(--s3)' }}>That page does not exist</h1>
      <p className="muted" style={{ marginBottom: 'var(--s5)' }}>
        The link may be out of date. Everything starts from the events list.
      </p>
      <Link to="/app" className="btn btn--primary">
        Go to my events
      </Link>
    </div>
  );
}
