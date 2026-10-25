# Security Audit — Yuzic Custom (Android)

**Date:** 2026-10-25  
**Scope:** Fork `thebeatmv1998/yuzic`, branch `custom-request-header`  
**Source commit:** `8ca303f2` (APK built from `c0d2f359`)  
**APK:** `Yuzic-2.17.1-custom3-arm64-v7a.apk`  
**Package:** `com.arinora.rawarr` — version `2.17.1-custom3` (21703)  
**APK SHA-256:** `56A6B2EE45EE40C95EEBAF0BC7E52AED2ABBDEB6CF5B394AC03B69F10F655ECD`  
**Signing cert SHA-256:** `1c75bd62bba2a7a62bc00ca31377aeea1ee3a9c24a48cbebd1596e4ece610882`

## Scope and method

This was a **static** audit of the app, its native configuration, its dependency tree,
its build/release process, and the fork's GitHub settings. Server-side components
(Cloudflare, Authentik, Navidrome, reverse proxy) and dynamic runtime testing were
**not** directly accessible and are therefore assessed from configuration facts and
the app's code paths, not from a live penetration test.

Tools and checks used:

- `npm audit` (production and full tree), `npm ls`, `npm outdated`
- `aapt2` / `apkanalyzer` for the merged manifest, permissions and exported components
- `apksigner` for signature and certificate verification
- `rg` secret scans over the working tree, git history and APK `classes*.dex`
- Manual review of authentication, credential storage, custom headers, HTTP clients,
  TLS/mTLS, logging, deep links, backup and release signing
- `gh api` for repository, branch, Actions, secret, key and webhook settings

## Executive summary

**Overall rating: Medium** — High if the device/network is hostile or the Windows
build machine is shared with other local accounts.

No remote-code-execution or authentication-bypass vulnerability was found in the
app's own code. CVE-2026-91403 (Oracle JSSE/GraalVM) does **not** affect the app:
no Oracle JRE/GraalVM is bundled, Android uses Conscrypt/BoringSSL, and the only
Java runtime is the build JDK on the PC.

The strongest parts of the design are the credential handling and the custom-header
implementation: secrets live in the platform keystore, never in Redux/MMKV, are not
logged by the header code, and are validated against injection and reserved headers.

The material risks are around **transport security, signing-key custody, token
exposure through URLs/logs, an exported media service, backup, and repo hygiene**.

### Top risks

1. **Cleartext HTTP is enabled app-wide** on Android and iOS, and credentials can be
   sent over `http://` with only a warning in some screens. (High)
2. **The release signing key and its plaintext password file were readable and
   modifiable by every local Windows account.** ACLs were fixed during this audit;
   rotation is still advisable if the machine was shared. (High)
3. **Release builds fall back to the public debug keystore** when signing environment
   variables are absent. (High/Medium)
4. **Bearer tokens are placed in stream/cover URLs and can reach release logs** through
   `UrlTimeoutError` and `console.error`. (Medium)
5. **Android trusts user-installed CAs globally**, allowing a user-installed CA to MITM
   all app traffic. (Medium)
6. **`allowBackup=true`** without backup rules can include MMKV state, catalog metadata
   and downloads. (Medium)
7. **The exported playback service accepts every controller**, so any local app can
   browse library metadata and control playback. (Medium/Low)

## Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| SEC-01 | High | Cleartext HTTP globally enabled; credentials/tokens can be transmitted unencrypted | Open |
| SEC-02 | High | Release signing key + plaintext password readable/modifiable by all local users | **ACL fixed**; rotate if shared |
| SEC-03 | High/Medium | Release signing silently falls back to the public debug keystore | Open |
| SEC-04 | Medium | Long-lived tokens in URLs; release logging can leak them | Open |
| SEC-05 | Medium | Global trust of user-installed CAs on Android | Open |
| SEC-06 | Medium | `allowBackup=true` with no backup/data-extraction rules | Open |
| SEC-07 | Medium/Low | Exported `PlaybackService` accepts all controllers | Open (engine) |
| SEC-08 | Medium/Low | R8/minify and resource shrinking disabled in release | Open |
| SEC-09 | Low | No `FLAG_SECURE`; credentials/settings screens can be screenshotted | Open |
| SEC-10 | Low | `Math.random()` used for Subsonic token salt | Open |
| SEC-11 | Low | `minSdk 24` includes old Android TLS/security stacks | Open |
| SEC-12 | Low | APK uses APK Signature Scheme v2 only (no v3/v4) | Open |
| SEC-13 | Low | JitPack repository added globally to all Gradle projects | Open |
| SEC-14 | Low/Medium | No branch protection; Dependabot alerts/updates disabled; Actions not SHA-pinned | Open |
| SEC-15 | Low | Runtime DoS advisories in `expo-router`/`@react-navigation/core` via query parsing | Open (SDK-limited) |
| SEC-16 | Info | Most `npm audit` critical/high findings are build/dev-only; 2 moderate are runtime | Accepted/monitor |
| SEC-17 | Info | CVE-2026-91403 (Oracle JSSE) not applicable; build JDK only | Update hygiene |
| SEC-18 | Info | Server/Cloudflare/Authentik configuration not directly audited; 403 is edge-side | Deployment checklist |

---

### SEC-01 — Cleartext HTTP is enabled app-wide (High)

**Evidence**

- `app.json:59` — `"usesCleartextTraffic": true`
- `android/app/src/main/AndroidManifest.xml:13` — `android:usesCleartextTraffic="true"`
- `android/app/src/main/res/xml/network_security_config.xml:14-18` —
  `<base-config cleartextTrafficPermitted="true">`
- `app.json:20` — iOS `NSAllowsArbitraryLoads: true`
- `serverFetch` and the engine accept both `http` and `https`; only the proxy and
  custom-header fields display an HTTP warning.

**Impact**

A passive attacker on the network (Wi-Fi, ISP, malicious hotspot) or a MITM can read:

- Navidrome/Subsonic passwords and `p=enc:` values, plus `u/t/s` tokens
- Jellyfin/Emby session tokens and `ApiKey` query parameters
- Plex account tokens (`X-Plex-Token` in stream/image URLs)
- reverse-proxy Basic-auth passwords
- custom-header values, including Cloudflare Access service tokens or Authentik tokens

The transport warning is not a control and does not cover the main server password.

**Remediation**

- Default to HTTPS and refuse `http://` for non-private hosts.
- If LAN HTTP must remain, allow cleartext only for private ranges/domains via
  `network_security_config.xml` `domain-config` entries, not globally.
- On iOS, replace `NSAllowsArbitraryLoads` with `NSAllowsLocalNetworking` and narrow
  `NSExceptionDomains`; do not allow arbitrary cleartext to the internet.
- Warn **before submitting credentials** over HTTP on every screen, not only for
  proxy/custom headers.
- Consider refusing to save/send proxy passwords or custom-header secrets over HTTP.

---

### SEC-02 — Release signing key custody (High)

**Evidence**

Before remediation, the signing directory inherited:

```
Authenticated Users:(M)   # any authenticated local user could modify
Users:(RX)                # any local user could read
```

`keystore.properties` stores the PKCS#12 password in plaintext next to the key.

During the audit the folder was restricted to:

```
<current user>:(OI)(CI)(F)
NT-AUTHORITY\SYSTEM:(OI)(CI)(F)
BUILTIN\Administrators:(OI)(CI)(F)
```

**Impact**

Anyone with local access could read the signing key and its password, then sign a
malicious APK as `com.arinora.rawarr`. Because the previous custom builds used the
same key, such an APK would install as an update over this app.

**Remediation**

- ACL is fixed. Keep the key and password offline/encrypted and backed up separately.
- If the machine was ever shared with another account or malware is suspected,
  **rotate the signing key** and re-release. Android will then require an uninstall
  of the old build (different key).
- Move the password out of the plaintext properties file (Windows DPAPI, password
  manager, CI secret store) and never commit it.
- Prefer a hardware-backed signing key for any wider distribution.

---

### SEC-03 — Default release signing uses the debug keystore (High/Medium)

**Evidence**

`android/app/build.gradle:107-129`:

```groovy
def keystorePath = System.getenv("ANDROID_KEYSTORE_PATH")
if (keystorePath != null) { ... } else {
  storeFile file('debug.keystore')
  storePassword 'android'
  keyAlias 'androiddebugkey'
  keyPassword 'android'
}
```

`android/app/debug.keystore` is tracked in git.

**Impact**

A local `assembleRelease` without env vars produces a "release" APK signed with the
public Android debug key. Anyone can sign with that key; if users install such a
build, malicious updates become possible. This also makes signature verification in
release pipelines ambiguous.

**Remediation**

Fail the build instead of falling back:

```groovy
release {
    if (keystorePath == null) {
        throw new GradleException("ANDROID_KEYSTORE_PATH is required for release builds")
    }
    // ... use env vars only
}
```

Verify the signing certificate in CI and in `release-on-version-bump.yml`.

---

### SEC-04 — Tokens in URLs and release logs (Medium)

**Evidence**

- `src/providers/server/navidrome/client.ts:230-263` — stream/avatar URLs carry
  `u`/`t`/`s` (or `p=enc:`), and cover URLs carry the same parameters.
- `src/providers/server/media-browser/client.ts:166-205` — `ApiKey`/`api_key` in
  stream and avatar URLs.
- `src/providers/server/plex/client.ts:106-116` — `X-Plex-Token` in stream/image URLs.
- `src/providers/http/urlFailover.ts:116-119` — `UrlTimeoutError` message includes the
  full URL.
- `src/providers/server/navidrome/auth/getMusicFolders.ts:39` — `console.error(... error)`.
- The release bundle contains `console.error`, `console.warn`, the Navidrome log
  string and the `No answer from` message; console is not stripped by the current
  Babel/Expo configuration.
- `src/features/player/DlnaContext.tsx` logs cast errors and response bodies; stream
  URLs with tokens can reach LAN cast devices and logs.

**Impact**

Tokens can leak to `adb logcat`, crash/diagnostics output, proxy/Cloudflare request
logs, DLNA devices and image caches. Subsonic salted tokens and Plex/Jellyfin tokens
are replayable bearer credentials; a leaked stream URL may remain valid because the
server accepts the same token/salt pair again.

**Remediation**

- Redact query strings before putting a URL in an error message (keep origin + path).
- Strip `console.*` from production builds, or route through a logger that redacts.
- Do not log request URLs for authenticated endpoints.
- On Cloudflare, redact query strings in logs/analytics and limit retention.
- Prefer header-based auth where the server supports it; otherwise keep HTTPS and
  short-lived credentials.
- Avoid casting tokenized URLs to untrusted LAN devices where possible.

---

### SEC-05 — Global user-CA trust on Android (Medium)

**Evidence**

`android/app/src/main/res/xml/network_security_config.xml:15-18`:

```xml
<trust-anchors>
  <certificates src="system" />
  <certificates src="user" />
</trust-anchors>
```

Generated by `plugins/withUserCaTrust.js`.

**Impact**

Any user-installed CA (malware, social engineering, MDM profile) can intercept all
app TLS, including passwords and tokens. The feature exists to support private CAs
(e.g., Caddy `tls internal`), but it is applied to every host, not just the user's
private server.

**Remediation**

- Make user-CA trust an explicit opt-in, or scope it to specific domains/private
  networks.
- Prefer per-server certificate pinning or mTLS (the app already supports mTLS).
- Document the risk and recommend removing user CAs when not needed.

---

### SEC-06 — App backup enabled (Medium)

**Evidence**

`android/app/src/main/AndroidManifest.xml:13` — `android:allowBackup="true"`.
No `android:fullBackupContent` or `android:dataExtractionRules` is declared.

**Impact**

Android Auto Backup / device-to-device transfer can include MMKV settings, catalog
metadata, server URLs/usernames and downloaded files. Secrets in SecureStore are
encrypted with Keystore keys that are not backed up, but metadata and files can still
leave the device. This is a privacy/exfiltration surface, especially on shared or
managed devices.

**Remediation**

- Set `android:allowBackup="false"` for this credentials-bearing app, or
- Add `dataExtractionRules`/`fullBackupContent` that exclude MMKV, downloads and
  SecureStore-related shared preferences, and test both backup and restore.

---

### SEC-07 — Exported playback service accepts every controller (Medium/Low)

**Evidence**

Merged manifest (engine):

```xml
<service android:name="dev.yuzic.engine.PlaybackService"
         android:exported="true"
         android:foregroundServiceType="0x2">
```

`node_modules/yuzic-engine/android/src/main/java/dev/yuzic/engine/PlaybackService.kt:328-367`
returns `AcceptedResultBuilder` for every `MediaSession.ControllerInfo`, granting
timeline/metadata/play/seek/set-media commands.

**Impact**

Any app on the device can bind to the exported media service, enumerate the browse
tree (titles/artists), and control playback. MediaLibraryService must be exported for
Android Auto/Assistant, but access can still be restricted.

**Remediation**

- In `onConnect`, reject controllers that are neither trusted nor in a small allowlist
  of system media packages (Android Auto, Assistant, Bluetooth).
- Keep the car/Assistant paths working; test on a device.
- Since this lives in the `yuzic-engine` dependency, patch it with `patch-package`
  or upstream it.

---

### SEC-08 — R8/minify disabled (Medium/Low)

**Evidence**

- `android/app/build.gradle:68` — `enableMinifyInReleaseBuilds` defaults to `false`.
- `android/app/build.gradle:139-140` — `shrinkResources false`,
  `minifyEnabled enableMinifyInReleaseBuilds`.

**Impact**

Release code is easier to reverse engineer and patch; not a direct vulnerability.
Also increases APK size and attack surface marginally.

**Remediation**

Enable R8 and resource shrinking with keep rules and test release builds (Hermes,
native modules, reflection in Expo/React Native). Validate with the Maestro flows.

---

### SEC-09 — No `FLAG_SECURE` (Low)

**Evidence**

No `FLAG_SECURE` in `MainActivity.kt` or elsewhere. Sensitive screens include server
credentials, custom-header values and reverse-proxy passwords.

**Impact**

Screenshots/screen recording can capture credentials or tokens; shoulder surfing.
Low for a personal app; relevant on shared devices.

**Remediation**

Set `FLAG_SECURE` on sensitive screens (onboarding credentials, server settings,
custom headers) or globally. Provide a user-facing note if screenshots are disabled.

---

### SEC-10 — Predictable Subsonic token salt (Low)

**Evidence**

`src/providers/server/navidrome/client.ts:44-45`:

```ts
function randomSalt(): string {
  return Math.random().toString(36).slice(2, 14);
}
```

**Impact**

The salt for `t = md5(password + salt)` is not cryptographically random. MD5 is
mandated by the Subsonic protocol, but a predictable salt weakens replay/precomputation
resistance. It does not expose the password directly.

**Remediation**

Use a CSPRNG (`expo-crypto.getRandomBytes`/`crypto.getRandomValues`) for the salt.
Keep MD5 only because the protocol requires it, and keep HTTPS mandatory.

---

### SEC-11 — `minSdk 24` (Low)

**Evidence**

`minSdkVersion 24` (Android 7.0) in the manifest/engine; `targetSdk 36`.

**Impact**

Older devices have older Conscrypt/TLS and security patch levels. The app itself is
modern, but the minimum runtime broadens exposure.

**Remediation**

Raise `minSdk` to 26 or 28 if the user base allows; otherwise document the risk.

---

### SEC-12 — v2-only APK signature (Low)

**Evidence**

`apksigner verify --verbose` reports v2 `true`, v3/v3.1/v4 `false`.

**Impact**

v2 is valid and secure for installation, but v3 enables key-rotation support and
stronger verification; v4 supports incremental installation.

**Remediation**

Enable v3/v4 signing in the release config (`enableV3Signing`, `enableV4Signing`) and
re-verify. v2-only is not a vulnerability by itself.

---

### SEC-13 — JitPack added globally (Low)

**Evidence**

`android/build.gradle:25` adds `https://www.jitpack.io` to every project. It is
actually needed: `expo-blur` resolves `com.github.Dimezis:BlurView` and
`react-native-turbo-image` resolves `com.github.Commit451.coil-transformations`
from JitPack.

**Impact**

JitPack builds artifacts from GitHub on demand, so those two native dependencies
include a third-party build service in the supply chain. This is a real but accepted
dependency choice; it is not an unnecessary repository.

**Remediation**

Keep JitPack but pin exact versions (already the case for these artifacts), verify
resolved artifacts in CI, and consider switching to a first-party/Maven Central
alternative if one becomes available. Do not remove the repository without checking
`expo-blur` and `react-native-turbo-image` first.

---

### SEC-14 — GitHub/fork hygiene (Low/Medium)

**Evidence**

- No branch protection on `master` or `custom-request-header`.
- Default branch is `custom-request-header`.
- Actions: `allowed_actions: all`, `sha_pinning_required: false`.
- Dependabot alerts and security updates: **disabled**.
- Secret scanning and push protection: **enabled**.
- No repository secrets, deploy keys or webhooks; one admin collaborator.
- `gh` token scopes: `gist`, `read:org`, `repo`.

**Impact**

A compromised owner token can push directly to the release branch. Unpinned actions
can be moved; dependency alerts are not monitored. The public repo intentionally
publishes source and APKs (GPL), so that is not a finding.

**Remediation**

- Enable branch protection on the default/release branch (PR + status checks, no
  force-push).
- Enable Dependabot alerts and security updates; add a dependency review workflow.
- Restrict Actions to selected/verified actions and require SHA pinning; set
  `permissions: contents: read` for PR checks.
- Use 2FA and a fine-grained PAT/`gh` login with least privilege.

---

### SEC-15 — Runtime query-parsing DoS advisories (Low)

**Evidence**

`npm audit` reports moderate issues in `expo-router` and `@react-navigation/core` via
`query-string`/`decode-uri-component` (malformed percent-encoded input can cause
exponential decoding/CPU or memory DoS). The app exposes `yuzic://` and `exp+yuzic://`
deep links; Expo Router parses query parameters.

**Impact**

A crafted deep link or malformed query could cause a CPU/memory denial of service.
No code execution or data disclosure. The fix is a major Expo Router/React Navigation
upgrade (SDK 58 / query-string 9), currently outside SDK 55.

**Remediation**

- Track the advisory; upgrade Expo Router/React Navigation when the SDK allows.
- Validate/limit deep-link parameters and avoid exposing routes that parse unbounded
  queries.
- Treat deep links as untrusted input.

---

### SEC-16 — Dependency audit (Info)

`npm audit --omit=dev` reports **31 production-labeled** issues:

- 1 critical, 15 high, 14 moderate, 1 low

`npm audit` (including dev) reports **34**: 1 critical, 17 high, 14 moderate, 2 low.

**Most are not shipped in the Android app.** Classification:

| Package / advisory | Severity | Runtime in Android APK? | Path |
|---|---|---|---|
| `shell-quote` | Critical | No (dev) | `react-devtools-core` |
| `@expo/cli`, `node-forge`, `@expo/code-signing-certificates` | High | No (build) | Expo CLI |
| `@xmldom/xmldom`, `xcode` | High | No (build) | Expo config plugins |
| `postcss`, `source-map-js` | High | No (build) | Metro/Expo CLI |
| `ws` | High | No (dev/build) | Metro/dev middleware |
| `compression`, `browserslist`, `brace-expansion` | High | No (build) | Expo CLI/Babel |
| `js-yaml` | High | No (build) | ESLint/Expo CLI |
| `image-size` | High | No (build) | Metro |
| `zod` | High | No (build) | Expo CLI |
| `expo` | High | **No** — the advisory is in its CLI subtree | `@expo/cli` |
| `follow-redirects`, `phin`, `qs` | Moderate | No on native; **web-only** via `node-vibrant` | `react-native-image-colors` web path |
| `expo-router`, `@react-navigation/core`, `query-string`, `decode-uri-component` | Moderate | **Yes (DoS)** | URL/query parsing |
| `uuid` | Moderate | No (build) | `xcode` |
| `@babel/core` | Low | No (build) | Babel |

The release bundle contains no `shell-quote`, `node-forge`, `postcss`, `js-yaml`,
`xmldom`, `image-size`, `compression` or `browserslist` markers. The Android build
resolves `react-native-image-colors` to its native module, not the web `node-vibrant`
path.

**Recommendation**

- Run `npm audit fix` for non-breaking build-time updates, then `npx expo install --fix`
  for Expo SDK 55 patch updates (currently 55.0.23 → 55.0.32, React Native 0.83.4 →
  0.83.10, expo-router 55.0.13 → 55.0.18).
- Plan the SDK 58 / Expo Router upgrade for the query-string advisory.
- Add Dependabot/OSV-Scanner and a Gradle dependency check (OWASP Dependency-Check or
  Gradle version catalog + Renovate). npm audit does not cover Maven/AndroidX.

---

### SEC-17 — CVE-2026-91403 (Info)

CVE-2026-91403 is an Oracle JSSE vulnerability in Oracle Java SE and GraalVM. The app
does **not** bundle Oracle Java or GraalVM. Android's `javax.net.ssl` implementation is
Conscrypt/BoringSSL, not Oracle JSSE. The only Java runtime present is the build JDK
(Microsoft OpenJDK 21.0.12.1), which is not shipped and is not a network service.
Update the JDK as hygiene when a patched build is available.

---

### SEC-18 — Deployment / Cloudflare / Authentik (Info, not directly audited)

The 403 observed at login is **not** produced by Yuzic, Navidrome or Authentik if the
reverse proxy sees no Yuzic request. It is an edge rejection. The strongest current
explanation is Cloudflare **Browser Integrity Check / Bot Fight Mode** blocking the
React Native/OkHttp `User-Agent`; Navic sets `User-Agent: Navic`, Yuzic does not set
one and sends `okhttp/…`. The fix is a Cloudflare BIC/Bot Fight skip rule, a custom
app UA, or — with Zero Trust Access — a service token (`CF-Access-Client-Id` /
`CF-Access-Client-Secret`) with a **Service Auth** policy.

**Deployment checklist**

- Cloudflare: TLS **Full (strict)**, HSTS, minimum TLS 1.2/1.3, no direct origin
  exposure, WAF/BIC/Bot Fight reviewed, Access service tokens with Service Auth,
  query strings redacted from logs/analytics.
- Authentik: MFA, least-privilege policies, outpost token protected, client-supplied
  `X-Authentik-*` identity headers stripped; do **not** use client-sent identity
  headers as authentication. Prefer Bearer JWT or Basic app password for machine
  clients.
- Navidrome: strong unique password, HTTPS only, reverse proxy in front, no direct
  port-forward, current version, encrypted backups.
- Network: no inbound Navidrome/Java ports; firewall; separate VLAN for IoT/DLNA if
  feasible.
- Monitoring: no credentials/tokens in reverse-proxy or Cloudflare logs; alert on
  401/403 spikes and unusual data access.

## Positive controls

- Server passwords, tokens, proxy passwords, mTLS material and custom-header values
  are stored in SecureStore (Keychain/Keystore), not Redux/MMKV.
- `persistedStateSecrets.test.ts` proves sentinel secrets never appear in serialized
  Redux state.
- Custom headers:
  - RFC 7230 token validation
  - CR/LF/NUL/control-character rejection
  - reserved app/framing headers blocked (`Host`, `Content-Length`, `Content-Type`,
    `Authorization`, `Cookie`, …)
  - unique names, 8-header and 1900-byte limits
  - values never logged by the header code
- mTLS engine uses the platform trust manager and OkHttp's strict hostname validation;
  no trust-all or hostname-verifier bypass was found.
- No hardcoded high-signal secrets were found in the current tree or APK DEX, and no
  secret-bearing files were added in git history (only the standard `debug.keystore`
  is tracked).
- No `expo-dev-client` in the release APK; `debuggable` is absent.
- Exported components are limited: launcher/deep-link activity, media service,
  DUMP-protected profile receiver; FileProvider/BrowseArtworkProvider and
  BrowserProxyActivity are not exported.
- No dangerous permissions such as `SYSTEM_ALERT_WINDOW`, `REQUEST_INSTALL_PACKAGES`,
  `QUERY_ALL_PACKAGES` or `MANAGE_EXTERNAL_STORAGE`.
- `patch-package` patch reviewed: only a safe-area initial-metrics fix, no network or
  data access.
- Dedicated 4096-bit RSA release key, v2 signature, checksum published with the APK.

## Remediation roadmap

**Immediate**

1. Keep the fixed signing-key ACL; rotate the key if the build machine was shared or
   compromised.
2. Fail release builds when signing env vars are missing; never use the debug keystore.
3. Block credentials over `http://`, and scope cleartext to private hosts.
4. Redact URLs in errors and strip console logs from release.
5. Disable app backup or add strict backup exclusion rules.
6. Restrict `PlaybackService` controllers to trusted/system media apps.
7. Enable Dependabot alerts/security updates and branch protection.

**Short term**

1. Apply Expo SDK 55 patch updates (`npx expo install --fix`) and test.
2. Enable R8/resource shrinking; verify with the Maestro suites.
3. Enable v3/v4 APK signing.
4. Raise `minSdk` if the user base permits.
5. Replace `Math.random` salt with a CSPRNG.
6. Add `FLAG_SECURE` to credential screens.

**Medium term**

1. Per-server certificate pinning or mandatory mTLS for self-hosted servers.
2. Header-based authentication where the server supports it; reduce token URLs.
3. Cloudflare/Authentik hardening and log redaction.
4. SAST (Semgrep), MobSF, and Gradle dependency scanning in CI.
5. Penetration test on a physical device against a staging server.

## Limitations

- No live device or emulator was connected; no MobSF/Frida/network interception.
- No access to the Cloudflare, Authentik, Navidrome or reverse-proxy configuration.
- No iOS build or App Store package was audited; the iOS ATS finding is based on
  `app.json`.
- `npm audit` covers npm only; Maven/AndroidX/native dependencies were not checked
  against a CVE database.
- This is a point-in-time review of commit `8ca303f2` / APK `2.17.1-custom3`.
