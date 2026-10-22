import { useRef, useState } from 'react';
import { Camera, X, AlertCircle } from 'lucide-react';
import { toSmallJpeg } from '../lib/photo';

/**
 * Optional reference photo for gate verification. Consent is explicit and the
 * photo is only taken once the attendee ticks the box.
 */
export function PhotoField({
  value,
  onChange
}: {
  value: string | null;
  onChange: (photo: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [consented, setConsented] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      onChange(await toSmallJpeg(file));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="field">
      <span className="field-label">Entry photo (optional)</span>

      <label className="row photo-consent">
        <input
          type="checkbox"
          checked={consented}
          onChange={(event) => {
            setConsented(event.target.checked);
            if (!event.target.checked) onChange(null);
          }}
        />
        <span>
          Add a photo so the gate can check it is me
          <span className="field-hint" style={{ display: 'block' }}>
            Shown only to the gate operator when your ticket is scanned, and deleted with the
            event. Skip it and you will still be let in with your QR.
          </span>
        </span>
      </label>

      {consented && (
        <div className="photo-pick">
          {value ? (
            <>
              <img src={value} alt="Your entry photo" className="photo-preview" />
              <div className="stack" style={{ gap: 'var(--s2)' }}>
                <button type="button" className="btn btn--sm" onClick={() => inputRef.current?.click()}>
                  Retake
                </button>
                <button
                  type="button"
                  className="btn btn--sm btn--ghost"
                  onClick={() => onChange(null)}
                >
                  <X size={14} aria-hidden /> Remove
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Camera size={15} aria-hidden /> {busy ? 'Processing…' : 'Take photo'}
            </button>
          )}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="user"
            className="sr-only"
            onChange={handleFile}
          />
        </div>
      )}

      {error && (
        <span className="field-error">
          <AlertCircle size={13} aria-hidden /> {error}
        </span>
      )}
    </div>
  );
}
