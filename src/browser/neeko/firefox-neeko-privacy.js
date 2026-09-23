// Neeko's privacy defaults (privacy step 3). Every browser built on Neeko
// inherits them from its very first launch.
//
// This file turns off everything docs/privacy/decisions.md puts on the KILL
// list and sets the other approved defaults. Row numbers ("#12") refer to
// docs/privacy/inventory.md. Every pref here was checked against the Firefox
// 156.0.1 source: it exists, and Firefox really reads it with the meaning
// described. docs/privacy/research/firefox-156-privacy-prefs.md lists where
// each one is defined and read.
//
// These are defaults, not locks. A browser built on Neeko can switch any of
// them back on in its own prefs, and a user can change them in about:config
// or Settings. That is the "only as an explicit choice" rule.
//
// The name matters. Firefox reads default pref files in reverse alphabetical
// order and the last one read wins (modules/libpref/Preferences.cpp,
// pref_LoadPrefsInDir). "firefox-neeko-privacy.js" is read after Firefox's
// own firefox.js, which sets 29 of these prefs the other way, and before
// firefox-branding.js, where a browser built on Neeko can override Neeko.
//
// What prefs can't do is handled elsewhere:
// - App updates (#33) and the crash reporter (#5): build flags in
//   configs/common/mozconfig.
// - Codec and DRM plugin updates (#37): NeekoPrivacy.sys.mjs, together with
//   the plugin prefs below.
// - Firefox Labs, the one part of #6 with no pref, stays on: only an
//   enterprise policy can turn it off (docs/privacy/implementation.md).


// ===========================================================================
// KILL: off completely, from first launch
// ===========================================================================

// --- #1-3 Telemetry: legacy, Glean, daily usage ping, shutdown ping sender ---
// The prebuilt Mozilla core has uploads compiled on, so these prefs are the
// real off switch.

// Master upload switch for legacy Telemetry, Glean, Nimbus studies, DAP and the
// crash pings the browser itself sends. Off from the first run means Glean
// never creates a client ID, so no "deletion-request" ping is sent either.
// Caveat: the separate crash reporter program only reads this from prefs.js,
// so it doesn't see this default. We don't ship that program (mozconfig).
pref("datareporting.healthreport.uploadEnabled", false);

// The daily "usage-reporting" ping. It ignores the master switch above, so it
// needs its own off switch.
pref("datareporting.usage.uploadEnabled", false);

// Legacy data-submission policy. Off means legacy Telemetry may never upload,
// and the privacy-notice tab (www.mozilla.org/privacy/firefox/, #11) never
// opens on first launch.
pref("datareporting.policy.dataSubmissionEnabled", false);

// Don't hand the shutdown ping to the separate "pingsender" program.
pref("toolkit.telemetry.shutdownPingSender.enabled", false);

// The daily Firefox Accounts "client info" ping also ignores the master
// switch. It only runs when signed in (Accounts are off below), but keep it
// off in case a browser built on Neeko turns Accounts back on.
pref("identity.fxaccounts.telemetry.clientInfoPing.enabled", false);

// Windows only: the default-browser agent reports to Mozilla's telemetry
// server. With this off it exits right away. Harmless on macOS and Linux.
pref("default-browser-agent.enabled", false);

// --- #4-5 Crash reports ---
// Mostly handled by --disable-crashreporter in mozconfig.

// "Crash reports on demand": Mozilla uses Remote Settings to ask users to send
// particular crash reports. Keep it off even if a Neeko browser later brings
// back its own crash reporter.
pref("browser.crashReports.onDemand", false);

// --- #6 Studies and experiments (Normandy, Nimbus) ---

// Normandy: Mozilla's older system for studies and remote pref changes.
pref("app.normandy.enabled", false);

// Nimbus studies ("Allow Firefox to install and run studies").
pref("app.shield.optoutstudies.enabled", false);

// Nimbus rollouts ("remote improvements"): features and prefs Mozilla switches
// on from its servers. This is also how New Tab code updates would arrive.
pref("nimbus.rollouts.enabled", false);

// #7 Private aggregate measurements (DAP): no pref needed. They only run when a
// Nimbus study or rollout turns them on (both off above), with the upload
// switch on (off above). The DAP sender also doesn't start in this build
// (AppConstants.MOZ_TELEMETRY_REPORTING is false).

// --- #8 Search results categorization ---

// Stop sorting the search result pages you visit into categories for Glean.
pref("browser.search.serpEventTelemetryCategorization.enabled", false);

// --- #9 Add-on recommendations ---

// Stop the addons.mozilla.org cookie carrying a hashed telemetry client ID.
pref("browser.discovery.enabled", false);

// No "Recommendations" pane in about:addons, so no fetch of Mozilla's
// discovery API when that page opens.
pref("extensions.getAddons.showPane", false);

// No recommended add-ons under the extension and theme lists in about:addons.
pref("extensions.htmlaboutaddons.recommendations.enabled", false);

// --- #10 In-browser messages, onboarding and "What's New" ---
// Each provider is Firefox's own setting with "enabled" set to false, so a
// browser built on Neeko can turn one back on by flipping one word.

// Contextual recommendations (CFR), downloaded from Remote Settings.
pref("browser.newtabpage.activity-stream.asrouter.providers.cfr", "{\"id\":\"cfr\",\"enabled\":false,\"type\":\"remote-settings\",\"collection\":\"cfr\",\"updateCycleInMs\":3600000}");
// Message groups (frequency caps for messages), downloaded from Remote Settings.
pref("browser.newtabpage.activity-stream.asrouter.providers.message-groups", "{\"id\":\"message-groups\",\"enabled\":false,\"type\":\"remote-settings\",\"collection\":\"message-groups\",\"updateCycleInMs\":3600000}");
// Messages delivered through Nimbus experiments.
pref("browser.newtabpage.activity-stream.asrouter.providers.messaging-experiments", "{\"id\":\"messaging-experiments\",\"enabled\":false,\"type\":\"remote-experiments\",\"updateCycleInMs\":3600000}");
// Built-in onboarding messages: spotlights, feature callouts, "set as
// default" prompts.
pref("browser.newtabpage.activity-stream.asrouter.providers.onboarding", "{\"id\":\"onboarding\",\"type\":\"local\",\"localProvider\":\"OnboardingMessageProvider\",\"enabled\":false,\"exclude\":[]}");

// Settings checkboxes "Recommend extensions / features as you browse". Set to
// match, so Settings doesn't show them as on.
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.addons", false);
pref("browser.newtabpage.activity-stream.asrouter.userprefs.cfr.features", false);

// --- #11 First-run and "What's New" pages ---

// Never open a welcome page on a new profile, or a "What's New" page after an
// update, whatever URL the branding sets. A browser built on Neeko can bring
// its own back by setting this to "" in its branding prefs.
pref("browser.startup.homepage_override.mstone", "ignore");

// Turn off about:welcome, the onboarding page.
pref("browser.aboutwelcome.enabled", false);

// Skip the Terms of Use pop-up. Already on in unofficial builds; this keeps it
// off if a browser built on Neeko sets MOZILLA_OFFICIAL.
pref("termsofuse.bypassNotification", true);

// --- #12-13 Sponsored shortcuts, stories and sponsored stories (New Tab) ---
// New Tab keeps your own shortcuts and history only.

// No sponsored shortcuts. Stops the ad requests to ads.mozilla.org.
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);

// No sponsored stories.
pref("browser.newtabpage.activity-stream.showSponsored", false);

// No stories feed. Stops fetches from Merino and its image proxy.
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);

// Firefox's own region-based on/off switch for stories, fixed at off, so the
// feature can't appear later when the region or locale changes.
pref("browser.newtabpage.activity-stream.feeds.system.topstories", false);

// --- #14 Weather ---

// Region-based switch for the New Tab weather widget, fixed at off. No
// location lookups through Merino.
pref("browser.newtabpage.activity-stream.system.showWeather", false);

// Second region-based weather switch. When it changes, New Tab fetches the
// weather even if the widget is off, so keep it fixed at off too.
pref("browser.newtabpage.activity-stream.widgets.system.weather.enabled", false);

// Address-bar weather, and #15-16 Firefox Suggest (online and sponsored): no
// pref here on purpose. Firefox only turns them on at runtime, and only for a
// known home region (US, GB, DE, FR, IT). Region detection is off below, so
// they stay off. A default set here would be overwritten at runtime in those
// regions anyway (see docs/privacy/implementation.md).

// --- #17 Region detection ---

// Don't look up your country from your IP (location.services.mozilla.com).
// An empty URL makes Firefox skip the request; no retries.
pref("browser.region.network.url", "");

// Don't schedule the weekly region re-check.
pref("browser.region.update.enabled", false);

// --- #35 Add-on metadata cache ---

// Don't send the IDs of your installed add-ons to services.addons.mozilla.org
// to fetch descriptions for about:addons.
pref("extensions.getAddons.cache.enabled", false);

// --- #42 (part) Relay and VPN promos ---

// No Mozilla VPN promotions (about:protections, messages).
pref("browser.vpn_promo.enabled", false);

// No Firefox Relay promotions.
pref("browser.promo.relay.enabled", false);


// ===========================================================================
// KEEP / REPLACE: security features
// ===========================================================================
// Kept with Firefox's defaults, so nothing is set here: CRLite, OneCRL and
// intermediates (#26), Remote Settings (#25), tracking-protection lists (#30),
// the malicious add-on blocklist (#31), man-in-the-middle detection (#32),
// add-on updates (#34), backup-domain fallback (#24).

// --- #27 OCSP, replaced by CRLite ---

// Don't ask certificate authorities about each site's certificate (it tells
// them which sites you visit). CRLite does the revocation check instead: it is
// on and enforcing by default in 156 (security.pki.crlite_mode = 2), and its
// data arrives through Remote Settings, which stays on. Certificates stapled by
// the site are still checked. Certificates CRLite doesn't cover, such as
// company-installed roots, go unchecked.
pref("security.OCSP.enabled", 0);

// --- #28 Safe Browsing: off in Neeko ---
// This build has no Google key, so the Google lists already never download.
// These make it explicitly off (and make Settings say so). A browser that adds
// its own key turns them back on.

// No malware checks against Google's lists. Also turns off local download
// checks against those lists.
pref("browser.safebrowsing.malware.enabled", false);

// No phishing checks against Google's lists.
pref("browser.safebrowsing.phishing.enabled", false);

// --- #29 Download protection remote lookup ---

// Don't send details of downloaded programs to Google. Firefox's code doesn't
// check for a missing key here, so without this it would still try.
pref("browser.safebrowsing.downloads.remote.enabled", false);


// ===========================================================================
// LATER: your own servers, once you distribute. Off until then.
// ===========================================================================
// #33 App updates: --disable-updater in mozconfig. No pref can stop the
// update check.
// #5 Crash reports: --disable-crashreporter in mozconfig (and see above).
// #28 Safe Browsing: above. #25 Remote Settings mirror: stays on Mozilla's.

// --- #36 System add-on and language-pack updates ---

// Don't ask aus5.mozilla.org for updates to built-in system add-ons.
pref("extensions.systemAddon.update.enabled", false);

// Don't fetch language-pack updates alongside app updates.
pref("app.update.langpack.enabled", false);

// --- #19-20 Captive portal and connectivity checks ---

// No plain-HTTP probe to firefox-portal-detection.com when the network
// changes. Hotel and café login pages won't pop up by themselves; opening any
// page brings up the login screen.
pref("network.captive-portal-service.enabled", false);

// No connectivity probes (plain-HTTP requests to firefox-portal-detection.com
// and test DNS lookups).
pref("network.connectivity-service.enabled", false);

// --- #22 Push service ---

// No permanent connection to push.services.mozilla.com. Websites can't use
// Web Push, so no notifications while a site is closed (they still work while
// it's open). Remote Settings falls back to its daily check, so CRLite and the
// blocklists still update.
pref("dom.push.enabled", false);


// ===========================================================================
// Features that leak a little: approved defaults
// ===========================================================================

// --- #21 DNS-over-HTTPS ---

// Turn off Mozilla's regional DoH rollout, which would silently send every
// site name you look up to Cloudflare. Firefox uses system DNS unless the
// browser or the user picks a DoH provider (network.trr.mode stays at its
// default, 0).
pref("doh-rollout.enabled", false);

// --- #23 Speculative connections and prefetch ---
// Left at Firefox's defaults for now (later website-tracking item).

// --- #37 Codec and DRM plugins (OpenH264, Widevine) ---

// No OpenH264 (Cisco's H.264 codec for video calls). Video calls use another
// codec (VP8/VP9) where the site supports it.
pref("media.gmp-gmpopenh264.enabled", false);

// DRM off until a site needs it. Then Firefox shows its own "enable DRM"
// prompt, and saying yes downloads Widevine. Mozilla ships Linux this way.
// Don't lock this pref: Firefox hides the prompt when it's locked.
pref("media.eme.enabled", false);

// Don't ask Google's Chrome update service for Widevine. When DRM is on,
// Widevine comes from the download location in Mozilla's plugin list.
pref("media.gmp-widevinecdm.allow-chromium-update", false);

// No plugin updates, so no daily request to aus5.mozilla.org for the plugin
// list while nothing needs a plugin. NeekoPrivacy.sys.mjs turns this back on
// as soon as DRM is on, so saying yes to the "enable DRM" prompt installs
// Widevine and keeps it up to date.
pref("media.gmp-manager.updateEnabled", false);

// --- #38 Search suggestions and trending ---

// No search suggestions or trending searches in Firefox's (hidden) address bar
// and search fields. Nothing you type is sent to the search engine before you
// press Enter.
pref("browser.search.suggest.enabled", false);

// --- #40-41 Translations and AI features ---

// Turn off Firefox Translations: no language-model downloads, no translate
// offers.
pref("browser.translations.enable", false);

// Turn off the on-device machine-learning engine: no model downloads from
// model-hub.mozilla.org. This also stops the AI features built on it (link
// preview key points, smart tab groups, PDF alt-text).
pref("browser.ml.enable", false);

// Turn off the AI chatbot sidebar and its context-menu entries.
pref("browser.ml.chat.enabled", false);

// Turn off link previews (they fetch the linked page in the background).
pref("browser.ml.linkPreview.enabled", false);

// Show "Blocked" as the overall state in Settings > AI controls, to match the
// prefs above. Switching it to "Available" there turns translations, the
// chatbot and link previews back on. The on-device models also need
// browser.ml.enable set back to true.
pref("browser.ai.control.default", "blocked");

// --- #42 Accounts, Sync, Relay ---

// Turn off Firefox Accounts and Sync (there's no UI to sign in yet).
pref("identity.fxaccounts.enabled", false);

// Turn off Firefox Relay email masks: they aren't offered in password forms
// or shown in Settings.
pref("signon.firefoxRelay.feature", "");

// --- #18 Geolocation for websites ---
// Kept: nothing set. It only runs when you allow a site, through macOS
// location services.

// --- Remote debugging (not a connection) ---
// Off in shipped builds. Dev launches (`make run`) turn both back on for
// Firefox's Browser Toolbox.

// Don't let DevTools debug the browser itself (chrome code).
pref("devtools.chrome.enabled", false);

// Don't allow remote debugging connections (Browser Toolbox, about:debugging
// over the network).
pref("devtools.debugger.remote-enabled", false);
