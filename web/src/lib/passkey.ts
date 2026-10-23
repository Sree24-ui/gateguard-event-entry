import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { api } from './api';

/**
 * Passkeys. The device checks the face, fingerprint or screen lock itself and
 * returns a signature; no biometric data is sent here or stored anywhere.
 */
export const passkeysSupported = () =>
  typeof window !== 'undefined' && !!window.PublicKeyCredential;

/** True when this device can do the check itself, rather than via a key fob. */
export async function hasDeviceAuthenticator() {
  if (!passkeysSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function enrolPasskey() {
  const options = await api.post<PublicKeyCredentialCreationOptionsJSON>(
    '/attendee/passkey/register/options'
  );
  const attestation = await startRegistration({ optionsJSON: options });
  return api.post('/attendee/passkey/register/verify', attestation as unknown as Record<string, unknown>);
}

export async function unlockWithPasskey(email: string) {
  const options = await api.post<PublicKeyCredentialRequestOptionsJSON>(
    '/attendee/passkey/login/options',
    { email }
  );
  const assertion = await startAuthentication({ optionsJSON: options });
  return api.post('/attendee/passkey/login/verify', assertion as unknown as Record<string, unknown>);
}

type PublicKeyCredentialCreationOptionsJSON = Parameters<
  typeof startRegistration
>[0]['optionsJSON'];
type PublicKeyCredentialRequestOptionsJSON = Parameters<
  typeof startAuthentication
>[0]['optionsJSON'];
