# Privacy decisions

**Status: proposed, waiting for approval.** Nothing here is implemented yet.
Numbers refer to rows in [`inventory.md`](inventory.md).

These are the defaults every browser built on Neeko inherits from first launch.
A browser built on Neeko can later switch individual features back on for its
users, but only as an explicit choice.

## KILL: off completely, from first launch

Pure tracking, usage reporting and ads. None of it is needed for anything a
browser built on Neeko does.

| # | What | Notes |
| --- | --- | --- |
| 1–3 | Telemetry: legacy, Glean, daily usage ping, shutdown ping sender | In artifact builds, uploads are compiled on in Mozilla's core, so this is done with prefs |
| 4 | Automatic crash ping | Goes away with the crash reporter (#5) |
| 5 | Crash reporter and crash reports | Nobody receives crash reports. Self-hosting is a later option (see LATER) |
| 6 | Studies and experiments (Normandy, Nimbus, rollouts, Firefox Labs) | Also stops Mozilla from changing the browser remotely |
| 7 | Private aggregate measurements (DAP) | |
| 8 | Search results categorization | |
| 9 | Add-on recommendations (hashed client ID) | |
| 10 | In-browser messages, onboarding, "What's New" | |
| 11 | First-run and "What's New" pages | Includes the mozilla.org page with a third-party consent script |
| 12–13 | Sponsored shortcuts, Pocket stories, sponsored stories | New Tab becomes local-only: your own shortcuts and history |
| 14 | Weather | |
| 15–16 | Firefox Suggest, online and sponsored | |
| 17 | Region detection | Firefox falls back to its default region for things like the default search engine list |
| 35 | Add-on metadata cache | Only cosmetic (add-on descriptions in about:addons) |
| 42 (part) | Relay and VPN promos | |

## KEEP / REPLACE: security features

| # | What | Options | Proposed | Trade-off |
| --- | --- | --- | --- | --- |
| 26 | Certificate revocation lists (CRLite, OneCRL, intermediates) | keep / off | **Keep** | Sends nothing about you. Needs Remote Settings (#25). |
| 25 | Remote Settings (the channel security lists arrive on) | keep / self-host a mirror / off | **Keep** | One request a day to Mozilla's CDN reveals your IP and that you use a Firefox-based browser. Turning it off would lose certificate revocation and the add-on blocklist. With the KILL items off, only security collections should sync; the privacy test will check. |
| 27 | OCSP (asking certificate authorities if a certificate was revoked) | keep / replace with CRLite / require | **Replace with CRLite** | Certificate authorities stop seeing which sites you visit. Certificates CRLite doesn't cover, such as company-installed roots, go unchecked for revocation. LibreWolf and Betterfox do this. |
| 28 | Safe Browsing lists (phishing and malware warnings) | off / your own Google key (LATER) | **Off in Neeko**, decide when you distribute | Already off in this build because it has no Google key. Without it there are no phishing or malware warnings. With a key, Google sees partial URL hashes and your IP. Keys are per product, so Neeko shouldn't ship one. |
| 29 | Download protection remote lookup | keep / off | **Off** | Would send details of downloaded programs to Google, and it's broken without a key anyway. |
| 30 | Tracking-protection lists | keep / off | **Keep** | Protects you from trackers. Downloads lists only. |
| 31 | Malicious add-on blocklist | keep / off | **Keep** | Sends nothing about you. |
| 32 | Man-in-the-middle detection | keep / off | **Keep** (your call) | Only contacts Mozilla after certain certificate errors, to spot antivirus or network interception. |
| 34 | Add-on updates | keep / manual | **Keep** | Security fixes for extensions. addons.mozilla.org sees your add-on IDs once a day. |
| 24 | Backup-domain fallback | keep / off | **Keep** | Only affects the remaining security traffic. |

## LATER: your own servers, once you distribute

| # | What | Until then |
| --- | --- | --- |
| 33 | App updates | **Off.** Today's build would ask Mozilla's server, with the wrong channel. Later: your own update server (Surfer can generate update manifests). |
| 36 | System add-on and language-pack updates | **Off.** Ship them with your own app updates later. |
| 5 | Crash reports | **Off.** Optional self-hosted crash server later. |
| 28 | Safe Browsing | **Off.** Optional: your own Google key. |
| 25 | Remote Settings mirror | Mozilla's (see KEEP). Optional self-host. |
| 19–20 | Captive portal and connectivity checks | **Off** (see below). Optional: point them at your own server. |
| 22 | Push server | **Off** (see below). Optional self-host. |

## Features that leak a little: proposed defaults

Not tracking and not security, but each one sends something somewhere.

| # | What | Proposed | Trade-off |
| --- | --- | --- | --- |
| 19–20 | Captive portal and connectivity checks | **Off** | Mozilla would see your IP every time your network changes. Without it, hotel and café Wi-Fi login pages don't pop up automatically; you open any page to get the login screen. |
| 21 | DNS-over-HTTPS | **Mozilla's automatic regional rollout off**; system DNS unless the browser or its user picks a provider | No encrypted DNS by default, but no silent routing of every site name to Cloudflare either. |
| 22 | Push service | **Off** | It's a permanent connection to Mozilla with a unique ID. Without it, websites can't send notifications while closed, and security lists arrive on the daily schedule instead of instantly. |
| 23 | Speculative connections and prefetch | **Leave for now** | This is about websites, not Mozilla. It belongs to the later website-tracking item. |
| 37 | Codec and DRM downloads (OpenH264, Widevine) | **Nothing at startup.** Widevine only when a site needs DRM and you say yes (Firefox's own prompt). OpenH264 off. | Netflix or Spotify need one click the first time. Video calls mostly fall back to another codec. |
| 38 | Search suggestions and trending | **Off in Firefox's hidden address bar** | The Neeko API will fetch suggestions only when a custom UI asks (roadmap). |
| 40–41 | Translations and AI features | **Off** | Their UI is hidden anyway. They can come back through the Neeko API as explicit opt-ins. |
| 42 | Accounts, Sync, Relay | **Off** | There's no UI to sign in yet. |
| 18 | Geolocation for websites | **Keep** | Only happens when you allow a site, through macOS location services. |
| — | Remote debugging (not a connection) | **Off in shipped builds, on in dev builds** | Dev builds need it for Firefox's Browser Toolbox. |

## How it will be implemented (privacy step 3)

- **A dedicated Neeko privacy prefs file** with a comment on every pref. This
  covers most items. Every pref name gets verified against the Firefox source
  again at implementation time.
- **Build config:** the crash reporter and updater get switched off, and the two
  dead telemetry lines in `configs/common/mozconfig` get replaced. Whether
  `--disable-updater` works with artifact builds still needs verifying.
- **Enterprise policies (`policies.json`):** step 3 explains whether they're
  worth it, and their downsides, such as the "managed by your organization"
  message.
- **The privacy test (step 4)** proves it: a fresh profile behind a proxy,
  failing on any KILL endpoint.
