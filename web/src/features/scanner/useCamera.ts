import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

export type CameraState = 'idle' | 'starting' | 'running' | 'denied' | 'unavailable' | 'error';

const HINTS = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]]]);

const MESSAGES: Record<Exclude<CameraState, 'idle' | 'starting' | 'running'>, string> = {
  denied:
    'Camera access was blocked. Allow the camera in your browser’s site settings, or use manual entry below.',
  unavailable:
    'No camera was found on this device. Use manual entry to type the ticket code instead.',
  error: 'The camera could not be started. Another app may be using it. Manual entry still works.'
};

/**
 * Wraps the ZXing reader. The decode callback fires many times a second while
 * a code is in frame, so debouncing is the caller's job (see useGate).
 */
export function useCamera(onDecode: (text: string) => void) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const onDecodeRef = useRef(onDecode);
  const [state, setState] = useState<CameraState>('idle');

  onDecodeRef.current = onDecode;

  const stop = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setState('idle');
  }, []);

  const start = useCallback(async () => {
    if (controlsRef.current || !videoRef.current) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unavailable');
      return;
    }

    setState('starting');
    try {
      const reader = new BrowserMultiFormatReader(HINTS, { delayBetweenScanAttempts: 180 });
      controlsRef.current = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current,
        (result) => {
          if (result) onDecodeRef.current(result.getText());
        }
      );
      setState('running');
    } catch (err) {
      controlsRef.current = null;
      const name = (err as Error)?.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') setState('denied');
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') setState('unavailable');
      else setState('error');
    }
  }, []);

  // Release the camera when the operator leaves the screen.
  useEffect(() => () => controlsRef.current?.stop(), []);

  const message = state === 'idle' || state === 'starting' || state === 'running' ? null : MESSAGES[state];

  return { videoRef, state, message, start, stop };
}
