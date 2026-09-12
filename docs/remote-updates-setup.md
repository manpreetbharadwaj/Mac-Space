# Remote Config + Auto-Update Setup

This document is for **you** (the project owner) to configure Firebase and
produce signed release builds. The app code already implements everything on
the client side — this is the "turn it on" checklist.

Architecture recap:

```
Firebase Remote Config  --->  decides update POLICY (mandatory / optional /
                               maintenance / feature flags) and messaging

Tauri Updater plugin    --->  checks / downloads / cryptographically
                               verifies / installs the actual signed binary
```

**Fallback rule:** if Remote Config has no opinion (`policy: 'none'` — including
whenever Firebase isn't configured at all) but the real Tauri updater finds a
genuinely newer signed artifact, the app still shows the optional dialog
using the native check's own version/notes (`mergeNativeAvailability` in
`src/services/updatePolicy.ts`). This only ever adds the weakest tier —
Remote Config still fully controls mandatory/forced/maintenance and the
`update_enabled` kill switch — but it means publishing a real signed release
is enough on its own for users to see it, without also having to remember to
bump `latest_version` in Remote Config first.

Remote Config never ships code or binaries — it only flips flags and text.
The Tauri updater never runs without your own signed artifacts existing at
the endpoint you configure. Losing/misconfiguring one system doesn't
compromise the other.

---

## 1. Create/select the Firebase project

1. Go to the [Firebase console](https://console.firebase.google.com/).
2. Click **Add project** (or select an existing one if you already have a
   project for this app).
3. Name it (e.g. "Mac Storage Manager"). Google Analytics is optional — not
   required for Remote Config.
4. Wait for provisioning to finish.

## 2. Register a Web app

Remote Config's JS SDK (used here, since the Tauri window is a webview) is
accessed through a **Web app** registration, even though this is a desktop
app, not a website.

1. In the Firebase console, open **Project settings** (gear icon) → **Your
   apps**.
2. Click the **`</>`** (Web) icon to add a web app.
3. Give it a nickname (e.g. "Mac Storage Manager Desktop"). You do **not**
   need Firebase Hosting for this step (skip that checkbox unless you plan to
   use Firebase Hosting for the updater manifest too — see §9).
4. Firebase shows you a `firebaseConfig` object with `apiKey`,
   `authDomain`, `projectId`, `storageBucket`, `messagingSenderId`, `appId`.
   Keep this tab open for the next step.

**None of these values are secret.** They identify your project to the
client the same way a public URL would — Firebase's real security boundary
is server-side rules/App Check, not hiding this object. It's still kept out
of git via `.env` for environment-hygiene reasons, not secrecy.

## 3. Firebase SDK packages installed

Already added to `package.json`:

- `firebase` (npm) — the modular Web SDK. Only `firebase/app` and
  `firebase/remote-config` are imported, and only inside
  `src/services/remoteConfigService.ts` — nowhere else in the app touches
  the Firebase SDK directly. It's dynamically `import()`-ed so it lands in
  its own lazy-loaded chunk instead of bloating the main bundle.

No Firebase Admin SDK, Auth, Firestore, or Analytics packages are used —
keep it that way unless a future feature genuinely needs them.

## 4. Where the configuration values go

Copy `.env.example` to `.env` in the project root and fill in the values
from step 2:

```bash
cp .env.example .env
```

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef
```

`.env` is gitignored — it never gets committed. If you ship this app to
other machines (CI, teammates), each needs its own `.env` with the same
values (again: not secret, just environment config).

**If `.env` is missing or any of these three are blank** (`API_KEY`,
`PROJECT_ID`, `APP_ID`), `remoteConfigService.ts` detects this at startup,
skips Firebase entirely, logs one `console.info`, and the app runs
permanently on the in-app defaults in `remoteConfigDefaults.ts` (always
"current version, no update, no maintenance"). This is intentional — it's
exactly what makes local development safe before you've configured anything.

## 5. Creating Remote Config parameters

1. In the Firebase console, go to **Engage → Remote Config** (left sidebar).
2. Click **Create configuration** (first time) or **Add parameter**.
3. For each row in the table below: set the **Parameter name** exactly as
   shown (case-sensitive, the app reads these exact keys), pick **Data
   type**, and set the **Default value**.
4. Click **Publish changes** (top right) when done — see §7.

## 6. Parameter reference + suggested initial template

| Parameter | Type | Suggested initial value | Purpose |
|---|---|---|---|
| `latest_version` | String | your current app version, e.g. `0.1.0` | Newest published version |
| `minimum_supported_version` | String | same as current version, e.g. `0.1.0` | Hard floor — below this, update is mandatory |
| `force_update` | Boolean | `false` | Forces mandatory update even above the minimum |
| `update_enabled` | Boolean | `true` | Master switch for the whole update UI |
| `update_title` | String | `New Version Available` | Optional-update dialog title |
| `update_message` | String | `A new version is available.` | Shown in both dialogs |
| `maintenance_mode` | Boolean | `false` | Full-app takeover screen |
| `maintenance_title` | String | `Under Maintenance` | Maintenance screen title |
| `maintenance_message` | String | `Mac Storage Manager is temporarily unavailable. Please try again shortly.` | Maintenance screen body |
| `pricing_enabled` | Boolean | `false` | Reserved — no payment UI wired up yet |
| `pro_annual_price_display` | String | `` (empty) | Reserved display-only price string |
| `pro_lifetime_price_display` | String | `` (empty) | Reserved display-only price string |
| `promotion_enabled` | Boolean | `false` | Reserved promo banner flag |
| `promotion_text` | String | `` (empty) | Reserved promo banner text |
| `developer_cleanup_enabled` | Boolean | `true` | Reserved feature flag (existing feature) |
| `browser_cleanup_enabled` | Boolean | `true` | Reserved feature flag (existing feature) |
| `automatic_cleanup_enabled` | Boolean | `true` | Reserved feature flag (existing feature) |
| `payments_enabled` | Boolean | `false` | Reserved — not implemented yet |
| `lifetime_plan_enabled` | Boolean | `false` | Reserved — not implemented yet |
| `annual_plan_enabled` | Boolean | `false` | Reserved — not implemented yet |
| `new_feature_x_enabled` | Boolean | `false` | Reserved placeholder for a future flag |

Every parameter above also has a matching hard-coded default in
`src/services/remoteConfig/remoteConfigDefaults.ts`, used whenever Firebase
is unreachable — the two should stay in sync conceptually (not
byte-for-byte identical), particularly `update_enabled: true`/
`maintenance_mode: false`, so an offline app never fails unsafe.

**You never need to create parameters for features that don't exist yet.**
The list above includes several "reserved for future use" flags per the
request that started this — feel free to skip creating those in the console
until you actually build the feature they gate. The app already has a safe
default for anything you haven't created yet (see §11).

## 7. Publishing a Remote Config change

1. Edit parameter value(s) in the console.
2. Click **Publish changes** — this is a manual, deliberate action; nothing
   goes live until you click it.
3. Clients pick it up the next time they fetch — see "Check timing" in the
   in-app behavior below: app startup, window focus after the cache
   interval, or the user pressing **Check for Updates** in Settings.
4. There's no "rollback" button — to undo, edit the value back and publish
   again. Firebase does keep a version history (History tab) you can restore
   from if needed.

## 8. Testing dev/staging values safely

Three independent tools, from lightest to heaviest:

**A. Dev-only local scenario override (no Firebase needed at all).**
Add to `.env`:
```
VITE_DEV_UPDATE_SCENARIO=optional        # or: mandatory-forced | mandatory-minimum | maintenance
```
This is read only by `vite dev` / `tauri dev` — `import.meta.env.DEV` is
compiled to the literal `false` by `vite build` / `tauri build`, which
dead-code-eliminates the entire branch (`src/services/remoteConfig/
devScenarioOverride.ts`) from anything you ship. It's impossible for this to
affect a real user, even if you forgot to remove the line from a local
`.env` before building — `.env` isn't bundled into the binary either way,
only read by the dev server. Restart `npm run dev` / `npm run tauri:dev`
after changing this value.

**B. Lower the fetch-cache interval** during manual testing against real
Firebase, so a published change shows up immediately instead of waiting up
to an hour:
```
VITE_REMOTE_CONFIG_MIN_FETCH_INTERVAL_MS=30000
```
Then use **Check for Updates** in Settings (that button also passes
`force: true`, bypassing the interval entirely, in addition to lowering it).

**C. Firebase Remote Config conditions**, for testing against a second
"channel" without affecting real users: Remote Config supports per-parameter
conditional values (console → parameter → "Add value for condition"),
targeting by app version, random percentage, or a custom signal you set via
`setCustomSignals()`. Not currently wired into this app (no custom signals
are sent), so the simplest safe staging approach today is (A) or (B) above,
or standing up a **second Firebase project** for staging and pointing a
separate `.env.staging` at it.

## 9. Maintenance mode behavior

`maintenance_mode: true` only takes effect from a **successfully fetched or
previously-cached** Remote Config value — never from the in-app defaults
(`computeMaintenanceActive` in `src/services/updatePolicy.ts` checks
`snapshot.source !== 'default'`). If Firebase is completely unreachable and
nothing has ever been fetched, the app cannot enter maintenance mode, by
design — an outage on Google's side can never accidentally lock out every
user of your app.

---

## 10. Tauri updater — signing key setup

**Already done for you as part of this implementation** — summarized here
so you know what exists and where:

- A keypair was generated with `tauri signer generate` and written to:
  - Private key: `~/.tauri/mac-storage-manager.key` (mode `600`, your user
    only)
  - Public key: `~/.tauri/mac-storage-manager.key.pub`
- The **public** key's contents were embedded in
  `src-tauri/tauri.conf.json` under `plugins.updater.pubkey` — this is safe
  to commit; it can only *verify* signatures, not create them.
- The **private** key and its password live **only** in
  `~/.tauri/mac-storage-manager.key` and
  `~/.tauri/mac-storage-manager.signing.env` (also mode `600`) — never in
  the repo, the app bundle, `.env`, or Firebase. Neither the key content nor
  the password is ever printed in a chat/agent session — the password was
  generated inline and written straight to the `.env` file above without
  passing through any visible output.
- **An earlier keypair generated during initial setup was rotated out**
  after its password was inadvertently shown in an agent session transcript
  — treat that as the general policy: if a signing password is ever
  displayed anywhere (chat, logs, screen share), rotate the keypair
  immediately rather than trying to "un-expose" it. See the rotation steps
  below; they're the same steps used for that incident.

**To source the current signing secrets for a build:**

```bash
source ~/.tauri/mac-storage-manager.signing.env
npm run tauri:build
```

That file exports `TAURI_SIGNING_PRIVATE_KEY` (the key's raw content, not a
path — this CLI version does not honor `TAURI_SIGNING_PRIVATE_KEY_PATH`,
despite `tauri signer generate` mentioning it; verified by trial during
setup) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — `source` it in your shell
(or copy its two values into your CI secret store, one secret per variable)
rather than typing the password on the command line, where it would land in
your shell history.

**To rotate the key yourself** (compromise, routine rotation, or handing
off to a new build machine):

```bash
PW="$(openssl rand -base64 32)"
npx tauri signer generate -w ~/.tauri/mac-storage-manager.key -p "$PW" --ci -f
{
  echo "export TAURI_SIGNING_PRIVATE_KEY=\"\$(cat \"$HOME/.tauri/mac-storage-manager.key\")\""
  echo "export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=\"$PW\""
} > ~/.tauri/mac-storage-manager.signing.env
chmod 600 ~/.tauri/mac-storage-manager.key ~/.tauri/mac-storage-manager.key.pub ~/.tauri/mac-storage-manager.signing.env
unset PW
cat ~/.tauri/mac-storage-manager.key.pub
```
This never echoes the password to your terminal — it's assigned to a shell
variable and redirected straight into the `.env` file. Copy the printed
**public** key into `src-tauri/tauri.conf.json`:

```json
"plugins": {
  "updater": {
    "endpoints": ["https://your-hosting-domain/updater/latest.json"],
    "pubkey": "PASTE_PUBLIC_KEY_HERE"
  }
}
```

**Rules, non-negotiable:**
- The private key file and its password never go in: the repo, `.env`, the
  app bundle, Firebase Remote Config, or any client-visible location — and
  never in a chat transcript, terminal echo, or log line either.
- The private key only ever needs to exist on your build machine or in a CI
  secret store (GitHub Actions secrets, etc.) — never in a log, never in a
  committed file.
- The public key is the only half that ships inside the app — that's by
  design; it can verify a signature but never produce one.
- Rotating the key means every previously-shipped build's auto-update stops
  verifying against the new signature until users reinstall once manually —
  see §17 "Key rotation breaks old installs' auto-update" below. For a
  pre-release app with no real installs yet (current state), this cost is
  zero — rotate freely.

## 11. Producing a signed updater build

From the project root, with the private key available locally:

```bash
source ~/.tauri/mac-storage-manager.signing.env
npm run tauri:build
```

For CI: set `TAURI_SIGNING_PRIVATE_KEY` (the raw key file content) and
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as secrets in your CI provider's secret
store — never as plain workflow-file env values.

Because `bundle.createUpdaterArtifacts: true` is set in
`src-tauri/tauri.conf.json`, this produces, in addition to the normal
`.app`/`.dmg`:

```
src-tauri/target/release/bundle/macos/Mac Storage Manager.app.tar.gz
src-tauri/target/release/bundle/macos/Mac Storage Manager.app.tar.gz.sig
```

(and the equivalent under `target/<triple>/release/bundle/macos/` if you
cross-compiled for a specific target, e.g. building on an Apple Silicon
Mac for Intel — see §13 for both architectures.)

The `.sig` file's content is what goes into the `signature` field of the
updater manifest (§12) — copy it verbatim (it's base64 text).

If you build without the two env vars set, `tauri build` still produces the
regular app bundle, but skips producing signed updater artifacts and warns
that signing was skipped — nothing breaks, you just won't have an update to
publish that round.

## 12. Update manifest (`latest.json`)

**Verified against the actual `tauri-plugin-updater` 2.11.0 source**
(`RemoteReleaseInner::Static`, `get_urls()` in `updater.rs`): with a single,
non-templated endpoint URL (what `tauri.conf.json` uses here — no
`{{target}}`/`{{arch}}` placeholders), the client fetches one static JSON
file and picks its own platform out of a `platforms` map, trying
`"<os>-<arch>-app"` then falling back to `"<os>-<arch>"` — so
`"darwin-aarch64"` / `"darwin-x86_64"` (not `"arm64"`/`"macos"` or any other
spelling) are the exact required keys. A target missing from `platforms`
surfaces as a caught, non-fatal error for that user (no crash, no false
lockout — see §17) rather than "no update."

The endpoint (`plugins.updater.endpoints` in `tauri.conf.json`) is:
```
https://mac-storage-manager.web.app/updates/macos/latest.json
```
Shape — see `docs/examples/latest.json` for a ready-to-copy template:

```json
{
  "version": "1.0.1",
  "notes": "Bug fixes and performance improvements.",
  "pub_date": "2026-09-12T00:00:00Z",
  "platforms": {
    "darwin-aarch64": {
      "signature": "<contents of the .app.tar.gz.sig for the arm64 build>",
      "url": "https://mac-storage-manager.web.app/updates/macos/aarch64/MacStorageManager_1.0.1.app.tar.gz"
    },
    "darwin-x86_64": {
      "signature": "<contents of the .app.tar.gz.sig for the x64 build>",
      "url": "https://mac-storage-manager.web.app/updates/macos/x86_64/MacStorageManager_1.0.1.app.tar.gz"
    }
  }
}
```

`version` here is what Tauri's updater compares against the running app's
version (real semver, via the `semver` crate — not string comparison) to
decide whether a download exists at the protocol level. This is independent
of, and in addition to, the `latest_version`/`force_update` policy fields in
Remote Config (see the architecture note + fallback rule at the top of this
doc) — Remote Config can also stay silent and let this manifest alone drive
the optional-update dialog.

## 13. Building for both Apple Silicon and Intel

```bash
# Apple Silicon (arm64) — run on an Apple Silicon Mac, or cross-compile:
rustup target add aarch64-apple-darwin
npm run tauri:build -- --target aarch64-apple-darwin

# Intel (x86_64):
rustup target add x86_64-apple-darwin
npm run tauri:build -- --target x86_64-apple-darwin
```

Each produces its own `.app.tar.gz` + `.sig` under
`src-tauri/target/<target-triple>/release/bundle/macos/`. Upload both
artifacts and fill in both `platforms` entries in `latest.json` — Tauri
needs both present for users on either chip to receive updates. (If you
only ever build on Apple Silicon and don't need to support Intel users,
you can ship just the `darwin-aarch64` entry — but check who's actually
installed on Intel today before dropping that entry from a real release.)

## 14. Hosting the manifest + artifacts

Any HTTPS host works — nothing in the client is coupled to a specific
provider (only the URL in `tauri.conf.json` + `latest.json` needs to point
at wherever you chose). Directory layout (one manifest for all platforms,
artifacts organized per architecture):

```
/updates/macos/latest.json
/updates/macos/aarch64/MacStorageManager_<version>.app.tar.gz
/updates/macos/aarch64/MacStorageManager_<version>.app.tar.gz.sig   (not hosted — .sig contents go inside latest.json, see below)
/updates/macos/x86_64/MacStorageManager_<version>.app.tar.gz         (once you build for Intel too)
```

The `.sig` file itself never needs to be hosted or publicly reachable — only
its *contents* (a short base64 string) go into `latest.json`'s `signature`
field. Keeping `.sig` alongside the artifact under `release/` locally is
just for your own bookkeeping.

Two straightforward hosting options:

**Firebase Hosting** — a ready-to-deploy `firebase.json` already exists at
the project root (`public: "release"`, with the cache headers below
pre-configured), and `release/updates/macos/` already has a real signed
0.1.1 build staged in it. Nothing has been deployed — this is authenticated,
account-level action that has to come from you:

```bash
npm install -g firebase-tools   # one-time, or use `npx firebase-tools ...` each time
firebase login                  # opens a browser — must be run by you interactively
firebase use --add              # pick or create the project; writes .firebaserc (gitignored-safe to commit, no secrets in it)
firebase deploy --only hosting
```
Your endpoint becomes `https://<project-id>.web.app/updates/macos/latest.json`.
The placeholder value in `tauri.conf.json` (`mac-storage-manager.web.app`)
is **not a claimed project** — Firebase project IDs are globally unique and
this one may or may not be available; confirm your real project ID first,
then update `plugins.updater.endpoints` in `tauri.conf.json` to match before
rebuilding.

**⚠️ The sibling website repo is now the canonical Firebase Hosting
deployment source for this site — do not deploy Hosting from here.**
`~/Documents/mac-storage-website` serves the public marketing site on the
*same* Hosting site (`mac-storage-manager`), and its build **includes this
repo's updater files under `/updates/`**: its `public/updates/` folder is
where this repo's `release/updates/` tree gets copied in before its `vite
build` runs, and its `dist/` (website + `/updates/` together) is the thing
that actually gets deployed.

Firebase Hosting deployments **replace the entire hosted file set rather
than merging it** — each deploy is a full snapshot, not an incremental
patch. That means running `firebase deploy` from **this** repo's
`firebase.json` (`public: "release"`, which only contains the updater
tree, no website) would overwrite/remove the live public website's
`index.html` and assets. This repo's `firebase.json` is kept only for local
testing of the updater tree in isolation (`firebase emulators:start` /
`firebase serve`) — it is not meant to be deployed for real.

**Future Firebase Hosting deployments should therefore always be performed
from the website repo, unless the hosting architecture is intentionally
changed** (e.g. moving to Firebase's multi-site Hosting so the website and
the updater tree deploy independently). The public `.dmg` installer is
**not** part of this at all — it's hosted as a GitHub Release asset (see
the website repo's `src/config/release.ts`),
since Firebase Hosting's free Spark plan rejects raw `.dmg` uploads.

**Any other static HTTPS host** (S3+CloudFront, GitHub Releases + a raw
content proxy, Cloudflare Pages, your own server) works identically — the
client only cares that `endpoints` in `tauri.conf.json` resolves to valid
JSON over HTTPS. Swapping hosts later is just editing that one URL and
rebuilding.

## 15. Publishing 1.0.1 as an **optional** update

1. Bump `"version"` in `src-tauri/tauri.conf.json` to `1.0.1` and rebuild
   (§11) — this also updates what `getVersion()` reports at runtime.
2. Upload the new `.app.tar.gz` artifacts + update `latest.json` (§12/§14)
   with `"version": "1.0.1"`.
3. In Remote Config: set `latest_version = 1.0.1`, leave `force_update =
   false`, leave `minimum_supported_version` at whatever it currently is
   (below `1.0.1`). Publish.
4. Users on an older version see the dismissible "New Version Available"
   dialog next time they check; users who click **Later** aren't asked
   again until they restart the app (or the version number changes again).

## 16. Making 1.0.1 **mandatory**

Two ways, per the spec's two mandatory triggers:

- **Forced latest:** set `force_update = true` (with `latest_version =
  1.0.1` as above). Publish. Everyone below `1.0.1` now gets the
  non-dismissible "Update Required" dialog, even though `1.0.1` isn't
  technically a hard floor — you're just insisting everyone jump to it.
- **Hard floor:** set `minimum_supported_version = 1.0.1`. Publish.
  Anyone below `1.0.1` gets the non-dismissible dialog regardless of
  `force_update`. This is the stronger, more permanent form — normally used
  once you're confident older versions are genuinely broken/unsupported
  (e.g. a backend contract changed), not for routine feature pushes.

## 17. Revoking support for versions below 1.0.1

Set `minimum_supported_version = 1.0.1` and publish. Every installed copy
below that version becomes permanently blocked by the mandatory dialog on
its next check — there is no time limit or grace period; this takes effect
as soon as each client re-checks (see "Check timing" below). Make sure
`latest_version >= 1.0.1` too, so the mandatory dialog has a real version to
point users toward. This is a one-way door **in the Remote Config sense**
(there's no automatic re-lowering) but you can always publish a new change
lowering `minimum_supported_version` again if you need to undo it — Remote
Config has no concept of a permanent revocation, only "the currently
published value."

---

## 18. Testing everything

### Update-policy logic + UI (no real device needed)

With `.env` containing only `VITE_UPDATE_CHECK_ENABLED=true` (no Firebase
keys), run `npm run dev` and open http://localhost:1420 in a browser — the
app runs the exact same React code as inside Tauri, just without native
storage/updater calls (those already no-op safely outside Tauri).

Set `VITE_DEV_UPDATE_SCENARIO` in `.env` to one of the four values from §8A
and restart `npm run dev` to see each state:

| Scenario | What you should see |
|---|---|
| *(unset)* | No dialog. Settings → Software Update shows "You're up to date." |
| `optional` | Dismissible "New Version Available" dialog; "Later" hides it for the session; rest of the app stays usable underneath. |
| `mandatory-forced` | Non-dismissible "Update Required" dialog (no X, no Later, backdrop click does nothing). |
| `mandatory-minimum` | Same non-dismissible dialog, with the "this version is no longer supported" message. |
| `maintenance` | Full-screen takeover replacing the entire app (sidebar included). |

In every case, clicking **Update Now** in the browser prototype correctly
fails with "Update could not be downloaded..." + a **Retry** button (there's
no real Tauri updater outside the desktop shell) — that's expected and is
itself proof the failure path doesn't crash or lock up the UI.

### Real desktop app

```bash
npm run tauri:dev
```
Verifies: real `getVersion()` reads `0.1.0` (or whatever's in
`tauri.conf.json`) in Settings; existing scan/cleanup/trash functionality is
untouched; the updater plugin initializes without error (check the terminal
log for `tauri_plugin_updater`/`tauri_plugin_process` panics — there
shouldn't be any). A real Tauri `check()` call against the placeholder
`mac-storage-manager.web.app` endpoint will fail (nothing's hosted there
yet) — confirm in Settings that this shows as a quiet "couldn't reach the
update server" note, not a crash or a false mandatory-update lock.

### End-to-end with a real signed release (once you're ready)

1. Publish `latest.json` + artifacts for a version *higher* than your
   currently-installed build (§11–§14).
2. Set Remote Config `latest_version` to match, `force_update: false`.
3. Launch the installed (older) build, or use Settings → **Check for
   Updates**.
4. Confirm: optional dialog appears with real release notes → **Update
   Now** → progress bar moves → "Installing update…" → app relaunches on
   the new version.
5. Repeat with `force_update: true` and again with a bumped
   `minimum_supported_version` to confirm the mandatory path installs too.

---

## Limitations & security notes

- **Remote Config is not authentication.** Anyone can inspect its published
  values (e.g. via network tools) — never put anything there you wouldn't
  want a user to read, and never use it to gate anything security-sensitive
  by itself.
- **No backend was built.** Firebase Remote Config (policy) + static
  HTTPS-hosted JSON/artifacts (the actual update) is the entire server-side
  footprint, matching the "no traditional backend" requirement.
- **Payments are not implemented.** `pricing_enabled`/`payments_enabled`/etc.
  are display-only placeholders for a future phase, per the instructions
  that started this work — no purchase flow exists yet.
- **The updater endpoint is currently a placeholder**
  (`https://mac-storage-manager.web.app/updater/latest.json`) and has
  nothing hosted there. Until you complete §14, real update checks will
  fail closed (safely — see "Real desktop app" above) rather than silently
  succeed.
- **Losing the private signing key or its password is unrecoverable** for
  that keypair — see §10. There is no key-recovery mechanism by design
  (that's what makes the signature meaningful).
- **Key rotation breaks old installs' auto-update.** If you ever need to
  change the signing key, every previously-installed copy needs one manual
  reinstall from a build signed with the new key before further
  auto-updates work for them again.
