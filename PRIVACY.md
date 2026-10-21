# Privacy

This browser is built on Neeko, which runs on Firefox. Neeko turns off every
way Firefox reports on you, from the very first launch, with nothing to set
up. This page lists every connection the browser makes on its own, and why.

**In short:** the browser sends no telemetry, usage data or crash reports to
anyone. On its own, it only downloads security updates (lists of revoked
certificates, dangerous add-ons and known trackers) and checks your add-ons
for updates. Everything else happens because you did something, like visiting
a website.

## What it never sends

- **No telemetry or usage data.** Firefox normally reports how you use it,
  how it performs, and details about your computer and settings, with an ID
  for your profile. All of it is off, including the ping Firefox sends when
  you quit.
- **No crash reports.** There is no crash reporter at all.
- **No studies or experiments.** Mozilla can't enroll you in tests or change
  the browser's settings remotely.
- **No ads or sponsored content.** No sponsored shortcuts or stories on the
  New Tab page, no sponsored suggestions, no weather lookups.
- **No region lookup.** The browser doesn't look up your country from your
  internet address.
- **No first-run web pages.** Nothing opens mozilla.org on first launch.
- **No app updates from Mozilla.** Updates come from whoever makes this
  browser, when they set that up. No video codecs or plugins are downloaded
  either, unless a site needs DRM and you say yes (below).
- **No add-on recommendations** and no fetching of add-on descriptions.
- **No Firefox account, Sync, Relay, translations or AI features.** They're
  off, so none of their connections happen.

## Connections it makes on its own

| Where | What for | What they can learn |
| --- | --- | --- |
| `firefox.settings.services.mozilla.com`, `firefox-settings-attachments.cdn.mozilla.net`, `content-signature-2.cdn.mozilla.net` (Mozilla's "Remote Settings") | At startup, then once a day: lists of revoked certificates (so you're warned about compromised websites), the blocklist of dangerous add-ons, tracker lists for tracking protection, and other built-in data such as the search engine list, website compatibility fixes and password-form rules. The last address proves the lists really come from Mozilla. | Your internet address, and that you use a Firefox-based browser. Nothing about you or your browsing is sent. |
| `shavar.services.mozilla.com` | Updates the tracker lists that tracking protection uses. | The same. |
| `versioncheck.addons.mozilla.org` | Once a day, if you have add-ons: checks for security fixes to them. | Which add-ons you have installed, and their versions. |
| `mitmdetection.services.mozilla.com` | Only after certain certificate errors: checks whether antivirus software or your network is intercepting secure connections, so the error page can explain it. | Your internet address. |
| `*.mozilla-backup.org` | Only if one of the Mozilla addresses above can't be reached: the same requests, sent to a backup address. | The same as the request it replaces. |

## Connections that happen because you did something

- **Websites you visit**, and everything they load (images, scripts, and any
  trackers they include; tracking protection blocks known ones).
- **Searching** sends what you searched for to your search engine.
  Suggestions as you type are only fetched if this browser's address bar
  asks for them.
- **Your location**, only when you allow a website to see it, through the
  system's location service (macOS's, or GeoClue on Linux). When that has
  no answer within a few seconds, Firefox asks its network location
  service instead (`geo.provider.network.url`, Google's).
- **Streaming video with DRM** (Netflix, Spotify): the first time a site
  needs it, the browser asks whether to turn DRM on. If you say yes, it asks
  Mozilla's update server (`aus5.mozilla.org`) which version of Google's
  Widevine plugin is current, downloads it from Google, and keeps checking
  for updates once a day. Mozilla and Google see your internet address and
  your browser and system versions.
- **Installing add-ons** from addons.mozilla.org.
- **Importing from another browser** (if this browser offers it) reads that
  browser's bookmarks, history and passwords on this computer and connects
  to nothing. Firefox can also match another browser's extensions on
  addons.mozilla.org; browsers built on Neeko don't offer that.
- **The browser's helpers**, if it has any: programs that come with the
  browser (a local AI server, say), which it starts only when you use a
  feature that needs one, never at startup, and stops when it quits. The
  browser talks to them on your computer only (127.0.0.1), with nothing of
  yours they aren't asked. Where a helper itself connects (an AI service
  your question goes to, say) is up to the browser's makers, whose privacy
  notice should say. To find the programs a helper may run, its first
  start asks your login shell for its search path, which runs your shell's
  profile files, as opening a terminal would.
- **The browser's secrets**, if it keeps any (an API key you gave it, say),
  are in your system's keychain (macOS's Keychain, or your Linux keyring),
  never in a file of the browser's, and go only to its helpers, on your
  computer. Keeping them connects to nothing.
- **DNS lookups** go to your computer's usual DNS server, as for any other
  app. The browser doesn't send them to an encrypted DNS provider unless you
  choose one in Settings.

## What's off, and what that costs you

Some of what's off is useful to some people. Here's what you give up, so you
can decide:

- **Wi-Fi login pages don't pop up by themselves.** In hotels and cafés,
  open any website to get the login page.
- **No phishing and malware warnings.** Those come from Google's Safe
  Browsing, which needs a key only the browser's maker can get.
- **Websites can't notify you while they're closed.** That needs a
  permanent connection to Mozilla's push service, with an ID for you.
- **No encrypted DNS by default.** You can turn it on in Settings.
- **The first DRM video needs one click** to turn DRM on.
- **Certificate revocation uses Firefox's CRLite lists** instead of asking
  certificate authorities about each site (which would tell them where you
  go). Certificates CRLite doesn't cover, such as ones your company
  installs, aren't checked for revocation.

## Who can change this

These are defaults. You can change any of them in Settings or
`about:config`. The makers of a browser built on Neeko can change them too,
in their browser's own settings; if they do, their own privacy notice should
say so. Neeko uses no enterprise policies, so the browser never shows
"managed by your organization".

## How it's checked

Neeko has an automated privacy test. It starts the browser with a brand-new
profile behind a proxy that sees every request, leaves it idle for four
minutes, visits a few ordinary websites, and fails if anything goes to an
address on the "never" list above, or if anything new shows up while the
browser sits idle. It also checks that Firefox's own telemetry pages say
nothing is uploaded. It runs after every Firefox update, on macOS, and it
passes on Linux too (tried on Ubuntu 24.04 on arm64, with a browser
installed by `make install`: the same three kept hosts while idle).

The details, with every setting and the Firefox source behind it, are in
[docs/privacy/](docs/privacy/implementation.md).
