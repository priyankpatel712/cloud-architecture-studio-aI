import 'server-only';
import {
  SSOOIDCClient,
  RegisterClientCommand,
  StartDeviceAuthorizationCommand,
  CreateTokenCommand,
  AuthorizationPendingException,
  SlowDownException,
  ExpiredTokenException,
} from '@aws-sdk/client-sso-oidc';
import { SSOClient, ListAccountsCommand, ListAccountRolesCommand } from '@aws-sdk/client-sso';

/**
 * AWS IAM Identity Center (SSO) device-authorization flow (research R4, FR-011/012).
 * Only the TEMPORARY session leaves this module — the caller encrypts it at rest
 * (Constitution III); long-term credentials are never requested or stored.
 *
 * Env: AWS_SSO_START_URL (the org's Identity Center start URL) + AWS_SSO_REGION.
 */

export class SsoNotConfiguredError extends Error {
  constructor() {
    super('AWS SSO is not configured (set AWS_SSO_START_URL and AWS_SSO_REGION).');
  }
}
/** the user has not finished approving the device yet — poll again */
export class SsoPendingError extends Error {
  constructor(public slowDown = false) {
    super('Authorization pending');
  }
}
/** the device code expired before the user approved — restart the flow */
export class SsoExpiredError extends Error {
  constructor() {
    super('The sign-in request expired. Start the connection again.');
  }
}

function ssoRegion(): string {
  return process.env.AWS_SSO_REGION || 'us-east-1';
}
function startUrl(): string {
  const url = process.env.AWS_SSO_START_URL;
  if (!url) throw new SsoNotConfiguredError();
  return url;
}

export interface DeviceAuthorization {
  clientId: string;
  clientSecret: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** seconds until the device code expires */
  expiresIn: number;
  /** recommended polling interval, seconds */
  interval: number;
}

export async function startDeviceAuthorization(): Promise<DeviceAuthorization> {
  const url = startUrl();
  const oidc = new SSOOIDCClient({ region: ssoRegion() });
  const client = await oidc.send(
    new RegisterClientCommand({ clientName: 'cloud-architecture-studio', clientType: 'public' })
  );
  const device = await oidc.send(
    new StartDeviceAuthorizationCommand({
      clientId: client.clientId!,
      clientSecret: client.clientSecret!,
      startUrl: url,
    })
  );
  return {
    clientId: client.clientId!,
    clientSecret: client.clientSecret!,
    deviceCode: device.deviceCode!,
    userCode: device.userCode!,
    verificationUri: device.verificationUri!,
    verificationUriComplete: device.verificationUriComplete!,
    expiresIn: device.expiresIn ?? 600,
    interval: device.interval ?? 5,
  };
}

export interface SsoSession {
  accessToken: string;
  expiresAt: string; // ISO
}

/** Exchange the device code once; throws SsoPendingError until the user approves. */
export async function pollDeviceToken(auth: {
  clientId: string;
  clientSecret: string;
  deviceCode: string;
}): Promise<SsoSession> {
  const oidc = new SSOOIDCClient({ region: ssoRegion() });
  try {
    const token = await oidc.send(
      new CreateTokenCommand({
        clientId: auth.clientId,
        clientSecret: auth.clientSecret,
        grantType: 'urn:ietf:params:oauth:grant-type:device_code',
        deviceCode: auth.deviceCode,
      })
    );
    const expiresAt = new Date(Date.now() + (token.expiresIn ?? 3600) * 1000).toISOString();
    return { accessToken: token.accessToken!, expiresAt };
  } catch (e) {
    if (e instanceof AuthorizationPendingException) throw new SsoPendingError();
    if (e instanceof SlowDownException) throw new SsoPendingError(true);
    if (e instanceof ExpiredTokenException) throw new SsoExpiredError();
    throw e;
  }
}

export interface SsoAccountInfo {
  accountId: string;
  alias: string;
  permissionSet: string;
}

/** Describe the first accessible account + role for display (FR-012 fields). */
export async function describeSsoAccount(accessToken: string): Promise<SsoAccountInfo> {
  const sso = new SSOClient({ region: ssoRegion() });
  const accounts = await sso.send(new ListAccountsCommand({ accessToken, maxResults: 1 }));
  const account = accounts.accountList?.[0];
  if (!account?.accountId) throw new Error('No AWS accounts are accessible from this SSO session.');
  let permissionSet = '';
  try {
    const roles = await sso.send(
      new ListAccountRolesCommand({ accessToken, accountId: account.accountId, maxResults: 1 })
    );
    permissionSet = roles.roleList?.[0]?.roleName ?? '';
  } catch {
    /* role listing is display-only */
  }
  return {
    accountId: account.accountId,
    alias: account.accountName ?? account.emailAddress ?? account.accountId,
    permissionSet,
  };
}
