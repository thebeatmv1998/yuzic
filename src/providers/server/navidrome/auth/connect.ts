import { buildTokenParams, subsonicRequestHeaders } from "../client";
import { SubsonicResponse } from "../types";
import type { BasicAuth, CustomHeader } from "@/providers/contracts/Server";
import i18n from '@/i18n';
import { InsecureUrlError } from '@/providers/http/urlPolicy';
import { serverFetch } from '@/features/mtls/serverFetch';

const API_VERSION = "1.16.0";
const CLIENT_NAME = "Yuzic";

type ConnectResult =
  | { success: true; libraries: { id: string; name: string }[] }
  | { success: false; message?: string };

export async function connect(
  serverUrl: string,
  username: string,
  password: string,
  basicAuth?: BasicAuth,
  customHeaders?: CustomHeader[]
): Promise<ConnectResult> {
  if (!serverUrl || !username || !password) {
    return { success: false, message: i18n.t('onboarding.connect.missingCredentials') };
  }

  const cleanUrl = serverUrl.replace(/\/+$/, "");
  const { u, t, s } = buildTokenParams(username, password);
  const params = new URLSearchParams({
    u,
    t,
    s,
    v: API_VERSION,
    c: CLIENT_NAME,
    f: "json",
  });
  const url = `${cleanUrl}/rest/getMusicFolders.view?${params}`;

  try {
    const res = await serverFetch(url, { headers: subsonicRequestHeaders(basicAuth, customHeaders) });
    if (!res.ok) {
      return { success: false, message: i18n.t('onboarding.connect.serverErrorStatus', { status: res.status }) };
    }

    const data: SubsonicResponse = await res.json();
    const response = data["subsonic-response"];

    if (response?.status === "ok") {
      const rawFolders = response?.musicFolders?.musicFolder;
      const folderList = Array.isArray(rawFolders)
        ? rawFolders
        : rawFolders
          ? [rawFolders]
          : [];

      const libraries = folderList
        .map((folder, index) => {
          const id = String(folder?.id ?? "").trim();
          const name = String(
            folder?.name ??
            folder?.title ??
            (id ? `Library ${index + 1}` : "")
          ).trim();
          if (!id) return null;
          return {
            id,
            name: name || `Library ${index + 1}`,
          };
        })
        .filter((folder): folder is { id: string; name: string } => folder !== null);

      return { success: true, libraries };
    }

    return {
      success: false,
      message: response?.error?.message ?? i18n.t('onboarding.credentials.authFailed'),
    };
  } catch (error) {
    if (error instanceof InsecureUrlError) {
      return {
        success: false,
        message: i18n.t('onboarding.connect.insecureHttp', { host: error.host }),
      };
    }
    return {
      success: false,
      message: i18n.t('onboarding.connect.serverConnectionFailed'),
    };
  }
}