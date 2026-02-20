import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server';
import { env } from '../config/env';

const rpID = new URL(env.APP_URL).hostname;

export async function createRegistrationOptions(params: {
  userId: number;
  email: string;
  existingCredentialIds: string[];
}): Promise<any> {
  return generateRegistrationOptions({
    rpName: 'SteamGuard Web',
    rpID,
    userID: new TextEncoder().encode(String(params.userId)),
    userName: params.email,
    timeout: 60000,
    attestationType: 'none',
    excludeCredentials: params.existingCredentialIds.map((id) => ({
      id
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred'
    }
  });
}

export async function verifyRegistration(params: {
  response: any;
  expectedChallenge: string;
}): Promise<any> {
  return verifyRegistrationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: env.APP_URL,
    expectedRPID: rpID
  });
}

export async function createAuthenticationOptions(credentialIds: string[]): Promise<any> {
  return generateAuthenticationOptions({
    rpID,
    timeout: 60000,
    userVerification: 'preferred',
    allowCredentials: credentialIds.map((id) => ({
      id
    }))
  });
}

export async function verifyAuthentication(params: {
  response: any;
  expectedChallenge: string;
  credential: any;
}): Promise<any> {
  return verifyAuthenticationResponse({
    response: params.response,
    expectedChallenge: params.expectedChallenge,
    expectedOrigin: env.APP_URL,
    expectedRPID: rpID,
    credential: params.credential
  });
}
