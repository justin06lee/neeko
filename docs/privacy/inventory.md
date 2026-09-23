# Privacy inventory: every way Firefox 156 connects out

This is step 1 of the privacy-by-default work: a list of everything stock
Firefox 156.0.1 contacts on its own, before any Neeko changes. Nothing here has
been changed yet. Step 2 sorts these into kill / keep / later.

It is built from three sources that agree with each other:

1. **A live capture.** The current Neeko build (stock Firefox, no privacy
   changes) was launched with a brand-new profile behind a logging proxy. It
   was left idle for 3 minutes, then relaunched to open two websites. Raw logs:
   [`research/capture-first-launch-idle.tsv`](research/capture-first-launch-idle.tsv)
   and [`research/capture-second-launch-browsing.tsv`](research/capture-second-launch-browsing.tsv).
2. **The Firefox 156.0.1 source.** Every endpoint, pref and build flag was found
   in `engine/` with its file and line:
   [`research/firefox-156-endpoints.md`](research/firefox-156-endpoints.md).
3. **Reference projects.** Betterfox, arkenfox, LibreWolf and Zen, fetched
   2026-09-22 and cross-checked against the 156 source:
   [`research/reference-projects.md`](research/reference-projects.md).

## What the live capture showed

With nobody touching it, a fresh profile contacted **24 hosts in the first 3
minutes**:

| Seconds after launch | Host | What it is |
| --- | --- | --- |
| 0 | `location.services.mozilla.com` | Region detection (IP to country) |
| 2 | `firefox-portal-detection.com` (plain HTTP) | Captive portal and connectivity checks |
| 2 | `ads.mozilla.org`, `ads-img.mozilla.org` | Sponsored shortcuts on New Tab |
| 2 | `merino.services.mozilla.com`, `prod-images.merino…mozgcp.net`, `img-getpocket.cdn.mozilla.net` | New Tab stories and their images |
| 2 | `mozilla-ohttp.fastly-edge.com`, `prod.ohttp-gateway…mozgcp.net` | Relay used to fetch New Tab content |
| 2 | `push.services.mozilla.com` | Push service (a persistent connection) |
| 2 | `mozilla.cloudflare-dns.com` | DNS-over-HTTPS (Cloudflare) |
| 2 | `www.mozilla.org`, then `transcend-cdn.com` | First-run privacy-notice tab, plus that page's cookie-consent script |
| 3 | `aus5.mozilla.org` | Update checks (app and codec plugins) |
| 4 | `normandy.cdn.mozilla.net`, `classify-client.services.mozilla.com` | Studies and experiments |
| 4 | `firefox.settings.services.mozilla.com` + 2 CDNs | Remote Settings downloads |
| **16** | **`incoming.telemetry.mozilla.org`** | **Telemetry upload** |
| 19–20 | `update.googleapis.com`, `ciscobinary.openh264.org`, `www.google.com` | Codec and DRM plugin downloads (OpenH264, Widevine) |
| 30 | `services.addons.mozilla.org` | Add-on metadata |

Browsing to Wikipedia and example.com on the second launch added only those
sites, plus the same background services again, including another telemetry
upload.

## Why this build leaks more than you'd expect

- **Artifact builds use Mozilla's prebuilt core, compiled for official
  Firefox.** Telemetry and Glean uploads are switched on inside that prebuilt
  code. The only off switch left is the pref
  `datareporting.healthreport.uploadEnabled`, which defaults to on.
- **The telemetry lines in `configs/common/mozconfig` do nothing.**
  `mk_add_options MOZ_TELEMETRY_REPORTING=` sets a make variable, not a build
  option. Surfer's `MOZ_APPUPDATE_HOST` export is also dead: nothing reads it,
  so updates still point at `aus5.mozilla.org`.
- **Some switches can't be flipped from mozconfig.** `MOZ_NORMANDY` and
  `MOZ_SERVICES_HEALTHREPORT` are forced on in `browser/moz.configure`, so
  prefs have to handle those.
- **App updates have no pref.** Only an enterprise policy (`DisableAppUpdate`)
  or removing the URL from the generated `application.ini` stops them.
- **The crash reporter sends a crash ping before its window even appears.** It
  only honors the upload pref when it's set as a user value in the profile, not
  as a default.
- **Remote Settings can't be pointed elsewhere on release builds** without an
  environment variable. The only built-in off switch is a policy whose name
  says it all: `DisableRemoteSettingsAndAcceptSecurityConsequences`.
- **37 prefs the reference projects set no longer exist in Firefox 156**, so
  copying their lists blindly would do nothing for those items.

## Inventory

"Type" means:

- **Tracking**: reports on you or your usage.
- **Ads**: sponsored content.
- **Security**: protects you.
- **Feature**: needed for something the browser does, but it leaks something.
- **Mixed**: carries both.

"Live" means the host showed up in the capture.

| # | What it is | What it sends | Where | Type | Main controls (verified in 156 source) | Live |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Telemetry (legacy) | Usage and performance measurements, device and settings details, a per-profile ID | `incoming.telemetry.mozilla.org` | Tracking | `datareporting.healthreport.uploadEnabled`, `toolkit.telemetry.*`; build gate compiled on in the artifact core | yes |
| 2 | Glean (newer telemetry) | Same kinds of data through the newer system, including New Tab and usage pings | `incoming.telemetry.mozilla.org` (hardcoded) and an HTTP relay | Tracking | `datareporting.healthreport.uploadEnabled`, `datareporting.usage.uploadEnabled` | yes |
| 3 | Shutdown ping sender | A telemetry ping sent by a helper program after the browser quits | `incoming.telemetry.mozilla.org` | Tracking | `toolkit.telemetry.shutdownPingSender.enabled` | |
| 4 | Crash ping | Crash details, sent automatically before any dialog | `incoming.telemetry.mozilla.org` | Tracking | user value of `datareporting.healthreport.uploadEnabled`, or crash reporter off (`--disable-crashreporter`, inferred from source; to confirm in the privacy test) | |
| 5 | Crash reports | Crash dump, optionally the open page's URL; you're asked first | `crash-reports.mozilla.com` | Feature (diagnostics) | `--disable-crashreporter`, `browser.crashReports.*`, `browser.tabs.crashReporting.*` | |
| 6 | Studies and experiments (Normandy, Nimbus) | Downloads experiments that change the browser remotely; enrollment is reported via telemetry | `normandy.cdn.mozilla.net`, `classify-client.services.mozilla.com`, Remote Settings | Tracking | `app.normandy.enabled`, `app.shield.optoutstudies.enabled`, `nimbus.rollouts.enabled`; Firefox Labs keeps Nimbus alive | yes |
| 7 | Private aggregate measurements (DAP) | Encrypted aggregate counts | `dap-09-3.api.divviup.org`, `dap.services.mozilla.com` | Tracking | only when an experiment enables it, plus the upload pref | |
| 8 | Search results categorization | Categories of the search pages you visit, via Glean | `incoming.telemetry.mozilla.org` | Tracking | `browser.search.serpEventTelemetryCategorization.enabled` | |
| 9 | Add-on recommendations | A hashed telemetry client ID, sent as a cookie to addons.mozilla.org | `services.addons.mozilla.org` | Tracking | `browser.discovery.enabled`, `extensions.htmlaboutaddons.recommendations.enabled` | |
| 10 | In-browser messages and onboarding (CFR, What's New) | Downloads message lists; interactions are reported via telemetry | Remote Settings | Tracking | `browser.newtabpage.activity-stream.asrouter.*` | |
| 11 | First-run pages | Opens mozilla.org's privacy notice, a normal web page with a third-party consent script | `www.mozilla.org`, `transcend-cdn.com` | Tracking (third party) | `datareporting.policy.*` (first-run URL) | yes |
| 12 | Sponsored shortcuts | Fetches ads and reports impressions and clicks | `ads.mozilla.org`, `ads-img.mozilla.org` | Ads | `browser.newtabpage.activity-stream.showSponsoredTopSites`, `...unifiedAds.*` | yes |
| 13 | Stories and sponsored stories (Pocket) | Requests a region-based story feed; images come through Mozilla's image proxy | `merino.services.mozilla.com` (via relay), `img-getpocket.cdn.mozilla.net`, `spocs.getpocket.com` | Ads | `...feeds.section.topstories`, `...showSponsored`, `...discoverystream.*` | yes |
| 14 | Weather (New Tab and address bar) | Your approximate location (from IP, or a set city) | `merino.services.mozilla.com` | Feature | `...showWeather`, `browser.urlbar.suggest.weather` | |
| 15 | Firefox Suggest, online | What you type in the address bar (US only by default) | `merino.services.mozilla.com` via relay | Tracking | `browser.urlbar.quicksuggest.*` | |
| 16 | Firefox Suggest, sponsored and offline | Downloads suggestion data and shows sponsored results (some regions) | Remote Settings | Ads | `browser.urlbar.suggest.quicksuggest.sponsored` | |
| 17 | Region detection | Your IP, looked up to a country; re-checked weekly | `location.services.mozilla.com` | Tracking | `browser.region.update.enabled`, `browser.region.network.url` | yes |
| 18 | Geolocation for websites | Your location, only when you allow a site | macOS location services, fallback `www.googleapis.com` | Feature | `geo.provider.network.url`, `geo.provider.use_corelocation` | |
| 19 | Captive portal detection | A plain-HTTP request that reveals "a Firefox is here" on the network | `firefox-portal-detection.com` | Feature (public Wi-Fi) | `network.captive-portal-service.enabled`, `captivedetect.canonicalURL` | yes |
| 20 | Connectivity checks | Plain-HTTP requests and DNS lookups | `firefox-portal-detection.com` | Feature | `network.connectivity-service.enabled` | yes |
| 21 | DNS-over-HTTPS | Every site name you look up, sent to Cloudflare when on (switched on by region) | `mozilla.cloudflare-dns.com` | Feature (a privacy trade-off) | `network.trr.mode`, `doh-rollout.*` | yes |
| 22 | Push service | A permanent connection with a unique ID; carries site notifications and instant Remote Settings updates | `push.services.mozilla.com` | Feature | `dom.push.enabled`, `dom.push.connection.enabled` | yes |
| 23 | Speculative connections and prefetch | Connects to sites before you click | the sites themselves | Feature (performance) | `network.prefetch-next`, `network.http.speculative-parallel-limit`, `browser.urlbar.speculativeConnect.enabled` | |
| 24 | Backup-domain fallback | Re-sends failed requests for Mozilla services to backup mirrors | `*.mozilla-backup.org` | Feature (infrastructure) | `network.essential_domains_fallback` | |
| 25 | Remote Settings (the backbone) | Downloads about 40 data collections every 24 hours; serves security lists and also experiments, messages and ads config | `firefox.settings.services.mozilla.com` + CDNs | Mixed | no pref; only a policy or a build-level change | yes |
| 26 | Certificate revocation lists (CRLite, OneCRL, intermediates) | Nothing about you; downloads revocation data | Remote Settings | Security | `security.pki.crlite_mode`, `security.remote_settings.*` | |
| 27 | OCSP | Which site's certificate you're checking, sent to that certificate authority | each CA's server | Security (leaks sites to CAs) | `security.OCSP.enabled` | |
| 28 | Safe Browsing lists (Google) | List downloads and partial hashes of risky URLs; **already off in this build** because it has no Google API key | `safebrowsing.googleapis.com` | Security | `browser.safebrowsing.*` | |
| 29 | Download protection lookup | Details of downloaded programs; source suggests it's still attempted despite the missing key (to confirm in the privacy test) | `sb-ssl.google.com` | Security | `browser.safebrowsing.downloads.remote.enabled` | |
| 30 | Tracking-protection lists | Nothing about you; downloads tracker lists | Remote Settings, `shavar.services.mozilla.com` | Security (privacy protection) | `browser.safebrowsing.provider.mozilla.*` | |
| 31 | Malicious add-on blocklist | Nothing about you; downloads the blocklist | Remote Settings | Security | `extensions.blocklist.enabled` | |
| 32 | Man-in-the-middle detection | One request to Mozilla on certain certificate errors | `mitmdetection.services.mozilla.com` | Security | `security.certerrors.mitm.priming.enabled` | |
| 33 | App updates | Version, build, OS, locale, channel | `aus5.mozilla.org` | Security (patches) | no pref; policy `DisableAppUpdate`/`AppUpdateURL`, `--disable-updater` | yes |
| 34 | Add-on updates | IDs and versions of your add-ons | `versioncheck.addons.mozilla.org` | Security | `extensions.update.enabled` | |
| 35 | Add-on metadata cache | IDs of your installed add-ons | `services.addons.mozilla.org` | Feature | `extensions.getAddons.cache.enabled` | yes |
| 36 | System add-on and language-pack updates | Version, build, OS, locale | `aus5.mozilla.org`, `services.addons.mozilla.org` | Feature | `extensions.systemAddon.update.enabled`, `app.update.langpack.enabled` | |
| 37 | Codec and DRM plugins (OpenH264, Widevine) | Version and OS; downloads from Cisco and Google | `aus5.mozilla.org`, `update.googleapis.com`, `ciscobinary.openh264.org`, `www.google.com` | Feature (video calls, Netflix) | `media.gmp-*`, `media.eme.enabled` | yes |
| 38 | Search suggestions and trending | What you type, sent to the search engine (Google by default) | the search engine | Feature | `browser.search.suggest.enabled`, `browser.urlbar.trending.featureGate` | |
| 39 | Search engine config updates | Nothing about you; downloads the engine list | Remote Settings | Feature | none (always on) | |
| 40 | Translations | Nothing about the text (it's translated on your machine); downloads language models on first use | Remote Settings attachments | Feature | `browser.translations.enable` | |
| 41 | AI features (link previews, smart tab groups, chatbot) | Model downloads on use; the chatbot sends page content to the provider you pick | `model-hub.mozilla.org`, your chosen provider | Feature | `browser.ml.enable`, `browser.ml.chat.enabled`, `browser.ai.control.default` | |
| 42 | Accounts, Sync, Relay | Only after you sign in or use them | `accounts.firefox.com`, `token.services.mozilla.com`, `relay.firefox.com` | Feature (opt-in) | `identity.fxaccounts.enabled`, `signon.firefoxRelay.feature` | |

## Other things worth knowing

- **Remote debugging is allowed in unofficial builds.** It isn't a network
  connection, but because Neeko builds aren't "official",
  `devtools.debugger.remote-enabled` defaults to on. It only listens when
  started, but it should still be off in shipped browsers.
- **New Tab code can be delivered remotely** (the `newtab-renderer` Remote
  Settings collection, and add-on packages from `archive.mozilla.org`).
- **The update channel on macOS is locked to `default`** by Mozilla's prebuilt
  framework, not the `unofficial` channel Surfer sets.

## Where the reference projects disagree

| Topic | Positions |
| --- | --- |
| Safe Browsing | LibreWolf turns it off. arkenfox and Betterfox keep it and only turn off the remote download check. Zen keeps it with its own Google key. |
| OCSP | Betterfox and LibreWolf turn it off (it leaks sites to certificate authorities) and rely on CRLite. arkenfox leaves Firefox's default (on). |
| Captive portal checks | arkenfox and LibreWolf turn them off. Betterfox keeps them so hotel and café Wi-Fi works. |
| DNS-over-HTTPS | arkenfox suggests forcing it on. LibreWolf turns Mozilla's rollout off but ships its own provider list. Betterfox turns it off by policy. |
| Codec/DRM plugins | LibreWolf turns them off (you can opt in). Zen keeps DRM on for streaming. |
| Push service | Nobody turns it off; arkenfox and Betterfox say CRLite needs it. |
| Remote Settings | Only LibreWolf filters it, keeping only security collections, via a source patch. |
| App updates | LibreWolf and Zen run their own update servers. |
