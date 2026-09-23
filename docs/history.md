# How Neeko got here

The user's original task lists, verbatim, and where each step landed. Neeko
was built one step at a time, with each step explained and checked with the
user before the next. The rules that came out of them live in
[CLAUDE.md](../CLAUDE.md), the design in [ARCHITECTURE.md](../ARCHITECTURE.md),
what's next in [ROADMAP.md](../ROADMAP.md).

## Setup track

1. Research Surfer (Zen Browser's tool for building Firefox forks) and set up
   this repo with it, pinned to a current stable Firefox version. Use artifact
   builds if possible. Build and run plain Firefox through Surfer to confirm it
   works. **Done.**
2. Research how Firefox's frontend is wired (browser.xhtml,
   tabbrowser/gBrowser, how the page content area works, how permission
   prompts and panels attach to UI). Then give me 2-3 options for how Neeko
   should hide Firefox's UI and replace it, with pros/cons for each (e.g. keep
   Firefox's logic running invisibly vs. replacing it). Pay special attention
   to which option keeps Firefox updates easy. Wait for me to choose. **Done:
   A, hide and plug.**
3. Implement the chosen approach: Firefox UI hidden, a blank custom UI loaded
   from a clearly separated folder, and one web page showing in a content area
   the custom UI can position freely. **Done.**
4. Create the first tiny version of the Neeko API: tabs (list, open, close,
   select, change events) and navigation (go to URL, back, forward, reload,
   current URL/title, loading state). Nothing more. **Done: `docs/api.md`,
   checked by `tools/test_api.py`.**
5. Build a minimal demo UI using only the API: a tab list and an address bar.
   Ugly is fine. It just proves the bridge works. **Done: `ui/`, named "the
   demo UI" in the component library.**
6. Propose how a separate browser project (mine) should use Neeko, e.g.
   template repo, layered patches, or something else, keeping in mind that
   Neeko and my browser must both be easy to update. **Done:
   `docs/using-neeko.md`. Neeko is a pinned git submodule in the browser's
   repo; builds take an app folder (`tools/app.ts`), `make release` does
   full builds and packages, and `tools/new-browser.ts` starts a browser
   repo.**
7. Create these files:
   - CLAUDE.md: rules for all future work.
   - ARCHITECTURE.md: how the layers connect, in plain language.
   - ROADMAP.md: an ordered checklist of API features to add one at a time,
     most essential first (e.g. permission fallbacks, context menus,
     downloads, history, bookmarks, find-in-page, devtools, extensions UI,
     fullscreen, etc.).

   **Done: `CLAUDE.md` (with the user's rules verbatim), `ARCHITECTURE.md`,
   `ROADMAP.md`. They replaced the running build plan (`docs/plan.md`);
   its lessons moved to `docs/lessons.md`.**

## Privacy track

> Next task for Neeko: privacy by default. No telemetry or usage data may ever
> be sent to Mozilla (or anyone else) from any browser built on Neeko,
> starting from the very first launch. Browsers built on Neeko must inherit
> this automatically, with no extra setup.
>
> RULES FOR THIS TASK
> - Do NOT edit Firefox's own default pref files (e.g. all.js, firefox.js) or
>   other Firefox files. All changes must live in Neeko's own layers (build
>   config, Neeko's prefs files, and only if truly necessary, small
>   clearly-marked patches) so Firefox updates stay easy.
> - Verify every pref and build flag name against the current Firefox source.
>   Don't trust pref lists from memory or AI chats; many are outdated or made
>   up.
>
> DO THESE STEPS ONE AT A TIME, EXPLAIN EACH IN PLAIN LANGUAGE, AND CHECK WITH
> ME BEFORE MOVING ON:
>
> 1. INVENTORY: Research every way current Firefox connects to Mozilla or
>    third-party services (telemetry, Glean, crash reporter,
>    studies/experiments, Remote Settings, Safe Browsing, captive portal and
>    connectivity checks, sponsored content/suggestions, Pocket, push service,
>    DNS-over-HTTPS defaults, geolocation, search suggestions, add-on updates,
>    app updates, anything else). Use Betterfox, arkenfox, LibreWolf, and Zen's
>    prefs as reference sources. Give me a table: what it is, what data it
>    sends, where, and whether it's tracking or a security feature. **Done:
>    `docs/privacy/inventory.md`.**
> 2. DECISIONS: Sort the table into three groups and wait for my approval:
>    - KILL: pure telemetry/tracking (disable completely)
>    - KEEP/REPLACE: security features (e.g. certificate revocation, malicious
>      extension blocklists, Safe Browsing), with options for keeping,
>      self-hosting, or making them opt-in, and the privacy vs. security
>      tradeoff of each
>    - LATER: things that will point to my own servers once I distribute (e.g.
>      app updates)
>
>    **Done: `docs/privacy/decisions.md`, approved as proposed on
>    2026-09-23.**
> 3. IMPLEMENT: Apply the approved decisions using build flags in mozconfig
>    and a dedicated Neeko privacy prefs file. Organize it with a comment on
>    every pref explaining what it does. Explain whether enterprise policies
>    (policies.json) are worth using and their downsides (e.g. "managed by
>    your organization" message).
>
>    **Done: `docs/privacy/implementation.md`.**
> 4. VERIFY: Create an automated privacy test that:
>    - launches the browser with a FRESH profile (first launch matters)
>    - routes all traffic through a local proxy (e.g. mitmproxy)
>    - idles for a few minutes, then visits a few normal websites
>    - lists every domain contacted and FAILS if any request goes to
>      telemetry/tracking endpoints from the KILL list
>
>    Also check about:telemetry and about:glean show nothing uploaded.
>
>    **Done: `tools/test_privacy.py` (see `docs/privacy/implementation.md`).**
> 5. DOCUMENT:
>    - PRIVACY.md: every connection the browser makes and why, in plain
>      language, suitable for showing to users.
>    - Add to CLAUDE.md: after every Firefox version update, re-run the privacy
>      test and re-check the reference sources (Betterfox, LibreWolf, etc.) for
>      newly added telemetry. Any new feature added to Neeko must not introduce
>      outgoing connections without my approval.
>    - Add to ROADMAP.md: a later, separate item for protection against WEBSITE
>      tracking (tracking protection, fingerprinting resistance), since that's
>      a different problem from Mozilla telemetry.
>
>    **Done: `PRIVACY.md`, the rule in `CLAUDE.md`, and the website-tracking
>    item in `ROADMAP.md`.**
