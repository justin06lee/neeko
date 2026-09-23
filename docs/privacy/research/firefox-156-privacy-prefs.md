# Firefox 156: privacy prefs and build flags (privacy step 3 research)

The research behind `src/browser/neeko/firefox-neeko-privacy.js`, done before
it was written. What came of it: the file is named `firefox-neeko-privacy.js`
(section 1), both build flags went in (section 3), no `policies.json`
(section 5), and option A for codec plugins is implemented in
`src/browser/neeko/NeekoPrivacy.sys.mjs` (section 9), which adds a 58th pref,
`media.gmp-manager.updateEnabled`. "The draft" below is that prefs file.
`docs/privacy/implementation.md` is the short version.

Source: Firefox 156.0.1 in `engine/` (commit `d9b85be608`). All paths below are relative to `engine/`. The local objdir, `engine/obj-aarch64-apple-darwin25.6.0`, was read but not changed.

Nothing was built or launched. Anything marked **INFERRED** is a deduction from the source that the step 4 privacy test has to confirm.

---

## 0. Summary

**Two things change the plan.**

1. **Pref-file load order (blocker).**
   - Firefox reads the default pref files in a folder in reverse alphabetical order, so the file whose name sorts first wins.
   - 29 of the 57 prefs are also set in `firefox.js`. Named `neeko-privacy.js`, the file would load before `firefox.js`, and those 29 would silently lose.
   - Fix: name it `firefox-neeko-privacy.js`. See section 1.
2. **The local `application.ini` is ignored at runtime in artifact builds.**
   - Mozilla's prebuilt `firefox` launcher carries its own compiled-in app data: name "Firefox", crash reporter on, update URL aus5.
   - So the build flags work only through what they remove from the locally built frontend, not through `application.ini`. See section 2.

**Build flags:**

| Line | Verdict |
|---|---|
| `mk_add_options MOZ_TELEMETRY_REPORTING=` | Delete. It's a make variable and never reaches configure. |
| `mk_add_options MOZ_DATA_REPORTING=` | Delete. Same, and `MOZ_DATA_REPORTING` isn't settable anyway (it's derived). |
| `ac_add_options MOZ_TELEMETRY_REPORTING=` | Optional guard. No change today (already off locally), but it keeps it off if `MOZILLA_OFFICIAL` is ever set. |
| `ac_add_options --disable-updater` | **Add.** Works with artifact builds. It's the only way, apart from a policy, to stop update checks to aus5. |
| `ac_add_options --disable-crashreporter` | **Add.** Works with artifact builds. It removes the report-sending program, the crash helper and the frontend submit and "crash pull" paths. The prebuilt core still installs its in-process handler, but nothing leaves the machine. |

**Enterprise policies:** don't ship them for now (section 5).
- With `--disable-updater`, the only thing a policy would add is turning off Firefox Labs.
- Any active policy brings:
  - the "managed by your organization" notice;
  - a changed Google search URL (`channel=entpr`);
  - features a browser built on Neeko can never re-allow;
  - OS-level override rules.

**Can't be fully done with prefs or flags** (section 9):
- Remote Settings filtering.
- Firefox Labs / the Nimbus experiment-list download.
- "Nothing at startup" for codec/DRM plugins: one daily plugin-list check to aus5 remains.
- Crash handler fully off (only an environment variable does it).
- Firefox Suggest in US/DE/FR/GB/IT once a region is known (protected by region detection being off).

---

## 1. Blocker: pref-file load order

**Evidence:**
- `modules/libpref/Preferences.cpp:5714-5720`: `pref_CompareFileNames` returns `Compare(filename2, filename1)`, a descending sort. The comment at :5722 says "sorted reverse-alphabetically". Files load in that order (:5769-5779).
- In the omni.ja case (packaged builds) the effect is the same: entries sorted ascending, then iterated backwards (`for (uint32_t i = prefEntries.Length(); i--;)`, `Preferences.cpp:6159-6166`).
- Later default wins: `Pref::SetDefaultValue` replaces the value unless the pref is locked (`Preferences.cpp:881-907`).

**Files in the objdir today** (`dist/bin/browser/defaults/preferences/`): `debugger.js`, `firefox-branding.js`, `firefox.js`, `neeko-prefs.js`.
- Load order: `neeko-prefs.js` → `firefox.js` → `firefox-branding.js` → `debugger.js`.
- So `firefox.js` beats any `neeko-*.js`.
- The current `neeko-prefs.js` only works because its two prefs aren't in `firefox.js`.

**Fix:** name the privacy file `firefox-neeko-privacy.js`.
- Byte order: `firefox-branding.js` < `firefox-neeko-privacy.js` < `firefox.js`.
- Load order becomes `firefox.js` → Neeko privacy → `firefox-branding.js`. Neeko overrides Firefox, and a browser built on Neeko overrides Neeko from its branding prefs. That's the layering the decisions ask for.
- Add it with `JS_PREFERENCE_FILES += ["firefox-neeko-privacy.js"]` in `src/browser/neeko/moz.build`. The installed name is the source file's name.
- Other options:
  - A name sorting before `debugger.js`, e.g. `0-neeko-privacy.js`, would also beat branding, so a Neeko browser couldn't override it from branding.
  - `locked` prefs win regardless of order, but users and downstream browsers could then never change them.

**The 29 prefs `firefox.js` would override:**
- Telemetry and studies: `toolkit.telemetry.shutdownPingSender.enabled`, `identity.fxaccounts.telemetry.clientInfoPing.enabled`, `default-browser-agent.enabled`, `app.normandy.enabled`, `app.shield.optoutstudies.enabled`, `nimbus.rollouts.enabled`, `browser.search.serpEventTelemetryCategorization.enabled`, `browser.discovery.enabled`.
- Messages and first run: the four `asrouter.providers.*`, both `asrouter.userprefs.cfr.*`, `browser.aboutwelcome.enabled`, `termsofuse.bypassNotification`.
- Add-ons and promos: `extensions.getAddons.cache.enabled`, `browser.vpn_promo.enabled`, `browser.promo.relay.enabled`, `extensions.systemAddon.update.enabled`, `app.update.langpack.enabled`.
- Network and plugins: `network.captive-portal-service.enabled`, `media.gmp-gmpopenh264.enabled`, `media.gmp-widevinecdm.allow-chromium-update`.
- Features: `browser.translations.enable`, `browser.ml.chat.enabled`, `browser.ml.linkPreview.enabled`, `identity.fxaccounts.enabled`, `signon.firefoxRelay.feature`.
- No pref in the draft is set by the unofficial branding file.

**Packaging (separate, for later).**
- `browser/installer/package-manifest.in:245,269-270` lists the default pref files by name (`debugger.js`, `firefox.js`, `firefox-branding.js`).
- The packager only copies files the manifest lists (`python/mozbuild/mozpack/packager/__init__.py:409-422`).
- So a `mach package` build would drop both `neeko-prefs.js` and the privacy file. Dev builds (`dist/bin`) aren't affected.
- Shipping needs a one-line, clearly marked `package-manifest.in` patch, or another packaging route. This already affects `neeko-prefs.js`.

---

## 2. Artifact builds ignore the local `application.ini`

- `browser/app/nsBrowserApp.cpp:248-252`: without `-app` / `XUL_APP_FILE`, the launcher uses `kStaticAppData` compiled into itself (`browser/app/ApplicationData.cpp:10-12`). `build/application.ini.in:1-4` even says "This file is not used".
- In artifact builds, `firefox` is Mozilla's prebuilt binary (`python/mozbuild/mozbuild/artifacts.py` ~769-787).
- `strings obj-*/dist/bin/firefox` shows `Mozilla`, `Firefox`, `156.0.1`, `https://crash-reports.mozilla.com/submit?...buildid=20260921121718` and the aus5 URL.
- The local `dist/bin/application.ini` has `Name=Neeko`, `BuildID=20260922170744`, but nothing reads it.
- The launcher's flags include `NS_XRE_ENABLE_CRASH_REPORTER` (decoded by the build research subagent).

**Consequences:**
- The update URL and crash-reporter flag can't be changed through `application.ini` / `MOZ_APPUPDATE_HOST`, whatever the mozconfig says.
- `docs/privacy/inventory.md` ("removing the URL from the generated application.ini", "crash reporter off through the locally generated application.ini") and `research/firefox-156-endpoints.md` rows on `application.ini` should be corrected.
- **INFERRED side finding:** `Services.appinfo.name` / vendor at runtime are "Firefox" / "Mozilla", so the profile folder is Firefox's, not Neeko's. The comment in `configs/common/mozconfig` ("the profile folder come[s] from the app basename") would then be wrong. This is worth checking in the setup track: a shipped Neeko browser may share `~/Library/Application Support/Firefox` with the user's real Firefox.

---

## 3. Build config

### 3.1 The two dead lines

- **`mk_add_options` only sets make variables.**
  - `python/mozbuild/mozbuild/mozconfig.py` sends `mk_add_options` to `make_extra`.
  - Only `export` lines reach configure (`python/mozbuild/mozbuild/controller/building.py` ~1837-1844, ~2004-2038).
  - The objdir's `.mozconfig-client-mk` has both lines; `.mozconfig.mk` doesn't. Both lines are no-ops.
- **`MOZ_TELEMETRY_REPORTING` is a real configure option.**
  - Env-style, `default=mozilla_official`, define only (`toolkit/moz.configure:1138-1144`). An empty value turns it off (`python/mozbuild/mozbuild/configure/options.py:454-456`). Mozilla uses `ac_add_options MOZ_TELEMETRY_REPORTING=` itself, e.g. `browser/config/mozconfigs/win64/nightly-asan:13`.
  - Locally it is already off: objdir `dist/bin/modules/AppConstants.sys.mjs` has `MOZ_TELEMETRY_REPORTING: false`, because `MOZILLA_OFFICIAL` is unset.
  - Frontend effects of being off:
    - `DAPTelemetrySender` / `DAPVisitCounter` don't start (`browser/components/BrowserGlue.sys.mjs:1298-1306`).
    - `browser/components/StartupTelemetry.sys.mjs:35-43` and `toolkit/components/ml/content/EngineProcess.sys.mjs:266-275` also check it.
  - Compiled effects (`isOfficialTelemetry`, `toolkit/components/telemetry/core/Telemetry.cpp:746-754`; Glean `glean_disable_upload`, `toolkit/library/rust/gkrust-features.mozbuild:60-61`) belong to Mozilla's prebuilt core, which has telemetry compiled on. Those are handled by the upload prefs.
- **`MOZ_DATA_REPORTING` is not an option.**
  - It is derived from telemetry, health report, crash reporter and Normandy (`toolkit/moz.configure:3517-3531`).
  - Health report and Normandy are forced on for the browser (`browser/moz.configure:6,10`; `project_flag` only accepts implied values, `build/moz.configure/util.configure:532-539`).
  - So it stays on no matter what the mozconfig says.
- **Verdict:** delete both lines. Optionally add `ac_add_options MOZ_TELEMETRY_REPORTING=` as a guard.

### 3.2 `--disable-crashreporter`

- **The option exists** with no `when=` (`toolkit/moz.configure:3485-3506`). Artifact builds only change its Linux default.
- **What it changes locally:**
  - `AppConstants.MOZ_CRASHREPORTER=false`, so these don't initialize (`BrowserGlue.sys.mjs:124-129, 978-983`):
    - `UnsubmittedCrashHandler`, which also removes the unsubmitted-report prompt, auto-submit, and the Remote Settings "crash pull" (`browser/modules/ContentCrashHandlers.sys.mjs:804`);
    - `CrashFileCleaner`.
  - The tab/subframe crash-report UI is off (`ContentCrashHandlers.sys.mjs:128`).
  - `crashreporter.app` and `crashhelper` drop out of the package manifest (`browser/installer/package-manifest.in:394-411`).
  - `crashhelper` drops out of the dev `.app` (`browser/app/macbuild/Contents/MacOS-files.in:16-18`).
- **Runtime:**
  - The prebuilt launcher still sets the crash-reporter flag, so `XRE_mainInit` installs the in-process exception handler (`toolkit/xre/nsAppRunner.cpp:4574-4584`).
  - Without `crashhelper`, `OOPInit` just warns. INFERRED: no child-process minidumps.
  - A main-process crash still writes a minidump locally.
  - The report-sending program is not in a packaged app, so nothing goes to crash-reports.mozilla.com. Its own crash ping isn't sent either (`toolkit/crashreporter/client/app/src/logic.rs:104-122`).
  - On the next start, `CrashManager` would send a Glean "crash" ping only if `datareporting.healthreport.uploadEnabled` is true (`toolkit/components/crashes/CrashManager.in.sys.mjs:792-800`). That's off in the draft.
- **Dev builds still contain `crashreporter.app`.**
  - `artifacts.py` always copies it into `dist/bin`, and `MacOS-files.in` copies every `/*.app` (seen in `dist/Nightly.app/Contents/MacOS`).
  - `mach run` sets `MOZ_CRASHREPORTER_DISABLE=1` by default (`python/mozbuild/mozbuild/mach_commands.py:2657-2660`), which fully disables the handler (`mozglue/misc/RuntimeExceptionModule.cpp:88-103`). But direct launches like `tools/test_api.py` don't.
  - That program reads the upload pref only as a user value from `prefs.js` and defaults to true (`toolkit/crashreporter/client/app/src/glean.rs:35-55`). So a crash during a direct dev launch could still send a crash ping. The step 4 test should know this.
- **Minor:** about:crashes is still registered by the prebuilt core but its page isn't built. INFERRED: it shows as a broken page.
- **Verdict:** add `ac_add_options --disable-crashreporter`.
- **Fully disabling the in-process handler** needs `MOZ_CRASHREPORTER_DISABLE=1` at launch. For Finder launches that means `LSEnvironment` in `browser/app/macbuild/Contents/Info.plist.in`, which is a Firefox file. Not worth it: nothing is sent without the report-sending program.

### 3.3 `--disable-updater`

- **The option exists** (`build/moz.configure/update-programs.configure:25-39`). Nothing ties it to artifact builds.
  - The update agent's default follows it (213-244).
  - `ChannelPrefs.framework` doesn't depend on it.
  - Linux distributions ship Firefox this way, so the JS paths are exercised.
- **What it changes locally:** `toolkit/mozapps/update` isn't built (`toolkit/moz.build:43-44`). That removes:
  - `UpdateService`, `UpdateServiceStub`, `AppUpdater`, `UpdateListener`, `BackgroundUpdate`;
  - `nsUpdateService.manifest`, the update timer registration;
  - `updater.app` from the package (`package-manifest.in:38-40, 61-63, 379-385`).
- **`AppConstants.MOZ_UPDATER=false`** turns off the about dialog and Settings update UI, the old-build check, and the background update task. The update-related `BrowserComponents.manifest` entries are `#ifdef MOZ_UPDATER` (188-191, 219-221).
- **Artifact-build wrinkle.**
  - The prebuilt core's static component table still registers `UpdateServiceStub` for `profile-after-change` (`toolkit/mozapps/update/components.conf:28-35`), but its JS module is gone.
  - The category manager logs "could not create service" and continues (`xpcom/components/nsCategoryManager.cpp:655-663`).
  - Other callers check `AppConstants.MOZ_UPDATER` or use try/catch (e.g. `BrowserContentHandler.sys.mjs:809-1032`).
  - INFERRED: one harmless console error at startup. Verify after the build.
- **Prebuilt C++ at startup** only looks for a pending update in a local folder (`toolkit/xre/nsUpdateDriver.cpp`); no network.
- **Verdict:** add `ac_add_options --disable-updater`. Clobber the objdir after changing it.

### 3.4 Exact `configs/common/mozconfig` change

Replace:

```
# No telemetry uploads.
mk_add_options MOZ_TELEMETRY_REPORTING=
mk_add_options MOZ_DATA_REPORTING=
```

with:

```
# Privacy (docs/privacy/decisions.md). Artifact builds use Mozilla's
# prebuilt core, so telemetry itself is switched off by Neeko's prefs;
# these remove the programs and frontend code that would contact Mozilla.
# No app updates from Mozilla (no update checks to aus5.mozilla.org).
ac_add_options --disable-updater
# No crash reporter: no reports or crash pings to Mozilla.
ac_add_options --disable-crashreporter
# Keep Firefox's own telemetry build flag off even if MOZILLA_OFFICIAL is
# ever set. (Already off in local builds; no effect on Mozilla's prebuilt core.)
ac_add_options MOZ_TELEMETRY_REPORTING=
```

**Also dead (Surfer-generated, in `engine/mozconfig`, not Neeko's file):**
- `export MOZ_APPUPDATE_HOST=localhost:7648`. Nothing defines this configure option (`build/moz.build:95-97` reads `CONFIG`, which is never set). It doesn't matter at runtime anyway (section 2).
- `mk_add_options ACCEPTED_MAR_CHANNEL_IDS=unofficial`.

### 3.5 Windows (for later)

`default-browser-agent.enabled=false` is in the draft and works at runtime: the agent exits immediately, and the pref is mirrored to the registry by `nsAppRunner.cpp:6207`. `configs/windows/mozconfig` could also add `ac_add_options --disable-default-browser-agent` (`update-programs.configure:253-270`). Not verified against artifact builds on Windows.

---

## 4. App updates (#33) without policies

**No pref stops the check:**
- `app.update.url` no longer exists (`browser/app/profile/firefox.js:160-164`). The URL is `Services.appinfo.updateURL`, from the prebuilt launcher (`nsAppRunner.cpp:1161-1167`).
- `UpdateServiceStub.updateDisabled` is true only for the `DisableAppUpdate` policy, automation or packaged apps (`toolkit/mozapps/update/UpdateServiceStub.sys.mjs:196-216`).
- `app.update.disabledForTesting` only counts under automation, Marionette or the remote agent.
- `app.update.auto` only controls downloading.
- `app.update.interval` is capped at 86400 (`UpdateTimerManager.sys.mjs:194-200`).

**Ways that do work:**
1. **`--disable-updater` (recommended):** removes the code that checks.
2. **Policy `DisableAppUpdate`:** brings the downsides in section 5.
3. **`-app` / `--override` with an empty `[AppUpdate] URL=`:** needs a launch argument. Not practical.

**Related:**
- GMP plugin updates and system add-on updates don't depend on the updater. They have their own prefs (section 9, and the draft).
- `app.update.langpack.enabled` in the draft is moot once the updater is gone (its only reader is `UpdateService.sys.mjs:6258`). It's kept so the decision still holds if a Neeko browser brings its own updater back.

---

## 5. Enterprise policies (`policies.json`): worth it?

### How they load

- The policy engine is always built and started. There's no build flag for it.
- `--disable-system-policies` only turns off the OS-level sources (`toolkit/moz.configure:4313-4318`).
- It starts at `policies-startup`, before telemetry, Normandy and Nimbus (`toolkit/xre/nsXREDirProvider.cpp:645-656`), so policies do work on first launch.
- On macOS the file is `<App>.app/Contents/Resources/distribution/policies.json` (`toolkit/components/enterprisepolicies/EnterprisePoliciesParent.sys.mjs:659-688`).
- macOS managed defaults for the app's bundle ID replace it policy by policy (812-845).

### What appears when any policy is active

- **about:preferences** shows a banner at the top linking to about:policies: **"Your browser is being managed by your organization."**
  - `browser/components/preferences/preferences.xhtml:233-239`, string `managed-notice-nav` (`browser/locales/en-US/browser/preferences/preferences.ftl:52-53`).
  - Shown when `Services.policies.status == ACTIVE` (`browser/components/preferences/preferences.js:1166-1172`).
  - No pref hides it.
- **about:policies** lists every policy. **about:support** shows "Enterprise Policies: Active" (`toolkit/content/aboutSupport.js:185-216`).
- With `DisableAppUpdate`, Settings and About say **"Updates disabled by your organization"** (`aboutDialog.ftl:39-41`).
- Neeko hides Firefox's window UI, but these about: pages still open in tabs.

### Side effects beyond the banner, whenever any policy is active

1. **Google searches change.** Google search URLs get `channel=entpr` instead of the normal value (`EnterprisePoliciesParent.sys.mjs:594-613` → `toolkit/components/search/ConfigSearchEngine.sys.mjs:736-761`; `search-config-v2.json:2627-2641`). Google learns "enterprise-managed browser" on every search.
2. The DoH rollout heuristics turn off (`toolkit/components/doh/DoHHeuristics.sys.mjs:294-305`). Harmless for us, since we turn the rollout off anyway.
3. Web Serial defaults to off (`EnterprisePoliciesParent.sys.mjs:146-149`).
4. **Features a policy disallows can never be re-allowed** at runtime. There's no API for it (`EnterprisePoliciesParent.sys.mjs:616`). A browser built on Neeko would have to edit or replace Neeko's `policies.json` at build time.
5. **Override rules are OS-specific.**
   - macOS: MDM or `defaults write <bundle id> EnterprisePoliciesEnabled` can replace Neeko's policies.
   - Linux: `/etc/<app name>/policies/policies.json` replaces the bundled file. INFERRED: the app name is "Firefox" in artifact builds, so a system-wide Firefox policy would take over.
6. **`DisableTelemetry` blocks about:telemetry** (`browser/components/enterprisepolicies/helpers/PoliciesHelpers.sys.mjs:496-564`). Step 4 wants to check that page.

### What policies can do that prefs can't

| Policy | What it does (`browser/components/enterprisepolicies/Policies.sys.mjs`) | Needed for Neeko? |
|---|---|---|
| `DisableAppUpdate` (:1038-1044) | Stops all update checks | No: `--disable-updater` does it |
| `UserMessaging: {"FirefoxLabs": false}` (:3666-3668) | The only way to turn off Firefox Labs, and with it the Nimbus experiment-list download (`toolkit/components/nimbus/ExperimentAPI.sys.mjs:480-486`) | The only real gain (see below) |
| `DisableTelemetry` (:1346-1368) | Sets and locks the 4 upload prefs; blocks about:telemetry | No: prefs do it, and the block would get in step 4's way |
| `DisableFirefoxStudies`, `DisableRemoteImprovements`, `FirefoxHome`, `FirefoxSuggest`, `DNSOverHTTPS`, `CaptivePortal`, `SearchSuggestEnabled`, `DisableAccounts`, `GenerativeAI`/`AIControls`, `EncryptedMediaExtensions`, `OverrideFirstRunPage`, `SkipTermsOfUse`, `DisableSystemAddonUpdate` | Only set, and sometimes lock, prefs | No: the draft sets the same prefs |
| `DisableRemoteSettingsAndAcceptSecurityConsequences` | Would kill CRLite and the blocklists | Never |

### Recommendation

**Don't ship `policies.json`.**
- After `--disable-updater`, the only benefit is turning off Firefox Labs. Without it, Nimbus downloads the experiment list from Remote Settings (the same host we keep) at startup and every 6 hours.
- It enrolls in nothing unless the user opts into a Labs feature in about:preferences#experimental: rollouts and studies are off, and only opt-in recipes are eligible (`toolkit/components/nimbus/lib/RemoteSettingsExperimentLoader.sys.mjs:1068-1075`).
- That doesn't justify the costs above: the banner, Google seeing `channel=entpr`, features a browser built on Neeko can't re-allow, and OS-level override rules.

**Revisit if** step 4 must show zero Nimbus traffic. Then the minimal file is `{"policies": {"UserMessaging": {"FirefoxLabs": false}}}`.

**Rejected alternative.** Neeko code could call `EnterprisePoliciesManager.prototype.disallowFeature("FirefoxLabs")` from `browser-before-ui-startup`, with no banner. It relies on a private Firefox internal (`EnterprisePoliciesParent.sys.mjs:362-375, 616`) and could break on any update.

**Locked prefs instead of policies?** Policy research noted that `pref(..., locked)` is as strong as a policy lock, and no banner appears. The draft deliberately doesn't lock:
- Users couldn't change the prefs.
- A browser built on Neeko couldn't override them from its own prefs file, because locked defaults ignore later files (`Preferences.cpp:888-907`). It would have to edit Neeko's file, which breaks "Neeko updates never conflict".
- Never lock `media.eme.enabled`: Firefox hides its "enable DRM" prompt when that pref is locked (`dom/media/eme/MediaKeySystemAccessManager.cpp:428-433`).

---

## 6. First launch: every connection from the baseline capture, and what stops it

| Host in the capture (`inventory.md`) | Stopped by |
|---|---|
| `location.services.mozilla.com` (0 s) | `browser.region.network.url=""`. `Region.#getRegion` returns early with no URL, and the failure counts as no error, so no retries (`toolkit/modules/Region.sys.mjs:378-383`). Plus `browser.region.update.enabled=false` |
| `firefox-portal-detection.com` | `network.captive-portal-service.enabled=false`, `network.connectivity-service.enabled=false` |
| `ads.mozilla.org`, `ads-img.mozilla.org` | `showSponsoredTopSites=false` (`browser/extensions/newtab/lib/TopSitesFeed.sys.mjs:621-633`), `showSponsored=false` |
| `merino…`, `img-getpocket…`, OHTTP relay/gateway | `feeds.section.topstories=false` and `feeds.system.topstories=false` (`browser/extensions/newtab/lib/DiscoveryStreamFeed.sys.mjs:278-293, 2216-2224`). Glean OHTTP pings are off via the upload prefs |
| `push.services.mozilla.com` | `dom.push.enabled=false`. The push service throws `NS_ERROR_NOT_AVAILABLE` and BrowserGlue expects that (`dom/push/PushComponents.sys.mjs:19-28`; `BrowserGlue.sys.mjs:1106-1118`) |
| `mozilla.cloudflare-dns.com` | `doh-rollout.enabled=false`. The pref beats the Remote Settings `doh-config` (`toolkit/components/doh/DoHConfig.sys.mjs:55-63, 96-108` (the getter's comment says a pref value "gets top priority" over Remote Settings); `DoHController.sys.mjs:155`). Region unknown also keeps the Remote Settings config at "global" (rollout off) |
| `www.mozilla.org` + `transcend-cdn.com` (privacy notice tab) | `datareporting.policy.dataSubmissionEnabled=false` (`toolkit/components/telemetry/app/TelemetryReportingPolicy.sys.mjs:865-870, 1045-1047`). Welcome and What's New pages: `browser.startup.homepage_override.mstone="ignore"` (`browser/components/BrowserContentHandler.sys.mjs:158-166`), `browser.aboutwelcome.enabled=false`. Terms-of-Use modal: `termsofuse.bypassNotification=true` (`TelemetryReportingPolicy.sys.mjs:941-949`) |
| `aus5.mozilla.org`, app update | `--disable-updater` |
| `aus5.mozilla.org`, GMP plugin list | **Not stopped.** One check at the first idle, then daily (section 9) |
| `normandy.cdn.mozilla.net`, `classify-client…` | `app.normandy.enabled=false` (`toolkit/components/normandy/lib/RecipeRunner.sys.mjs:198-205`). `classify-client` is only used by Normandy (`toolkit/components/normandy/lib/ClientEnvironment.sys.mjs:30-35`) |
| `firefox.settings.services.mozilla.com` + CDNs | Kept (Remote Settings). Also includes Nimbus experiments, Normandy recipes and non-security collections (section 9) |
| `incoming.telemetry.mozilla.org` (16 s) | `datareporting.healthreport.uploadEnabled=false`, which Glean reads at init (`toolkit/components/glean/src/init/mod.rs:43`). On a fresh profile Glean sends no deletion-request (`third_party/rust/glean-core/src/core/mod.rs:491-528`). Also `datareporting.usage.uploadEnabled=false` (the usage ping ignores the main switch: `toolkit/components/telemetry/pings.yaml:22`) |
| `update.googleapis.com`, `ciscobinary.openh264.org`, `www.google.com` | `media.gmp-gmpopenh264.enabled=false`, `media.eme.enabled=false`, `media.gmp-widevinecdm.allow-chromium-update=false` (`toolkit/modules/GMPInstallManager.sys.mjs:395-406, 625-640`; `toolkit/modules/GMPUtils.sys.mjs:27-40`) |
| `services.addons.mozilla.org` (30 s) | `extensions.getAddons.cache.enabled=false` (`toolkit/mozapps/extensions/internal/AddonRepository.sys.mjs:38-44, 349`) |

**Other Glean pings that ignore the main upload switch** (`follows_collection_enabled: false`):
- `usage-reporting`, `usage-deletion-request`: `datareporting.usage.uploadEnabled=false`. The deletion ping only fires on a true-to-false change (`toolkit/components/telemetry/app/UsageReporting.sys.mjs:130-165`), which never happens on a fresh profile.
- `fx-accounts-client-info`: only when signed in (`browser/components/AccountsGlue.sys.mjs:125-130`). Off via `identity.fxaccounts.telemetry.clientInfoPing.enabled=false` and Accounts off.
- `quick-suggest` / `quick-suggest-deletion-request`: only when AMP suggestions are on (`browser/components/urlbar/private/AmpSuggestions.sys.mjs:88-100`). Suggest is off.
- `onboarding-opt-out`: only on a user action in onboarding (`toolkit/components/messaging-system/lib/SpecialMessageActions.sys.mjs:795-814`).
- `context-id-deletion-request`: see section 10 (dormant).

**For the step 4 test:**
- **Don't launch with `-marionette`** (as `tools/test_api.py` does), or set `remote.prefs.recommended=false`. Marionette applies its "recommended prefs" (`remote/components/Marionette.sys.mjs:173` → `remote/shared/RecommendedPreferences.sys.mjs`), which turn off captive portal, telemetry and much more. That would hide exactly the defaults we're testing.
- Marionette also makes `app.update.disabledForTesting` effective (`UpdateServiceStub.sys.mjs:196-205`).

---

## 7. Remote debugging

**The draft turns off:**
- `devtools.chrome.enabled`
- `devtools.debugger.remote-enabled`

Both are defined `sticky` in `modules/libpref/init/all.js:3989-3998` (true in non-official builds).

**The Browser Toolbox needs both** (`devtools/client/framework/browser-toolbox/Launcher.sys.mjs:59-65`; `devtools/server/devtools-server.js:244`; `devtools/shared/security/socket.js:394-397`).

**`devtools.debugger.prompt-connection`:**
- It is true on non-Nightly builds (`all.js:3982-3987`; objdir `greprefs.js:1525`). Neeko's 156.0.1 build isn't Nightly.
- So every Browser Toolbox connection shows an accept prompt unless it's false (`devtools/shared/security/auth.js:168-171`).

**Makefile `run` target:**

```
run:
	cd $(ENGINE) && ./mach run --setpref neeko.ui.path=$(CURDIR)/ui \
		--setpref devtools.chrome.enabled=true \
		--setpref devtools.debugger.remote-enabled=true \
		--setpref devtools.debugger.prompt-connection=false
```

**How `--setpref` works:**
- `mach run --setpref` writes these as user values into the profile's `user.js` through mozprofile (`python/mozbuild/mozbuild/mach_commands.py:2583-2598`).
- User values override the defaults. Because the prefs are sticky, they stay in `prefs.js` of `obj-*/tmp/profile-default` afterwards.
- `mach run` also sets `MOZ_CRASHREPORTER_DISABLE=1` for dev launches (`mach_commands.py:2657-2660`).

---

## 8. KEEP items: checked that nothing breaks

- **CRLite (#26).**
  - `security.pki.crlite_mode` defaults to **2 (enforce)** in 156 (`modules/libpref/init/StaticPrefList.yaml:18950-18960`). Filters download through Remote Settings when `security.remote_settings.crlite_filters.enabled=true` (`all.js:58`; `security/manager/ssl/RemoteSecuritySettings.sys.mjs:613`).
  - It doesn't need push: Remote Settings polls daily on its own timer (`services/settings/servicesSettings.manifest:7`; `services.settings.poll_interval`, `all.js:1758`). The arkenfox/Betterfox "push is required for CRLite" claim is outdated. Push only makes updates arrive faster.
  - With OCSP off, CRLite still decides for covered certificates. In enforce mode it returns before OCSP even for EV (`security/certverifier/NSSCertDBTrustDomain.cpp:775-796`).
  - Uncovered certificates only get stapled OCSP (`security/manager/ssl/nsNSSComponent.cpp:221-231`).
  - **Don't set `crlite_mode`**: the default is right, and no setting is required by turning OCSP or push off.
- **OneCRL and intermediates:** come through Remote Settings (`security-state` bucket), unaffected.
- **Remote Settings (#25):** nothing in the draft touches it. Policy `DisableRemoteSettingsAndAcceptSecurityConsequences` is not used.
- **Tracking-protection lists (#30):**
  - Separate from the Google Safe Browsing features. `SafeBrowsing.sys.mjs` gates phishing/malware/downloads separately from the tracking tables (31-110), so turning off `malware`/`phishing` doesn't touch them.
  - Their lists come from Remote Settings (`toolkit/components/url-classifier/UrlClassifierRemoteSettingsService.sys.mjs:10`).
- **Add-on blocklist (#31), add-on updates (#34), MITM detection (#32), backup-domain fallback (#24):** not touched.
- **Geolocation (#18):** not touched.

---

## 9. Things prefs and build flags can't do

1. **Remote Settings collection filtering.**
   - Remote Settings syncs every main-bucket collection that has a bundled data file or a local DB, whether or not its feature is on (`services/settings/remote-settings.sys.mjs:188-212, 533-538`).
   - Bundled files (`services/settings/dumps/main/`) include `search-telemetry-v2`, `sites-classification`, `newtab-*`, `top-sites`, `translations-*`, `ai-window-prompts` and others.
   - Normandy creates its recipes client even when disabled (`RecipeRunner.sys.mjs:236-251`). Nimbus fetches the experiment list for Labs.
   - All of this goes to the Remote Settings host we keep, and sends nothing about you beyond what the security lists already reveal.
   - "Only security collections" needs a source patch like LibreWolf's `rs-blocker.patch`.
   - **Recommendation:** accept for now, and have step 4 report which collections sync rather than fail on them. Decide on a patch later.
2. **Firefox Labs / Nimbus:** policy only (section 5).
3. **Codec and DRM plugins (#37): "nothing at startup".**
   - Firefox's idle-time plugin check (`BrowserGlue.sys.mjs:1368-1376`) always fetches the plugin list from aus5.
   - It stops only with `media.gmp-manager.updateEnabled=false` (`GMPInstallManager.sys.mjs:290-293`). But then saying yes to DRM installs nothing, because the prompt uses the same check (`toolkit/mozapps/extensions/internal/GMPProvider.sys.mjs:515-571`).
   - The draft does OpenH264 off, DRM off until the prompt, and no Google contact. **One aus5.mozilla.org request per day remains** (version, OS, locale, channel in the URL).
   - **Option A (recommended, about 10 lines of Neeko code):** default `media.gmp-manager.updateEnabled=false`, and have a Neeko startup module set it to true when `media.eme.enabled` turns true.
     - The prompt waits 10 seconds before its check (`GMP_CHECK_DELAY`, `GMPProvider.sys.mjs:29, 557-573`), so an observer that flips the pref right away is in time.
     - Nothing at startup, Widevine on demand, updates after that.
   - **Option B (prefs-only, not recommended):** `media.gmp-manager.url="data:text/plain,"`.
     - The check fails without any network request, and Firefox falls back to its bundled plugin list (`GMPInstallManager.sys.mjs:298-326`; `toolkit/content/gmp-sources/widevinecdm.json`).
     - But Firefox never installs updates from that fallback (`GMPInstallManager.sys.mjs:615-623`), so Widevine would stay at its first version forever.
   - Separately, the "enable DRM" prompt lives in the tab's notification bar, part of Firefox's UI. Whether Neeko's custom UI shows it depends on the roadmap's permission fallbacks.
4. **Crash handler fully off:** only `MOZ_CRASHREPORTER_DISABLE=1` at launch (section 3.2). Not needed.
5. **App updates:** build flag, done (section 3.3).
6. **Firefox Suggest (#15-16) and address-bar weather (#14) once a region is known.**
   - `QuickSuggest.#initPrefs` writes region-based values onto the default branch at runtime for US/DE/FR/GB/IT, including sponsored results (`browser/components/urlbar/QuickSuggest.sys.mjs:73-190, 829-926`). That overrides any default from a prefs file.
   - Firefox's own defaults are already off (`firefox.js:561-621`).
   - Neeko's protection is region detection being off (#17), so `Region.home` stays null and no region matches (`QuickSuggest.sys.mjs:671-690`).
   - If a user or browser ever sets `browser.search.region`, Suggest comes on in those regions. Locking the prefs is the only prefs-level fix.
   - **Recommendation:** leave as is, and document that setting a region re-enables Suggest.
7. **Search suggestions via the Neeko API later (#38).** `browser.search.suggest.enabled=false` also turns off Firefox's `SearchSuggestionController` (`toolkit/components/search/SearchSuggestionController.sys.mjs:23`). The roadmap API will need to fetch suggestions on explicit request, bypassing this pref, or pass a per-request override.

---

## 10. Prefs considered and left out

**Not needed:**

| Pref | Why left out |
|---|---|
| `browser.tabs.crashReporting.sendReport` | Only read by the tab-crash UI, which `--disable-crashreporter` turns off (`ContentCrashHandlers.sys.mjs:128, 697`) |
| `browser.contextual-services.contextId.rotation-in-days` | A context-ID rotation would send `context-id-deletion-request`, which ignores the upload switch (`browser/modules/ContextId.sys.mjs:66-72`). But the ID is only requested by sponsored features (off) and search engines with a `clickUrl` (none in the 156 search config). Dormant. Optional hardening |
| `browser.urlbar.quicksuggest.enabled`, `browser.urlbar.suggest.quicksuggest.*`, `browser.urlbar.weather.featureGate`, `browser.urlbar.suggest.weather` | Overwritten at runtime by region (section 9.6). Already off by default when no region is known |
| `browser.urlbar.trending.featureGate`, `browser.urlbar.suggest.searches` | `browser.search.suggest.enabled=false` already stops remote and trending suggestions in the address bar (`browser/components/urlbar/UrlbarProviderSearchSuggestions.sys.mjs:95-117, 161-178`) |
| `toolkit.telemetry.enabled/unified/archive.enabled/server`, `*PingEnabled` | Local recording, or already covered by the upload switch |
| `app.normandy.api_url` | Normandy is off |
| `datareporting.policy.firstRunURL`, `…BypassNotification` | `dataSubmissionEnabled=false` returns before either is read |
| `startup.homepage_welcome_url(.additional)`, `startup.homepage_override_url` | The branding file sets these and loads after Neeko. `mstone="ignore"` covers them |
| `browser.newtabpage.activity-stream.system.showSponsored`, `…showWeather`, `…widgets.weather.enabled`, `…unifiedAds.*`, `browser.topsites.contile.enabled` | The user-level and system switches in the draft are enough (`TopSitesFeed.sys.mjs:621-633`, `DiscoveryStreamFeed.sys.mjs:278-293`, `WeatherFeed.sys.mjs:69-78`) |
| `…asrouter.useRemoteL10n` | Only used by the CFR provider, which is off |
| `browser.tabs.groups.smart.enabled` | Needs `browser.ml.enable` (`browser/components/tabbrowser/SmartTabGrouping.sys.mjs:338-347`) |
| `dom.push.connection.enabled` | `dom.push.enabled=false` also hides the Push API from websites, so they degrade cleanly instead of failing to subscribe |
| `network.trr.mode` | The decision is "system DNS unless someone picks a provider". Mode 0 is Firefox's default, and the rollout is off |
| `security.pki.crlite_mode` | The default (2) is right |
| `browser.uitour.enabled` | Not a connection |
| `browser.preferences.moreFromMozilla` | Not in the decisions |
| `extensions.ml.enabled` | The WebExtensions ML trial needs `browser.ml.enable` (`toolkit/components/extensions/parent/ext-trial-ml.js:22`) |

**Don't exist in 156** (reference lists still set them):
- `toolkit.telemetry.coverage.opt-out`
- `browser.ping-centre.telemetry`
- `dom.private-attribution.submission.enabled`
- `toolkit.telemetry.dap_enabled`
- `browser.newtabpage.activity-stream.feeds.snippets`
- `extensions.pocket.*`
- `messaging-system.rsexperimentloader.enabled`
- `browser.preferences.experimental`
- `browser.messaging-system.whatsNewPanel.enabled`
- `network.trr.resolvers`
- `browser.attribution.enabled`

(Also see `reference-projects.md` section 5.) None of these are in the draft.

---

## 11. Doubts and things step 4 must confirm

1. **`--disable-updater` in artifact mode** (INFERRED OK). Expect one "could not create service … nsUpdateServiceStub" console message. Check that about:preferences opens cleanly and no aus5 app-update request appears.
2. **`--disable-crashreporter`.** Check that about:crashes and about:support don't throw in ways that matter. The in-process handler stays on in shipped builds; minidumps stay local.
3. **GMP.** One aus5 plugin-list request per day will show up (section 9.3). Decide: Option A, or allow it in the test.
4. **`browser.startup.homepage_override.mstone="ignore"`** also skips the "What's New" logic for Neeko browsers' own updates. A browser that wants a first-run page must set it to `""` in its branding prefs. `BrowserHandler.firstRunProfile` stays false; only hidden UI uses it (`browser/components/places/PlacesBrowserStartup.sys.mjs:350`, Windows MSIX pinning).
5. **`datareporting.policy.dataSubmissionEnabled=false`** makes the legacy Telemetry opt-in need two prefs (this and `healthreport.uploadEnabled`). That's intended for KILL.
6. **`signon.firefoxRelay.feature=""`** relies on the "unknown value → disabled, not offered" path (`toolkit/components/passwordmgr/LoginHelper.sys.mjs:1886-1941`). `"disabled"` would still show the Settings checkbox.
7. **The ASRouter provider JSON copies** mirror `firefox.js:2041-2044` with `"enabled":false`. If Mozilla changes those JSON values in a later version, re-copy them. The step 4 test and the post-update re-check should look.
8. **`browser.ai.control.default="blocked"`** is mainly for the Settings display and the hidden app menu (`browser/components/customizableui/content/panelUI.js:103-111`). It doesn't turn features off by itself; the feature prefs do.
9. **The run-time app identity is "Firefox"** (section 2, INFERRED). This affects the profile location and the Linux policy path. Not a privacy-pref issue, but it matters for shipping.
10. **The Marionette recommended prefs** would mask the results of a Marionette-driven privacy test (section 6).

---

## 12. Every pref in the draft

In the table:
- "Defined at" is where the 156 default comes from. **SPL** = `modules/libpref/init/StaticPrefList.yaml` (compiled into Mozilla's core; a prefs file overrides it, `Preferences.cpp:6016-6018`). **AS** = defined at runtime by New Tab's `browser/extensions/newtab/lib/ActivityStream.sys.mjs` PREFS_CONFIG, which skips prefs that already have a default (`ActivityStreamPrefs.sys.mjs:70-80`). **none** = not defined anywhere, so the prefs file defines it.
- "FF.js" in caveats means `firefox.js` also sets it, so the file-name fix in section 1 is required.
- "Default OK" means it works as a `pref()` default: read after default prefs load, in the parent process or via shared prefs.

| Pref | Value | Row | Defined at | Read at | Caveats |
|---|---|---|---|---|---|
| `datareporting.healthreport.uploadEnabled` | false | 1-3 | `all.js:3779`; SPL:2523 | `toolkit/components/glean/src/init/mod.rs:43`; `TelemetrySend.sys.mjs:1606-1609`; `CrashManager.in.sys.mjs:792-796`; `ExperimentAPI.sys.mjs:44,456-477` | Default OK. **Crash reporter client reads only the prefs.js user value** (`crashreporter/client/app/src/glean.rs:35-55`); mitigated by `--disable-crashreporter` in packaged builds |
| `datareporting.usage.uploadEnabled` | false | 1-3 | `all.js:3780` | `toolkit/components/telemetry/app/UsageReporting.sys.mjs:39-53` | Default OK. Ping ignores main switch (`toolkit/components/telemetry/pings.yaml:22`) |
| `datareporting.policy.dataSubmissionEnabled` | false | 1-3, 11 | `all.js:3763` | `TelemetryReportingPolicy.sys.mjs:437-442, 823-828, 865-870, 1045-1047` | Default OK |
| `toolkit.telemetry.shutdownPingSender.enabled` | false | 1-3 | `firefox.js:2583` | `toolkit/components/telemetry/pings/TelemetrySession.sys.mjs:1010-1014, 1036-1040` | FF.js. Defense in depth (upload switch already blocks) |
| `identity.fxaccounts.telemetry.clientInfoPing.enabled` | false | 1-3 | `firefox.js:2518` | `browser/components/AccountsGlue.sys.mjs:26-32, 125-130` | FF.js. Ping ignores main switch (`services/fxaccounts/pings.yaml:39`) |
| `default-browser-agent.enabled` | false | 1-3 | `firefox.js:3536` (`#ifdef XP_WIN`) | `toolkit/mozapps/defaultagent/DefaultAgentScheduler.sys.mjs:27`; `toolkit/xre/nsAppRunner.cpp:283, 2554, 6207` | FF.js. Windows only; mirrored to the registry for the separate agent; default OK |
| `browser.crashReports.onDemand` | false | 5 | SPL:1517 | `toolkit/components/crashes/RemoteSettingsCrashPull.sys.mjs:31-34` | Default OK. Redundant while `--disable-crashreporter` |
| `app.normandy.enabled` | false | 6 | `firefox.js:3023` | `RecipeRunner.sys.mjs:43, 198-205` | FF.js. The Normandy Remote Settings client still syncs its collection (section 9.1) |
| `app.shield.optoutstudies.enabled` | false | 6 | `firefox.js:3031` (`#ifdef MOZ_DATA_REPORTING`) | `ExperimentAPI.sys.mjs:45, 456-477` | FF.js |
| `nimbus.rollouts.enabled` | false | 6 | `firefox.js:2266` | `ExperimentAPI.sys.mjs:43, 456-460, 488-493` | FF.js. Labs still enables Nimbus (policy only) |
| `browser.search.serpEventTelemetryCategorization.enabled` | false | 8 | `firefox.js:998` | `browser/components/search/SERPCategorization.sys.mjs:26-40, 143` | FF.js |
| `browser.discovery.enabled` | false | 9 | `firefox.js:3067` | `browser/modules/Discovery.sys.mjs:15, 28-30`; `toolkit/mozapps/extensions/content/aboutaddons-utils.mjs:75, 885-891` | FF.js. Also needs upload on, so doubly off |
| `extensions.getAddons.showPane` | false | 9 | none | `aboutaddons-utils.mjs:72, 90-95`; `browser/base/content/browser-addons.js:2505` | Default OK |
| `extensions.htmlaboutaddons.recommendations.enabled` | false | 9 | `all.js:3155` | `toolkit/mozapps/extensions/content/aboutaddons.mjs:30-35` | Default OK |
| `…asrouter.providers.cfr` | JSON, enabled:false | 10 | `firefox.js:2043` | `browser/components/asrouter/modules/ASRouterPreferences.sys.mjs:17-18, 114-130`; `ASRouter.sys.mjs:875-880` | FF.js. Keep in sync with `firefox.js` JSON |
| `…asrouter.providers.message-groups` | JSON, enabled:false | 10 | `firefox.js:2041` | same | FF.js |
| `…asrouter.providers.messaging-experiments` | JSON, enabled:false | 10 | `firefox.js:2044` | same | FF.js |
| `…asrouter.providers.onboarding` | JSON, enabled:false | 10 | `firefox.js:2042` | same | FF.js |
| `…asrouter.userprefs.cfr.addons` | false | 10 | `firefox.js:2047` | `ASRouterPreferences.sys.mjs:42-46, 262-265`; `ASRouter.sys.mjs:1008-1013` | FF.js. Settings display; the provider pref is the real switch |
| `…asrouter.userprefs.cfr.features` | false | 10 | `firefox.js:2048` | same | FF.js |
| `browser.startup.homepage_override.mstone` | "ignore" | 11 | none | `browser/components/BrowserContentHandler.sys.mjs:158-166, 810-845` | Default OK. Firefox only writes a user value when not "ignore". See doubt 4 |
| `browser.aboutwelcome.enabled` | false | 10-11 | `firefox.js:2208` | `browser/components/DesktopActorRegistry.sys.mjs:229`; `BrowserGlue.sys.mjs:1746-1749`; `browser/components/asrouter/modules/PreonboardingSplash.sys.mjs:41` | FF.js |
| `termsofuse.bypassNotification` | true | 11 | `firefox.js:1960/1962` (`#ifdef MOZILLA_OFFICIAL`) | `TelemetryReportingPolicy.sys.mjs:38, 941-949` | FF.js. Already true in unofficial builds |
| `browser.newtabpage.activity-stream.showSponsoredTopSites` | false | 12 | AS:373 | `TopSitesFeed.sys.mjs:76, 621-633` | Default OK |
| `browser.newtabpage.activity-stream.showSponsored` | false | 13 | AS:358 | `DiscoveryStreamFeed.sys.mjs:96, 278-284` | Default OK |
| `browser.newtabpage.activity-stream.feeds.section.topstories` | false | 13 | AS:794 | `DiscoveryStreamFeed.sys.mjs:88, 286-293` | Default OK |
| `browser.newtabpage.activity-stream.feeds.system.topstories` | false | 13 | AS:2220 (FEEDS_DATA → `feeds.` prefix, :2418-2421), dynamic | `DiscoveryStreamFeed.sys.mjs:89, 286-293, 2662-2666`; feed creation | Runtime-dynamic pref. A prefs-file default pins it (`ActivityStream.sys.mjs:2684-2692`) |
| `browser.newtabpage.activity-stream.system.showWeather` | false | 14 | AS:487, dynamic | `browser/extensions/newtab/lib/WeatherFeed.sys.mjs:31, 69-78` | Dynamic, pinned as above |
| `browser.newtabpage.activity-stream.widgets.system.weather.enabled` | false | 14 | AS:1398, dynamic | `WeatherFeed.sys.mjs:224-230` (a change triggers a fetch without checking the enabled state) | Dynamic, pinned |
| `browser.region.network.url` | "" | 17 | `all.js:3113` | `Region.sys.mjs:378-383` | Default OK. No retries (null result is not an error) |
| `browser.region.update.enabled` | false | 17 | `all.js:3118` | `Region.sys.mjs:51-55, 177-186` | Default OK |
| `extensions.getAddons.cache.enabled` | false | 35 | `firefox.js:39` | `AddonRepository.sys.mjs:38-44, 349` | FF.js |
| `browser.vpn_promo.enabled` | false | 42 | `firefox.js:2726` | `ASRouter.sys.mjs:2546`; `browser/components/protections/content/protections.mjs:475`; `vpn-card.mjs:90`; `toolkit/modules/BrowserUtils.sys.mjs:911` | FF.js. UI promo, no connection |
| `browser.promo.relay.enabled` | false | 42 | `firefox.js:2736` | `ASRouter.sys.mjs:2548` | FF.js |
| `security.OCSP.enabled` | 0 | 27 | SPL:18813 | `security/manager/ssl/nsNSSComponent.cpp:221-231` (re-read on change, 1709) | Default OK. CRLite stays at its default of 2 |
| `browser.safebrowsing.malware.enabled` | false | 28 | SPL:1942 | `toolkit/components/url-classifier/SafeBrowsing.sys.mjs:46-58, 72-90`; `toolkit/components/reputationservice/ApplicationReputation.cpp:1983` | Default OK. Also turns off local download checks (no lists without a key anyway) |
| `browser.safebrowsing.phishing.enabled` | false | 28 | SPL:1948 | `SafeBrowsing.sys.mjs:31-45` | Default OK |
| `browser.safebrowsing.downloads.remote.enabled` | false | 29 | `all.js:3404` | `ApplicationReputation.cpp:74-75, 1606` | Default OK |
| `extensions.systemAddon.update.enabled` | false | 36 | `firefox.js:56` | `toolkit/mozapps/extensions/AddonManager.sys.mjs:31, 1351-1359` | FF.js |
| `app.update.langpack.enabled` | false | 36 | `firefox.js:180` | `toolkit/mozapps/update/UpdateService.sys.mjs:90, 6258` | FF.js. Moot with `--disable-updater` |
| `network.captive-portal-service.enabled` | false | 19 | `all.js:3280` (false) **and** `firefox.js:1474` (true) | `netwerk/base/nsIOService.cpp:97, 1638-1649` | FF.js: the most visible load-order casualty |
| `network.connectivity-service.enabled` | false | 20 | `all.js:3282` | `netwerk/base/NetworkConnectivityService.cpp:355-360, 539-544` | Default OK |
| `dom.push.enabled` | false | 22 | SPL:4269 | `dom/push/PushComponents.sys.mjs:19-28`; `dom/push/PushManager.cpp:420`; WebIDL `[Pref=]` | Default OK (mirror: always) |
| `doh-rollout.enabled` | false | 21 | none | `toolkit/components/doh/DoHConfig.sys.mjs:21, 41, 55-63, 96-108, 120-126`; `DoHController.sys.mjs:155` | Default OK. The pref beats the Remote Settings `doh-config` |
| `media.gmp-gmpopenh264.enabled` | false | 37 | `firefox.js:2553` | `GMPUtils.sys.mjs:161`; `GMPInstallManager.sys.mjs:534-536, 625-634` | FF.js |
| `media.eme.enabled` | false | 37 | SPL:12353 (false on Linux, true elsewhere) | `dom/media/eme/MediaKeySystemAccessManager.cpp:424-437`; `GMPUtils.sys.mjs:36-38`; `browser/actors/EncryptedMediaParent.sys.mjs:28-37` | Default OK. **Never lock** (the prompt is hidden when locked) |
| `media.gmp-widevinecdm.allow-chromium-update` | false | 37 | `firefox.js:2533` (`#ifdef MOZ_WIDEVINE_EME`) | `GMPUtils.sys.mjs:178`; `GMPInstallManager.sys.mjs:395-406` | FF.js. The aus5 plugin-list check remains (section 9.3) |
| `browser.search.suggest.enabled` | false | 38 | `all.js:3485` | `UrlbarProviderSearchSuggestions.sys.mjs:161-178`; `SearchSuggestionController.sys.mjs:23` | Default OK |
| `browser.translations.enable` | false | 40 | `all.js:3624` (false) **and** `firefox.js:2570` (true) | `toolkit/components/translations/TranslationsFeature.sys.mjs:38-44, 78-88` | FF.js |
| `browser.ml.enable` | false | 41 | `all.js:3673` | `toolkit/components/ml/content/EngineProcess.sys.mjs:1240-1241`; `SmartTabGrouping.sys.mjs:343`; `toolkit/components/pdfjs/content/PdfJsAIFeature.sys.mjs:127` | Default OK. Not re-enabled by AI-controls "Available" |
| `browser.ml.chat.enabled` | false | 41 | `firefox.js:2336` | `browser/components/genai/GenAI.sys.mjs:30-38, 270, 288, 1539-1545` | FF.js |
| `browser.ml.linkPreview.enabled` | false | 41 | `firefox.js:2359` | `browser/components/genai/LinkPreview.sys.mjs:44, 219-231, 241-243` | FF.js |
| `browser.ai.control.default` | "blocked" | 40-41 | `all.js:3664` | `browser/components/preferences/main.js:108, 423`; `browser/components/preferences/config/aiFeatures.mjs:398-425`; `panelUI.js:103-111`; `ExperimentAPI.sys.mjs:42` | Default OK. Display state (doubt 8) |
| `identity.fxaccounts.enabled` | false | 42 | `firefox.js:2464` | `services/fxaccounts/FxAccounts.sys.mjs:62-66, 601, 1053`; `browser/base/content/browser.js:808-812` | FF.js |
| `signon.firefoxRelay.feature` | "" | 42 | `firefox.js:2941` | `toolkit/components/satchel/integrations/FirefoxRelay.sys.mjs:33, 1071`; `LoginHelper.sys.mjs:1886-1941` | FF.js. See doubt 6 |
| `devtools.chrome.enabled` | false | remote debugging | `all.js:3991/3996` (sticky) | `devtools/client/framework/browser-toolbox/Launcher.sys.mjs:59-65`; `devtools/shared/commands/commands-factory.js:81` | Default OK. Sticky: a dev `--setpref true` persists in that profile |
| `devtools.debugger.remote-enabled` | false | remote debugging | `all.js:3993/3997` (sticky) | `Launcher.sys.mjs:59-65`; `devtools/server/devtools-server.js:244`; `devtools/shared/security/socket.js:394-397` | Same |

**How each pref is read:**
- None of these prefs is read before the default pref files load.
- Two are read by separate programs: `healthreport.uploadEnabled` by the crash reporter client (user value only), and `default-browser-agent.enabled` by the Windows agent (via the registry, written from the effective value).
- None is sticky except the two devtools prefs, which Firefox itself declares sticky.
