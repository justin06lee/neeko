# Firefox 156.0.1: network endpoints contacted by default (inventory from source)

Source: `engine/` at `d9b85be608 "Firefox 156.0.1"`. All paths are relative to
`/Volumes/T7/Stockpile/Workspace/github.com/justin06lee/neeko/engine`. Every pref,
host and flag below was found with `git grep` at the file:line given. "Local objdir"
refers to `engine/obj-aarch64-apple-darwin25.6.0` (the existing Neeko artifact build),
which I read but did not modify. Anything marked **inferred** is a deduction from source
and was not observed in a running binary.

---

## 0. Artifact builds: which parts are yours and which are Mozilla's

| Layer | Built locally (Neeko controls it) | Taken prebuilt from Mozilla's shippable 156.0.1 build | Evidence |
|---|---|---|---|
| Default pref files `browser/app/profile/firefox.js`, `modules/libpref/init/all.js` (becomes `greprefs.js`), branding prefs | Yes. Preprocessed with **local** `#ifdef`s | | objdir `dist/bin/greprefs.js:1447` has `datareporting.healthreport.uploadEnabled true`; `dist/bin/browser/defaults/preferences/firefox.js` exists |
| `toolkit/modules/AppConstants.sys.mjs` (JS build flags and API keys) | Yes | | objdir `dist/bin/modules/AppConstants.sys.mjs`: `MOZILLA_OFFICIAL: false`, `MOZ_TELEMETRY_REPORTING: false`, `MOZ_DATA_REPORTING: true`, `MOZ_GOOGLE_SAFEBROWSING_API_KEY: "no-google-safebrowsing-api-key"` |
| `*.manifest` category registrations (for example `browser/components/BrowserComponents.manifest`) | Yes, preprocessed | | `BrowserComponents.manifest:17-19` `#ifdef MOZ_NORMANDY` |
| `application.ini` (crash reporter on/off plus ServerURL, AppUpdate URL) | Yes | | `build/moz.build:95-97`, `build/application.ini.in:48-56`; objdir `dist/bin/application.ini` -> `build/application.ini` (Name=Neeko) |
| `StaticPrefList.yaml` **default values** | **No.** Compiled into libxul (`modules/libpref/Preferences.cpp:6873` `#include "mozilla/StaticPrefListAll.h"`). Local edits to the YAML do nothing in an artifact build | Yes | `Preferences.cpp:6016-6018`: static prefs are initialized first, then pref files "override the former". `all.js:599-602`: "MOZILLA_OFFICIAL is false in local full builds but true in artifact builds" |
| All C++/Rust `#ifdef`/`cfg!` gates, hardcoded Rust/C++ endpoints | | Yes | see section 1 |
| Separate binaries: `crashreporter.app`, `crashhelper`, `pingsender`, `updater.app`, `ChannelPrefs.framework` | | Yes (present in objdir `dist/bin`) | `ls dist/bin` |

**How to override a StaticPrefList default in an artifact build:** add a `pref(...)` line to `firefox.js`
(or a branding/distribution pref file). That file is read after the compiled defaults
(`Preferences.cpp:6016-6018`).

**macOS update channel:** on macOS `app.update.channel` is **locked** and read from
`ChannelPrefs.framework`, not from `channel-prefs.js` (`Preferences.cpp:6122-6140`). Artifact
builds ship Mozilla's `ChannelPrefs-localbuild` framework, which is compiled with
`MOZ_UPDATE_CHANNEL_OVERRIDE = "default"` (`toolkit/mozapps/macos-frameworks/ChannelPrefs-localbuild/moz.build:11`). Running `strings` on objdir
`dist/update_framework_artifacts/ChannelPrefs-localbuild.framework/ChannelPrefs` returns `default`.
So the effective channel is `default`, not the `unofficial` channel that Neeko configured.

---

## 1. Build-time flags

| Flag / option | Defined at | Default | What it gates | Where the gate lives | Mozilla prebuilt value | Neeko local value (objdir `config.status.json`) |
|---|---|---|---|---|---|---|
| `MOZILLA_OFFICIAL` (env option) | `build/moz.configure/init.configure:1010-1020` | unset | C++: `isOfficialTelemetry` (`toolkit/components/telemetry/core/Telemetry.cpp:747-753`). Rust: adds the `glean_disable_upload` cargo feature when **unset** (`toolkit/library/rust/gkrust-features.mozbuild:60-61`). StaticPrefList `IS_NOT_MOZILLA_OFFICIAL` (`StaticPrefList.yaml:166-170`). JS/prefs: `browser.safebrowsing.id` (`all.js:3396-3400`), `urlclassifier.phishTable` (`all.js:3316-3322`), `termsofuse.bypassNotification` (`firefox.js:1959-1963`), `devtools.chrome.enabled` / `devtools.debugger.remote-enabled` (`all.js:3989-3998`), newtab `value_local_dev` (`browser/extensions/newtab/lib/ActivityStreamPrefs.sys.mjs:70,86-87`) | Both. The C++/Rust side is Mozilla's; the JS/pref side is local | **1** (`browser/config/mozconfigs/macosx64-aarch64/common-opt:18` `export MOZILLA_OFFICIAL=1`) | unset (AppConstants `MOZILLA_OFFICIAL: false`) |
| `MOZ_TELEMETRY_REPORTING` (env option, **define only**) | `toolkit/moz.configure:1138-1144` | `default=mozilla_official` | C++ `isOfficialTelemetry` (`Telemetry.cpp:747`), which TelemetrySend requires before sending (`TelemetrySend.sys.mjs:1590-1596`). Also `dom/base/nsFrameLoader.cpp:3707+`, `accessible/mac/Platform.mm:433`. JS `AppConstants.MOZ_TELEMETRY_REPORTING` (`BrowserGlue.sys.mjs:1300`, `StartupTelemetry.sys.mjs:37`, `toolkit/components/ml/content/EngineProcess.sys.mjs:269`) | C++ (Mozilla) plus JS (local) | **on (inferred** from MOZILLA_OFFICIAL=1) | off |
| `MOZ_TELEMETRY_ON_BY_DEFAULT` | `toolkit/moz.configure:1147-1152` | reporting AND nightly | Android `toolkit.telemetry.enabled` only (`Preferences.cpp:4491-4512`) | C++ | off (release) | n/a |
| `MOZ_DATA_REPORTING` | `toolkit/moz.configure:3517-3531` = telemetry OR healthreport OR crashreporter OR normandy | derived | `datareporting.policy.*` prefs (`all.js:3762-3771`); `app.shield.optoutstudies.enabled` default (`firefox.js:3030-3034`); preferences UI (`browser/components/preferences/config/permissions-data.mjs:295-440`) | JS/prefs (local) | on | **on** (because healthreport, crashreporter and normandy are on) |
| `MOZ_SERVICES_HEALTHREPORT` (`project_flag`) | `toolkit/moz.configure:1084-1088`, forced on by `browser/moz.configure:6` | implied True | `datareporting.healthreport.uploadEnabled=true` and `datareporting.usage.uploadEnabled=true` (`all.js:3773-3780`) | JS/prefs (local) | on | on. A `project_flag` only accepts `possible_origins=("implied",)` (`build/moz.configure/util.configure:532-539`), so **mozconfig cannot turn it off**. You would have to edit `browser/moz.configure:6` |
| `MOZ_NORMANDY` (`project_flag`) | `toolkit/moz.configure:1090-1094`, forced on by `browser/moz.configure:10` | implied True | `Normandy.init` registration (`browser/components/BrowserComponents.manifest:17-19`), `toolkit/modules/FirstStartup.sys.mjs:71`, prefs UI | JS (local) | on | on (same limitation: edit `browser/moz.configure:10`) |
| `--enable-crashreporter` -> `MOZ_CRASHREPORTER` | `toolkit/moz.configure:3486-3506` | on for macOS/Windows | `[Crash Reporter] Enabled=1` in application.ini (`build/application.ini.in:48-51`), which sets `NS_XRE_ENABLE_CRASH_REPORTER` at runtime (`toolkit/xre/CreateAppData.cpp:72`, `nsAppRunner.cpp:4578-4583`). Also adds the Rust `crashreporter` feature (`gkrust-features.mozbuild:66-67`) | application.ini is **local**, so a local `--disable-crashreporter` should keep the prebuilt binary from installing the handler (**inferred**; env `MOZ_CRASHREPORTER` can force it back on, `nsAppRunner.cpp:4556-4558`) | on | on |
| `--with-crashreporter-url` / `MOZ_CRASHREPORTER_URL` | `toolkit/moz.configure:3416-3427` | `https://crash-reports.mozilla.com/` | `ServerURL` in application.ini (`application.ini.in:50`), applied at `nsAppRunner.cpp:4574-4576` | local | n/a | `https://crash-reports.mozilla.com` |
| `--enable-updater` -> `MOZ_UPDATER` | `build/moz.configure/update-programs.configure:30-39` | on for desktop | `[AppUpdate] URL=` in application.ini (`application.ini.in:53-56`); JS `AppConstants.MOZ_UPDATER` (`AppUpdater.sys.mjs:253`, `BrowserGlue.sys.mjs:434`) | local (application.ini plus JS). The updater binary itself is prebuilt | on | on |
| `MOZ_APPUPDATE_HOST` | `build/moz.build:95-97` only | `aus5.mozilla.org` | host in application.ini | **No configure option defines it** (`git grep` finds only `build/moz.build` and `application.ini.in`), so `CONFIG["MOZ_APPUPDATE_HOST"]` is always empty | n/a | Surfer's `export MOZ_APPUPDATE_HOST=localhost:7648` (`engine/mozconfig:64`) **has no effect**. objdir application.ini still says `URL=https://aus5.mozilla.org/update/6/...` |
| `--enable-maintenance-service` | `update-programs.configure:183-205` | Windows only | `app.update.service.enabled` (`firefox.js:170-172`) | local prefs plus a Windows binary | n/a on macOS | n/a |
| `--disable-update-agent` -> `MOZ_UPDATE_AGENT` | `update-programs.configure:212-245` | on when backgroundtasks and updater are on (Windows/macOS) | `firefox.js:182-205`; `BrowserGlue.sys.mjs:1240-1243`. At runtime the task is Windows-only (`toolkit/mozapps/update/BackgroundUpdate.sys.mjs:204-209`) | JS (local) | on | on |
| `--disable-backgroundtasks` -> `MOZ_BACKGROUNDTASKS` | `toolkit/moz.configure:3181-3186` | on | background-task mode (pingsender task, backgroundupdate, etc.) | C++ define (Mozilla) plus JS | on | on |
| `--enable-default-browser-agent` -> `MOZ_DEFAULT_BROWSER_AGENT` | `update-programs.configure:253-270` | Windows only | `default-browser-agent.enabled` (`firefox.js:3536`); agent telemetry `toolkit/mozapps/defaultagent/Telemetry.cpp:32` | Windows binary | n/a on macOS | n/a |
| API keys `--with-{google-safebrowsing,google-location-service,mozilla}-api-keyfile` | `toolkit/moz.configure:1164-1169`, `build/moz.configure/keyfiles.configure` | none -> `no-...-api-key` | substituted **only into JS AppConstants** (`toolkit/modules/moz.build:279-300`, `AppConstants.sys.mjs:183-186`), then into URLs by `URLFormatter.sys.mjs:124-128` | **JS (local)** | real keys (`common-opt:13-15`) | `no-google-safebrowsing-api-key`, `no-google-location-service-api-key`, `no-mozilla-api-key` |
| Rust cargo feature `glean_disable_upload` | `toolkit/library/rust/shared/Cargo.toml:166`; enabled when `!MOZILLA_OFFICIAL` (`gkrust-features.mozbuild:60-61`) | | FOG uploader fakes success when this is set (`toolkit/components/glean/src/init/viaduct_uploader.rs:45-51`) | **Rust in libxul (Mozilla)** | **NOT set**, so Glean uploads for real (**inferred** from MOZILLA_OFFICIAL=1) | not applicable, because the local Rust is not compiled |
| `MOZ_ARTIFACT_BUILDS` | configure | | `telemetry.fog.artifact_build=true` (`all.js:4189-4191`), which turns on JOG runtime metric registration (`toolkit/components/glean/bindings/jog/JOG.cpp:60`). **Does not disable upload** | pref (local) | | on |

**Neeko mozconfig lines that don't work (engine/mozconfig, generated from `configs/common/mozconfig:32-33`):**
- `mk_add_options MOZ_TELEMETRY_REPORTING=` and `mk_add_options MOZ_DATA_REPORTING=` (`engine/mozconfig:34-35`).
  `mk_add_options` only sets make variables; these are configure options. Mozilla's own no-telemetry configs use
  `ac_add_options MOZ_TELEMETRY_REPORTING=` (for example `browser/config/mozconfigs/win64/nightly-asan:13`). Also,
  `MOZ_DATA_REPORTING` is not an option at all; it is derived (`toolkit/moz.configure:3517-3531`).
  Either way, the flags that actually gate uploads (`isOfficialTelemetry`, Glean `disable_upload`)
  are compiled into Mozilla's prebuilt binary, where they are ON.
- `export MOZ_APPUPDATE_HOST=localhost:7648` (`engine/mozconfig:64`) has no effect (see above).

---

## 2. Endpoints by feature

Columns: feature | endpoint host(s) | controlling pref(s) + default | build flag(s) | file:line | what is sent

### 2.1 Telemetry and data reporting

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| **Master upload switch** (legacy telemetry, Glean, Nimbus studies, DAP, crash-client ping) | n/a | `datareporting.healthreport.uploadEnabled` = **true** (all.js). StaticPrefList default is `false`, but all.js overrides it | `MOZ_SERVICES_HEALTHREPORT` (local, forced on) | `all.js:3773-3779`; `StaticPrefList.yaml:2523-2527` | n/a |
| Data submission policy / first-run notice | `www.mozilla.org` (policy page link only) | `datareporting.policy.dataSubmissionEnabled` = true; `datareporting.policy.firstRunURL` | `MOZ_DATA_REPORTING` (local) | `all.js:3762-3771` | not evident |
| **Legacy Telemetry** (TelemetryController/TelemetrySend) | `incoming.telemetry.mozilla.org` | `toolkit.telemetry.server`; the upload gate is `datareporting.healthreport.uploadEnabled` (`TelemetrySend.sys.mjs:1601-1609`); `toolkit.telemetry.unified`=true (`all.js:547`); `toolkit.telemetry.enabled` (extended data) default is computed in C++: true only for nightly/aurora/beta or non-official `default` channel (`Preferences.cpp:4530-4563`), so **false** in the prebuilt release libxul | `MOZILLA_OFFICIAL` + `MOZ_TELEMETRY_REPORTING` + `!DEBUG` -> `isOfficialTelemetry` (**C++, Mozilla's = true**) | `all.js:540`; `Telemetry.cpp:746-753`; `TelemetrySend.sys.mjs:1590-1596` | Pings listed as toggles: new-profile, first-shutdown, update, bhr (hang), shutdown (`firefox.js:2581-2595`). Payload contents not evident from prefs |
| Telemetry via pingsender binary | `incoming.telemetry.mozilla.org` (C++ allowlist) | `toolkit.telemetry.shutdownPingSender.enabled`=true, `...backgroundtask.enabled`=false, `...enabledFirstSession`=false | prebuilt `pingsender` binary | `firefox.js:2583-2587`; `toolkit/components/telemetry/pingsender/pingsender.cpp:23-27`; `toolkit/components/telemetry/pings/BackgroundTask_pingsender.sys.mjs:23` | shutdown ping (sent after the browser exits) |
| User-characteristics ping | `incoming.telemetry.mozilla.org` | `toolkit.telemetry.user_characteristics_ping.current_version`=0 (sent only when Mozilla raises it remotely); `...opt-out`=false | same as telemetry | `all.js:565-580` | per comment: a ping with its own UUID, cleared on opt-out; the comment says Mozilla edits the version remotely |
| Coverage ping | `coverage.mozilla.org` | `toolkit.coverage.enabled` = **false** | | `firefox.js:3063-3064` | not evident |
| **Glean / FOG** (all Glean pings: metrics, events, baseline, newtab, crash, etc.) | `incoming.telemetry.mozilla.org` (**hardcoded in Rust**, not a pref); OHTTP pings: relay `mozilla-ohttp.fastly-edge.com`, config `prod.ohttp-gateway.prod.webservices.mozgcp.net` (hardcoded) | `datareporting.healthreport.uploadEnabled` (read in Rust); test override `telemetry.fog.test.localhost_port`=0 | Rust feature `glean_disable_upload` (off in Mozilla's official build, so **uploads happen**) | `toolkit/components/glean/src/init/mod.rs:43,160-169`; `viaduct_uploader.rs:45-51,127,158`; `gkrust-features.mozbuild:60-61`; `toolkit/components/glean/docs/dev/preferences.md:85-100` | Glean pings. Turning the pref off sends a "deletion-request" ping (`preferences.md:6-12`) |
| Usage-reporting ping (Glean) | `incoming.telemetry.mozilla.org` | `datareporting.usage.uploadEnabled` = **true** | `MOZ_SERVICES_HEALTHREPORT` | `all.js:3780`; `toolkit/components/telemetry/app/UsageReporting.sys.mjs:39-40,138-139,181` | not evident |
| New Tab telemetry | `incoming.telemetry.mozilla.org/submit` | newtab `telemetry` = true, but `value_local_dev: false`, which applies when `!AppConstants.MOZILLA_OFFICIAL`, so **false locally**; `browser.newtabpage.activity-stream.telemetry.privatePing.enabled`=true | JS `MOZILLA_OFFICIAL` (local) | `browser/extensions/newtab/lib/ActivityStream.sys.mjs:727-740`; `ActivityStreamPrefs.sys.mjs:70,86-87`; `firefox.js:2162` | newtab Glean/content pings (per pref titles) |
| FxA telemetry pings | Glean endpoint | `identity.fxaccounts.telemetry.clientAssociationPing.enabled`=true, `...clientInfoPing.enabled`=true | | `firefox.js:2515-2518` | not evident |
| **DAP** (Distributed Aggregation Protocol) | leader `dap-09-3.api.divviup.org`, helper `dap.services.mozilla.com`, OHTTP relay `mozilla-ohttp-dap.mozilla.fastly-edge.com` | only if Nimbus feature `dapTelemetry.enabled` (no default, so off unless enrolled) **and** `datareporting.healthreport.uploadEnabled` | | `all.js:555-560`; `firefox.js:777-780`; `toolkit/components/dap/DAPTelemetrySender.sys.mjs:23-27,69-78`; `toolkit/components/nimbus/FeatureManifest.yaml:3813-3820` | encrypted aggregate measurements (HPKE keys in prefs) |
| Default browser agent telemetry | `incoming.telemetry.mozilla.org/submit` | `default-browser-agent.enabled`=true | `MOZ_DEFAULT_BROWSER_AGENT` (**Windows only**) | `firefox.js:3536`; `toolkit/mozapps/defaultagent/Telemetry.cpp:32` | n/a on macOS |

### 2.2 Crash reporting

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| Crash report submission (crash reporter client) | `crash-reports.mozilla.com` (`/submit?id=..&version=..&buildid=..`) | Client setting `submit_report` defaults to **true** and `include_url` to **true** (`toolkit/crashreporter/client/app/src/settings.rs:21-26`). The user confirms in the dialog unless auto-submit is on | `--enable-crashreporter`, `--with-crashreporter-url` (both write the local application.ini); client binary is prebuilt | `build/application.ini.in:48-51`; `toolkit/moz.configure:3416-3427`; `nsAppRunner.cpp:4574-4583`; `logic.rs:547-565` | minidump + `.extra` annotations; the URL of the open page if `include_url` (`logic.rs:667`) |
| **Crash ping from the crash reporter client** (Glean `crash` ping) | `incoming.telemetry.mozilla.org` (hardcoded) | Reads **only the user value** of `datareporting.healthreport.uploadEnabled` from the profile's `prefs.js`. If the pref is absent or unreadable it **defaults to true** (`client/app/src/glean.rs:12,34-66`). The ping is sent **before the UI appears** (`logic.rs:109`) | prebuilt Rust client | `toolkit/crashreporter/crashping/src/lib.rs:22`; `toolkit/crashreporter/client/app/src/glean.rs:12,34-66,125-126` | crash ping (annotations in `crashping/src/annotations`) |
| Crash pings/submission from the browser (CrashManager, about:crashes, unsubmitted reports) | ServerURL annotation (`crash-reports.mozilla.com`) | `browser.crashReports.unsubmittedCheck.enabled`=false (release), `...autoSubmit2`=**false**; `browser.tabs.crashReporting.sendReport`=true, `...includeURL`=false | | `firefox.js:2967-2978,2835-2836` | pending crash reports (content-process crashes from about:tabcrashed) |
| Crash reports on demand ("crash pull") | Remote Settings collection `crash-reports-ondemand` | `browser.crashReports.onDemand`=true (StaticPrefList, compiled) | | `StaticPrefList.yaml:1517-1521`; `toolkit/components/crashes/RemoteSettingsCrashPull.sys.mjs:15` | prompts the user to send specific crash reports that developers requested |
| about:crashes links | `crash-stats.mozilla.org` (link only) | `breakpad.reportURL` | | `firefox.js:1650` | none (link) |
| ASan reporter | `anf1.fuzzing.mozilla.org` | `asanreporter.apiurl` | `MOZ_ASAN_REPORTER` (not set) | `all.js:3711-3715` | n/a |

### 2.3 Experiments, studies, remote configuration

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| **Normandy** | `normandy.cdn.mozilla.net` (`/api/v1`, used for classify-client and extension-list); recipes come from Remote Settings collection `normandy-recipes-capabilities` | `app.normandy.enabled`=**true**; `app.normandy.api_url` (must be https, otherwise disabled); `app.normandy.run_interval_seconds`=21600; `app.shield.optoutstudies.enabled`=**true** (under `MOZ_DATA_REPORTING`) | `MOZ_NORMANDY` (local manifest `#ifdef`) | `firefox.js:3021-3034`; `toolkit/components/normandy/lib/RecipeRunner.sys.mjs:38,43,198-218`; `NormandyApi.sys.mjs:16-17,138,152`; `BrowserComponents.manifest:17-19` | classify-client request (per NormandyApi); recipes filtered locally |
| **Nimbus** (experiments, rollouts, Firefox Labs) | Remote Settings collection `nimbus-desktop-experiments` (plus a secure experiments collection) | `messaging-system.rsexperimentloader.collection_id`; `nimbus.rollouts.enabled`=**true**; studies need `app.shield.optoutstudies.enabled` AND `datareporting.healthreport.uploadEnabled` AND the `Shield` policy. **Nimbus runs if Labs OR rollouts OR studies is enabled**, and `labsEnabled` is true unless the `FirefoxLabs` policy disables it | | `firefox.js:2237,2266`; `toolkit/components/nimbus/ExperimentAPI.sys.mjs:42-55,456-495`; `RemoteSettingsExperimentLoader.sys.mjs:252,259` | enrollment is local; exposure/enrollment telemetry goes via Glean |
| Background-task Nimbus | same | `nimbus.appId`=`firefox-desktop-background-task` | `MOZ_BACKGROUNDTASKS` | `toolkit/components/backgroundtasks/defaults/backgroundtasks_browser.js:47` | |
| **Remote Settings** (backbone for many features, see section 3) | `firefox.settings.services.mozilla.com/v2` (**JS constant**, not a pref); attachments CDN and content-signature chain are server-provided (dump fallbacks `firefox-settings-attachments.cdn.mozilla.net`, `content-signature-2.cdn.mozilla.net`) | `services.settings.server` override is **ignored on RELEASE_OR_BETA** unless env `MOZ_REMOTE_SETTINGS_DEVTOOLS=1` (`services/settings/Utils.sys.mjs:52-73,101-106`); poll timer `services.settings.poll_interval`=86400 (manifest default 21600); only way to disable is policy `DisableRemoteSettingsAndAcceptSecurityConsequences` | JS AppConstants (local, editable) | `toolkit/modules/AppConstants.sys.mjs:215-220`; `services/settings/servicesSettings.manifest:7`; `all.js:1758`; `browser/components/enterprisepolicies/Policies.sys.mjs:1296-1300` | changeset polls per collection |
| Remote Settings push broadcast | `push.services.mozilla.com` (websocket) | broadcast id `remote-settings/monitor_changes` | | `services/settings/remote-settings.sys.mjs:38,763-780` | keeps the push socket open even with no web-push subscriptions (see 2.6) |
| Messaging System (CFR, message groups, remote l10n, background-task messages) | Remote Settings collections `cfr`, `message-groups`, `ms-language-packs`; Nimbus `messaging-experiments` | `browser.newtabpage.activity-stream.asrouter.providers.*` (enabled); `...asrouter.userprefs.cfr.addons`=true, `...cfr.features`=true; `...asrouter.useRemoteL10n`=true | | `firefox.js:2041-2053`; `browser/components/asrouter/modules/ASRouter.sys.mjs:105,414,426` | |

### 2.4 Safe Browsing / URL classifier

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| Google Safe Browsing list updates + hash lookups (v2.2/v4/v5 providers) | `safebrowsing.google.com`, `safebrowsing.googleapis.com` | `browser.safebrowsing.malware.enabled`=true, `...phishing.enabled`=true, `...blockedURIs.enabled`=true (StaticPrefList, compiled); `browser.safebrowsing.provider.google5.enabled`=true; `browser.safebrowsing.id`=`Firefox` (non-official; official=`navclient-auto-ffox`) | **API key is JS-only** (AppConstants). When the key is `no-google-safebrowsing-api-key`, SafeBrowsing.sys.mjs **clears updateURL and gethashURL for google\* providers**, so the Neeko artifact build does **no Google list updates or gethash** | `all.js:3396-3400,3416-3448`; `StaticPrefList.yaml:1936-1952`; `toolkit/components/url-classifier/SafeBrowsing.sys.mjs:537-558,636-643` | list-update requests; truncated hash prefixes for gethash (full-hash lookups) |
| Google SB real-time lookup / global cache | same | `browser.safebrowsing.realTime.enabled`, `...globalCache.enabled` = `@IS_NIGHTLY_BUILD@` (**false** in the prebuilt release libxul) | StaticPrefList compiled | `StaticPrefList.yaml:1954-1964` | |
| **Download protection (application reputation) remote lookup** | `sb-ssl.google.com` (`/safebrowsing/clientreport/download?key=...`) | `browser.safebrowsing.downloads.enabled`=true; `browser.safebrowsing.downloads.remote.enabled`=**true** | **C++ does not check for a missing key.** It only bails if the URL is empty or `about:blank` (`ApplicationReputation.cpp:1605-1622`). The key is substituted by JS URLFormatter, so the request would go out with `key=no-google-safebrowsing-api-key` when no local list verdict exists (**inferred**) | `all.js:3403-3411`; `toolkit/components/reputationservice/ApplicationReputation.cpp:71-75,1605-1640` | download URL (stripped), file length, and the other request fields built after `ApplicationReputation.cpp:1624` |
| Google SB data sharing (threatHits) | `safebrowsing.googleapis.com` | `browser.safebrowsing.provider.google4.dataSharing.enabled` = **false** | | `all.js:3436-3437` | |
| Report/mistake links | `%LOCALE%.phish-report.mozilla.com`, `.phish-error.mozilla.com`, `.malware-error.mozilla.com`, `safebrowsing.google.com/safebrowsing/diagnostic` | user-initiated | | `all.js:3420-3422,3452` | the URL being reported |
| **Mozilla tracking-protection lists** | lists via Remote Settings (`moz-sbrs:://antitracking` -> collection `tracking-protection-lists`); gethash `shavar.services.mozilla.com` | `browser.safebrowsing.provider.mozilla.*`; `nextupdatetime`="1" (immediate download on new profiles) | | `all.js:3455-3462`; `toolkit/components/url-classifier/UrlClassifierRemoteSettingsService.sys.mjs:10` | list updates |
| Related RS lists | RS `url-classifier-exceptions`, `query-stripping`, `hijack-blocklists`, partitioning / bounce-tracking / fingerprinting exceptions | various | | `netwerk/url-classifier/UrlClassifierExceptionListService.sys.mjs:13`; `toolkit/components/antitracking/URLQueryStrippingListService.sys.mjs:13`; `toolkit/modules/IgnoreLists.sys.mjs:17` | |

### 2.5 Network probes, DNS

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| **Captive portal detection** | `http://firefox-portal-detection.com/generate_204` (plain HTTP) | `network.captive-portal-service.enabled` = **true** in firefox.js (all.js says false); `captivedetect.canonicalURL` | | `firefox.js:1474`; `all.js:3275-3280,3308-3312` | plain HTTP GET, expecting an empty 204 |
| **Network connectivity service** | `http://firefox-portal-detection.com/success.txt?ipv4` and `?ipv6`; DNS lookups of `example.org` (A/AAAA) and `cloudflare-dns.com` (HTTPS RR) | `network.connectivity-service.enabled` = **true** | | `all.js:3282-3287` | plain HTTP GET; DNS queries |
| DNS-over-HTTPS (TRR) | default provider `mozilla.cloudflare-dns.com/dns-query`; confirmation lookup `example.com` | `network.trr.mode` = **0** (off; compiled StaticPrefList); `network.trr.default_provider_uri`; `network.trr.uri`=""; `network.trr.confirmationNS`=`example.com` | StaticPrefList compiled; override in firefox.js | `StaticPrefList.yaml:15927-15936`; `all.js:3289-3295` | DNS queries when TRR is active |
| **DoH regional rollout** | providers/config from RS `doh-providers`, `doh-config`; when enabled for your region it sets `doh-rollout.mode` / `doh-rollout.uri`, which TRRService honors | `doh-rollout.*` branch (regional `doh-rollout.<region>.enabled`); opt-out via `network.trr.mode`=5; `doh-rollout.disable-heuristics`; `doh-rollout.clearModeOnShutdown`=false | | `toolkit/components/doh/DoHConfig.sys.mjs:21,52-53,320-356`; `DoHController.sys.mjs:86,113-114`; `netwerk/dns/TRRServiceBase.h:24-25`; `BrowserComponents.manifest:159`; `firefox.js:3015` | |
| DoH heuristics (DNS lookups) | `use-application-dns.net`, `firefox.com`, `mozilla.org`, `www.google.com`/`google.com`/`forcesafesearch.google.com`, YouTube hosts incl. `restrict.youtube.com`, `sitereview.zscaler.com` | run by DoHController when rollout is active | | `toolkit/components/doh/DoHHeuristics.sys.mjs:32,251,259,324-336,374` | DNS queries |
| TRR racer (performance measurement) | `firefox-dns-perf-test.net` plus popular domains | `doh-rollout.trrRace.enabled` (no default, so off unless set remotely) | | `BrowserGlue.sys.mjs:1190-1213`; `toolkit/components/doh/TRRPerformance.sys.mjs:41,63-67` | DNS timing |
| Essential-domain fallback | redirects failing requests to `*.mozilla-backup.org` mirrors of aus5, AMO, versioncheck, archive, download, the RS server/attachments, and content-signature | `network.essential_domains_fallback` = **true** (compiled); mapping from RS `moz-essential-domain-fallbacks` | C++ `nsIOService.cpp:2528-2545` | `StaticPrefList.yaml:17249-17252`; `netwerk/base/EssentialDomainsRemoteSettings.sys.mjs:13,52`; `services/settings/dumps/main/moz-essential-domain-fallbacks.json` | same request, sent to the fallback host |
| Speculative connects / prefetch | sites the user may visit (not Mozilla) | `browser.urlbar.speculativeConnect.enabled`=true, `browser.places.speculativeConnect.enabled`=true, `network.prefetch-next`=true, `network.http.speculative-parallel-limit`=20, `network.dns.disablePrefetch`=false | | `firefox.js:441,1641`; `all.js:1237,1357`; `StaticPrefList.yaml:15592` | TCP/TLS preconnects, DNS, `<link rel=prefetch>` |

### 2.6 Push

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| Web Push (autopush) | `wss://push.services.mozilla.com/` | `dom.push.enabled`=true (compiled); `dom.push.connection.enabled`=**true**; `dom.push.serverURL`; `dom.push.userAgentID`="" | | `all.js:3222-3223,3239`; `StaticPrefList.yaml:4269-4272` | The socket is opened whenever online, with the broadcast listeners (`dom/push/PushService.sys.mjs:227-239`). Remote Settings always registers one, so **it connects even with zero site subscriptions**. UAID stored in `dom.push.userAgentID` |

### 2.7 Location

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| Geolocation (only when a site asks and the user allows) | macOS: CoreLocation (`geo.provider.use_corelocation`=true), falling back to the network provider `www.googleapis.com/geolocation/v1/geolocate?key=%GOOGLE_LOCATION_SERVICE_API_KEY%` via `MLSFallback` | `geo.enabled` (compiled); `geo.provider.network.url` | Key is JS-only, so locally it is `no-google-location-service-api-key` | `all.js:3093-3104`; `StaticPrefList.yaml:7183`; `dom/system/mac/CoreLocationLocationProvider.mm` (uses `dom/geolocation/MLSFallback.cpp`) | location request (Wi-Fi data on some platforms; not evident for macOS here) |
| **Region detection** | `location.services.mozilla.com/v1/country?key=%MOZILLA_API_KEY%` | runs at startup if `browser.search.region` is unset (`Region.sys.mjs:90,188-194`); `browser.region.update.enabled`=**true** (weekly re-check, `Region.sys.mjs:53,107,180-186`); `browser.region.network.scan`=false (no Wi-Fi); `browser.region.local-geocoding`=false (would use RS `regions` + the geo URL) | Key is JS-only, so locally it is `no-mozilla-api-key`. **No missing-key check in Region.sys.mjs**, so the request is sent anyway and retried up to 3 times (`Region.sys.mjs:102,225-245`) | `all.js:3112-3118`; `toolkit/modules/Region.sys.mjs:363-395` | GET with the API key; response `country_code`. With scan=true it would POST `wifiAccessPoints` (`Region.sys.mjs:366-376`) |

### 2.8 Search and address bar

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| Search suggestions | the default engine's suggest URL (from search-config) | `browser.search.suggest.enabled`=**true**, `...enabled.private`=false; `browser.urlbar.suggest.searches`=true | | `all.js:3485-3486`; `firefox.js:488` | typed query text |
| Trending suggestions (empty urlbar) | default engine's trending endpoint | `browser.urlbar.trending.featureGate`=**true**, `browser.urlbar.suggest.trending`=true, `...trending.requireSearchMode`=false | | `firefox.js:521-523,554`; `browser/components/urlbar/UrlbarProviderSearchSuggestions.sys.mjs:227-230` | request on urlbar focus |
| Search engine config | RS `search-config-v2`, `search-config-overrides-v2`, `search-config-icons` | none (always on) | | `toolkit/components/search/SearchUtils.sys.mjs:175,183`; `ConfigSearchEngine.sys.mjs:86`; `SearchEngineSelector.sys.mjs:45` | |
| OpenSearch engine updates | each installed OpenSearch engine's update URL | `browser.search.update`=true | | `all.js:3484`; `SearchService.sys.mjs:4071-4078` | |
| SERP telemetry / categorization | RS `search-telemetry-v2`, `search-categorization` (results go out via Glean) | `browser.search.serpEventTelemetryCategorization.enabled`=**true** | | `firefox.js:998`; `browser/components/search/SearchSERPTelemetry.sys.mjs:39`; `SERPCategorization.sys.mjs:59` | categorized SERP domains, via Glean |
| **Firefox Suggest** (offline) | RS (via the Rust suggest component) | `browser.urlbar.quicksuggest.enabled`=false in firefox.js, **but QuickSuggest sets region defaults at runtime**: enabled for US/GB/DE/FR/IT with matching locales, and `suggest.quicksuggest.sponsored`=true there | | `firefox.js:561-621`; `browser/components/urlbar/QuickSuggest.sys.mjs:78-126` | |
| **Firefox Suggest online (Merino)** | `merino.services.mozilla.com/api/v1/suggest`, via OHTTP relay `ohttp-merino.mozilla.fastly-edge.com` + config `ohttp-gateway-merino.services.mozilla.com` | `browser.urlbar.quicksuggest.online.available`=false (runtime default: US only, if `shouldOnlineBeAvailable`); `browser.urlbar.quicksuggest.online.enabled`=true (sticky) | | `firefox.js:579,594,755-767`; `QuickSuggest.sys.mjs:87-90` | query `q`, `sid`, `seq`, `providers`, `client_variants` (`browser/components/urlbar/MerinoClient.sys.mjs:34-38,200-210`) |
| Urlbar weather suggestion | `merino.services.mozilla.com/api/v1/suggest`, `/api/v1/weather/hourly-forecasts` | `browser.urlbar.suggest.weather`=true; `weather.featureGate` set by region at runtime | | `firefox.js:550,770-771`; `QuickSuggest.sys.mjs` (`weather.featureGate`) | |
| Sponsored partner link attribution | `topsites.services.mozilla.com/cid/` | `browser.partnerlink.attributionURL`, `browser.partnerlink.campaign.topsites`=`amzn_2020_a1` | | `firefox.js:1935-1936` | campaign id in path |

### 2.9 New Tab / Home

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| **Sponsored top sites** | `ads.mozilla.org` (MARS, over OHTTP); legacy Contile `contile.services.mozilla.com/v1/tiles` | `browser.newtabpage.activity-stream.showSponsoredTopSites`=**true**; `...feeds.topsites`=true; `...unifiedAds.tiles.enabled`=**true**; `...unifiedAds.ohttp.enabled`=true; `browser.topsites.contile.enabled`=true | | `ActivityStream.sys.mjs:336-378,434-475`; `firefox.js:1928-1931,1980-1984`; `browser/extensions/newtab/lib/TopSitesFeed.sys.mjs:76,93-94,124-128` | not evident |
| **Stories / Pocket (Discovery Stream)** | `merino.services.mozilla.com/api/v1/curated-recommendations`; allowed prefixes `getpocket.cdn.mozilla.net`, `firefox-api-proxy.cdn.mozilla.net`, `spocs.getpocket.com`, `merino.services.mozilla.com`, `ads.mozilla.org`; OHTTP `mozilla-ohttp.fastly-edge.com` / `prod.ohttp-gateway.prod.webservices.mozgcp.net` | `...feeds.section.topstories`=**true**; `...discoverystream.enabled`=true; region gate `...discoverystream.region-stories-config`="US,DE,CA,GB,IE,CH,AT,BE,IN,FR,IT,ES"; `...merino-provider.ohttp.enabled`=false | | `ActivityStream.sys.mjs:794-799,1869-1875`; `firefox.js:2056,2109,2145-2148`; `DiscoveryStreamFeed.sys.mjs:873-875` | not evident |
| Sponsored stories (spocs) | `spocs.getpocket.com/spocs`, `ads.mozilla.org`; opt-out delete call `spocs.getpocket.com/user` | `...showSponsored`=**true**; `system.showSponsored` computed from Nimbus `regionSpocsConfig`; `...discoverystream.region-spocs-config`="US,CA,DE,GB,FR,IT,ES"; `...unifiedAds.spocs.enabled`=true | | `ActivityStream.sys.mjs:220-225,358-371,1908-1913`; `DiscoveryStreamFeed.sys.mjs:68`; `firefox.js:1981,2152` | not evident |
| Story image proxy / publisher favicons | `img-getpocket.cdn.mozilla.net` | `...discoverystream.imageProxy.enabled`=true; `...publisherFavicon.enabled`=true | | `firefox.js:2149,2178`; `content-src/components/DiscoveryStreamComponents/DSImage/DSImage.jsx:126` | image URL in path |
| **New Tab weather widget** | Merino (`accuweather` provider) via MerinoClient | `...widgets.weather.enabled`=true (Nova on); `...showWeather`=true; `system.showWeather` from `...region-weather-config` / `...locale-weather-config` | | `ActivityStream.sys.mjs:487-499,1391-1395`; `firefox.js:1987,1997,2000`; `browser/extensions/newtab/lib/WeatherFeed.sys.mjs:25,68-77` | location query (`weather.query`=""), else Merino geolocates by IP (not evident in source) |
| Other Merino newtab widgets | `merino.services.mozilla.com/api/v1/wcs/*`, `/api/v1/rss/picture-of-the-day`; `prod-games-particle.merino.prod.webservices.mozgcp.net` | ActivityStream prefs (feature-gated) | | `ActivityStream.sys.mjs:573-603,1776` | |
| Default top sites / site icons | RS `top-sites`, `tippytop` | `browser.topsites.useRemoteSetting`=true | | `firefox.js:1928`; `browser/components/topsites/TopSites.sys.mjs:409,1191` | |
| Newtab attribution (DAP conversions) | `ads.mozilla.org`, `mozilla-ohttp-dap.mozilla.fastly-edge.com` | `...discoverystream.attribution.enabled`=**false** | | `ActivityStream.sys.mjs:1044-1048`; `NewTabAttributionFeed.sys.mjs:15,63`; `NewTabAttributionService.sys.mjs:190-198` | |
| Newtab train-hop add-on / remote renderer | `archive.mozilla.org/pub/system-addons/newtab/`; RS `newtab-renderer` (remote JS/CSS bundles) | `browser.newtabpage.trainhopAddon.xpiBaseURL`; `browser.newtabpage.activity-stream.remote-renderer.version`="" (bundled is used unless set) | | `firefox.js:2203`; `browser/extensions/newtab/lib/RemoteRenderer.sys.mjs:19-25` | code delivered remotely for New Tab |
| FxA link on newtab | `accounts.firefox.com` | `...fxaccounts.endpoint` | | `firefox.js:2035` | |

### 2.10 Add-ons

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| Add-on update checks | `versioncheck.addons.mozilla.org`, `versioncheck-bg.addons.mozilla.org` | `extensions.update.enabled`=**true**; `extensions.update.autoUpdateDefault`=true; `extensions.update.interval`=86400 | | `firefox.js:52,233-236` | per URL template: add-on id, version, status, app id/version, OS, ABI, locale, update type, compat mode |
| Add-on metadata cache | `services.addons.mozilla.org/api/v4/addons/search/?guid=%IDS%` | `extensions.getAddons.cache.enabled`=**true** | | `firefox.js:39-40` | IDs of installed add-ons + locale |
| System add-on updates | `aus5.mozilla.org/update/3/SystemAddons/...` | `extensions.systemAddon.update.enabled`=**true** | | `firefox.js:55-56` | version, build id, target, locale, channel, OS version, distribution (URL template) |
| Blocklist | RS `addons-bloomfilters`, `addons`, `gfx`, `addons-manager-settings`; detail pages `blocked.cdn.mozilla.net` | `extensions.blocklist.enabled`=true | | `all.js:1771-1774`; `toolkit/mozapps/extensions/Blocklist.sys.mjs:498,761,1194`; `AddonManager.sys.mjs:4684` | |
| Recommendations / discovery pane (when about:addons opens) | `services.addons.mozilla.org/api/v4/discovery/` | `extensions.htmlaboutaddons.recommendations.enabled`=true; `browser.discovery.enabled`=true | | `all.js:3155`; `firefox.js:44,3067`; `toolkit/mozapps/extensions/content/aboutaddons-utils.mjs:74-75,885-905` | **hashed telemetry client ID** (`telemetry-client-id`) if `browser.discovery.enabled` AND upload pref are on |
| TAAR cookie | sets a `taarId` cookie (hashed client ID) for `addons.mozilla.org` | `browser.discovery.enabled`=true, `browser.discovery.sites`=`addons.mozilla.org` | | `firefox.js:3067-3069`; `browser/modules/Discovery.sys.mjs:15-17,76,115-128` | hashed client ID in a cookie |
| Langpack updates | `services.addons.mozilla.org/api/v4/addons/language-tools/` | `app.update.langpack.enabled`=true; `intl.multilingual.downloadEnabled`=true (RELEASE_OR_BETA) | | `firefox.js:43,180,3048-3056` | app version |
| Browser-mappings (import) / abuse reports | `services.addons.mozilla.org/api/v5/...` | user-initiated; `extensions.abuseReport.enabled`=true | | `firefox.js:26,45`; `all.js:1767-1768` | |

### 2.11 Application update

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| **App update (AUS/Balrog)** | `aus5.mozilla.org/update/6/%PRODUCT%/%VERSION%/%BUILD_ID%/%BUILD_TARGET%/%LOCALE%/%CHANNEL%/%OS_VERSION%/%SYSTEM_CAPABILITIES%/%DISTRIBUTION%/%DISTRIBUTION_VERSION%/update.xml` (from **application.ini**) | **There is no pref to disable it** (app.update.url was removed, `firefox.js:160-164`). Checks happen unless the `DisableAppUpdate` policy is set (`UpdateServiceStub.sys.mjs:210-216`) or `application.ini` has no URL (`UpdateService.sys.mjs:5474-5494`). Policy `AppUpdateURL` overrides the URL. `app.update.auto`=true; `app.update.interval`=86400 (unofficial branding) | `--enable-updater` (application.ini `[AppUpdate]`, local); `MOZ_APPUPDATE_HOST` has no working override | `build/application.ini.in:53-56`; `build/moz.build:95-97`; `browser/branding/unofficial/pref/firefox-branding.js:11`; `firefox.js:153` | product, version, build id, target, locale, channel (**`default` on macOS artifact**), OS version, system capabilities, distribution (URL template) |
| Background update task | same | `app.update.background.enabled` per-install default=true (`toolkit/modules/UpdateUtils.sys.mjs:590-592`) | `MOZ_UPDATE_AGENT`; **Windows-only at runtime** (`BackgroundUpdate.sys.mjs:204-209`) | `firefox.js:182-205`; `BrowserGlue.sys.mjs:1240-1260` | n/a on macOS |
| Maintenance service | n/a | `app.update.service.enabled` | Windows only | `firefox.js:170-172` | n/a |
| Manual/details links | `nightly.mozilla.org` (unofficial branding) | `app.update.url.manual`, `.details` | | `firefox-branding.js:16-19` (unofficial) | link |
| **GMP (OpenH264, Widevine)** | Balrog `aus5.mozilla.org/update/3/GMP/...`; Widevine via `update.googleapis.com/service/update2/crx`; fallback download hosts from bundled JSON: `ciscobinary.openh264.org`, `edgedl.me.gvt1.com`, `www.google.com` | `media.gmp-provider.enabled`=true; `media.gmp-gmpopenh264.enabled`=true; `media.gmp-widevinecdm.enabled`=true, `...allow-chromium-update`=true; `media.gmp-manager.allowLocalSources`=true | `MOZ_WIDEVINE_EME` (local; active per objdir firefox.js:998-1000) | `all.js:3494-3503`; `firefox.js:2528-2554,2598`; `toolkit/content/gmp-sources/*.json`; checked at idle startup `BrowserGlue.sys.mjs:1368-1376` | version, build id, target, locale, channel, OS (URL template) |

### 2.12 Accounts, Sync, account-linked services

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| Firefox Accounts | `accounts.firefox.com`, `api.accounts.firefox.com/v1`, `profile.accounts.firefox.com/v1`, `oauth.accounts.firefox.com/v1`; pairing `wss://channelserver.services.mozilla.com` | `identity.fxaccounts.enabled`=true (active only after sign-in) | `MOZ_SERVICES_SYNC` (forced on in browser/moz.configure:7) | `firefox.js:2464-2485`; `all.js:3879` | account data (after sign-in) |
| Sync | `token.services.mozilla.com/1.0/sync/1.5` (+ the storage node it returns) | only when signed in | `MOZ_SERVICES_SYNC` | `firefox.js:2488` | encrypted records |
| WebExtension `storage.sync` | `webextensions.settings.services.mozilla.com/v1` | Sync-dependent | | `all.js:3601` | |
| **Firefox Relay** | `relay.firefox.com/api/v1/` | `signon.firefoxRelay.feature`=`available` (offered; the API needs `enabled` and FxA); RS allow/deny lists | | `all.js:3020-3024`; `firefox.js:2936-2941`; `toolkit/components/satchel/integrations/FirefoxRelay.sys.mjs:555-566,1142` | not evident |
| Monitor breach alerts (about:logins) | RS `fxmonitor-breaches` | `signon.management.page.breach-alerts.enabled`=true | | `firefox.js:2942`; `browser/components/aboutlogins/LoginBreaches.sys.mjs:29`; `BrowserGlue.sys.mjs:1418-1424` | |
| Monitor card on about:protections | `monitor.firefox.com/user/breach-stats` | `browser.contentblocking.report.monitor.enabled`=**false** | | `firefox.js:2706,2747` | |
| VPN promos | links only (`vpn.mozilla.org`, app stores) | `browser.vpn_promo.enabled`=true; `browser.promo.relay.enabled`=true | | `firefox.js:2726-2739,2750-2753` | none (links) |
| IP Protection (built-in VPN) | `vpn.mozilla.org` (guardian); RS `vpn-serverlist` | `browser.ipProtection.enabled`=**false** | | `firefox.js:3698,3736`; `toolkit/components/ipprotection/IPProtectionServerlist.sys.mjs:393` | |

### 2.13 Certificates / TLS

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| OCSP | the CA's responder from the certificate (not a fixed host) | `security.OCSP.enabled`=**1** (DV+EV); `security.OCSP.require`=false; `security.ssl.enable_ocsp_stapling`=true (all compiled StaticPrefList) | StaticPrefList (Mozilla) | `StaticPrefList.yaml:18813-18830,18857-18860` | certificate serial/issuer to the CA |
| CRLite | RS bucket `security-state`, collection `cert-revocations` | `security.pki.crlite_mode`=**2** (enforce, so **DV OCSP is skipped for Mozilla-root certs; EV OCSP still fetched**); `security.remote_settings.crlite_filters.enabled`=true | | `StaticPrefList.yaml:18950-18960`; `all.js:58`; `security/manager/ssl/RemoteSecuritySettings.sys.mjs:21,556-560` | |
| Intermediate preloading | RS `security-state/intermediates` (+ attachment downloads) | `security.remote_settings.intermediates.enabled`=true, `...downloads_per_poll`=5000 | | `all.js:54-56`; `RemoteSecuritySettings.sys.mjs:17,271-276` | |
| OneCRL | RS `security-state/onecrl` | none | | `RemoteSecuritySettings.sys.mjs:257-260` | |
| MitM priming (on certain cert errors) | `mitmdetection.services.mozilla.com` | `security.certerrors.mitm.priming.enabled`=true | | `firefox.js:1663-1665`; `toolkit/actors/NetErrorParent.sys.mjs:142` | request to a known host to detect interception |

### 2.14 Translations, ML, AI

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| Translations | models and wasm from RS (translations models / wasm collections, attachments) | `browser.translations.enable`=**true** (firefox.js; all.js says false); `browser.translations.select.enable`=true; `browser.translations.automaticallyPopup`=true | | `firefox.js:2570-2574`; `all.js:3624-3649`; `toolkit/components/translations/actors/TranslationsParent.sys.mjs:3425,3786` | model downloads (translation runs locally) |
| ML engine models | `model-hub.mozilla.org`; RS `ml-onnx-runtime`, `ml-inference-options`, `ml-model-allow-deny-list`, `ml-inference-words-block-list` | `browser.ml.enable`=**true**; `browser.ai.control.default`=`available`; consumers `browser.ml.linkPreview.enabled`=true, `browser.tabs.groups.smart.enabled`=true | | `all.js:3664-3679`; `firefox.js:1183,2359`; `toolkit/components/ml/actors/MLEngineParent.sys.mjs:50-57` | model downloads on use |
| AI chatbot sidebar | provider chosen by the user | `browser.ml.chat.enabled`=true, `browser.ml.chat.provider`="" (none) | | `firefox.js:2336,2348` | |
| Smart Window | `mlpa-prod-prod-mozilla.freetls.fastly.net/v1` (+ `/v1/search`) | `browser.smartwindow.enabled`=**false** | | `firefox.js:2379-2429` | |

### 2.15 Misc browser services

| Feature | Endpoint host(s) | Controlling pref(s) + default | Build flag(s) | file:line | What is sent |
|---|---|---|---|---|---|
| Spell-check dictionaries | link only (`addons.mozilla.org/.../language-tools/`); RS `language-dictionaries` in the language dialog | `browser.dictionaries.download.url` | | `firefox.js:80`; `browser/components/preferences/dialogs/browserLanguages.js:46` | none automatically |
| Favicon / site-icon services | no dedicated favicon service found. Icons come from sites, RS `tippytop` (2.9), and the Pocket image proxy (2.9) | | | see 2.9 | |
| DevTools / Profiler | `profiler.firefox.com` (opened when the user captures a profile); `api.profiler.firefox.com` upload is **commented out** by default; ADB extension `ftp.mozilla.org` (about:debugging); MDN links only | `devtools.performance.recording.ui-base-url`; `toolkit.aboutLogging.uploadProfileToCloud`=false | | `all.js:623,3736-3745,4033`; `devtools/client/netmonitor/src/utils/doc-utils.js:130` | profile data only on user action |
| DevTools debugging (non-official) | none by default (the server listens only when started) | `devtools.chrome.enabled`=**true**, `devtools.debugger.remote-enabled`=**true** because `MOZILLA_OFFICIAL` is unset locally | `MOZILLA_OFFICIAL` (local) | `all.js:3989-3998` | Note: official builds set both to false |
| Webcompat reporter / decoder doctor | `webcompat.com/issues/new` | user-initiated | | `all.js:227,3172` | |
| Shopping (OHTTP prefs remain) | `prod.ohttp-gateway.prod.webservices.mozgcp.net`, `mozilla-ohttp.fastly-edge.com` | only prefs are defined, no enable flag found | | `all.js:530-531` | |

---

## 3. Remote Settings collections referenced by desktop code (all fetched from `firefox.settings.services.mozilla.com`)

`normandy-recipes-capabilities`, `nimbus-desktop-experiments` (+ secure experiments), `cfr`, `message-groups`,
`ms-language-packs`, `search-config-v2`, `search-config-overrides-v2`, `search-config-icons`, `search-telemetry-v2`,
`search-categorization`, `hijack-blocklists`, `tracking-protection-lists`, `url-classifier-exceptions`,
`query-stripping`, `doh-providers`, `doh-config`, `regions` (only with local-geocoding), `top-sites`, `tippytop`,
`newtab-renderer`, `addons-bloomfilters`, `addons`, `gfx`, `addons-manager-settings`, `fxmonitor-breaches`,
`crash-reports-ondemand`, `moz-essential-domain-fallbacks`, `vpn-serverlist`, `ml-onnx-runtime`, `ml-inference-options`,
`ml-model-allow-deny-list`, `ml-inference-words-block-list`, `language-dictionaries`,
security-state: `onecrl`, `intermediates`, `cert-revocations`; plus translations models/wasm and others found via
`git grep "RemoteSettings("` (partitioning/bounce-tracking/fingerprinting exceptions, password-related lists, webcompat interventions).

---

## 4. Endpoints that don't fit a category

| Host | Pref / location | Notes |
|---|---|---|
| `*.mozilla-backup.org` (aus5, addons, versioncheck-addons, archive, download, firefox-settings, firefox-settings-attachments, content-signature-2-cdn) | `network.essential_domains_fallback`=true (`StaticPrefList.yaml:17249-17252`) + RS dump | Automatic fallback hosts for Mozilla infrastructure |
| `mitmdetection.services.mozilla.com` | `firefox.js:1664` | cert-error priming |
| `coverage.mozilla.org` | `firefox.js:3064` | disabled |
| `archive.mozilla.org/pub/system-addons/newtab/` | `firefox.js:2203` | newtab train-hop XPIs |
| `ideas.mozilla.org`, `support.mozilla.org`, `www.mozilla.org`, `www.firefox.com`, `monitor.firefox.com`, `color.firefox.com`, app stores | many `*.url` prefs in `firefox.js` (for example 248, 1535-1537, 1657-1660, 2741-2761, 3652-3656) | UI links only (no background traffic) |
| `anf1.fuzzing.mozilla.org` | `all.js:3712` | ASan builds only |
| `webcompat.com` | `all.js:227,3172` | user-initiated |
| `ftp.mozilla.org` (ADB extension) | `all.js:4033` | about:debugging USB, user-initiated |
| `profile.stage.mozaws.net` | `firefox.js:3561` | only an SVG context-properties allowlist, not contacted |

---

## 5. Key findings

1. **Telemetry is not disabled in the Neeko artifact build.** Legacy Telemetry's `isOfficialTelemetry` and Glean's
   `glean_disable_upload` are both compile-time gates in Mozilla's prebuilt libxul, and both allow upload there
   (**inferred** from `MOZILLA_OFFICIAL=1` in Mozilla's macOS mozconfig). The only remaining gate is
   `datareporting.healthreport.uploadEnabled`, which defaults to **true** in the locally built `all.js:3779`
   (objdir `greprefs.js:1447` confirms it). The mozconfig lines `mk_add_options MOZ_TELEMETRY_REPORTING=` /
   `MOZ_DATA_REPORTING=` do nothing.
2. **The crash reporter client sends a Glean crash ping right after a crash, before any UI**, and it reads the
   upload pref **only from `prefs.js` user values**, defaulting to true (`client/app/src/glean.rs:34-66`,
   `logic.rs:109`). A `pref()` default in firefox.js will not stop it; it has to be a user value
   (user.js / prefs.js / UI), or the crash reporter has to be disabled through the locally generated application.ini.
3. **App update cannot be switched off by pref.** The update URL comes from the locally generated `application.ini`.
   The `MOZ_APPUPDATE_HOST=localhost:7648` export is dead code because no configure option reads it, so
   application.ini still points to `aus5.mozilla.org`. The effective channel on macOS is `default` (locked, from the
   prebuilt ChannelPrefs framework).
4. **The API keys are local (JS)**, so this build has `no-*-api-key`. Google SB list updates and gethash are
   auto-disabled. But the **download-protection remote lookup is not gated on the key** (C++ checks only for an
   empty URL), and **region detection still calls `location.services.mozilla.com`** with an invalid key and retries
   3 times.
5. **Push websocket to `push.services.mozilla.com` opens at startup** because Remote Settings registers a broadcast
   listener, even with no site subscriptions.
6. **StaticPrefList.yaml edits are ignored in artifact builds.** Its defaults are compiled into Mozilla's libxul
   (`@IS_NIGHTLY_BUILD@` / `MOZILLA_OFFICIAL` take release/official values). Override them in firefox.js instead.
7. **MOZ_NORMANDY and MOZ_SERVICES_HEALTHREPORT are `project_flag`s** that only accept implied values, so they
   cannot be turned off from mozconfig. Change `browser/moz.configure:6,10`, or rely on the prefs
   (`app.normandy.enabled`, `app.shield.optoutstudies.enabled`, `datareporting.healthreport.uploadEnabled`).
8. Other surprising defaults: Nimbus stays active for **Firefox Labs** even with studies and rollouts off; the
   Remote Settings server cannot be overridden on release/beta without an env var; New Tab code can be delivered
   remotely (`newtab-renderer` RS collection, train-hop XPIs from `archive.mozilla.org`); DoH may be enabled
   automatically per region via RS `doh-config`; captive-portal and connectivity checks use **plain HTTP**
   to `firefox-portal-detection.com`.
