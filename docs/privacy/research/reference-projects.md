# Firefox privacy-hardening reference inventory (network / telemetry)

Generated 2026-09-22 for Neeko (Firefox 156.0.1). Research only: nothing here was applied to the project.

## Sources (fetched 2026-09-22)

| Project | URL fetched | Commit (HEAD) | Commit date | Version marker in file |
|---|---|---|---|---|
| Betterfox | https://github.com/yokoffing/Betterfox (user.js, Securefox.js, Peskyfox.js, Fastfox.js, Smoothfox.js, policies.json, zen/user.js) | `067172a4b0dc90e78e5b8b94d9abfe6430c6a7be` | 2026-09-06 | user.js/Securefox.js "version: 154"; Peskyfox.js "version: 152"; latest release tag 154.0 (2026-09-06) |
| arkenfox | https://github.com/arkenfox/user.js (user.js) | `fb56d7bb4ed07898c9d94ca7ecc89697dd88cc3c` | 2026-09-09 | header "version: 144, date: 21 April 2026"; latest release v144 (2026-04-20) |
| LibreWolf settings (standalone repo) | https://codeberg.org/librewolf/settings (librewolf.cfg, distribution/policies.json, defaults/pref/local-settings.js) | `590dd1c2e3c248f4b3023093520e9fcd642dd899` | 2026-08-18 | `librewolf.cfg.version` 8.6. **Stale**: see note below |
| LibreWolf source | https://codeberg.org/librewolf/source (assets/mozconfig.new, assets/patches.txt, patches/, scripts/, **settings/**) | `57e37706b9fee69a7d3fdbb5c529d6e3b318a649` | 2026-09-22 | `version` 156.0.1, `release` 1 |
| Zen Browser | https://github.com/zen-browser/desktop (prefs/**/*.yaml, configs/*/mozconfig, surfer.json, build/AppDir/distribution/policies.json, src/**/*.patch) | `4c92731b2dbbcf3f5a4dad79c09d13c38f91f774` | 2026-09-22 | surfer.json: Firefox 156.0.1, Zen 1.22.3b |

**LibreWolf note:** LibreWolf has moved to its own Forgejo at `librewolf.dev` (codeberg `source` HEAD == `https://librewolf.dev/librewolf/source` HEAD). The build script `scripts/librewolf-patches.py` copies `settings/librewolf.cfg`, `settings/distribution/policies.json` and `settings/defaults/pref/local-settings.js` from **inside the source repo** ("Apply most recent `settings` repository files"); that copy has 15+ commits after the standalone `settings` repo's last commit (e.g. "Preferences for 156", "Add the updater settings", "Redo GMP related preferences"). The **LibreWolf column below uses `source/settings/` (what ships in 156.0.1-1)**. Differences vs. the stale standalone repo are listed in section 6.

Scratch copies of every source: `/tmp/neeko-privacy/src/`. Machine-readable extraction: `/tmp/neeko-privacy/prefs.json` (all prefs incl. non-network ones).

## How to read the tables

- **Betterfox (BF)**: value from `user.js` (the file users install). `(X.js only)` = active only in the Securefox/Peskyfox/Fastfox component file, not in user.js. `(opt) v` = present only as a commented-out suggestion (NOT applied).
- **arkenfox (AF)**: active `user_pref`. `(opt) v` = commented out (suggested/optional). `(reset to FF default)` = prefsCleaner entry, i.e. arkenfox deliberately stopped setting it. `(inactive-9999)` = inside the deprecated block comment (not applied).
- **LibreWolf (LW)**: from `librewolf.cfg` (autoconfig). `[def]` = `defaultPref` (user can change), `[P]` = `pref` (re-applied each start), `[L]` = `lockPref` (locked), `(opt)` = commented out.
- **Zen**: from `prefs/**/*.yaml` (compiled into the default pref file). `[L]` = `locked: true`; `(if ...)` = build condition.
- **FF156**: does the exact pref name appear in the Firefox 156.0.1 source (`engine/` at commit `d9b85be` "Firefox 156.0.1", tests/third_party excluded)? `yes` / `dyn` (name built at runtime, checked by hand) / **NOT FOUND** (no reference: the pref is probably dead and has no effect in 156) / `n/a (fork)` (pref added by the fork's own patches).
- **Comments**: condensed from each project's own comment text (arkenfox item number in brackets). BF comments come from the component file where the pref is documented.
- Only network-related prefs are tabulated (anything that makes Firefox contact Mozilla, Google or other third parties, or leak to them). UI, fingerprinting, cache, TLS-cipher, ETP and sanitizing prefs are in `prefs.json` but omitted here.

## Summary counts

- Network-related pref names tabulated: **410** across 32 categories.
- Actively set (not commented) per project: Betterfox 65 (incl. component-file-only), arkenfox 79, LibreWolf 253, Zen 85.
- Pref names used by these projects that are **not referenced anywhere in FF156 source**: 37 (see section 5).

## 1. Build-time configuration (mozconfig, env, source patches)

arkenfox and Betterfox are prefs-only (no build config). Betterfox ships a `policies.json` (section 2).

### 1a. mozconfig flags / exported env

| Flag / env (exact text) | LibreWolf `assets/mozconfig.new` | Zen `configs/common/mozconfig` (+platform) | Purpose / project comment |
|---|---|---|---|
| `ac_add_options --disable-crashreporter` | yes | yes, only `if test "$ZEN_RELEASE"` | Compiles out Breakpad/crash reporter client; no crash report submission. |
| `mk_add_options MOZ_CRASHREPORTER=0` | yes |  | Same, make-level. |
| `ac_add_options --disable-default-browser-agent` | yes |  | Windows scheduled task that reports default-browser status to Mozilla (telemetry). Not built. |
| `ac_add_options --disable-updater` | yes |  | Compiles out the app updater (LW distributes via package managers). Note LW's newer `updater.patch` points the update host to `update.librewolf.net`, while this flag + policies still disable updates: in transition. |
| `export MOZ_TELEMETRY_REPORTING=` | yes (empty) |  | Empty = telemetry reporting not enabled at build time. |
| `mk_add_options MOZ_TELEMETRY_REPORTING=0` / `=` | `=0` | `mk_add_options MOZ_TELEMETRY_REPORTING=` and `ac_add_options MOZ_TELEMETRY_REPORTING=` | Disables telemetry reporting build define. |
| `mk_add_options MOZ_DATA_REPORTING=0` / `=` | `=0` | `mk_add_options MOZ_DATA_REPORTING=` and `ac_add_options MOZ_DATA_REPORTING=` | Disables the data-reporting (FHR/data submission) build define, which also removes the data-submission info bar. |
| `mk_add_options MOZ_SERVICES_HEALTHREPORT=0` / `=` | `=0` | `=` (empty) | Health report service off. LW additionally patches `browser/moz.configure` `imply_option("MOZ_SERVICES_HEALTHREPORT", False)` because `mk_add_options` alone does not override the imply_option. |
| `export MOZILLA_OFFICIAL=1` | yes | yes (release builds; also `mk_add_options MOZILLA_OFFICIAL=1`) | Official-build behaviour. Side effect: upstream only disables Glean upload (`glean_disable_upload`) for NON-official builds, so LW patches gkrust-features to add `glean_disable_upload` when MOZILLA_OFFICIAL (see 1b). |
| `export MOZ_REQUIRE_SIGNING=` | yes (empty) | yes (`export` + `mk_add_options`) | Allows `xpinstall.signatures.required=false` (unsigned add-ons). Security trade-off, not a network item. |
| `ac_add_options --with-unsigned-addon-scopes=app,system` |  | yes | Allows unsigned add-ons in app/system scopes. |
| `ac_add_options --with-google-safebrowsing-api-keyfile=...` |  | yes, if `$HOME/.zen-keys/safebrowsing.dat` exists | Zen supplies a Google Safe Browsing API key, i.e. keeps Safe Browsing working. |
| `ac_add_options --with-mozilla-api-keyfile=...` |  | yes, if `$HOME/.zen-keys/mozilla.dat` exists | Mozilla API key (used by Mozilla location/other services). |
| `ac_add_options --with-google-location-service-api-keyfile=...` |  | yes, if key file exists | Google geolocation key: Zen keeps Google network geolocation available. |
| `ac_add_options --with-distribution-id=app.zen-browser` |  | yes | Distribution ID (reported in update URL `%DISTRIBUTION%`, search/attribution). |
| `ac_add_options --enable-eme=widevine` (`widevine,wmfcdm` on Win x64) |  | yes (macOS, Linux x86_64, Windows) | Builds Widevine CDM support (downloaded from Google on demand). LW does not pass it. |
| `ac_add_options --disable-tests` | yes | yes (release) | Not network-related; listed for completeness. |
| surfer.json `"updateHostname": "updates.zen-browser.app"` |  | yes | Surfer-specific: points the updater at Zen's own AUS (relevant to Neeko, which also builds with Surfer). |

### 1b. Source patches that remove telemetry / network features

| Project | Patch / script step | What it does (from the diff) |
|---|---|---|
| LibreWolf | `patches/disable-data-reporting-at-compile-time.patch` | `browser/moz.configure`: `imply_option("MOZ_SERVICES_HEALTHREPORT", False)` and `imply_option("MOZ_NORMANDY", False)` (Normandy not built). `glean-core`: `glean_set_upload_enabled` / `set_collection_enabled` forced to `false`, `is_upload_enabled()` returns `false`. `Telemetry.cpp`: `SetCanRecordBase/Extended` and telemetry instance creation compiled out (`#if false`). `gkrust-features.mozbuild`: `glean_disable_upload` feature enabled for MOZILLA_OFFICIAL builds. `mach` build telemetry disabled; glean-sdk dropped from mach venv. |
| LibreWolf | `patches/remove-pingsender.patch` | Removes the `pingsender` binary from build/packaging (mac, Linux, Windows NSIS, artifacts) and makes `TelemetrySend.runPingSender()` throw NS_ERROR_NOT_IMPLEMENTED. |
| LibreWolf | `patches/rs-blocker.patch` + prefs `librewolf.services.settings.allowedCollections[FromDump]` | Remote Settings allowlist: sync, attachment downloads and JSON-dump loading are refused for any bucket/collection not in the allowlist (logged as "was blocked/filtered"). Also stubs `SearchEngineSelector.#getConfigurationOverrides()` to return `[]` (no remote search-config overrides). |
| LibreWolf | `scripts/librewolf-patches.py` | Replaces `services/settings/dumps/main/search-config-v2.json` and `search-config-icons.json` with LibreWolf's own (adds Mojeek); deletes the ML OpenAI backend files; replaces updater MAR signing keys with LibreWolf's (`marsigner*.der`). |
| LibreWolf | `patches/updater.patch` | `application.ini` AppUpdate URL becomes `https://@MOZ_APPUPDATE_HOST@/%BUILD_TARGET%/%CHANNEL%/update.xml` (drops version/OS/locale/distribution fields) and host `aus5.mozilla.org` -> `update.librewolf.net`. |
| LibreWolf | `patches/autoconfig-setEnv.patch` + cfg `setEnv("MOZ_CRASHREPORTER_DISABLE", 1)`, `setEnv("MOZ_GFX_CRASH_MOZ_CRASH", 1)` | Adds `setEnv()` to autoconfig so the cfg can set env vars that disable the runtime exception/crash reporter module and turn gfx crashes into MOZ_CRASH. |
| LibreWolf | `patches/newtab-fix.patch` | `ExperimentAPI.ready()` resolves immediately when Nimbus is disabled (so New Tab does not wait on / trigger Nimbus). |
| LibreWolf | `patches/display-version.patch` | Update prompt release-notes URL no longer read from Nimbus `updatePrompt` feature; uses `app.releaseNotesURL.prompt`. |
| LibreWolf | `patches/ui-patches/wallpapers.patch` | New Tab wallpaper records are only fetched from Remote Settings if `librewolf.externalWallpapers.enabled` is true. |
| LibreWolf | `patches/remove-openai.patch` | Removes the OpenAI backend from the ML component (no remote LLM endpoint). |
| LibreWolf | `patches/remove-language-packs.patch` + policy `ExtensionSettings.allowed_types` | Uninstalls any installed language packs at startup; policies forbid installing type `locale` (builds are multi-locale, so no langpack downloads). |
| LibreWolf | `patches/extensions-setUninstallURL.patch` | `runtime.setUninstallURL` becomes a no-op, so extensions cannot open a tracking URL on uninstall. |
| LibreWolf | `patches/custom-ubo-assets-bootstrap-location.patch` | uBlock Origin asset bootstrap list is read from `librewolf.uBO.assetsBootstrapLocation` (LibreWolf-hosted JSON). |
| LibreWolf | `patches/hide-disabled-urlbar-suggests.patch` | Hides the AI and Labs quick actions when those features are off (UI). |
| Zen | `src/browser/installer/windows/nsis/defines-nsi-in.patch` | Blanks `TELEMETRY_BASE_URL` (was `https://incoming.telemetry.mozilla.org/submit`), i.e. no Windows installer ping. |
| Zen | `src/browser/installer/package-manifest-in.patch` | Comments out `crashreporter(.app)` from the package manifest. |
| Zen | `src/browser/extensions/newtab/lib/ActivityStream-sys-mjs.patch` | Default `showSponsoredTopSites` changed `true` -> `false` in PREFS_CONFIG. |
| Zen | `src/toolkit/modules/UpdateUtils-sys-mjs.patch` | Update URL `%VERSION%` uses `ZEN_FIREFOX_VERSION` (Zen runs its own update server). |

LibreWolf Remote Settings allowlist as shipped (`librewolf.services.settings.allowedCollections`, network sync allowed):

`"security-state/*,main/content-classifier-lists,main/change-password-urls,main/webcompat-interventions,main/addons-data-leak-blocker-domains,main/vpn-serverlist,main/fxrelay-denylist,main/translations-models-v2,main/translations-wasm-v2,main/mfcdm-origins-list,main/url-classifier-exceptions,main/fxrelay-allowlist,main/ml-model-allow-deny-list,main/third-party-cookie-blocking-exempt-urls,main/backup-common-passwords-list,main/bounce-tracking-protection-exceptions,main/fingerprinting-protection-overrides,main/translations-models,main/translations-wasm,main/cookie-banner-rules-list,main/password-rules,main/websites-with-shared-credential-backends,main/password-recipes,main/partitioning-exempt-urls,blocklists/addons-bloomfilters,main/tracking-protection-lists,main/anti-tracking-url-decoration,main/hijack-blocklists,main/fxmonitor-breaches,main/language-dictionaries,blocklists/gfx,blocklists/addons,blocklists/plugins"`

Dump-only (bundled JSON, never synced) `librewolf.services.settings.allowedCollectionsFromDump`:

`"main/moz-essential-domain-fallbacks,main/url-parser-default-unknown-schemes-interventions,main/urlbar-persisted-search-terms,main/newtab-wallpapers-v2,main/newtab-wallpapers,main/devtools-devices,main/devtools-compatibility-browsers,main/ms-images,main/tippytop,main/search-config-icons,main/search-config-v2"`

Everything else (e.g. `nimbus-desktop-experiments`, `main/search-config-overrides-v2`, `main/newtab-wallpapers*` network sync, `main/quicksuggest*`, `main/ms-language-packs`, `main/top-sites`, `main/search-telemetry-v2`) is blocked.

## 2. Enterprise policies (`policies.json`)

arkenfox ships no policies. Zen ships a policies.json only in the Linux AppImage tree (`build/AppDir/distribution/policies.json`).

| Policy key | Betterfox `policies.json` | LibreWolf `settings/distribution/policies.json` | Zen AppImage | Notes / project comment |
|---|---|---|---|---|
| `DisableTelemetry` | `true` | `true` |  | Locks telemetry + data reporting off. |
| `DisableFirefoxStudies` | `true` | `true` |  | Studies/Normandy/Nimbus experiments off. |
| `DisableRemoteImprovements` | `true` | `true` |  | Nimbus rollouts ("remote improvements", FF148+) off. |
| `DisableFeedbackCommands` | `true` | `true` |  | Removes "Submit feedback" / "Report deceptive site" menu items. |
| `DisableDefaultBrowserAgent` |  | `true` |  | Windows default-browser agent (telemetry task). |
| `DontCheckDefaultBrowser` | `true` | `true` |  |  |
| `SkipTermsOfUse` | `true` | `true` |  | Skips the Terms-of-Use acceptance flow. |
| `AppAutoUpdate` | `true` |  | `false` | BF comment: "Change to false to disable auto-updates". |
| `ManualAppUpdateOnly` | `false` |  | `true` | BF comment: "Change to true to disable auto-updates". |
| `DisableAppUpdate` |  | `true` | `true` |  |
| `AppUpdateURL` |  | `"https://localhost"` |  | Points AUS at localhost (defense in depth). |
| `BackgroundAppUpdate` |  |  | `false` | Background update task off (AppImage). |
| `CrashReportsSubmit` | `{"ForceAutoSubmit": false}` |  |  | BF comment: "Only implemented in Firefox ESR". |
| `DNSOverHTTPS` | `{"Enabled": false, "ProviderURL": "", "Locked": false}` |  |  | BF turns DoH off by policy (no comment given). |
| `FirefoxHome` | `SponsoredStories:false, SponsoredTopSites:false, Stories:false` | `Weather:false, TopSites:false, SponsoredTopSites:false, Highlights:false, Stories:false, SponsoredStories:false` |  | New Tab content. |
| `FirefoxSuggest` |  | `WebSuggestions:false, SponsoredSuggestions:false, ImproveSuggest:false` |  | Firefox Suggest (online + sponsored + data sharing). |
| `GenerativeAI` | `{"Enabled": false}` |  |  | AI features off. |
| `AIControls` |  | `Translations:available; PDFAltText, SmartTabGroups, LinkPreviewKeyPoints, SidebarChatbot, SmartWindow: blocked` |  | LW keeps local Translations available, blocks other AI. |
| `UserMessaging` |  | `UrlbarInterventions:false, SkipOnboarding:true, MoreFromMozilla:false, FirefoxLabs:false` |  | Messaging / onboarding. |
| `EncryptedMediaExtensions` |  | `{"Enabled": false}` |  | DRM off (so no Widevine download). |
| `ExtensionSettings` |  | `"*": allowed_types [dictionary, extension, sitepermission, theme]` (blocks langpacks); uBO `normal_installed` from AMO |  | LW message: "LibreWolf does not allow installing Language Packs." uBO is fetched from addons.mozilla.org on first run. |
| `Extensions` | `Install: uBlock Origin (AMO latest.xpi); Uninstall: amazondotcom@search.mozilla.org, ebay@search.mozilla.org` |  |  | Note: fetches uBO from AMO on first run. |
| `SearchEngines` | `Default: DuckDuckGo; Remove: Amazon.com, eBay, Perplexity; Add: DuckDuckGo Lite, SearXNG (searx.be), MetaGer, StartPage` |  |  | Search engine config. |
| `WebsiteFilter` | `Block: ["https://localhost/*"]` | `Block + Exceptions: ["https://localhost/*"]` |  | No comment given in either project (pairs with LW `AppUpdateURL: https://localhost`). |
| `HttpsOnlyMode` |  | `"enabled"` |  |  |
| `LocalNetworkAccess` |  | `Enabled:true, BlockTrackers:true, EnablePrompting:true` |  |  |
| `OverridePostUpdatePage` |  | `""` |  | No What's New page after updates. |
| `NoDefaultBookmarks` | `true` | `true` |  | Not network (removes Mozilla default bookmarks). |
| `DisableSetDesktopBackground` | `true` | `false` |  | Not network. |
| `SupportMenu` |  | LibreWolf Issue Tracker -> `https://librewolf.dev/librewolf/issues` |  |  |

## 3. Preferences by category

Columns: exact pref name | Betterfox | arkenfox | LibreWolf | Zen | FF156 | project comments | kept-on-for-security / context

### 3.1 Telemetry (legacy Telemetry, ping sender, misc telemetry switches)

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.newtabpage.activity-stream.feeds.telemetry` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable Firefox Home (Activity Stream) telemetry<br>**AF:** [0335] disable Firefox Home (Activity Stream) telemetry<br>**LW:** disable telemetry in Firefox Home<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `browser.newtabpage.activity-stream.telemetry` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable Firefox Home (Activity Stream) telemetry<br>**AF:** [0335] disable Firefox Home (Activity Stream) telemetry<br>**LW:** disable telemetry in Firefox Home<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.archive.enabled` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable telemetry - If "unified" is false then "enabled" controls the telemetry module - If "unified" is true then "e...<br>**AF:** [8502] disable telemetry The "unified" pref affects the behavior of the "enabled" pref - If "unified" is false then "enabled...<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy.<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.bhrPing.enabled` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable telemetry - If "unified" is false then "enabled" controls the telemetry module - If "unified" is true then "e... // [FF57+] Background Hang Reporter<br>**AF:** [8502] disable telemetry The "unified" pref affects the behavior of the "enabled" pref - If "unified" is false then "enabled... // [FF57+] Background Hang Reporter<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy.<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.enabled` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable telemetry - If "unified" is false then "enabled" controls the telemetry module - If "unified" is true then "e... // see [NOTE]<br>**AF:** [8502] disable telemetry The "unified" pref affects the behavior of the "enabled" pref - If "unified" is false then "enabled... // see [NOTE]<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just... // master switch<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.firstShutdownPing.enabled` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable telemetry - If "unified" is false then "enabled" controls the telemetry module - If "unified" is true then "e...<br>**AF:** [8502] disable telemetry The "unified" pref affects the behavior of the "enabled" pref - If "unified" is false then "enabled... // [FF57+]<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy.<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.newProfilePing.enabled` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable telemetry - If "unified" is false then "enabled" controls the telemetry module - If "unified" is true then "e...<br>**AF:** [8502] disable telemetry The "unified" pref affects the behavior of the "enabled" pref - If "unified" is false then "enabled... // [FF55+]<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy.<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.server` | `"data:,"` | `"data:,"` | `"data:," [L]` | `"data:," [L]` | yes | **BF:** disable telemetry - If "unified" is false then "enabled" controls the telemetry module - If "unified" is true then "e...<br>**AF:** [8502] disable telemetry The "unified" pref affects the behavior of the "enabled" pref - If "unified" is false then "enabled...<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy.<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.shutdownPingSender.enabled` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable telemetry - If "unified" is false then "enabled" controls the telemetry module - If "unified" is true then "e...<br>**AF:** [8502] disable telemetry The "unified" pref affects the behavior of the "enabled" pref - If "unified" is false then "enabled... // [FF55+]<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy.<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.unified` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable telemetry - If "unified" is false then "enabled" controls the telemetry module - If "unified" is true then "e...<br>**AF:** [8502] disable telemetry The "unified" pref affects the behavior of the "enabled" pref - If "unified" is false then "enabled...<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just... // master switch<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.updatePing.enabled` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable telemetry - If "unified" is false then "enabled" controls the telemetry module - If "unified" is true then "e...<br>**AF:** [8502] disable telemetry The "unified" pref affects the behavior of the "enabled" pref - If "unified" is false then "enabled... // [FF56+]<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy.<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `browser.search.serpEventTelemetryCategorization.enabled` | `(opt) false` |  | `false [def]` | `false [L]` | yes | **BF:** SERP Telemetry [FF125+]<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR)<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `browser.newtabpage.activity-stream.impressionId` |  |  | `"{lulu-glows-at-night}" [L]` |  | yes | **LW:** Set random ID |  |
| `browser.newtabpage.activity-stream.telemetry.privatePing.enabled` |  |  | `false [L]` |  | yes | **LW:** Disable newtab ping |  |
| `browser.ping-centre.telemetry` |  |  |  | `false` | **NOT FOUND** | **Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.cachedClientID` |  |  | `"" [L]` |  | yes | **LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy. |  |
| `toolkit.telemetry.pioneer-new-studies-available` |  |  |  | `false` | **NOT FOUND** | **Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.previousBuildID` |  |  | `"" [L]` |  | yes | **LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy. |  |
| `toolkit.telemetry.server_owner` |  |  | `"" [L]` |  | yes | **LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy. |  |
| `toolkit.telemetry.site_categories` |  |  | `"{}" [L]` |  | yes | **LW:** Set random ID |  |
| `app.update.lastUpdateTime.glean-addons-daily` |  |  | `(clearPref)` |  | dyn (update-timer) | **LW:** Disable and deregister the Glean add-on ping scheduler https://codeberg.org/celenity/Phoenix/commit/1ff7ae1dbd3095c99... |  |
| `dom.security.unexpected_system_load_telemetry_enabled` | `(opt) false` |  |  |  | yes | **BF:** assorted telemetry |  |
| `network.trr.confirmation_telemetry_enabled` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** assorted telemetry |  |
| `privacy.trackingprotection.emailtracking.data_collection.enabled` | `(opt) false` |  |  |  | yes | **BF:** assorted telemetry |  |
| `security.app_menu.recordEventTelemetry` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** assorted telemetry |  |
| `security.certerrors.recordEventTelemetry` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** assorted telemetry |  |
| `security.protectionspopup.recordEventTelemetry` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** assorted telemetry |  |

### 3.2 Telemetry coverage

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `toolkit.coverage.endpoint.base` | `""` | `""` | `"" [L]` | `"" [L]` | yes | **BF:** disable Telemetry Coverage<br>**AF:** [8503] disable Telemetry Coverage<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy.<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.coverage.opt-out` | `true` | `true` | `true [L]` | `true [L]` | yes | **BF:** disable Telemetry Coverage // [FF64+] [HIDDEN PREF]<br>**AF:** [8503] disable Telemetry Coverage // [FF64+] [HIDDEN PREF]<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just... // hidden<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `toolkit.telemetry.coverage.opt-out` | `true` | `true` |  | `true [L]` | **NOT FOUND** | **BF:** disable Telemetry Coverage // [HIDDEN PREF]<br>**AF:** [8503] disable Telemetry Coverage // [HIDDEN PREF]<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) | Set by BF/AF/Zen but no longer referenced in FF156 (only `toolkit.coverage.opt-out` is). |
| `toolkit.coverage.enabled` |  |  | `false [L]` |  | yes | **LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy. |  |

### 3.3 Data reporting / health report / Glean-FOG upload / usage pings

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `datareporting.healthreport.uploadEnabled` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable Health Reports<br>**AF:** [8501] disable Health Reports<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy.<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `datareporting.policy.dataSubmissionEnabled` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable new data submission [FF41+] If disabled, no policy is shown or upload takes place, ever.<br>**AF:** [8500] disable new data submission [FF41+] If disabled, no policy is shown or upload takes place, ever<br>**LW:** TELEMETRY telemetry is already disabled elsewhere and most of the stuff in here is just for redundancy.<br>**Zen:** Telemetry & Data Reporting (privatefox/privacy.yaml) |  |
| `datareporting.usage.uploadEnabled` | `false` |  | `false [L]` |  | yes | **BF:** disable daily active users [FF136+]<br>**LW:** disable daily usage pings | BF + LW disable daily-usage ping; AF and Zen do not set it. |
| `extensions.gleanPingAddons.daily.interval` |  |  | `2147483647 [L]` |  | yes (update-timer manifest) | **LW:** Disable and deregister the Glean add-on ping scheduler https://codeberg.org/celenity/Phoenix/commit/1ff7ae1dbd3095c99... |  |
| `extensions.gleanPingAddons.updated.delay` |  |  | `2147483647 [L]` |  | yes | **LW:** Disable and deregister the Glean add-on ping scheduler https://codeberg.org/celenity/Phoenix/commit/1ff7ae1dbd3095c99... |  |
| `extensions.gleanPingAddons.updated.idleTimeout` |  |  | `2147483647 [L]` |  | yes | **LW:** Disable and deregister the Glean add-on ping scheduler https://codeberg.org/celenity/Phoenix/commit/1ff7ae1dbd3095c99... |  |
| `extensions.gleanPingAddons.updated.testing` |  |  | `false [L]` |  | yes | **LW:** Disable and deregister the Glean add-on ping scheduler https://codeberg.org/celenity/Phoenix/commit/1ff7ae1dbd3095c99... |  |
| `identity.fxaccounts.telemetry.clientInfoPing.enabled` |  |  | `false [L]` |  | yes | **LW:** Disable Firefox account ping |  |

### 3.4 Data-submission / Terms-of-Use notices (first-run policy UI)

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `termsofuse.bypassNotification` |  |  | `true [L]` | `true` | yes | **LW:** FIRST LAUNCH disable what's new, ui tour, and privacy notice/terms of use on first start and updates. the browser sho...<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `datareporting.policy.dataSubmissionPolicyAcceptedVersion` |  |  | `999 [L]` |  | yes | **LW:** FIRST LAUNCH disable what's new, ui tour, and privacy notice/terms of use on first start and updates. the browser sho... |  |
| `datareporting.policy.dataSubmissionPolicyBypassNotification` |  |  | `true [L]` |  | yes | **LW:** FIRST LAUNCH disable what's new, ui tour, and privacy notice/terms of use on first start and updates. the browser sho... |  |
| `datareporting.policy.dataSubmissionPolicyNotifiedTime` |  |  | `"32503679999000" [L]` |  | yes | **LW:** FIRST LAUNCH disable what's new, ui tour, and privacy notice/terms of use on first start and updates. the browser sho... |  |

### 3.5 Crash reporter and crash pings

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.tabs.crashReporting.sendReport` | `false` | `false` | `false [L]` | `false` | yes | **BF:** disable crash reports<br>**AF:** [0350] disable Crash Reports // [FF44+]<br>**LW:** disable crash report<br>**Zen:** Crash Reports (privatefox/privacy.yaml) |  |
| `breakpad.reportURL` | `""` | `""` | `"" [L]` |  | yes | **BF:** disable crash reports<br>**AF:** [0350] disable Crash Reports<br>**LW:** disable crash report |  |
| `browser.crashReports.unsubmittedCheck.autoSubmit2` | `(opt) false` | `false` |  | `false` | yes | **BF:** no autosubmission of backlogged crash reports // [DEFAULT FF132+]<br>**AF:** [0351] enforce no submission of backlogged Crash Reports [FF58+] // [DEFAULT: false]<br>**Zen:** (privatefox/privacy.yaml § Crash Reports) |  |
| `browser.crashReports.onDemand` |  |  | `false [L]` |  | yes | **LW:** disable crash report |  |
| `browser.crashReports.requestedNeverShowAgain` |  |  | `true [L]` |  | yes | **LW:** disable crash report |  |
| `browser.crashReports.unsubmittedCheck.enabled` | `false` | `(opt) false` |  |  | yes | **BF:** disable crash reports // [DEFAULT ENFORCE]<br>**AF:** [0350] disable Crash Reports // [FF51+] [DEFAULT: false] |  |
| `setEnv("MOZ_CRASHREPORTER_DISABLE")` |  |  | `1 [env]` |  | env | **LW:** https://searchfox.org/firefox-main/rev/6d751cf5d0af4b7fcc1b232b6c2ba0551afabe1d/mozglue/misc/RuntimeExceptionModule.cpp#98-102 |  |
| `setEnv("MOZ_GFX_CRASH_MOZ_CRASH")` |  |  | `1 [env]` |  | env | **LW:** https://searchfox.org/firefox-main/rev/0989a082704f0bda8d370ccd57402645d834757e/gfx/thebes/gfxPlatform.cpp#381 |  |

### 3.6 Studies / Normandy / Nimbus / experiments / remote improvements

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `app.normandy.api_url` | `""` | `""` | `"" [L]` | `"" [L]` | yes | **BF:** disable Normandy/Shield [FF60+] Shield is an telemetry system (including Heartbeat) that can also push and test "reci...<br>**AF:** [0341] disable Normandy/Shield [FF60+] Shield is a telemetry system that can push and test "recipes"<br>**LW:** opt-out of normandy and studies<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `app.normandy.enabled` | `false` | `false` | `false [L]` | `false` | yes | **BF:** disable Normandy/Shield [FF60+] Shield is an telemetry system (including Heartbeat) that can also push and test "reci...<br>**AF:** [0341] disable Normandy/Shield [FF60+] Shield is a telemetry system that can push and test "recipes"<br>**LW:** opt-out of normandy and studies<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `app.shield.optoutstudies.enabled` | `false` | `false` | `false [L]` | `false [L]` | yes | **BF:** disable Studies<br>**AF:** [0340] disable Studies<br>**LW:** opt-out of normandy and studies<br>**Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `nimbus.rollouts.enabled` | `false` |  | `false [L]` |  | yes | **BF:** disable remote improvements [FF148+]<br>**LW:** (no comment; section TELEMETRY) | BF + LW disable; AF does not set it; Zen does not set it. |
| `browser.newtabpage.activity-stream.discoverystream.merino-feed-experiment` |  |  | `false [L]` |  | yes | **LW:** Disable Mozilla Ad Routing Service (MARS) unified ads service https://searchfox.org/firefox-main/rev/202150dcdade5798... |  |
| `browser.preferences.experimental` |  |  |  | `true` | **NOT FOUND** | **Zen:** (firefox/browser.yaml) |  |
| `browser.preferences.experimental.hidden` |  |  | `true [def]` |  | yes | **LW:** Avoids the "Firefox Labs" section from shortly appearing on first launch |  |
| `startup.homepage_override_nimbus_disable_wnp` |  |  | `true [L]` |  | yes | **LW:** FIRST LAUNCH disable what's new, ui tour, and privacy notice/terms of use on first start and updates. the browser sho... |  |
| `messaging-system.rsexperimentloader.enabled` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** assorted telemetry |  |

### 3.7 Privacy-Preserving Attribution (PPA/DAP), install attribution, referrals

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.referrals.enabled` |  |  | `false [L]` | `false [L]` | yes | **LW:** Disable the Firefox Referral program<br>**Zen:** (firefox/browser.yaml § Only enabled for windows, doesn't really fit inside Zen.) |  |
| `browser.attribution.enabled` |  |  |  | `false` | **NOT FOUND** | **Zen:** (privatefox/privacy.yaml § Telemetry & Data Reporting) |  |
| `browser.referrals.code` |  |  | `"" [L]` |  | yes | **LW:** Disable the Firefox Referral program |  |
| `browser.referrals.pingSubmitted` |  |  | `true [L]` |  | yes | **LW:** Disable the Firefox Referral program |  |
| `dom.private-attribution.submission.enabled` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** disable Privacy-Preserving Attribution [FF128+] |  |
| `toolkit.telemetry.dap_enabled` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** disable telemetry - If "unified" is false then "enabled" controls the telemetry module - If "unified" is true then "e... // DEFAULT [FF108] |  |
| `toolkit.telemetry.dap_helper` | `(opt) ""` |  |  |  | **NOT FOUND** | **BF:** disable Privacy-Preserving Attribution [FF128+] // [OPTIONAL HARDENING] |  |
| `toolkit.telemetry.dap_leader` | `(opt) ""` |  |  |  | **NOT FOUND** | **BF:** disable Privacy-Preserving Attribution [FF128+] // [OPTIONAL HARDENING] |  |

### 3.8 Remote Settings (collections, remote overrides)

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.topsites.useRemoteSetting` |  |  | `false [def]` |  | yes | **LW:** ...about:preferences#home // hide sponsored shortcuts button |  |
| `librewolf.services.settings.allowedCollections` |  |  | `"security-state/*,main/content-classifier-lists,main/chan...` |  | n/a (fork) | **LW:** LIBREWOLF prefs introduced by librewolf-specific patches |  |
| `librewolf.services.settings.allowedCollectionsFromDump` |  |  | `"main/moz-essential-domain-fallbacks,main/url-parser-defa...` |  | n/a (fork) | **LW:** LIBREWOLF prefs introduced by librewolf-specific patches |  |
| `privacy.fingerprintingProtection.remoteOverrides.enabled` |  | `(opt) false` |  |  | yes | **AF:** [4004] disable remote FPP overrides [FF127+] |  |
| `signon.recipes.remoteRecipes.enabled` | `(opt) false` |  |  |  | yes | **BF:** assorted telemetry |  |

### 3.9 Safe Browsing

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.safebrowsing.downloads.remote.enabled` | `false` | `false` | `false [P]` |  | yes | **BF:** disable SB checks for downloads (remote) To verify the safety of certain executable files, Firefox may submit some in...<br>**AF:** [0403] disable SB checks for downloads (remote) To verify the safety of certain executable files, Firefox may submit some in...<br>**LW:** disable safe browsing checks on downloads, both local and remote. the resetting prefs control remote checks, while th... | All of BF/AF/LW disable remote (Google) download lookups. AF tags it [SETUP-SECURITY]: "If you do not understand this, or you want this protection, then override this". |
| `browser.safebrowsing.blockedURIs.enabled` | `(opt) false` |  | `false [def]` |  | yes | **BF:** Safe Browsing [WARNING] Be sure to have alternate security measures if you disable SB! Adblockers do not count! [ALTERNATIVE] Enable local ch... // all checks happen locally<br>**LW:** SAFE BROWSING disable safe browsing, including the fetch of updates. reverting the 7 prefs below allows to perform lo... |  |
| `browser.safebrowsing.downloads.enabled` | `(opt) false` | `(opt) false` | `false [def]` |  | yes | **BF:** disable SB checks for downloads This is the master switch for the safebrowsing.downloads prefs (both local lookups + ... // all checks happen locally<br>**AF:** [0402] disable SB checks for downloads (both local lookups + remote) This is the master switch for the safebrowsing.download...<br>**LW:** disable safe browsing checks on downloads, both local and remote. the resetting prefs control remote checks, while th... | AF/BF keep local download checks (BF: "Still enable this for checks to happen locally"); LW disables. |
| `browser.safebrowsing.downloads.remote.block_potentially_unwanted` | `(opt) false` | `(opt) false` | `false [P]` |  | yes | **BF:** disable SB checks for downloads (remote) To verify the safety of certain executable files, Firefox may submit some in...<br>**AF:** [0404] disable SB checks for unwanted software<br>**LW:** disable safe browsing checks on downloads, both local and remote. the resetting prefs control remote checks, while th... |  |
| `browser.safebrowsing.downloads.remote.block_uncommon` | `(opt) false` | `(opt) false` | `false [P]` |  | yes | **BF:** disable SB checks for downloads (remote) To verify the safety of certain executable files, Firefox may submit some in...<br>**AF:** [0404] disable SB checks for unwanted software<br>**LW:** disable safe browsing checks on downloads, both local and remote. the resetting prefs control remote checks, while th... |  |
| `browser.safebrowsing.downloads.remote.url` | `(opt) ""` | `(opt) ""` | `"" [P]` |  | yes | **BF:** disable SB checks for downloads (remote) To verify the safety of certain executable files, Firefox may submit some in...<br>**AF:** [0403] disable SB checks for downloads (remote) To verify the safety of certain executable files, Firefox may submit some in... // Defense-in-depth<br>**LW:** empty for defense in depth |  |
| `browser.safebrowsing.malware.enabled` | `(opt) false` | `(opt) false` | `false [def]` |  | yes | **BF:** Safe Browsing [WARNING] Be sure to have alternate security measures if you disable SB! Adblockers do not count! [ALTERNATIVE] Enable local ch... // all checks happen locally<br>**AF:** [0401] disable SB (Safe Browsing) [WARNING] Do this at your own risk! These are the master switches<br>**LW:** SAFE BROWSING disable safe browsing, including the fetch of updates. reverting the 7 prefs below allows to perform lo... | AF+BF keep SB on (only commented as optional). AF: "[WARNING] Do this at your own risk! These are the master switches"; BF: "Be sure to have alternate security measures if you disable SB! Adblockers do not count!" LW turns it off. Zen leaves the default and its common mozconfig passes a Google SB API key file when present. |
| `browser.safebrowsing.phishing.enabled` | `(opt) false` | `(opt) false` | `false [def]` |  | yes | **BF:** Safe Browsing [WARNING] Be sure to have alternate security measures if you disable SB! Adblockers do not count! [ALTERNATIVE] Enable local ch... // all checks happen locally<br>**AF:** [0401] disable SB (Safe Browsing) [WARNING] Do this at your own risk! These are the master switches<br>**LW:** SAFE BROWSING disable safe browsing, including the fetch of updates. reverting the 7 prefs below allows to perform lo... | Same as malware.enabled: AF/BF keep, LW disables, Zen keeps (SB API key in build). |
| `browser.safebrowsing.provider.google.gethashURL` | `(opt) ""` |  | `"" [def]` |  | yes | **BF:** Safe Browsing [WARNING] Be sure to have alternate security measures if you disable SB! Adblockers do not count! [ALTERNATIVE] Enable local ch...<br>**LW:** SAFE BROWSING disable safe browsing, including the fetch of updates. reverting the 7 prefs below allows to perform lo... |  |
| `browser.safebrowsing.provider.google.updateURL` | `(opt) ""` |  | `"" [def]` |  | yes | **BF:** Safe Browsing [WARNING] Be sure to have alternate security measures if you disable SB! Adblockers do not count! [ALTERNATIVE] Enable local ch...<br>**LW:** SAFE BROWSING disable safe browsing, including the fetch of updates. reverting the 7 prefs below allows to perform lo... |  |
| `browser.safebrowsing.provider.google4.dataSharingURL` |  |  | `"" [P]` |  | yes | **LW:** empty for defense in depth |  |
| `browser.safebrowsing.provider.google4.gethashURL` | `(opt) ""` |  | `"" [def]` |  | yes | **BF:** Safe Browsing [WARNING] Be sure to have alternate security measures if you disable SB! Adblockers do not count! [ALTERNATIVE] Enable local ch...<br>**LW:** SAFE BROWSING disable safe browsing, including the fetch of updates. reverting the 7 prefs below allows to perform lo... |  |
| `browser.safebrowsing.provider.google4.updateURL` | `(opt) ""` |  | `"" [def]` |  | yes | **BF:** Safe Browsing [WARNING] Be sure to have alternate security measures if you disable SB! Adblockers do not count! [ALTERNATIVE] Enable local ch...<br>**LW:** SAFE BROWSING disable safe browsing, including the fetch of updates. reverting the 7 prefs below allows to perform lo... |  |
| `browser.safebrowsing.allowOverride` | `(opt) true` | `(opt) false` |  |  | yes | **BF:** allow user to "ignore this warning" on SB warnings If clicked, it bypasses the block for that session. This is a mean... // DEFAULT<br>**AF:** [0405] disable "ignore this warning" on SB warnings [FF45+] If clicked, it bypasses the block for that session. This is a me... | AF optional `false` = enforce SB ("a means for admins to enforce SB"). |

### 3.10 Certificate revocation / cert-related connections (OCSP, CRLite, MITM priming)

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `security.OCSP.enabled` | `0` | `(reset to FF default)` | `0 [def]` |  | yes | **BF:** disable OCSP fetching to confirm current validity of certificates OCSP (non-stapled) leaks information about the site...<br>**AF:** [6050] prefsCleaner: reset previously active items removed from arkenfox FF140+ (until v140-1 it enforced 1 = OCSP on, see disagreements)<br>**LW:** Disable OCSP | DISAGREE. BF 0 + LW 0 (OCSP leaks visited domains to the CA; rely on CRLite). AF removed its old `1`+hard-fail enforcement in v144 and now leaves FF default, which in FF156 desktop is 1 (OCSP on, soft-fail) per StaticPrefList.yaml. |
| `security.pki.crlite_mode` | `(opt) 2` | `2` | `2 [def]` |  | yes | **BF:** CRLite CRLite covers valid certs, and it doesn't fall back to OCSP in mode 2 [FF84+]. CRLite is faster and more priva... // [DEFAULT: 2 FF142+]<br>**AF:** [1224] enable CRLite [FF73+] 0 = disabled 1 = consult CRLite but only collect telemetry 2 = consult CRLite and enforce both ... // [DEFAULT: 2 FF142+]<br>**LW:** Use CRLite whenever possible 0: Disable CRLite entirely. 1: Consult CRLite but only collect telemetry. -> 2: Consult ... | KEEP ON. AF enforces 2 (item 1224 "enable CRLite"); LW "Use CRLite whenever possible" (2); BF leaves default 2 (commented: "CRLite is faster and more private than OCSP"). |
| `security.remote_settings.crlite_filters.enabled` | `(opt) true` | `true` | `true [def]` |  | yes | **BF:** CRLite CRLite covers valid certs, and it doesn't fall back to OCSP in mode 2 [FF84+]. CRLite is faster and more priva... // [DEFAULT: true FF137+]<br>**AF:** [1224] enable CRLite [FF73+] 0 = disabled 1 = consult CRLite but only collect telemetry 2 = consult CRLite and enforce both ... // [DEFAULT: true]<br>**LW:** Use CRLite whenever possible 0: Disable CRLite entirely. 1: Consult CRLite but only collect telemetry. -> 2: Consult ... | KEEP ON (AF enforces true, LW true, BF default). Needed so CRLite filters are downloaded via Remote Settings. |
| `security.OCSP.require` | `(opt) true` | `(reset to FF default)` | `false [def]` |  | yes | **BF:** set OCSP fetch failures to hard-fail When a CA cannot be reached to validate a cert, Firefox just continues the conne...<br>**AF:** [6050] prefsCleaner reset (until v140-1 it enforced true = hard-fail)<br>**LW:** Disable OCSP | BF optional hard-fail (true) with warning it breaks captive portals; LW false; AF reset (was true until v140-1). |
| `privacy.partition.network_state.ocsp_cache` |  | `(opt) true` |  |  | **NOT FOUND** | **AF:** [7016] customize ETP settings [WHY] Arkenfox only supports strict (2701) which sets these at runtime // [DEFAULT: true] |  |
| `security.certerrors.mitm.priming.enabled` | `(opt) false` |  |  |  | yes | **BF:** assorted telemetry |  |

### 3.11 Captive portal detection / connectivity checks

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `captivedetect.canonicalURL` | `(opt) ""` | `""` | `"" [P]` |  | yes | **BF:** disable Captive Portal detection [WARNING] Do NOT use for mobile devices. May NOT be able to use Firefox on public wifi (hotels, coffee shops, etc).<br>**AF:** [0360] disable Captive Portal detection<br>**LW:** disable captive portal | BF keeps (commented only) with "[WARNING] Do NOT use for mobile devices. May NOT be able to use Firefox on public wifi". AF + LW disable. |
| `network.captive-portal-service.enabled` | `(opt) false` | `false` | `false [P]` |  | yes | **BF:** disable Captive Portal detection [WARNING] Do NOT use for mobile devices. May NOT be able to use Firefox on public wifi (hotels, coffee shops, etc).<br>**AF:** [0360] disable Captive Portal detection // [FF52+]<br>**LW:** disable captive portal | BF keeps (usability on public wifi); AF + LW disable. |
| `network.connectivity-service.enabled` | `(opt) false` | `false` | `false [P]` |  | yes | **BF:** disable Network Connectivity checks [WARNING] Do NOT use for mobile devices. May NOT be able to use Firefox on public wifi (hotels, coffee shops, etc).<br>**AF:** [0361] disable Network Connectivity checks [FF65+]<br>**LW:** disable connectivity checks | BF keeps (same public-wifi warning); AF + LW disable. |
| `network.trr.wait-for-portal` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** assorted options // [DEFAULT] set this to true to tell Firefox to wait for the captive portal detection before TRR is used |  |

### 3.12 DNS-over-HTTPS / TRR / DoH rollout

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `doh-rollout.enabled` |  |  | `false [def]` |  | yes | **LW:** Disable DoH rollout |  |
| `doh-rollout.provider-list` |  |  | `'[ { "UIName": "Quad9 (No Filtering)", "uri": "https://dn...` |  | yes | **LW:** (no comment; section NETWORKING/DOH) |  |
| `network.dns.preferIPv6` |  |  | `true [def]` |  | yes | **LW:** Fix IPv6 when using DoH https://codeberg.org/divested/brace/pulls/5 |  |
| `network.trr.default_provider_uri` |  |  | `"https://doh.dns4all.eu/dns-query" [def]` |  | yes | **LW:** Additions by Acideburn in https://codeberg.org/librewolf/issues/issues/1975 // Define a fallback DoH server |  |
| `network.trr.mode` | `(opt) 0` | `(opt) 3` | `5 [def]` |  | yes | **BF:** DNS-over-HTTPS (DoH) implementation // DEFAULT<br>**AF:** [0710] enable DNS-over-HTTPS (DoH) [FF60+] 0=default, 2=increased (TRR (Trusted Recursive Resolver) first), 3=max (TRR only)...<br>**LW:** DoH is turned off. | DISAGREE: AF suggests 3 (max/TRR-only, commented); LW 5 (off) with a curated provider list; BF commented 0 (default) and its policies.json sets DNSOverHTTPS Enabled:false; Zen untouched. |
| `network.trr.uri` | `(opt) "https://xxxx/dns-query"` | `(opt) "https://example.dns"` | `"https://dns10.quad9.net/dns-query" [def]` |  | yes | **BF:** DoH resolver<br>**AF:** [0712] set DoH provider The custom uri is the value shown when you "Choose provider>Custom>"<br>**LW:** Current 'reasonable default' proposal: NON-malware-blocking quad9 endpoint. |  |
| `network.trr.useGET` |  |  | `false [def]` |  | yes | **LW:** (no comment; section NETWORKING/DOH) |  |
| `network.dns.echconfig.enabled` | `(opt) true` |  |  |  | yes | **BF:** Encrypted Client Hello (ECH) [FF118] // use ECH for TLS Connections |  |
| `network.dns.echconfig.fallback_to_origin_when_all_failed` | `(opt) false` |  |  |  | yes | **BF:** Encrypted Client Hello (ECH) [FF118] // fallback to non-ECH without an authenticated downgrade signal |  |
| `network.dns.http3_echconfig.enabled` | `(opt) true` |  |  |  | yes | **BF:** Encrypted Client Hello (ECH) [FF118] // use ECH for QUIC connections |  |
| `network.trr.allow-rfc1918` | `(opt) false` |  |  |  | yes | **BF:** DNS Rebind Protection false=do not allow RFC 1918 private addresses in TRR responses (default) true=allow RFC 1918 pr... // DEFAULT |  |
| `network.trr.bootstrapAddr` | `(opt) "10.0.0.1"` | `(opt) "10.0.0.1"` |  |  | dyn (TRR_PREF macro) | **BF:** set DoH bootstrap address [FF89+] Firefox uses the system DNS to initially resolve the IP address of your DoH server.... // [HIDDEN PREF]<br>**AF:** [5511] set DoH bootstrap address [FF89+] Firefox uses the system DNS to initially resolve the IP address of your DoH server.... // [HIDDEN PREF] |  |
| `network.trr.builtin-excluded-domains` | `(opt) "localhost,local"` |  |  |  | yes | **BF:** DOH exlcusions // DEFAULT; comma-separated list of domain names to be resolved using the native resolver instead of TRR |  |
| `network.trr.clear-cache-on-pref-change` | `(opt) true` |  |  |  | yes | **BF:** assorted options // [DEFAULT] DNS+TRR cache will be cleared when a relevant TRR pref changes |  |
| `network.trr.confirmationNS` | `(opt) "skip"` |  |  |  | yes | **BF:** assorted options // skip undesired DOH test connection |  |
| `network.trr.custom_uri` | `(opt) "https://xxxx/dns-query"` | `(opt) "https://example.dns"` |  |  | yes | **BF:** DoH resolver<br>**AF:** [0712] set DoH provider The custom uri is the value shown when you "Choose provider>Custom>" |  |
| `network.trr.disable-ECS` | `(opt) true` |  |  |  | yes | **BF:** EDNS Client Subnet (ECS) [WARNING] In some circumstances, enabling ECS may result in suboptimal routing between CDN origins and end users [2]. // DEFAULT |  |
| `network.trr.display_fallback_warning` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** display fallback warning page [FF115+] Show a warning checkbox UI in modes 0 or 2 above. // DEFAULT |  |
| `network.trr.excluded-domains` | `(opt) ""` |  |  |  | yes | **BF:** DOH exlcusions // DEFAULT; comma-separated list of domain names to be resolved using the native resolver instead of TRR. This pref can be used to make /etc/hosts works with DN... |  |
| `network.trr.max-fails` | `(opt) 5` |  |  |  | yes | **BF:** lower max attempts to use DoH If DNS requests take too long, FF will fallback to your default DNS much quicker. // default=15 |  |
| `network.trr.ohttp.config_uri` | `(opt) "https://dooh.cloudflare-dns.com/.well-known/doohco...` |  |  |  | yes | **BF:** Oblivious HTTP (OHTTP) (DoOH) [Oct 2023] Cloudflare are the only ones running an OHTTP server and resolver, but there... |  |
| `network.trr.ohttp.relay_uri` | `(opt) ""` |  |  |  | yes | **BF:** Oblivious HTTP (OHTTP) (DoOH) [Oct 2023] Cloudflare are the only ones running an OHTTP server and resolver, but there... // custom |  |
| `network.trr.ohttp.uri` | `(opt) "https://dooh.cloudflare-dns.com/dns-query"` |  |  |  | yes | **BF:** Oblivious HTTP (OHTTP) (DoOH) [Oct 2023] Cloudflare are the only ones running an OHTTP server and resolver, but there... |  |
| `network.trr.resolvers` | `(opt) '[{ "name": "Cloudflare", "url": "https://mozilla.c...` |  |  |  | **NOT FOUND** | **BF:** adjust providers |  |
| `network.trr.skip-AAAA-when-not-supported` | `(opt) true` |  |  |  | **NOT FOUND** | **BF:** assorted options // [DEFAULT] If Firefox detects that your system does not have IPv6 connectivity, it will not request IPv6 addresses from the DoH server |  |
| `network.trr.use_ohttp` | `(opt) true` |  |  |  | yes | **BF:** Oblivious HTTP (OHTTP) (DoOH) [Oct 2023] Cloudflare are the only ones running an OHTTP server and resolver, but there... |  |
| `network.trr_ui.show_fallback_warning_option` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** display fallback warning page [FF115+] Show a warning checkbox UI in modes 0 or 2 above. // DEFAULT |  |

### 3.13 Push service (autopush) / web notifications

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `permissions.default.desktop-notification` | `2` | `(opt) 0` |  |  | yes | **BF:** default permission for Web Notifications To add site exceptions: Page Info>Permissions>Receive Notifications To manag...<br>**AF:** [7002] set default permissions Location, Camera, Microphone, Notifications [FF58+] Virtual Reality [FF73+] 0=always ask (def... [WHY] These are fingerprintable via Permissions API, except VR. Just add site exceptions as allow/block for frequently visited/... | BF blocks all notification prompts (2). AF 7002 says don't bother (fingerprintable via Permissions API; use per-site exceptions). |
| `dom.push.enabled` | `(opt) false` | `(opt) false` |  |  | yes | **BF:** disable Push Notifications API [FF44+] [WHY] Website "push" requires subscription, and the API is required for CRLite. Push is an API that allows websites to send you...<br>**AF:** [7019] disable Push Notifications [FF44+] [WHY] Website "push" requires subscription, and the API is required for CRLite (1224) | KEEP ON (none disable). AF 7019 DON'T BOTHER: "Website push requires subscription, and the API is required for CRLite"; BF: same reasoning, "You shouldn't need to disable this." |
| `dom.push.userAgentID` | `(opt) ""` |  |  |  | yes | **BF:** disable Push Notifications API [FF44+] [WHY] Website "push" requires subscription, and the API is required for CRLite. Push is an API that allows websites to send you... |  |

### 3.14 Weather (URL bar + New Tab)

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.urlbar.weather.featureGate` | `(opt) false` | `false` | `false [def]` | `false` | yes | **BF:** disable urlbar suggestions // [FF108+] [DEFAULT: false]<br>**AF:** [0806] disable urlbar suggestions // [FF108+]<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR)<br>**Zen:** (firefox/urlbar.yaml § URL bar and search-related preferences) |  |
| `browser.newtabpage.activity-stream.feeds.weatherfeed` |  |  | `false [def]` |  | yes | **LW:** disable weather info fetching (ticket #2048) |  |
| `browser.newtabpage.activity-stream.system.showWeather` | `(opt) false` |  |  | `false` | yes | **BF:** Pinned Shortcuts on New Tab [SETTINGS] Home>Firefox Home Content // hides Weather as an UI option<br>**Zen:** (firefox/newtab.yaml) |  |
| `browser.newtabpage.activity-stream.widgets.system.weather.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.activity-stream.widgets.system.weatherForecast.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.activity-stream.widgets.weather.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.newtabpage.activity-stream.widgets.weatherForecast.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.urlbar.suggest.weather` | `(opt) true` |  | `false [def]` |  | yes | **BF:** minimize URL bar suggestions (bookmarks, history, open tabs) Dropdown options in the URL bar: // DEFAULT [FF108]<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.newtabpage.activity-stream.showWeather` | `(opt) false` |  |  |  | yes | **BF:** Pinned Shortcuts on New Tab [SETTINGS] Home>Firefox Home Content // Weather [FF130+] |  |
| `browser.urlbar.weather.ignoreVPN` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** minimize URL bar suggestions (bookmarks, history, open tabs) Dropdown options in the URL bar: // DEFAULT |  |

### 3.15 Firefox Suggest / sponsored & online URL-bar suggestions

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.urlbar.quicksuggest.enabled` | `false` | `false` | `false [P]` | `false [L]` | yes | **BF:** disable Firefox Suggest // controls whether the UI is shown<br>**AF:** [0802] disable location bar contextual suggestions // [FF92+]<br>**LW:** the pref disables the whole feature and hide it from the ui (as noted in https://bugzilla.mozilla.org/show_bug.cgi?id...<br>**Zen:** (firefox/urlbar.yaml § URL bar and search-related preferences) |  |
| `browser.urlbar.suggest.quicksuggest.nonsponsored` | `(opt) false` | `false` | `false [def]` | `false [L]` | yes | **BF:** disable Firefox Suggest // [FF95+]<br>**AF:** [0802] disable location bar contextual suggestions // [FF95+]<br>**LW:** Support but disable by default and show full settings UI<br>**Zen:** (firefox/urlbar.yaml § URL bar and search-related preferences) |  |
| `browser.urlbar.suggest.quicksuggest.sponsored` | `(opt) false` | `false` | `false [def]` | `false [L]` | yes | **BF:** disable Firefox Suggest // [FF92+]<br>**AF:** [0802] disable location bar contextual suggestions // [FF92+]<br>**LW:** Support but disable by default and show full settings UI<br>**Zen:** (firefox/urlbar.yaml § URL bar and search-related preferences) |  |
| `browser.urlbar.addons.featureGate` | `(opt) false` | `false` | `false [def]` |  | yes | **BF:** disable urlbar suggestions // [FF115+]<br>**AF:** [0806] disable urlbar suggestions // [FF115+]<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.groupLabels.enabled` | `false` |  |  | `false` | yes | **BF:** disable Firefox Suggest<br>**Zen:** (firefox/urlbar.yaml § URL bar and search-related preferences) |  |
| `browser.urlbar.importantDates.featureGate` |  | `false` | `false [def]` |  | yes | **AF:** [0806] disable urlbar suggestions // [FF143+]<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.market.featureGate` |  | `false` | `false [def]` |  | yes | **AF:** [0806] disable urlbar suggestions // [FF143+] stock market<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.mdn.featureGate` | `(opt) false` | `false` | `false [def]` |  | yes | **BF:** disable urlbar suggestions // [FF117+] [HIDDEN PREF]<br>**AF:** [0806] disable urlbar suggestions // [FF117+]<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.yelp.featureGate` | `(opt) false` | `false` | `false [def]` |  | yes | **BF:** disable urlbar suggestions // [FF124+] [DEFAULT: false]<br>**AF:** [0806] disable urlbar suggestions // [FF124+]<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.yelpRealtime.featureGate` |  | `false` | `false [def]` |  | yes | **AF:** [0806] disable urlbar suggestions // [FF144+]<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.amp.featureGate` | `(opt) false` | `false` |  |  | yes | **BF:** disable urlbar suggestions // [FF141+] adMarketplace<br>**AF:** [0806] disable urlbar suggestions // [FF141+] adMarketplace |  |
| `browser.urlbar.clipboard.featureGate` | `(opt) false` | `(opt) false` |  | `true` | yes | **BF:** disable urlbar suggestions // [FF118+] [DEFAULT: true FF125+]<br>**AF:** [0807] disable urlbar clipboard suggestions [FF118+]<br>**Zen:** (firefox/urlbar.yaml § URL bar and search-related preferences) |  |
| `browser.urlbar.quicksuggest.mlEnabled` |  |  | `false [def]` |  | yes | **LW:** Support but disable by default and show full settings UI |  |
| `browser.urlbar.quicksuggest.online.available` |  |  | `true [def]` |  | yes | **LW:** Support but disable by default and show full settings UI |  |
| `browser.urlbar.quicksuggest.online.enabled` |  |  | `false [def]` |  | yes | **LW:** Support but disable by default and show full settings UI |  |
| `browser.urlbar.quicksuggest.settingsUi` |  |  | `0 [def]` |  | yes | **LW:** https://searchfox.org/firefox-main/rev/0304f5a3e392699f440f0e15f9ea0bc2790309c6/browser/components/urlbar/QuickSuggest.sys.mjs#18-27 |  |
| `browser.urlbar.sponsoredTopSites` |  |  | `false [def]` |  | yes | **LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.suggest.addons` |  |  | `false [def]` |  | yes | **LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.suggest.amp` |  |  | `false [def]` |  | yes | **LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.suggest.importantDates` |  |  | `false [def]` |  | yes | **LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.suggest.mdn` |  |  | `false [def]` |  | yes | **LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.suggest.quicksuggest.all` |  |  | `false [def]` |  | yes | **LW:** Support but disable by default and show full settings UI |  |
| `browser.urlbar.suggest.realtimeOptIn` |  |  | `false [def]` |  | yes | **LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.suggest.sports` |  |  | `false [def]` |  | yes | **LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.suggest.wikipedia` |  |  | `false [def]` |  | yes | **LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.suggest.yelp` |  |  | `false [def]` |  | yes | **LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.wikipedia.featureGate` | `(opt) false` | `false` |  |  | yes | **BF:** disable urlbar suggestions // [FF141+]<br>**AF:** [0806] disable urlbar suggestions // [FF141+] |  |
| `browser.urlbar.yelp.mlEnabled` |  |  | `false [def]` |  | yes | **LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.fakespot.featureGate` | `(opt) false` | `(reset to FF default)` |  |  | yes | **BF:** disable urlbar suggestions // [FF130+] [DEFAULT: false]<br>**AF:** [6050] prefsCleaner: reset previously active items removed from arkenfox FF140+ |  |
| `browser.urlbar.recentsearches.featureGate` | `(opt) false` | `(opt) false` |  |  | yes | **BF:** disable recent searches [FF120+]<br>**AF:** [0808] disable recent searches [FF120+] |  |

### 3.16 Search suggestions / trending / search-engine config updates

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.search.suggest.enabled` | `false` | `false` | `false [def]` | `false` | yes | **BF:** disable live search suggestions (Google, Bing, etc.) [WARNING] Search engines keylog every character you type from the URL bar. Override these if you trust and use a privacy respec...<br>**AF:** [0803] disable live search suggestions<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR)<br>**Zen:** (firefox/urlbar.yaml § URL bar and search-related preferences) |  |
| `browser.urlbar.trending.featureGate` | `false` | `false` | `false [def]` | `false` | yes | **BF:** disable urlbar trending search suggestions [FF118+]<br>**AF:** [0805] disable urlbar trending search suggestions [FF118+]<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR)<br>**Zen:** (firefox/urlbar.yaml § URL bar and search-related preferences) |  |
| `browser.search.update` | `false` |  | `false [def]` |  | yes | **BF:** disable search engine updates (e.g. OpenSearch) Prevent Firefox from adding back search engines after you removed them.<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.suggest.searches` | `(opt) false` | `false` | `false [def]` |  | yes | **BF:** minimize URL bar suggestions (bookmarks, history, open tabs) Dropdown options in the URL bar:<br>**AF:** [0803] disable live search suggestions<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.suggest.topsites` | `(opt) false` | `(opt) false` | `true [def]` | `true [L]` | yes | **BF:** disable dropdown suggestions with empty query<br>**AF:** [5010] disable location bar suggestion types // [FF78+]<br>**LW:** Enables local shortcuts<br>**Zen:** (firefox/urlbar.yaml § URL bar and search-related preferences) |  |
| `browser.search.suggest.enabled.private` | `(opt) false` |  |  | `false` | yes | **BF:** disable live search suggestions (Google, Bing, etc.) [WARNING] Search engines keylog every character you type from the URL bar. Override these if you trust and use a privacy respec... // DEFAULT<br>**Zen:** (firefox/urlbar.yaml § URL bar and search-related preferences) |  |
| `browser.urlbar.showSearchTerms.enabled` | `(opt) false` | `false` |  |  | yes | **BF:** do not show search terms in URL bar [FF110+] Show search query instead of URL on search results pages.<br>**AF:** [9004] disable search terms [FF110+] |  |
| `browser.urlbar.suggest.engines` | `false (Peskyfox.js only)` | `(opt) false` |  |  | yes | **BF:** minimize URL bar suggestions (bookmarks, history, open tabs) Dropdown options in the URL bar:<br>**AF:** [0815] disable tab-to-search [FF85+] Alternatively, you can exclude on a per-engine basis by unchecking them in Options>Search |  |
| `browser.urlbar.suggest.trending` | `(opt) false` |  | `false [def]` |  | yes | **BF:** disable urlbar trending search suggestions [FF118+]<br>**LW:** (no comment; section BEHAVIOR/SEARCH AND URLBAR) |  |
| `browser.urlbar.showSearchTerms.featureGate` | `(opt) false` |  |  |  | yes | **BF:** do not show search terms in URL bar [FF110+] Show search query instead of URL on search results pages. // DEFAULT |  |
| `browser.urlbar.suggest.recentsearches` | `(opt) false` |  |  |  | yes | **BF:** disable Show recent searches |  |

### 3.17 Sponsored top sites / New Tab content / Pocket / widgets / wallpapers

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons` | `false` | `false` |  | `false` | yes | **BF:** disable Extension Recommendations (CFR: "Contextual Feature Recommender")<br>**AF:** [9002] disable General>Browsing>Recommend extensions/features as you browse [FF67+]<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features` | `false` | `false` |  | `false` | yes | **BF:** disable Extension Recommendations (CFR: "Contextual Feature Recommender")<br>**AF:** [9002] disable General>Browsing>Recommend extensions/features as you browse [FF67+]<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `browser.newtabpage.activity-stream.default.sites` | `""` | `""` | `"" [L]` |  | yes | **BF:** clear default topsites<br>**AF:** [0106] clear default topsites<br>**LW:** disable telemetry in Firefox Home |  |
| `browser.newtabpage.activity-stream.showSponsoredCheckboxes` | `false` | `false` |  | `false` | yes | **BF:** Pinned Shortcuts on New Tab [SETTINGS] Home>Firefox Home Content // [FF140+] Support Firefox<br>**AF:** [0105] disable sponsored content on Firefox Home (Activity Stream) // [FF140+] Support Firefox<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `browser.newtabpage.activity-stream.feeds.section.topstories` | `false` |  |  | `false` | yes | **BF:** Pinned Shortcuts on New Tab [SETTINGS] Home>Firefox Home Content // Recommended by Pocket<br>**Zen:** (firefox/newtab.yaml) |  |
| `browser.newtabpage.activity-stream.feeds.topsites` | `(opt) false` |  | `false [def]` | `false` | yes | **BF:** Pinned Shortcuts on New Tab [SETTINGS] Home>Firefox Home Content // Shortcuts<br>**LW:** Disable the top site feed<br>**Zen:** (firefox/newtab.yaml) |  |
| `browser.newtabpage.activity-stream.showSponsored` | `false` | `false` |  |  | yes | **BF:** Pinned Shortcuts on New Tab [SETTINGS] Home>Firefox Home Content // Sponsored stories [FF58+]<br>**AF:** [0105] disable sponsored content on Firefox Home (Activity Stream) // [FF58+] Sponsored stories |  |
| `browser.newtabpage.activity-stream.showSponsoredTopSites` | `false` | `false` |  |  | yes | **BF:** Pinned Shortcuts on New Tab [SETTINGS] Home>Firefox Home Content // Sponsored shortcuts [FF83+]<br>**AF:** [0105] disable sponsored content on Firefox Home (Activity Stream) // [FF83+] Sponsored shortcuts |  |
| `browser.startup.page` | `(opt) 3` | `0` |  | `3` | yes | **BF:** startup / new tab page 0=blank, 1=home, 2=last visited page, 3=resume previous session<br>**AF:** [0102] set startup page<br>**Zen:** (firefox/browser.yaml) |  |
| `browser.topsites.contile.enabled` |  |  | `false [def]` | `false` | yes | **LW:** ...about:preferences#home<br>**Zen:** (firefox/newtab.yaml) |  |
| `browser.newtabpage.activity-stream.asrouter.providers.cfr` |  |  | `"null" [L]` |  | yes | **LW:** https://searchfox.org/firefox-main/rev/202150dcdade5798ca858b843b51b20112b4d061/toolkit/components/backgroundtasks/de... |  |
| `browser.newtabpage.activity-stream.asrouter.providers.message-groups` |  |  | `"null" [L]` |  | yes | **LW:** https://searchfox.org/firefox-main/rev/202150dcdade5798ca858b843b51b20112b4d061/toolkit/components/backgroundtasks/de... |  |
| `browser.newtabpage.activity-stream.asrouter.providers.messaging-experiments` |  |  | `"null" [L]` |  | yes | **LW:** https://searchfox.org/firefox-main/rev/202150dcdade5798ca858b843b51b20112b4d061/toolkit/components/backgroundtasks/de... |  |
| `browser.newtabpage.activity-stream.asrouter.providers.onboarding` |  |  | `"null" [L]` |  | yes | **LW:** https://searchfox.org/firefox-main/rev/202150dcdade5798ca858b843b51b20112b4d061/toolkit/components/backgroundtasks/de... |  |
| `browser.newtabpage.activity-stream.discoverystream.attribution.enabled` |  |  | `false [def]` |  | yes | **LW:** Disable attribution |  |
| `browser.newtabpage.activity-stream.discoverystream.carousel.enabled` |  |  | `false [def]` |  | yes | **LW:** Disable story carousel |  |
| `browser.newtabpage.activity-stream.discoverystream.reportAds.enabled` |  |  | `false [L]` |  | yes | **LW:** (no comment; section UI/NEW TAB PAGE) |  |
| `browser.newtabpage.activity-stream.discoverystream.sections.adAllowedRanks` |  |  | `"" [L]` |  | yes | **LW:** (no comment; section UI/NEW TAB PAGE) |  |
| `browser.newtabpage.activity-stream.discoverystream.sections.contextualAds.enabled` |  |  | `false [L]` |  | yes | **LW:** (no comment; section UI/NEW TAB PAGE) |  |
| `browser.newtabpage.activity-stream.discoverystream.sections.contextualAds.locale-config` |  |  | `"" [L]` |  | yes | **LW:** Set ad region/locale to empty values |  |
| `browser.newtabpage.activity-stream.discoverystream.sections.contextualAds.region-config` |  |  | `"" [L]` |  | yes | **LW:** Set ad region/locale to empty values |  |
| `browser.newtabpage.activity-stream.discoverystream.shortcuts.personalization.enabled` |  |  | `false [def]` |  | yes | **LW:** Disable smart shortcuts |  |
| `browser.newtabpage.activity-stream.feeds.adsfeed` |  |  | `false [L]` |  | dyn (feeds.${name}) | **LW:** (no comment; section UI/NEW TAB PAGE) |  |
| `browser.newtabpage.activity-stream.newtabWallpapers.enabled` | `(opt) false` |  |  | `true` | yes | **BF:** wallpapers on New Tab [FF128+ NIGHTLY] // Wallpapers<br>**Zen:** (firefox/newtab.yaml) |  |
| `browser.newtabpage.activity-stream.newtabWallpapers.v2.enabled` | `(opt) true` |  |  | `true` | **NOT FOUND** | **BF:** new tab page wallpapers // [DEFAULT FF132+]<br>**Zen:** (firefox/newtab.yaml) |  |
| `browser.newtabpage.activity-stream.showWebNotifications` |  |  | `false [def]` |  | yes | **LW:** Disable web notifications on newtabpage https://bugzilla.mozilla.org/show_bug.cgi?id=2054389 feeds.webnotificationsfe... |  |
| `browser.newtabpage.activity-stream.unifiedAds.adsFeed.enabled` |  |  | `false [L]` |  | yes | **LW:** Disable Mozilla Ad Routing Service (MARS) unified ads service https://searchfox.org/firefox-main/rev/202150dcdade5798... |  |
| `browser.newtabpage.activity-stream.unifiedAds.endpoint` |  |  | `"" [L]` |  | yes | **LW:** Disable Mozilla Ad Routing Service (MARS) unified ads service https://searchfox.org/firefox-main/rev/202150dcdade5798... |  |
| `browser.newtabpage.activity-stream.unifiedAds.ohttp.enabled` |  |  | `true [L]` |  | yes | **LW:** Disable Mozilla Ad Routing Service (MARS) unified ads service https://searchfox.org/fir... // Might as well keep it as ohttp enabled |  |
| `browser.newtabpage.activity-stream.unifiedAds.spocs.enabled` |  |  | `false [L]` |  | yes | **LW:** Disable Mozilla Ad Routing Service (MARS) unified ads service https://searchfox.org/firefox-main/rev/202150dcdade5798... |  |
| `browser.newtabpage.activity-stream.unifiedAds.tiles.enabled` |  |  | `false [L]` |  | yes | **LW:** Disable Mozilla Ad Routing Service (MARS) unified ads service https://searchfox.org/firefox-main/rev/202150dcdade5798... |  |
| `browser.newtabpage.activity-stream.widgets.clocks.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.newtabpage.activity-stream.widgets.crossword.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.newtabpage.activity-stream.widgets.enabled` |  |  | `false [def]` |  | yes | **LW:** Main user toggle |  |
| `browser.newtabpage.activity-stream.widgets.feedback.enabled` |  |  | `false [def]` |  | yes | **LW:** Disable feedback |  |
| `browser.newtabpage.activity-stream.widgets.focusTimer.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.newtabpage.activity-stream.widgets.lists.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.newtabpage.activity-stream.widgets.pictureOfTheDay.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.newtabpage.activity-stream.widgets.privacy.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.newtabpage.activity-stream.widgets.privacy.showVpnMessages` |  |  | `false [def]` |  | yes | **LW:** Disable VPN promos |  |
| `browser.newtabpage.activity-stream.widgets.recentSearches.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.newtabpage.activity-stream.widgets.sportsWidget.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.newtabpage.activity-stream.widgets.stocks.enabled` |  |  | `false [def]` |  | yes | **LW:** Set the individual widgets to be disabled by default |  |
| `browser.newtabpage.activity-stream.widgets.system.clocks.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.activity-stream.widgets.system.crossword.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.activity-stream.widgets.system.enabled` |  |  | `true [def]` |  | yes | **LW:** Main system toggle |  |
| `browser.newtabpage.activity-stream.widgets.system.focusTimer.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.activity-stream.widgets.system.lists.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.activity-stream.widgets.system.pictureOfTheDay.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.activity-stream.widgets.system.privacy.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.activity-stream.widgets.system.recentSearches.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.activity-stream.widgets.system.sportsWidget.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.activity-stream.widgets.system.stocks.enabled` |  |  | `true [def]` |  | yes | **LW:** Allow the widgets to be available |  |
| `browser.newtabpage.enabled` | `(opt) false` | `false` |  |  | yes | **BF:** set NEWTAB page to blank tab true=Firefox Home, false=blank page<br>**AF:** [0104] set NEWTAB page true=Firefox Home (default, see 0105), false=blank page |  |
| `browser.startup.homepage` | `(opt) "about:blank"` | `"chrome://browser/content/blanktab.html"` |  |  | yes | **BF:** set HOME+NEW WINDOW page to blank tab about:home=Activity Stream, custom URL, about:blank [Custom URLs] Set two or mo...<br>**AF:** [0103] set HOME+NEWWINDOW page about:home=Firefox Home (default, see 0105), custom URLs..., Blank Page |  |
| `librewolf.externalWallpapers.enabled` |  |  | `false [def]` |  | n/a (fork) | **LW:** Toggle for enabling/disabling fetching of the CDN wallpapers |  |
| `browser.newtab.preload` | `(opt) true` |  |  |  | yes | **BF:** new tab preload [WARNING] Disabling this may cause a delay when opening a new tab in Firefox. // DEFAULT |  |
| `browser.newtabpage.activity-stream.asrouter.devtoolsEnabled` | `(opt) true` |  |  |  | yes | **BF:** enable ASRouter Devtools at about:newtab#devtools This is useful if you're making your own CSS theme. |  |
| `browser.newtabpage.activity-stream.discoverystream.enabled` | `(opt) false` |  |  |  | yes | **BF:** Pinned Shortcuts on New Tab [SETTINGS] Home>Firefox Home Content |  |
| `browser.newtabpage.activity-stream.feeds.snippets` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** Pinned Shortcuts on New Tab [SETTINGS] Home>Firefox Home Content // [DEFAULT] |  |
| `extensions.pocket.api` | `(opt) " "` |  |  |  | **NOT FOUND** | **BF:** disable built-in Pocket extension |  |
| `extensions.pocket.enabled` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** disable built-in Pocket extension // DEFAULT |  |
| `extensions.pocket.oAuthConsumerKey` | `(opt) " "` |  |  |  | **NOT FOUND** | **BF:** disable built-in Pocket extension |  |
| `extensions.pocket.showHome` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** disable built-in Pocket extension |  |
| `extensions.pocket.site` | `(opt) " "` |  |  |  | **NOT FOUND** | **BF:** disable built-in Pocket extension |  |

### 3.18 Messaging system (ASRouter/CFR), onboarding, What's New, UITour

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.uitour.enabled` | `false` | `false` | `false [L]` | `false` | yes | **BF:** disable UITour backend This way, there is no chance that a remote page can use it.<br>**AF:** [2606] disable UITour backend so there is no chance that a remote page can use it<br>**LW:** FIRST LAUNCH disable what's new, ui tour, and privacy notice/terms of use on first start and updates. the browser sho...<br>**Zen:** (privatefox/privacy.yaml § Privacy and Misc) |  |
| `browser.startup.homepage_override.mstone` | `"ignore"` | `"ignore"` | `"ignore" [def]` |  | yes | **BF:** disable welcome notices<br>**AF:** [9001] disable welcome notices // [HIDDEN PREF]<br>**LW:** FIRST LAUNCH disable what's new, ui tour, and privacy notice/terms of use on first start and updates. the browser sho... |  |
| `browser.aboutwelcome.enabled` | `false` |  |  | `false` | yes | **BF:** disable welcome notices // disable Intro screens<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `browser.preonboarding.enabled` |  |  |  | `false` | yes | **Zen:** (firefox/browser.yaml § Only enabled for windows, doesn't really fit inside Zen.) |  |
| `browser.uitour.url` | `(opt) ""` | `(opt) ""` | `"" [L]` |  | yes | **BF:** disable UITour backend This way, there is no chance that a remote page can use it.<br>**AF:** [2606] disable UITour backend so there is no chance that a remote page can use it // Defense-in-depth<br>**LW:** FIRST LAUNCH disable what's new, ui tour, and privacy notice/terms of use on first start and updates. the browser sho... |  |
| `startup.homepage_welcome_url` | `(opt) ""` |  | `"about:blank" [def]` |  | yes | **BF:** disable welcome notices<br>**LW:** FIRST LAUNCH disable what's new, ui tour, and privacy notice/terms of use on first start and updates. the browser sho... |  |
| `startup.homepage_welcome_url.additional` | `(opt) ""` |  | `"" [def]` |  | yes | **BF:** disable welcome notices<br>**LW:** FIRST LAUNCH disable what's new, ui tour, and privacy notice/terms of use on first start and updates. the browser sho... |  |
| `browser.firefox-view.feature-tour` | `(opt) "{\"screen\":\"\",\"complete\":true}"` |  |  |  | yes | **BF:** disable the Firefox View tour from popping up |  |
| `browser.messaging-system.whatsNewPanel.enabled` | `(opt) false` |  |  |  | **NOT FOUND** | **BF:** disable "What's New" toolbar icon [FF69+] |  |
| `messaging-system.askForFeedback` | `(opt) true` |  |  |  | yes | **BF:** assorted telemetry // DEFAULT [FF120+] |  |
| `startup.homepage_override_url` | `(opt) ""` |  |  |  | yes | **BF:** disable welcome notices // What's New page after updates |  |

### 3.19 Promos: VPN / Relay / Monitor / mobile / More-from-Mozilla / Sync promos

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.contentblocking.report.hide_vpn_banner` |  |  | `true [L]` | `true [L]` | yes | **LW:** ABOUT remove annoying ui elements from the about pages, including about:protections<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `browser.contentblocking.report.show_mobile_app` |  |  | `false [L]` | `false [L]` | yes | **LW:** ABOUT remove annoying ui elements from the about pages, including about:protections<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `browser.preferences.moreFromMozilla` | `false` |  |  | `false [L]` | yes | **BF:** hide "More from Mozilla" in Settings<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `browser.vpn_promo.enabled` |  |  | `false [def]` | `false` | yes | **LW:** Disable promos<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `browser.contentblocking.report.lockwise.enabled` | `(opt) false` |  | `false [def]` |  | yes | **BF:** disable Firefox Lockwise (about:logins)<br>**LW:** ABOUT remove annoying ui elements from the about pages, including about:protections |  |
| `browser.privatebrowsing.vpnpromourl` |  |  |  | `"" [L]` | **NOT FOUND** | **Zen:** (privatefox/disablemozilla.yaml) |  |
| `browser.promo.pin.enabled` |  |  | `false [def]` |  | yes | **LW:** Disable promos |  |
| `browser.promo.relay.enabled` |  |  | `false [def]` |  | yes | **LW:** Disable promos |  |
| `browser.promo.syncPromo.bookmarks.connectdevice.dismissed` |  |  | `true [def]` |  | dyn (syncPromo.${type}) | **LW:** Disable Sync promos |  |
| `browser.promo.syncPromo.bookmarks.signin.dismissed` |  |  | `true [def]` |  | dyn (syncPromo.${type}) | **LW:** Disable Sync promos |  |
| `browser.promo.syncPromo.bookmarks.turnonsync.dismissed` |  |  | `true [def]` |  | dyn (syncPromo.${type}) | **LW:** Disable Sync promos |  |
| `browser.promo.syncPromo.history.connectdevice.dismissed` |  |  | `true [def]` |  | dyn (syncPromo.${type}) | **LW:** Disable Sync promos |  |
| `browser.promo.syncPromo.history.signin.dismissed` |  |  | `true [def]` |  | dyn (syncPromo.${type}) | **LW:** Disable Sync promos |  |
| `browser.promo.syncPromo.history.turnonsync.dismissed` |  |  | `true [def]` |  | dyn (syncPromo.${type}) | **LW:** Disable Sync promos |  |
| `browser.urlbar.trustPanel.breachAlerts` |  |  | `false [def]` |  | yes | **LW:** Disable breach alerts for the time being |  |
| `identity.fxaccounts.toolbar.pxiToolbarEnabled` |  |  | `false [L]` |  | yes | **LW:** hide pxi ads on toolbar firefox sync button |  |
| `sidebar.verticalTabs.dragToPinPromo.dismissed` |  |  |  | `true [L]` | yes | **Zen:** (privatefox/disablemozilla.yaml) |  |
| `browser.contentblocking.report.lockwise.how_it_works.url` | `(opt) ""` |  |  |  | yes | **BF:** disable Firefox Lockwise (about:logins) |  |
| `signon.firefoxRelay.feature` | `(opt) ""` |  |  |  | yes | **BF:** disable Firefox Relay Privacy & Security > Passwords > Suggest Firefox Relay email masks to protect your email address |  |
| `signon.management.page.breach-alerts.enabled` | `(opt) false` |  |  |  | yes | **BF:** disable Firefox Lockwise (about:logins) |  |
| `signon.management.page.breachAlertUrl` | `(opt) ""` |  |  |  | yes | **BF:** disable Firefox Lockwise (about:logins) |  |

### 3.20 Geolocation

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `geo.provider.ms-windows-location` | `(opt) false` | `false` | `false [def]` |  | yes | **BF:** disable using the OS's geolocation service // [WINDOWS]<br>**AF:** [0202] disable using the OS's geolocation service // [WINDOWS]<br>**LW:** LOCATION replace google with beacondb as the default geolocation provide and prevent us... // [WINDOWS] |  |
| `geo.provider.network.url` | `"https://beacondb.net/v1/geolocate"` |  | `"https://api.beacondb.net/v1/geolocate" [def]` |  | yes | **BF:** use alternative geolocation service instead of Google<br>**LW:** LOCATION replace google with beacondb as the default geolocation provide and prevent use of OS location services | DISAGREE on URL: LW uses BeaconDB's documented `https://api.beacondb.net/v1/geolocate` (verified on beacondb.net); BF uses `https://beacondb.net/v1/geolocate`. |
| `geo.provider.use_corelocation` | `(opt) false` | `false` | `false [def]` |  | yes | **BF:** disable using the OS's geolocation service // [MAC]<br>**AF:** [0202] disable using the OS's geolocation service // [MAC]<br>**LW:** LOCATION replace google with beacondb as the default geolocation provide and prevent us... // [MAC] |  |
| `geo.provider.use_geoclue` | `(opt) false` | `false` | `false [def]` |  | yes | **BF:** disable using the OS's geolocation service // [FF102+] [LINUX]<br>**AF:** [0202] disable using the OS's geolocation service // [FF102+] [LINUX]<br>**LW:** LOCATION replace google with beacondb as the default geolocation provide and prevent us... // [LINUX] |  |
| `permissions.default.geo` | `2` | `(opt) 0` |  |  | yes | **BF:** default permission for Location Requests 0=always ask (default), 1=allow, 2=block<br>**AF:** [7002] set default permissions Location, Camera, Microphone, Notifications [FF58+] Virtual Reality [FF73+] 0=always ask (def... [WHY] These are fingerprintable via Permissions API, except VR. Just add site exceptions as allow/block for frequently visited/... | BF blocks (2). AF 7002 says don't bother (fingerprintable). |
| `geo.enabled` |  | `(opt) false` |  |  | yes | **AF:** [7001] disable APIs Location-Aware Browsing, Full Screen [WHY] The API state is easily fingerprintable. Geo is behind a prompt (7002). Full screen requires user interaction |  |
| `geo.provider.network.logging.enabled` | `(opt) true` |  |  |  | **NOT FOUND** | **BF:** logging geolocation to the console |  |

### 3.21 Region detection

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.region.network.url` | `(opt) ""` |  | `"" [P]` |  | yes | **BF:** disable region updates<br>**LW:** disable region specific updates from mozilla |  |
| `browser.region.update.enabled` | `(opt) false` |  | `false [P]` |  | yes | **BF:** disable region updates<br>**LW:** disable region specific updates from mozilla | Only LW disables; BF commented; AF not listed. |

### 3.22 Language packs / dictionaries downloads

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `intl.multilingual.downloadEnabled` |  |  | `false [def]` | `false` | yes | **LW:** Ensure we never try to download language packs / (Our builds are multi-locale, so we do not need/support them)<br>**Zen:** (firefox/multilingual.yaml) |  |
| `app.update.langpack.enabled` |  |  | `false [def]` |  | yes | **LW:** Ensure we never try to download language packs / (Our builds are multi-locale, so we do not need/support them) |  |
| `extensions.getAddons.langpacks.url` |  |  | `"" [def]` |  | yes | **LW:** Ensure we never try to download language packs / (Our builds are multi-locale, so we do not need/support them) |  |

### 3.23 Add-ons: recommendations / discovery / AMO metadata / updates / blocklist / reporters

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.discovery.enabled` | `false` | `false` | `false [L]` | `false` | yes | **BF:** Personalized Extension Recommendations in about:addons and AMO<br>**AF:** [0322] disable personalized Extension Recommendations in about:addons and AMO [FF65+]<br>**LW:** disable personalized extension recommendations<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `extensions.getAddons.showPane` | `false` | `false` | `false [def]` | `false` | yes | **BF:** disable about:addons' Recommendations pane (uses Google Analytics) // HIDDEN<br>**AF:** [0320] disable recommendation pane in about:addons (uses Google Analytics) // [HIDDEN PREF]<br>**LW:** ...about:addons recommendations sections and more<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `extensions.htmlaboutaddons.recommendations.enabled` | `false` | `false` | `false [def]` | `false` | yes | **BF:** disable recommendations in about:addons' Extensions and Themes panes<br>**AF:** [0321] disable recommendations in about:addons' Extensions and Themes panes [FF68+]<br>**LW:** ...about:addons recommendations sections and more<br>**Zen:** (privatefox/disablemozilla.yaml) |  |
| `extensions.getAddons.cache.enabled` | `false` |  |  | `false` | yes | **BF:** disable metadata caching for installed add-ons by default<br>**Zen:** Privacy and Misc (privatefox/privacy.yaml) | BF + Zen disable AMO metadata refresh; AF/LW do not. |
| `extensions.webcompat-reporter.enabled` |  | `false` | `false [L]` |  | yes | **AF:** [6011] enforce disabling of Web Compatibility Reporter [FF56+] Web Compatibility Reporter adds a "Report Site Issue" button ... [WHY] To prevent wasting Mozilla's time with a custom setup // [DEFAULT: false]<br>**LW:** SYSTEM The reporter extension of webcompat is disabled, urls are stripped for defense in depth. | AF enforces off: "To prevent wasting Mozilla's time with a custom setup". LW locks off. |
| `extensions.blocklist.enabled` | `(opt) true` | `true` |  |  | yes | **BF:** enforce Firefox blocklist for extensions + no hiding tabs This includes updates for "revoked certificates". // DEFAULT<br>**AF:** [6001] enforce Firefox blocklist [WHY] It includes updates for "revoked certificates" // [DEFAULT: true] | KEEP ON. AF 6001 DON'T TOUCH: "[WHY] It includes updates for 'revoked certificates'". BF (commented) "enforce Firefox blocklist... includes updates for revoked certificates". LW keeps `blocklists/*` Remote Settings collections allowed. |
| `extensions.quarantinedDomains.enabled` | `(opt) true` | `true` |  |  | yes | **BF:** disable Quarantined Domains [FF115+] Users may see a notification when running add-ons that are not monitored by Mozi... // [DEFAULT: true]<br>**AF:** [6012] enforce Quarantined Domains [FF115+] [WHY] https://support.mozilla.org/kb/quarantined-domains // [DEFAULT: true] | AF enforces ON (6012) for security. |
| `extensions.ui.mlmodel.hidden` |  |  | `true [def]` |  | dyn (extensions.ui.${type}.hidden) | **LW:** some leftover menu still appears otherwise: |  |
| `extensions.webcompat-reporter.newIssueEndpoint` |  |  | `"" [L]` |  | yes | **LW:** SYSTEM The reporter extension of webcompat is disabled, urls are stripped for defense in depth. |  |
| `librewolf.uBO.assetsBootstrapLocation` |  |  | `"https://librewolf.dev/librewolf/source/raw/branch/main/a...` |  | n/a (fork) | **LW:** LIBREWOLF prefs introduced by librewolf-specific patches |  |
| `xpinstall.signatures.required` | `(opt) false` |  |  | `true` | yes | **BF:** do not require signing for extensions [ESR/DEV/NIGHTLY ONLY]<br>**Zen:** (firefox/extensions.yaml) | Zen keeps signature requirement on (yet builds with MOZ_REQUIRE_SIGNING= so it can be turned off). |
| `extensions.abuseReport.enabled` | `(opt) false` |  |  |  | yes | **BF:** "report extensions for abuse" |  |
| `extensions.systemAddon.update.enabled` |  | `(opt) false` |  |  | yes | **AF:** [7014] disable System Add-on updates [WHY] It can compromise security. System addons ship with prefs, use those // [FF62+] | AF keeps (7014 DON'T BOTHER): "[WHY] It can compromise security. System addons ship with prefs, use those". |
| `extensions.systemAddon.update.url` |  | `(opt) ""` |  |  | yes | **AF:** [7014] disable System Add-on updates [WHY] It can compromise security. System addons ship with prefs, use those // [FF44+] |  |
| `extensions.update.enabled` | `(opt) false` |  |  |  | yes | **BF:** disable automatic extension updates | Nobody disables add-on updates by default (BF only as a commented option). |

### 3.24 App updates / update service / background update

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `app.update.checkInstallTime.days` |  |  | `7 [def]` | `6 (if defined(MOZILLA_OFFICIAL))` | yes | **LW:** (no comment; section BUILT-IN FEATURES/UPDATER)<br>**Zen:** (firefox/browser.yaml) |  |
| `app.releaseNotesURL` |  |  | `"https://librewolf.dev/librewolf/bsys6/releases/tag/%VERS...` |  | yes | **LW:** (no comment; section BUILT-IN FEATURES/UPDATER) |  |
| `app.releaseNotesURL.aboutDialog` |  |  | `"https://librewolf.dev/librewolf/bsys6/releases/tag/%VERS...` |  | yes | **LW:** (no comment; section BUILT-IN FEATURES/UPDATER) |  |
| `app.releaseNotesURL.prompt` |  |  | `"https://librewolf.dev/librewolf/bsys6/releases/tag/%VERS...` |  | yes | **LW:** (no comment; section BUILT-IN FEATURES/UPDATER) |  |
| `app.update.badgeWaitTime` |  |  | `0 [def]` |  | yes | **LW:** (no comment; section BUILT-IN FEATURES/UPDATER) |  |
| `app.update.interval` |  |  | `14400 [def]` |  | yes | **LW:** UPDATER |  |
| `app.update.promptWaitTime` |  |  | `0 [def]` |  | yes | **LW:** UPDATER |  |
| `app.update.service.enabled` |  |  | `false [L]` |  | yes | **LW:** UPDATES disable windows specific update services. |  |
| `app.update.url.details` |  |  | `"https://librewolf.dev/librewolf/bsys6/releases" [def]` |  | yes | **LW:** (no comment; section BUILT-IN FEATURES/UPDATER) |  |
| `app.update.url.manual` |  |  | `"https://librewolf.net/installation/" [def]` |  | yes | **LW:** (no comment; section BUILT-IN FEATURES/UPDATER) |  |
| `librewolf.aboutMenu.checkVersion` |  |  | `false [def]` |  | n/a (fork) | **LW:** LIBREWOLF prefs introduced by librewolf-specific patches |  |
| `zen.mods.auto-update` |  |  |  | `"@cond" (if defined(MOZILLA_OFFICIAL))` | n/a (fork) | **Zen:** (zen/mods.yaml) |  |
| `zen.mods.auto-update-days` |  |  |  | `20` | n/a (fork) | **Zen:** In days (zen/mods.yaml) |  |
| `zen.updates.show-update-notification` |  |  |  | `true` | n/a (fork) | **Zen:** (zen/updates.yaml) |  |
| `app.update.BITS.enabled` | `(opt) false` |  |  |  | yes | **BF:** disable BITS (Background Intelligent Transfer Service) for updates [WINDOWS] BITS is a Windows service that downloads... // [WINDOWS] |  |
| `app.update.auto` | `(opt) false` |  |  |  | yes | **BF:** disable auto-INSTALLING Firefox updates [NON-WINDOWS] | BF keeps auto-update on by default (policy AppAutoUpdate true: "Change to false to disable auto-updates"). LW newer settings removed the old lock (`false`) and now ship update-interval prefs + own update host. |

### 3.25 Firefox Accounts / Sync

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `identity.fxaccounts.enabled` | `(opt) false` |  | `false [def]` |  | yes | **BF:** disable Firefox Sync [ALTERNATIVE] Use xBrowserSync [1]<br>**LW:** SYNC this functionality is disabled by default but it can be activated in one click. this pref fully controls the fea... |  |
| `services.sync.engine.spaces` |  |  |  | `"@cond" (if @IS_TWILIGHT@)` | n/a (Zen engine) | **Zen:** (zen/sync.yaml) |  |
| `services.sync.prefs.sync.zen.share.display-name` |  |  |  | `true` | n/a (Zen) | **Zen:** Allow zen.share.display-name to be synced across devices. (zen/share.yaml) |  |
| `services.sync.prefs.sync.zen.spaces-sync.normal-tabs` |  |  |  | `true` | n/a (Zen) | **Zen:** (zen/sync.yaml) |  |
| `zen.spaces-sync.normal-tabs` |  |  |  | `false` | n/a (fork) | **Zen:** (zen/sync.yaml) |  |
| `identity.fxaccounts.autoconfig.uri` | `(opt) ""` |  |  |  | yes | **BF:** disable Firefox Sync [ALTERNATIVE] Use xBrowserSync [1] |  |

### 3.26 Default browser checks / default browser agent

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.macAppMenu.setAsDefaultShown` |  |  | `false [def]` |  | yes | **LW:** Disable Set as Default Browser menu item in app menu |  |
| `browser.shell.checkDefaultBrowser` | `false` |  |  |  | yes | **BF:** disable Firefox from asking to set as the default browser |  |
| `default-browser-agent.enabled` | `(opt) false` |  | `false [L]` |  | yes | **BF:** software that continually reports what default browser you are using [WINDOWS] [WARNING] Breaks "Make Default..." button in Preferences to set Firefox as the default browser [2].<br>**LW:** OTHERS // disable windows specific telemetry |  |

### 3.27 AI / ML models, chatbot, smart features, Translations

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.ml.chat.menu` | `false` |  | `false [def]` | `false` | yes | **BF:** Chatbot in sidebar<br>**LW:** some leftover menu still appears otherwise:<br>**Zen:** (firefox/ai.yaml § Machine learning and chat feature preferences) |  |
| `browser.ml.enable` | `false` |  | `false [def]` | `false` | yes | **BF:** AI default controls<br>**LW:** See ticket: #1919 - LibreWolf should delete all AI code - https://codeberg.org/librewolf/issues/issues/1919<br>**Zen:** (firefox/ai.yaml § Machine learning and chat feature preferences) |  |
| `browser.ai.control.default` | `"blocked"` |  | `"blocked" [L]` |  | yes | **BF:** AI default controls<br>**LW:** Disable all features by default |  |
| `browser.ml.chat.enabled` | `false` |  |  | `false` | yes | **BF:** Chatbot in sidebar<br>**Zen:** Machine learning and chat feature preferences (firefox/ai.yaml) |  |
| `browser.ml.linkPreview.enabled` | `false` |  |  | `false` | yes | **BF:** Key points in link previews<br>**Zen:** (firefox/ai.yaml § Machine learning and chat feature preferences) |  |
| `browser.preferences.aiControls` |  |  | `false [L]` | `false` | yes | **LW:** Removes the AI pane<br>**Zen:** (firefox/ai.yaml § Machine learning and chat feature preferences) |  |
| `browser.tabs.groups.smart.enabled` | `false` |  | `false [def]` |  | yes | **BF:** Tab group suggestions<br>**LW:** disable smart tab groups |  |
| `browser.ml.chat.shortcuts` |  |  |  | `false` | yes | **Zen:** (firefox/ai.yaml § Machine learning and chat feature preferences) |  |
| `browser.ml.chat.shortcuts.custom` |  |  |  | `false` | yes | **Zen:** (firefox/ai.yaml § Machine learning and chat feature preferences) |  |
| `browser.ml.chat.sidebar` |  |  |  | `false` | yes | **Zen:** (firefox/ai.yaml § Machine learning and chat feature preferences) |  |
| `browser.ml.linkPreview.blockListEnabled` |  |  | `false [def]` |  | yes | **LW:** Disable the blocklist |  |
| `browser.ml.linkPreview.supportedLocales` |  |  | `"null" [def]` |  | yes | **LW:** some leftover menu still appears otherwise: |  |
| `browser.ml.onnxNativeAvailabilityReported` |  |  | `true [L]` |  | yes | **LW:** (no comment; section TELEMETRY) |  |
| `browser.smartwindow.autoTabGrouping.preloadModels` |  |  | `false [def]` |  | yes | **LW:** Do not preload models |  |
| `browser.smartwindow.hideTopSites` |  |  | `true [def]` |  | yes | **LW:** Hide top sites |  |
| `browser.smartwindow.searchTheWebFast` |  |  | `false [def]` |  | yes | **LW:** Disable Exa snippets |  |
| `browser.smartwindow.smartformfill.enabled` |  |  | `false [def]` |  | yes | **LW:** Disable smart form fill |  |
| `browser.translations.newSettingsUI.enable` |  |  |  | `true` | **NOT FOUND** | **Zen:** (firefox/newtab.yaml) |  |
| `extensions.formautofill.useml` |  |  | `false [def]` |  | yes | **LW:** https://bugzilla.mozilla.org/show_bug.cgi?id=2063599 |  |
| `browser.ai.control.linkPreviewKeyPoints` | `(opt) "blocked"` |  |  |  | yes | **BF:** Key points in link previews |  |
| `browser.ai.control.pdfjsAltText` | `(opt) "blocked"` |  |  |  | yes | **BF:** Image alt text in Nightly PDF viewer |  |
| `browser.ai.control.sidebarChatbot` | `(opt) "blocked"` |  |  |  | yes | **BF:** Chatbot in sidebar |  |
| `browser.ai.control.smartTabGroups` | `(opt) "blocked"` |  |  |  | yes | **BF:** Tab group suggestions |  |
| `browser.ai.control.translations` | `(opt) "blocked"` |  |  |  | yes | **BF:** Translations |  |
| `browser.translations.autoTranslate` | `(opt) true` |  |  |  | **NOT FOUND** | **BF:** Firefox Translations [FF118+] Automated translation of web content is done locally in Firefox, so that the text being... |  |
| `browser.translations.enable` | `(opt) true` |  |  |  | yes | **BF:** Firefox Translations [FF118+] Automated translation of web content is done locally in Firefox, so that the text being... // DEFAULT |  |

### 3.28 GMP / DRM plugin downloads (OpenH264, Widevine, ClearKey)

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `media.eme.enabled` | `(opt) false` | `(opt) false` | `false [def]` | `true` | yes | **BF:** disable all DRM content (EME: Encryption Media Extension) EME is a JavaScript API for playing DRMed (not free) video ...<br>**AF:** [5508] disable all DRM (Digital Rights Management) content (EME: Encryption Media Extension) Optionally hide the UI setting ...<br>**LW:** Widevine<br>**Zen:** (zen/media.yaml) |  |
| `librewolf.eme.gmp-clearkey.enabled` |  |  | `false [def]` |  | n/a (fork) | **LW:** Whether the Clear Key CDM is enabled (depends on media.eme.enabled) |  |
| `librewolf.eme.warning.infoURL` |  |  | `"https://librewolf.net/docs/faq/#how-do-i-allow-playback-...` |  | n/a (fork) | **LW:** Widevine |  |
| `media.eme.require-app-approval` |  |  | `true [def]` |  | yes | **LW:** Require permission for playback of DRM content |  |
| `media.gmp-gmpopenh264.enabled` |  |  | `false [def]` |  | yes | **LW:** h264 |  |
| `media.gmp-manager.allowLocalSources` |  |  | `false [def]` |  | yes | **LW:** DRM |  |
| `media.gmp-manager.chromium-update-url` |  |  | `"" [def]` |  | yes | **LW:** Disable fetching Widevine from Chromium servers |  |
| `media.gmp-manager.updateEnabled` |  |  | `false [def]` |  | yes | **LW:** DRM |  |
| `media.gmp-provider.enabled` | `(opt) false` | `(opt) false` | `true [def]` |  | yes | **BF:** disable GMP (Gecko Media Plugins)<br>**AF:** [2020] disable GMP (Gecko Media Plugins)<br>**LW:** DRM | LW keeps provider true (so DRM can be opted into) but disables GMP updates, OpenH264 and Widevine; AF/BF only optional false. |
| `media.gmp-widevinecdm.allow-chromium-update` |  |  | `false [def]` |  | yes | **LW:** Disable fetching Widevine from Chromium servers |  |
| `media.gmp-widevinecdm.chromium-guid` |  |  | `"luluglowsatnight" [def]` |  | yes | **LW:** Disable fetching Widevine from Chromium servers |  |
| `media.gmp-widevinecdm.enabled` | `(opt) false` |  | `false [def]` |  | yes | **BF:** disable widevine CDM (Content Decryption Module)<br>**LW:** Widevine |  |
| `media.gmp-widevinecdm.force-chromium-beta` |  |  | `false [def]` |  | yes | **LW:** Disable fetching Widevine from Chromium servers |  |
| `media.gmp-widevinecdm.force-chromium-update` |  |  | `false [def]` |  | yes | **LW:** Disable fetching Widevine from Chromium servers |  |
| `browser.eme.ui.enabled` | `(opt) false` | `(opt) false` |  |  | yes | **BF:** disable all DRM content (EME: Encryption Media Extension) EME is a JavaScript API for playing DRMed (not free) video ...<br>**AF:** [5508] disable all DRM (Digital Rights Management) content (EME: Encryption Media Extension) Optionally hide the UI setting ... |  |

### 3.29 Mozilla-domain privileges / UITour / WebChannel / Mozilla URLs

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `permissions.manager.defaultsUrl` | `""` | `""` | `"" [P]` |  | yes | **BF:** remove special permissions for certain mozilla domains [FF35+] default = resource://app/defaults/permissions<br>**AF:** [2616] remove special permissions for certain mozilla domains [FF35+]<br>**LW:** revoke special permissions for some mozilla domains |  |
| `privacy.resistFingerprinting.block_mozAddonManager` | `(opt) true` | `true` | `true [def]` |  | yes | **BF:** disable mozAddonManager Web API [FF57+]<br>**AF:** [4503] disable mozAddonManager Web API [FF57+]<br>**LW:** rfp related settings // prevents rfp from breaking AMO |  |
| `app.support.baseURL` |  |  | `"https://support.librewolf.net/" [def]` |  | yes | **LW:** BRANDING set librewolf support and releases urls in the UI, so that users land in the proper places. |  |
| `extensions.webextensions.restrictedDomains` | `(opt) ""` | `(opt) ""` | `"" [def]` |  | yes | **BF:** disable webextension restrictions on Mozilla domains [FF60+]<br>**AF:** [2662] disable webextension restrictions on certain mozilla domains (you also need 4503) [FF60+]<br>**LW:** USER INSTALLED extensions are allowed to operate on restricted domains, while their scope is set to profile+applicati... |  |
| `gecko.handlerService.defaultHandlersVersion` |  |  | `999 [L]` |  | yes | **LW:** Never inject region specific mailto handlers https://searchfox.org/firefox-main/rev/202150dcdade5798ca858b843b51b2011... |  |
| `webchannel.allowObject.urlWhitelist` | `(opt) ""` |  |  |  | **NOT FOUND** | **BF:** remove webchannel whitelist // [DEFAULT FF132+] |  |

### 3.30 Prefetch / speculative connections (brief)

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `browser.places.speculativeConnect.enabled` | `false` | `false` | `false [def]` |  | yes | **BF:** mousedown speculative connections on bookmarks and history [FF98+] Whether to warm up network connections for places:...<br>**AF:** [0605] disable mousedown speculative connections on bookmarks and history [FF98+]<br>**LW:** PREFETCHING AND SPECULATIVE CONNECTIONS disable prefecthing for different things such as links, bookmarks and predict... |  |
| `browser.urlbar.speculativeConnect.enabled` | `false` | `false` | `false [def]` |  | yes | **BF:** preconnect to the autocomplete URL in the address bar Whether to warm up network connections for autofill or search r...<br>**AF:** [0801] disable location bar making speculative connections [FF56+]<br>**LW:** disable speculative connections and domain guessing from the urlbar |  |
| `network.dns.disablePrefetch` | `true` | `true` | `true [def]` |  | yes | **BF:** DNS prefetching for HTMLLinkElement <link rel="dns-prefetch"> Used for cross-origin connections to provide small perf...<br>**AF:** [0602] disable DNS prefetching<br>**LW:** DNS // disable dns prefetching |  |
| `network.dns.disablePrefetchFromHTTPS` | `true` | `true` | `true [def]` |  | yes | **BF:** DNS prefetching for HTMLLinkElement <link rel="dns-prefetch"> Used for cross-origin connections to provide small perf... // [FF127+ false]<br>**AF:** [0602] disable DNS prefetching<br>**LW:** DNS // disable dns prefetching HTTPS |  |
| `network.http.speculative-parallel-limit` | `0` | `0` | `0 [P]` |  | yes | **BF:** link-mouseover opening connection to linked server When accessing content online, devices use sockets as endpoints. T...<br>**AF:** [0604] disable link-mouseover opening connection to linked server<br>**LW:** PREFETCHING AND SPECULATIVE CONNECTIONS disable prefecthing for different things such as links, bookmarks and predict... |  |
| `network.prefetch-next` | `false` | `false` | `false [P]` |  | yes | **BF:** link prefetching <link rel="prefetch"> Pre-populates the HTTP cache by prefetching same-site future navigation resour...<br>**AF:** [0601] disable link prefetching<br>**LW:** PREFETCHING AND SPECULATIVE CONNECTIONS disable prefecthing for different things such as links, bookmarks and predict... |  |
| `network.early-hints.preconnect.max_connections` | `(opt) 10` |  | `0 [P]` |  | yes | **BF:** `Link: rel=preconnect` in 103 Early Hint response [FF120+] Used to warm most critical cross-origin connections to pro... // DEFAULT<br>**LW:** PREFETCHING AND SPECULATIVE CONNECTIONS disable prefecthing for different things such as links, bookmarks and predict... |  |
| `beacon.enabled` | `(opt) false` |  |  |  | yes | **BF:** Beacon API Allows websites to asynchronously transmit small amounts of data to servers without impacting page load pe... |  |
| `browser.fixup.alternate.enabled` | `(opt) false` |  |  |  | yes | **BF:** URL bar domain guessing Domain guessing intercepts DNS "hostname not found errors" and resends a request (e.g. by add... // [DEFAULT FF104+] |  |
| `browser.send_pings` | `(opt) false` | `(opt) false` |  |  | yes | **BF:** Hyperlink Auditing (click tracking) // DEFAULT<br>**AF:** [0610] enforce no "Hyperlink Auditing" (click tracking) // [DEFAULT: false] |  |
| `dom.prefetch_dns_for_anchor_http_document` | `(opt) false` |  |  |  | yes | **BF:** DNS prefetch for HTMLAnchorElement (speculative DNS) Disable speculative DNS calls to prevent Firefox from resolving ... // [FF128+] |  |
| `dom.prefetch_dns_for_anchor_https_document` | `(opt) false` |  |  |  | yes | **BF:** DNS prefetch for HTMLAnchorElement (speculative DNS) Disable speculative DNS calls to prevent Firefox from resolving ... // DEFAULT [FF128+] |  |
| `network.early-hints.enabled` | `(opt) true` |  |  |  | yes | **BF:** early hints [FF120+] |  |
| `network.early-hints.preconnect.enabled` | `(opt) true` |  |  |  | yes | **BF:** `Link: rel=preconnect` in 103 Early Hint response [FF120+] Used to warm most critical cross-origin connections to pro... |  |
| `network.fetchpriority.enabled` | `(opt) true` |  |  |  | yes | **BF:** Fetch Priority API [FF119+] Indicates whether the `fetchpriority` attribute for elements which support it. |  |
| `network.modulepreload` | `(opt) true` |  |  |  | yes | **BF:** network module preload <link rel="modulepreload"> [FF115+] High-priority loading of current page JavaScript modules. ... // DEFAULT |  |
| `network.preconnect` | `(opt) true` |  |  |  | yes | **BF:** enable <link rel="preconnect"> tag and Link: rel=preconnect response header handling // DEFAULT |  |
| `network.predictor.enable-prefetch` |  | `(inactive-9999) false` |  |  | **NOT FOUND** | **AF:** [0603, now in 9999 DEPRECATED block, inactive] disable predictor / prefetching |  |
| `network.predictor.enabled` |  | `(inactive-9999) false` |  |  | **NOT FOUND** | **AF:** [0603, now in 9999 DEPRECATED block, inactive] disable predictor / prefetching; removed FF148 (bug 2006028); DEFAULT false FF144+ |  |

### 3.31 Other outbound leaks: proxy bypass, WebRTC IP, CSP reports, HTTP background probes, OS SSO

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `security.csp.reporting.enabled` | `false` | `false` | `false [def]` |  | yes | **BF:** disable CSP Level 2 Reporting [FF140+]<br>**AF:** [2640] disable CSP Level 2 Reporting [FF140+]<br>**LW:** https://codeberg.org/librewolf/issues/issues/2688 |  |
| `media.peerconnection.ice.default_address_only` | `(opt) true` | `true` | `false [def]` |  | yes | **BF:** force a single network interface for ICE candidates generation [FF42+] When using a system-wide proxy, it uses the pr...<br>**AF:** [2003] force a single network interface for ICE candidates generation [FF42+] When using a system-wide proxy, it uses the pr...<br>**LW:** use a single interface for ICE candidates, the vpn one when a vpn is used |  |
| `media.peerconnection.ice.proxy_only_if_behind_proxy` | `(opt) true` | `true` | `true [def]` |  | yes | **BF:** force WebRTC inside the proxy [FF70+]<br>**AF:** [2002] force WebRTC inside the proxy [FF70+]<br>**LW:** force webrtc inside proxy when one is used |  |
| `network.file.disable_unc_paths` | `(opt) true` | `true` | `true [def]` |  | yes | **BF:** disable using UNC (Uniform Naming Convention) paths [FF61+] // [HIDDEN PREF]<br>**AF:** [0703] disable using UNC (Uniform Naming Convention) paths [FF61+] // [HIDDEN PREF]<br>**LW:** hidden, disable using uniform naming convention to prevent proxy bypass |  |
| `network.gio.supported-protocols` | `(opt) ""` | `""` | `"" [def]` |  | **NOT FOUND** | **BF:** disable GIO as a potential proxy bypass vector Gvfs/GIO has a set of supported protocols like obex, network, archive,... // [HIDDEN PREF] [DEFAULT FF118+]<br>**AF:** [0704] disable GIO as a potential proxy bypass vector Gvfs/GIO has a set of supported protocols like obex, network, archive,... // [HIDDEN PREF] [DEFAULT: ""]<br>**LW:** PROXY // disable gio as it could bypass proxy | Set by AF/LW but no longer referenced in FF156 source. |
| `network.proxy.socks_remote_dns` | `(opt) true` | `true` | `true [def]` |  | yes | **BF:** set the proxy server to do any DNS lookups when using SOCKS e.g. in Tor, this stops your local DNS server from knowin...<br>**AF:** [0702] set the proxy server to do any DNS lookups when using SOCKS e.g. in Tor, this stops your local DNS server from knowin...<br>**LW:** forces dns query through the proxy when using one |  |
| `dom.security.https_only_mode_send_http_background_request` | `(opt) true` | `false` |  |  | yes | **BF:** HTTP background requests in HTTPS-only Mode When attempting to upgrade, if the server doesn't respond within a few se... // DEFAULT<br>**AF:** [1246] disable HTTP background requests [FF82+] When attempting to upgrade, if the server doesn't respond within 3 seconds, ... |  |
| `media.peerconnection.enabled` | `(opt) false` | `(opt) false` |  |  | yes | **BF:** disable WebRTC (Web Real-Time Communication) Firefox desktop uses mDNS hostname obfuscation and the private IP is nev...<br>**AF:** [7020] disable WebRTC (Web Real-Time Communication) [WHY] Firefox desktop uses mDNS hostname obfuscation and the private IP is never exposed until required in TRUSTED scenarios; i... |  |
| `media.peerconnection.ice.no_host` | `(opt) true` | `(opt) true` |  |  | yes | **BF:** force exclusion of private IPs from ICE candidates [FF51+] [SETUP-HARDEN] This will protect your private IP even in T...<br>**AF:** [2004] force exclusion of private IPs from ICE candidates [FF51+] [SETUP-HARDEN] This will protect your private IP even in T... |  |
| `network.dns.disableIPv6` | `(opt) true` | `(opt) true` |  |  | yes | **BF:** disable IPv6 If you are not masking your IP, then this won't make much difference. And some VPNs now cover IPv6.<br>**AF:** [5509] disable IPv6 if using a VPN This is an application level fallback. Disabling IPv6 is best done at an OS/network level... |  |
| `network.http.microsoft-entra-sso.enabled` |  | `(opt) false` |  |  | yes | **AF:** [0907] enforce no automatic authentication on Microsoft sites [FF131+] [MAC] On macOS, SSO only works on corporate devices // [DEFAULT: false] |  |
| `network.http.windows-sso.enabled` | `(opt) false` | `(opt) false` |  |  | yes | **BF:** disable automatic authentication on Microsoft sites [WINDOWS] // DEFAULT<br>**AF:** [0906] enforce no automatic authentication on Microsoft sites [FF91+] [WINDOWS 10+] // [DEFAULT: false] |  |
| `network.notify.checkForProxies` | `(opt) false` |  |  |  | yes | **BF:** disable check for proxies |  |
| `network.proxy.allow_bypass` |  | `(opt) false` |  |  | yes | **AF:** [0706] disable proxy bypass for system request failures [FF95+] RemoteSettings, UpdateService, Telemetry [1] [WARNING] If false, this will break the fallback for some security features | AF keeps default: "If false, this will break the fallback for some security features" (RemoteSettings, UpdateService, Telemetry). |
| `network.proxy.failover_direct` |  | `(opt) false` |  |  | yes | **AF:** [0705] disable proxy direct failover for system requests [FF91+] [WARNING] Default true is a security feature against malicious extensions [1] | AF keeps default: "[WARNING] Default true is a security feature against malicious extensions". |

### 3.32 Zen-specific network features (own services)

| Pref | BF | AF | LW | Zen | FF156 | Comments (own words, condensed) | Keeps-on for security / notes |
|---|---|---|---|---|---|---|---|
| `zen.injections.match-urls` |  |  |  | `"https://zen-browser.app/*" [L] (if defined(MOZILLA_OFFIC...` | n/a (fork) | **Zen:** (zen/mods.yaml § === Mark: Site Injection ===) |  |
| `zen.live-folders.github.skip-new-pr-ui-check` |  |  |  | `false` | n/a (fork) | **Zen:** (zen/live-folders.yaml) |  |
| `zen.share.base-url` |  |  |  | `"https://share.zen-browser.app"` | n/a (fork) | **Zen:** (zen/share.yaml) |  |
| `zen.share.secret-key` |  |  |  | `""` | n/a (fork) | **Zen:** (zen/share.yaml) |  |

## 4. Where the projects disagree (with their stated reasons)

| Topic | Positions and each project's own reasoning |
|---|---|
| **Safe Browsing (Google)** | **LibreWolf** turns it all off (`browser.safebrowsing.malware/phishing/blockedURIs/downloads.enabled=false`, blanks `google`/`google4` update+gethash URLs, `downloads.remote.url`, `google4.dataSharingURL`): "disable safe browsing, including the fetch of updates. reverting the 7 prefs below allows to perform local checks and to fetch updated lists from google." **arkenfox** keeps SB on and lists the master switches only as commented options: "[WARNING] Do this at your own risk!" It only disables *remote* download lookups (0403) and tags that `[SETUP-SECURITY]`. It also notes FF147+ uses SBv5 with Oblivious HTTP and local list mode. **Betterfox** is the same as arkenfox: "Be sure to have alternate security measures if you disable SB! Adblockers do not count!", and it points to an "enable local checks only" alternative. **Zen** leaves SB at the defaults. Its common mozconfig passes `--with-google-safebrowsing-api-keyfile` whenever `$HOME/.zen-keys/safebrowsing.dat` exists. |
| **OCSP** | **Betterfox** `security.OCSP.enabled=0`: "OCSP (non-stapled) leaks information about the sites you visit to the CA... It's a trade-off between security (checking) and privacy". **LibreWolf** `0` ("Disable OCSP"), relying on CRLite mode 2. **arkenfox** enforced the opposite until v140-1 (`OCSP.enabled=1` plus `OCSP.require=true`, hard-fail: "It is pointless to soft-fail when an OCSP fetch fails"). v144 (2026-04-20) removed both prefs and added them to the prefsCleaner reset list, while keeping CRLite enforced. Net effect: the FF156 default, which is `1` (OCSP on for DV+EV, soft-fail) on desktop. Betterfox also offers `OCSP.require=true` (hard-fail) as an option, with the warning that it breaks some captive portals. |
| **Captive portal + connectivity checks** | **arkenfox** (0360/0361) and **LibreWolf** disable `captivedetect.canonicalURL`, `network.captive-portal-service.enabled` and `network.connectivity-service.enabled`. arkenfox cites EFF's "captive portals interfere with wireless security and privacy". **Betterfox** keeps them on and lists them only as commented options: "[WARNING] Do NOT use for mobile devices. May NOT be able to use Firefox on public wifi (hotels, coffee shops, etc)." **Zen**: untouched. |
| **DNS-over-HTTPS** | **arkenfox** suggests `network.trr.mode=3` (TRR-only, commented) and explains the region rollout ("doh-rollout.home-region: USA 2019, Canada 2021, Russia/Ukraine 2022"). **LibreWolf** sets mode `5` (off) and `doh-rollout.enabled=false`, but ships a curated provider list (Quad9, LibreDNS, Wikimedia, DNS4All, Mullvad) with `network.trr.uri` = non-filtering Quad9 and `network.trr.default_provider_uri` = DNS4All. **Betterfox** leaves the default (`0`, commented) in user.js, but its `policies.json` sets `DNSOverHTTPS: {Enabled:false, Locked:false}`, with no comment. **Zen**: untouched, so the Firefox default region rollout applies. |
| **Geolocation provider** | **LibreWolf** `geo.provider.network.url = https://api.beacondb.net/v1/geolocate` and disables OS providers (Windows/CoreLocation/geoclue). **Betterfox** `https://beacondb.net/v1/geolocate` (no `api.` prefix). BeaconDB's own homepage documents `https://api.beacondb.net/v1/geolocate`. Betterfox also sets `permissions.default.geo=2`. **arkenfox** only disables the OS providers and leaves the FF156 default (Google `googleapis.com/geolocation`, behind a prompt). Under 7002 it argues that global permission defaults are fingerprintable: "Just add site exceptions". **Zen** builds with an optional Google location-service key. |
| **Permission defaults (notifications, geo)** | **Betterfox** blocks both globally (`permissions.default.desktop-notification=2`, `permissions.default.geo=2`). **arkenfox** 7002 DON'T BOTHER: "These are fingerprintable via Permissions API... Just add site exceptions". |
| **Push service** | No project disables `dom.push.enabled`. arkenfox (7019) and Betterfox both say the API "is required for CRLite". Nobody blanks `dom.push.serverURL` (FF156 default `wss://push.services.mozilla.com/`). |
| **DRM / GMP downloads** | **LibreWolf** turns off EME, Widevine and OpenH264, sets `media.gmp-manager.updateEnabled=false`, and blanks the Chromium Widevine update URL. It keeps `media.gmp-provider.enabled=true` so users can opt in. **Zen** turns EME on (`media.eme.enabled: true`, `prefs/zen/media.yaml`) and builds `--enable-eme=widevine`. **arkenfox/Betterfox** only list `media.eme.enabled=false` / `media.gmp-provider.enabled=false` as optional hardening. |
| **WebRTC ICE interface** | **arkenfox** `media.peerconnection.ice.default_address_only=true` ("force a single network interface for ICE candidates generation"). **LibreWolf** sets `false`: "there is no point in disabling webrtc as mDNS protects the private IP... only used in trusted environments". Both set `media.peerconnection.ice.proxy_only_if_behind_proxy=true`. |
| **HTTPS-Only background HTTP probe** | **arkenfox** `dom.security.https_only_mode_send_http_background_request=false` (1246). **Betterfox** keeps the default `true`: "[WARNING] Disabling causes long timeouts when no path to HTTPS is present." |
| **App updates** | **Betterfox** keeps auto-update (`AppAutoUpdate: true`, "Change to false to disable auto-updates"). **LibreWolf** 156.0.1-1 ships `--disable-updater`, `DisableAppUpdate: true` and `AppUpdateURL: https://localhost`. Its newer settings, however, add `app.update.interval`/`promptWaitTime`/`checkInstallTime.days` and remove the old `lockPref("app.update.auto", false)` ("since we do not bake auto-updates in the browser"), and `updater.patch` retargets AUS to `update.librewolf.net`. So an in-house updater looks to be in progress. **Zen** runs its own AUS (`updates.zen-browser.app`); only its AppImage disables updates by policy. **arkenfox** does not touch updates, and under 7014 it argues against disabling system add-on updates: "[WHY] It can compromise security." |
| **Remote Settings** | **LibreWolf** is the only project that filters Remote Settings, using an allowlist patch that keeps security-relevant collections (`security-state/*`, `blocklists/*`, tracking-protection lists, cookie-banner rules, translations models, and others). arkenfox, Betterfox and Zen do not restrict it. arkenfox 0706 warns that disabling proxy bypass "will break the fallback for some security features" (it names RemoteSettings). |
| **Nimbus rollouts, daily-usage ping, AMO metadata** | `nimbus.rollouts.enabled=false`: Betterfox + LibreWolf (Betterfox: "disable remote improvements [FF148+]"). arkenfox and Zen do not set it, though Betterfox/LibreWolf also set policy `DisableRemoteImprovements`. `datareporting.usage.uploadEnabled=false`: Betterfox + LibreWolf only. `extensions.getAddons.cache.enabled=false`: Betterfox + Zen only. |
| **Telemetry (philosophy)** | All four disable it. arkenfox explicitly states: "Arkenfox does not consider Firefox telemetry to be a privacy or security concern... But since most arkenfox users prefer it disabled, we'll do that". LibreWolf: "telemetry is already disabled elsewhere [build-time] and most of the stuff in here is just for redundancy". |
| **Translations (model downloads)** | None of the four disable Translations. Betterfox (commented, default on): "done locally in Firefox, so that the text being translated does not leave your machine". LibreWolf keeps `AIControls.Translations: available` and allowlists the `translations-models(-v2)`/`translations-wasm(-v2)` Remote Settings collections, so models are still downloaded from Mozilla on first use. Betterfox, LibreWolf and Zen disable the rest of AI/ML (`browser.ml.enable=false`, chatbot, smart tab groups, link preview; Betterfox policy `GenerativeAI: false`, LibreWolf `browser.ai.control.default="blocked"` locked). arkenfox sets no AI/ML prefs at all. |
| **Update-check cadence** | `app.update.checkInstallTime.days`: LibreWolf 7, Zen 6 (official builds only). This is not a privacy disagreement. |

### Items a project explicitly keeps ON for security (quick list)
- `extensions.blocklist.enabled=true`: arkenfox 6001 "DON'T TOUCH... It includes updates for 'revoked certificates'". Betterfox (commented) says the same. LibreWolf allowlists `blocklists/*`.
- `security.pki.crlite_mode=2` + `security.remote_settings.crlite_filters.enabled=true`: arkenfox enforces both, LibreWolf sets both ("Use CRLite whenever possible"), and Betterfox documents them as default.
- Safe Browsing (local lists + malware/phishing): kept by arkenfox, Betterfox and Zen, with warnings. LibreWolf is the outlier.
- `dom.push.enabled`: kept by arkenfox and Betterfox ("required for CRLite").
- Captive portal / connectivity: kept by Betterfox (usability on public Wi-Fi).
- `network.proxy.failover_direct` / `network.proxy.allow_bypass`: arkenfox keeps the defaults ("a security feature against malicious extensions" / "will break the fallback for some security features").
- `extensions.systemAddon.update.*`: arkenfox keeps them ("It can compromise security").
- `extensions.quarantinedDomains.enabled=true`: arkenfox enforces it.
- OCSP: arkenfox used to enforce it with hard-fail. As of v144 it only keeps the FF default, which is on.
- App auto-update: Betterfox keeps it on.

## 5. Surprises and gaps (checked against the local Firefox 156.0.1 source)

1. **Dead prefs.** 37 pref names these projects set or suggest are not referenced anywhere in FF156 (tests and third_party excluded), so they have no effect: `browser.attribution.enabled`, `browser.messaging-system.whatsNewPanel.enabled`, `browser.newtabpage.activity-stream.feeds.snippets`, `browser.newtabpage.activity-stream.newtabWallpapers.v2.enabled`, `browser.ping-centre.telemetry`, `browser.preferences.experimental`, `browser.privatebrowsing.vpnpromourl`, `browser.translations.autoTranslate`, `browser.translations.newSettingsUI.enable`, `browser.urlbar.weather.ignoreVPN`, `dom.private-attribution.submission.enabled`, `extensions.pocket.api`, `extensions.pocket.enabled`, `extensions.pocket.oAuthConsumerKey`, `extensions.pocket.showHome`, `extensions.pocket.site`, `geo.provider.network.logging.enabled`, `messaging-system.rsexperimentloader.enabled`, `network.gio.supported-protocols`, `network.predictor.enable-prefetch`, `network.predictor.enabled`, `network.trr.confirmation_telemetry_enabled`, `network.trr.display_fallback_warning`, `network.trr.resolvers`, `network.trr.skip-AAAA-when-not-supported`, `network.trr.wait-for-portal`, `network.trr_ui.show_fallback_warning_option`, `privacy.partition.network_state.ocsp_cache`, `security.app_menu.recordEventTelemetry`, `security.certerrors.recordEventTelemetry`, `security.protectionspopup.recordEventTelemetry`, `toolkit.telemetry.coverage.opt-out`, `toolkit.telemetry.dap_enabled`, `toolkit.telemetry.dap_helper`, `toolkit.telemetry.dap_leader`, `toolkit.telemetry.pioneer-new-studies-available`, `webchannel.allowObject.urlWhitelist`. Notable ones:
   - `toolkit.telemetry.coverage.opt-out`: set by Betterfox, arkenfox and Zen. Only `toolkit.coverage.opt-out` is read, in `CoveragePing.sys.mjs`.
   - `network.gio.supported-protocols`: set by arkenfox and LibreWolf.
   - `dom.private-attribution.submission.enabled`: Betterfox comment and the stale LibreWolf repo. PPA code is gone.
   - `browser.ping-centre.telemetry`, `browser.attribution.enabled`, `toolkit.telemetry.pioneer-new-studies-available`, `browser.privatebrowsing.vpnpromourl`: all set by Zen.
   - `extensions.pocket.*`: Pocket has been removed.
   - `network.predictor.*`: arkenfox already moved these to its deprecated block, "removed FF148".
   - Several `network.trr.*` and `security.*.recordEventTelemetry` prefs.
2. **Safe Browsing v5 provider not blanked.** FF156 `all.js` defines `browser.safebrowsing.provider.google5.enabled=true` with `google5.updateURL` = `https://safebrowsing.googleapis.com/v5/hashLists:batchGet?...` and `google5.gethashURL`. LibreWolf's "defense in depth" blanking covers only `google` and `google4`. Its master switches are off, so this is probably harmless, but a blanking inventory should add `google5.*`. Nobody touches `browser.safebrowsing.provider.mozilla.*` either (the ETP tracking-list provider, `moz-sbrs:://antitracking` in FF156).
3. **An unused Remote Settings kill switch exists.** FF156 has the enterprise policy `DisableRemoteSettingsAndAcceptSecurityConsequences`, which makes `Utils.shouldSkipRemoteActivity` return true. None of the projects use it. LibreWolf's allowlist patch looks like its way of keeping CRLite, blocklists and tracking lists while blocking everything else. Also, in FF156 `Utils.sys.mjs` (`allowServerURL`), `services.settings.server` is ignored on release/beta builds unless the env has `MOZ_DISABLE_NONLOCAL_CONNECTIONS=1` or `MOZ_REMOTE_SETTINGS_DEVTOOLS=1`, or the value is one of `AppConstants.REMOTE_SETTINGS_SERVER_URLS`. So redirecting Remote Settings needs a build-level change, not just a pref.
4. **Other FF156 policies relevant to network privacy that none of the projects use:**
   - `CaptivePortal`
   - `NetworkPrediction`
   - `SearchSuggestEnabled`
   - `DisableFirefoxAccounts` / `DisableAccounts`
   - `DisableSystemAddonUpdate`
   - `ExtensionUpdate`
   - `TranslateEnabled`
   - `VisualSearchEnabled`: `browser.search.visualSearch.featureGate` defaults to `true` in FF156 and no project touches it.
   - `IPProtectionAvailable`
   - `MicrosoftEntraSSO` / `WindowsSSO`
   - `Preferences`: can lock arbitrary prefs.
5. **Endpoints nobody blanks** (FF156 defaults):
   - `dom.push.serverURL` (`wss://push.services.mozilla.com/`)
   - `network.connectivity-service.IPv4.url` (`http://firefox-portal-detection.com/success.txt?ipv4`)
   - `captivedetect.canonicalURL`, which now defaults to `http://firefox-portal-detection.com/generate_204` (arkenfox and LibreWolf blank it)
   - `browser.urlbar.merino.endpointURL` and its OHTTP relay
   - `extensions.update.url` (AMO version check)
   - `extensions.systemAddon.update.url` (aus5)
   - `identity.fxaccounts.remote.root`
   - `browser.newtabpage.activity-stream.discoverystream.ohttp.relayURL`
   - `toolkit.shopping.ohttpRelayURL`

   LibreWolf blanks `media.gmp-manager.chromium-update-url` and `browser.newtabpage.activity-stream.unifiedAds.endpoint`. Its older settings also blanked `media.gmp-manager.url` (removed in the 156 settings).
6. **The LibreWolf standalone `settings` repo is stale** (section 6). Anyone copying `codeberg.org/librewolf/settings` would get the August 2026 prefs, which predate LibreWolf's "Preferences changed in Firefox v155" and "Preferences for 156" commits, for example `media.gmp-provider.enabled=false` and `media.gmp-manager.url="data:text/plain,"` instead of the newer GMP scheme, and would miss about 60 newer network prefs such as Suggest online, MARS ads, widgets and the Firefox Account ping.
7. **Build flags alone are not enough.** LibreWolf does more than set the `mk_add_options MOZ_*=0` flags. It patches `imply_option` in `browser/moz.configure`, because `imply_option("MOZ_SERVICES_HEALTHREPORT", True)` and `imply_option("MOZ_NORMANDY", True)` are upstream defaults. It also hard-patches `glean-core` so upload is always false, and enables `glean_disable_upload` for MOZILLA_OFFICIAL builds, because upstream only sets that feature for non-official builds. Zen passes only the empty `MOZ_*_REPORTING=` flags and uses no Glean patch.
8. **Zen's own network services** (not Mozilla, but still outbound):
   - mod auto-update (`zen.mods.auto-update`, every 20 days; mods are injected on `https://zen-browser.app/*`)
   - the share service `zen.share.base-url = https://share.zen-browser.app`
   - GitHub "live folders"
   - update host `updates.zen-browser.app`

   Zen also blanks the Windows installer telemetry ping URL. LibreWolf's source patches do not touch `defines.nsi.in`; its Windows installers are built in the separate bsys6 repo, which was not examined.
9. **Version skew.** arkenfox's latest release is v144 (April 2026) and it has not changed prefs for 145–156. Betterfox is at 154, with Peskyfox.js still saying 152. Zen and LibreWolf track 156.0.1.

## 6. LibreWolf: `source/settings/` (156.0.1-1) vs. standalone `settings` repo (2026-08-18)

These are network-relevant differences only. The full list can be regenerated from `prefs.json` (`librewolf` vs `librewolf_standalone_settings_repo`).
- **Only in the stale repo:**
  - `lockPref("app.update.auto", false)`
  - `pref("dom.private-attribution.submission.enabled", false)`
  - `defaultPref("media.gmp-manager.url", "data:text/plain,")`
  - `media.gmp-provider.enabled=false`
  - `lockPref("browser.promo.focus.enabled", false)`
  - `browser.search.searchEnginesURL`
  - `app.feedback.baseURL`
  - `browser.urlbar.trustPanel.breachAlerts.featureGate=false`
  - `browser.urlbar.suggest.mdn=true`
  - a cookie-banner section
- **Only in source/settings (newer):**
  - Updater prefs (`app.update.interval=14400`, `promptWaitTime=0`, `checkInstallTime.days=7`, `badgeWaitTime=0`) and release-notes URLs on librewolf.dev.
  - GMP: `media.gmp-manager.updateEnabled=false`, `allowLocalSources=false`, the Chromium Widevine update prefs, `media.eme.enabled=false`, `media.gmp-widevinecdm.enabled=false`.
  - Firefox Suggest: the full "online available but disabled" set (`quicksuggest.online.*`, `suggest.quicksuggest.*`, `suggest.amp/addons/wikipedia/yelp/sports/realtimeOptIn...`, `sponsoredTopSites=false`).
  - MARS/ads locks: `feeds.adsfeed`, `discoverystream.reportAds`, `contextualAds`, `adAllowedRanks`, `merino-feed-experiment`.
  - Telemetry locks: `identity.fxaccounts.telemetry.clientInfoPing.enabled`, `browser.newtabpage.activity-stream.telemetry.privatePing.enabled`, `impressionId`, `toolkit.telemetry.site_categories`.
  - New Tab widgets (the system toggles kept on, the user toggles off).
  - Smart-window/ML prefs and the sync promos.
  - `browser.vpn_promo.enabled` changed from lock to default.

## 7. Method and caveats

- Prefs were extracted by script (`/tmp/neeko-privacy/extract.py`) from the exact files at the commits listed above. Values are shown exactly as written. Commented-out lines are reported as `(opt)`, not as settings. Categorisation is regex-based (`categories.py`), and the non-network remainder was reviewed by hand before exclusion.
- "Comments" are condensed from each project's own text, not paraphrased from memory. The "Keeps-on for security" column is written by hand from those comments.
- FF156 existence was checked with `git grep` against `engine/` at `d9b85be` ("Firefox 156.0.1") in read-only mode. Names built at runtime (`TRR_PREF(...)`, `feeds.${name}`, `browser.promo.syncPromo.${type}`, `extensions.ui.${type}.hidden`) were verified by hand and marked `dyn`. A `yes` only means the name is referenced; it does not prove the pref still has the effect the project describes.
- Nothing in the Neeko repository was modified.
