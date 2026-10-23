import { useRef } from 'react';
import { QRCodeCanvas, QRCodeSVG } from 'qrcode.react';
import { Download, Printer } from 'lucide-react';

/** Renders the signed payload. The canvas copy exists only for download. */
export function QrTicket({
  payload,
  code,
  fileName,
  staticPayload,
  size = 208
}: {
  payload: string;
  code: string;
  fileName: string;
  /** The durable code. A downloaded or printed rotating code would be dead
   *  within 30 seconds, so the file always carries this one. */
  staticPayload?: string;
  size?: number;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);

  function download() {
    const canvas = canvasRef.current?.querySelector('canvas');
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = `${fileName}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  }

  return (
    <>
      <div className="pass__qr">
        <QRCodeSVG value={payload} size={size} level="M" marginSize={0} title="Entry QR code" />
        <span className="stamp">Ticket {code.slice(0, 6)}…</span>
      </div>
      <div ref={canvasRef} style={{ display: 'none' }} aria-hidden>
        <QRCodeCanvas value={staticPayload ?? payload} size={760} level="M" marginSize={2} />
      </div>
      <div className="pass__actions print-hide">
        <button type="button" className="btn" onClick={download}>
          <Download size={15} aria-hidden /> Download
        </button>
        <button type="button" className="btn" onClick={() => window.print()}>
          <Printer size={15} aria-hidden /> Print
        </button>
      </div>
    </>
  );
}
