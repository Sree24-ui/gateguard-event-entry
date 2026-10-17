import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/** Native <dialog>, so focus trapping and Escape come from the platform. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  danger = false,
  busy = false,
  onConfirm,
  onCancel
}: {
  open: boolean;
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog className="dialog" ref={ref} onCancel={onCancel} onClose={onCancel}>
      <div className="dialog__head">
        <h2>{title}</h2>
        <button type="button" className="btn btn--ghost btn--sm btn--icon" onClick={onCancel} aria-label="Close">
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="dialog__body">{body}</div>
      <div className="dialog__foot">
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className={danger ? 'btn btn--danger' : 'btn btn--primary'}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? 'Working…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
