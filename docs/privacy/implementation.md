# How Neeko's privacy defaults are implemented

Privacy step 3. It carries out every approved decision in
[`decisions.md`](decisions.md), so every browser built on Neeko is private
from its first launch without any setup. The research behind it, with the
Firefox source location of every pref and flag, is in
[`research/firefox-156-privacy-prefs.md`](research/firefox-156-privacy-prefs.md).

## Where it lives

All of it is in Neeko's own layers. No Firefox file changed.

| Piece | What it does |
| --- | --- |
| `src/browser/neeko/firefox-neeko-privacy.js` | 58 default prefs, a comment on each, grouped by the decisions (KILL, KEEP/REPLACE, LATER, leaks a little). This does most of the work. |
| `configs/common/mozconfig` | `--disable-updater` (no update checks to Mozilla) and `--disable-crashreporter` (no crash reports or crash pings). |
| `src/browser/neeko/NeekoPrivacy.sys.mjs` | Keeps codec and DRM plugin updates off until DRM is actually turned on. That's the one decision prefs alone can't express. |
| `Makefile` (`make run`) | Dev launches turn remote debugging back on, for Firefox's Browser Toolbox. Shipped builds keep it off. |

**Defaults, not locks.** A browser built on Neeko can switch any of these
back on in its own branding prefs, and a user can change them in Settings or
about:config. That's the "only as an explicit choice" rule from the
decisions.

**The file name matters.** Firefox reads its default pref files in reverse
alphabetical order, and the last one read wins. Named
`firefox-neeko-privacy.js`, Neeko's file is read after Firefox's own
`firefox.js` (29 of these prefs are set there the other way, and Neeko's
values win) and before `firefox-branding.js`, where a browser built on Neeko
sets its own values (the build appends the browser's `branding/prefs.js`
there). With a name like `neeko-privacy.js` those 29 prefs would have
silently lost.

## Enterprise policies (`policies.json`): not used

Firefox can also be configured with an enterprise policy file, the way
companies manage their employees' browsers. Policies are stronger than prefs:
they lock settings so nobody can change them. Neeko doesn't use them, because
here they'd cost more than they give.

**What they would add.** With the updater built out, the only thing a policy
could do that Neeko's prefs can't is turn off Firefox Labs (opt-in
experimental features in Settings). Everything else a policy does comes down
to setting the same prefs Neeko already sets.

**What they cost.** As soon as any policy is active:

- Settings shows **"Your browser is being managed by your organization"** at
  the top, and about:policies and about:support list the policies.
- Every Google search URL changes to say the browser is enterprise-managed
  (`channel=entpr`).
- Whatever a policy turns off can never be turned back on, not by the user
  and not by a browser built on Neeko, short of replacing Neeko's policy
  file. That breaks "a browser built on Neeko can change anything".
- The operating system's own policy settings (macOS managed preferences, a
  system-wide Firefox policy file on Linux) can replace Neeko's.
- `DisableTelemetry` would also block about:telemetry, which the privacy test
  wants to check.

**When to revisit:** if the privacy test (step 4) has to show no experiment
traffic at all. The minimal file would only turn off Firefox Labs.

## What's still sent on first launch, and why

A brand-new profile, left idle for 3 minutes behind a logging proxy, before
and after this step:

| | Stock Firefox 156 | With Neeko's defaults |
| --- | --- | --- |
| Hosts contacted | 24 | 3 |
| Telemetry upload | at 16 seconds | none |
| Everything else | region lookup, Wi-Fi portal checks, New Tab ads and stories, push, DNS to Cloudflare, the privacy-notice page, update checks, studies, codec downloads, add-on metadata | none |

The three hosts left are all Remote Settings, which the decisions keep for
security, contacted in the first two seconds:

| Host | What it is |
| --- | --- |
| `firefox.settings.services.mozilla.com` | Asks which lists changed. Certificate revocation (CRLite, OneCRL), the add-on blocklist and tracking-protection lists arrive this way. |
| `firefox-settings-attachments.cdn.mozilla.net` | Downloads the list files. |
| `content-signature-2.cdn.mozilla.net` | Fetches the certificate that proves the lists really come from Mozilla. |

Visiting Wikipedia and example.com on a fresh profile added only those sites
(and Wikipedia's own image and login hosts). Raw logs:
[`research/capture-after-step3-first-launch-idle.tsv`](research/capture-after-step3-first-launch-idle.tsv)
and
[`research/capture-after-step3-browsing.tsv`](research/capture-after-step3-browsing.tsv),
next to the stock captures.

This was a 3-minute check by hand through the same small logging proxy as the
inventory. Things on daily timers, such as add-on update checks (kept), don't
show up that soon.

## The privacy test (step 4)

`python3 tools/test_privacy.py` (after `make build`) checks all of this
automatically, and should be run after every Firefox update:

1. A brand-new profile sends everything through mitmproxy, which sees full
   URLs (the profile trusts the proxy's one-off certificate).
2. First launch with the UI the build bundled (the demo UI in Neeko's own
   repo, the browser's UI in a browser's), idle for 4 minutes, then a
   normal quit (shutdown pings would go then). `--app` tests a packaged
   release instead of the dev build.
3. Second launch, on three ordinary websites for a minute.
4. With the proxy gone, a last launch reads about:telemetry and about:glean.

It fails if any request reaches an endpoint Neeko turns off, if anything but
the kept security traffic appears while idle (that's how new Firefox
services get caught), if any browser process connects without going through
the proxy, or if upload isn't disabled or pings are waiting to be sent. It
also lists the Remote Settings collections that synced.

**Result on 2026-09-23, Firefox 156.0.1: passed.** While idle, only the
three Remote Settings hosts. While browsing, only the websites. Nothing
skipped the proxy. Both pages say upload is disabled, and no pings are
waiting.

**The test catches leaks.** Run with the captive portal check and telemetry
upload switched back on
(`--pref network.captive-portal-service.enabled=true --pref
datareporting.healthreport.uploadEnabled=true`), it failed on:
- `firefox-portal-detection.com` and `incoming.telemetry.mozilla.org`;
- a telemetry connection that bypassed the proxy completely;
- about:telemetry saying upload is enabled;
- 7 Glean pings waiting to be sent.

**Remote Settings collections seen in a short run:**
- Security: `tracking-protection-lists`, `hijack-blocklists`.
- Other data: `fxmonitor-breaches`, `moz-essential-domain-fallbacks`,
  `ms-action-allowlists`, `url-parser-default-unknown-schemes-interventions`.
- New Tab wallpaper images: `newtab-wallpapers-v2`.

The non-security ones are what the Remote Settings filtering decision (below)
is about.

## Loose ends, and what was decided

- **Firefox Labs: left on, no policy** (decided). Only an enterprise policy
  turns it off, with the costs above. Nimbus keeps a recipe loader running
  for it, which checks the kept Remote Settings host every 6 hours (the
  first check comes 6 hours after first launch, so the privacy test doesn't
  see it). It enrolls in nothing unless the user opts into a Labs feature
  in Settings.
- **Remote Settings syncs more than security lists: left as is**
  (recommended, waiting for the user's word). The privacy test lists about
  35 collections: the security ones, plus search engine config, website
  compatibility fixes, password-form rules, translation and New Tab data
  and similar. They come from the same kept host, in the same requests as
  the security lists, and send nothing about you, so filtering them would
  only save downloads. It would take a patch to Firefox's Remote Settings
  code, like LibreWolf's.
- **Firefox Suggest can come back if a region is set: left as is**
  (recommended, waiting for the user's word). Firefox turns Suggest on at
  runtime in some countries (US, UK, Germany, France, Italy) once it knows
  the region, setting its own defaults over Neeko's. Region detection is
  off, so it stays off unless a user or a browser built on Neeko sets
  `browser.search.region`, and even then it only shows in Firefox's own
  fallback address bar, not in a custom UI's. The privacy test fails on
  Suggest's online endpoint if it ever shows up.
- **Local crash dumps: solved by release builds.** Dev builds use Mozilla's
  prebuilt core, whose crash handler can still write crash dumps into the
  profile (nothing is sent). Release builds (`make release`) compile the
  crash reporter out.
- **Shipping: solved in setup step 6** ([`../using-neeko.md`](../using-neeko.md)).
  Packaged builds include Neeko's pref files (a three-line patch to
  Firefox's package list), and release builds compile their own launcher,
  so they carry the browser's name and profile folder instead of Firefox's
  and have telemetry upload compiled out. `tools/test_release.py` checks
  both, and the privacy test runs against a release with `--app`.
