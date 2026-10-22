import { MediaBrowserBrand } from "../brand";
import { mediaBrowserAuthHeaders } from "../clientHeader";
import { customHeaderForRequest } from '@/providers/http/customHeader';
import type { BasicAuth, CustomHeader } from '@/providers/contracts/Server';
import { serverFetch } from '@/features/mtls/serverFetch';

type ConnectResult =
  | { success: true; token: string; userId: string }
  | { success: false; message?: string };

export async function connect(
  brand: MediaBrowserBrand,
  serverUrl: string,
  username: string,
  password: string,
  basicAuth?: BasicAuth,
  customHeader?: CustomHeader
): Promise<ConnectResult> {
  try {
    const res = await serverFetch(`${serverUrl}/Users/AuthenticateByName`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...customHeaderForRequest(customHeader),
        ...mediaBrowserAuthHeaders(brand, { basicAuth }),
      },
      // `App` is not a field of Jellyfin's `AuthenticateUserByName` body and
      // never was — it was added here reading the exception literally, and it
      // cannot have helped. `request.App` is populated from the *header*, so
      // the body was never where the value was missing from. Left out again
      // rather than kept as a harmless extra: an unread field in a login
      // payload is a claim that something reads it.
      body: JSON.stringify({ Username: username, Pw: password }),
    });

    if (!res.ok) {
      let msg = `Login failed (${res.status})`;
      if (res.status === 401) msg = "Invalid username or password.";
      if (res.status === 403)
        msg = "User is not permitted to sign in.";
      return { success: false, message: msg };
    }

    const data = await res.json();
    const token = data?.AccessToken;
    const userId = data?.User?.Id;

    if (!token || !userId) {
      return {
        success: false,
        message: `Malformed ${brand.label} login response.`,
      };
    }

    return {
      success: true,
      token,
      userId,
    };
  } catch {
    return {
      success: false,
      message: "Connection failed. Check URL or network.",
    };
  }
}
