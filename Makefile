# Neeko's build entry point. A bare `make` sets everything up on first run
# (bun deps, Firefox source), applies Neeko's changes, builds, and launches
# the browser with a throwaway dev profile.
#
# It builds an app: a folder with browser.json (name, vendor, app id,
# version), ui/ and branding/. By default that's Neeko's own demo app, this
# folder. A browser built on Neeko keeps Neeko as a submodule and runs
# `make -C neeko APP=$(CURDIR) ...` from its own Makefile (docs/using-neeko.md).

APP ?= $(CURDIR)
SURFER := bun run --silent surfer
ENGINE := engine
MACH := cd $(ENGINE) && ./mach

# Full builds on smaller machines (docs/lessons.md):
# - Parallel jobs: one per 2 GB of memory, at most one per core. mach's
#   default (one per core) made an 8 GB machine swap for hours.
# - Rust LTO: Firefox optimizes all its Rust code together in one step that
#   needs about 10 GB. Below 16 GB it's skipped (RUST_LTO=0): the browser is
#   the same, its Rust code a little bigger and slower. RUST_LTO=1 forces it.
ifeq ($(shell uname -s),Linux)
LINUX := 1
MEM_GB := $(shell awk '/^MemTotal:/ { print int($$2 / 1048576) }' /proc/meminfo)
CPUS := $(shell nproc)
else
MEM_GB := $(shell echo $$(( $$(sysctl -n hw.memsize 2>/dev/null || echo 17179869184) / 1073741824 )))
CPUS := $(shell sysctl -n hw.ncpu 2>/dev/null || echo 8)
endif
RELEASE_JOBS := $(shell jobs=$$(( $(MEM_GB) / 2 < $(CPUS) ? $(MEM_GB) / 2 : $(CPUS) )); \
	echo $$(( jobs > 0 ? jobs : 1 )))
RUST_LTO ?= $(shell test $(MEM_GB) -ge 16 && echo 1 || echo 0)
# cargo_rustc_flags is where Firefox's config/makefiles/rust.mk adds -Clto.
NO_RUST_LTO := MAKEFLAGS=" -- cargo_rustc_flags="

.PHONY: all build run release install uninstall linux-only wipe update stop deps config firefox import configure

all: build run

# Dev build: an artifact build (Mozilla's prebuilt C++/Rust, about 30s).
# mach assembles the .app afresh every time, so the app's helpers are linked
# into it after (tools/app.ts helpers).
build: configure
	$(MACH) build
	bun tools/app.ts helpers $(APP)

# Same `mach run` that `surfer run` wraps, pointed at the app's UI and pages
# folders, so changes only need a relaunch. The app's pages run in a content
# process, whose sandbox would refuse Neeko's files (the build links to them
# in src/) and the pages folder, so dev launches let it read those two (each
# system's sandbox has its own prefs; Linux's is one list, folders ending in
# a slash). Dev launches also allow Firefox's Browser Toolbox, which Neeko's
# privacy defaults turn off for shipped browsers.
ifdef LINUX
SANDBOX_READS := --setpref security.sandbox.content.read_path_whitelist=$(realpath $(CURDIR))/src/,$(abspath $(APP))/pages/
else
SANDBOX_READS := --setpref security.sandbox.content.mac.testing_read_path1=$(realpath $(CURDIR))/src \
	--setpref security.sandbox.content.mac.testing_read_path2=$(abspath $(APP))/pages
endif

run:
	$(MACH) run --setpref neeko.ui.path=$(abspath $(APP))/ui \
		--setpref neeko.pages.path=$(abspath $(APP))/pages \
		$(SANDBOX_READS) \
		--setpref devtools.chrome.enabled=true \
		--setpref devtools.debugger.remote-enabled=true \
		--setpref devtools.debugger.prompt-connection=false

# Release build: everything compiled from source (hours), so the program
# carries the app's own name and profile folder, then packaged into the app's
# dist/ folder as <Name>.app and <name>-<version>.dmg. Its build files live in
# engine/obj-release, apart from the dev build's.
#
# A new app version alone would recompile all of Firefox's C/C++: it's a
# line in the build folder's config/autoconf.mk, which every C/C++ object
# depends on (Firefox's config/rules.mk), as is the PATH configure ran with,
# which changes with the shell. So configure runs first, and where those two
# lines are all that changed, the file keeps its old time. The version
# reaches compiled code only through its own folders' build files (their
# backend.mk), which rebuild them anyway, and tools/test_release.py checks it
# in About; the compilers are their own lines, full paths. Anything else
# that changed is listed, and everything recompiles.
AUTOCONF := $(ENGINE)/obj-release/config/autoconf.mk
UNCOMPILED := ^(MOZ_APP_VERSION_DISPLAY|PATH) =
release: configure
	@test "$(RUST_LTO)" = 1 || echo "neeko: $(MEM_GB) GB of memory, so skipping Rust LTO (RUST_LTO=1 forces it)."
	@test ! -f $(AUTOCONF) || cp -p $(AUTOCONF) $(AUTOCONF).before
	cd $(ENGINE) && NEEKO_FULL_BUILD=1 ./mach configure
	@if test -f $(AUTOCONF).before && ! cmp -s $(AUTOCONF) $(AUTOCONF).before; then \
		if test "$$(grep -Ev '$(UNCOMPILED)' $(AUTOCONF))" = "$$(grep -Ev '$(UNCOMPILED)' $(AUTOCONF).before)"; then \
			touch -r $(AUTOCONF).before $(AUTOCONF); \
			echo "neeko: only the app's version (and PATH) changed in the build's config, so Firefox's C/C++ isn't recompiled."; \
		else \
			echo "neeko: the build's config changed, so all of Firefox's C/C++ recompiles:"; \
			diff $(AUTOCONF).before $(AUTOCONF) | grep '^[<>]' | cut -c1-160; \
		fi; \
	fi; rm -f $(AUTOCONF).before
	cd $(ENGINE) && $(if $(filter 0,$(RUST_LTO)),$(NO_RUST_LTO)) NEEKO_FULL_BUILD=1 ./mach build -j$(RELEASE_JOBS)
	cd $(ENGINE) && NEEKO_FULL_BUILD=1 ./mach package
	bun tools/app.ts dist $(APP)

# Linux: installs the app for this user from the dev build, packaged (no
# hours-long full build): the program in ~/.local/share/<name>/app, a launcher
# in ~/.local/bin that runs it as the app (its own profiles, in
# ~/.config/mozilla/<name>), a desktop entry and icons. Running it again
# updates it in place, profiles untouched; `make uninstall` removes all but
# the profiles. The program is packaged (staged: no archive to compress),
# quietly: mach would announce it on the desktop.
install: $(if $(LINUX),build,linux-only)
	cd $(ENGINE) && MOZ_NOSPAM=1 ./mach build browser/installer/stage-package
	bun tools/app.ts install $(APP)

uninstall: $(if $(LINUX),,linux-only)
	bun tools/app.ts uninstall $(APP)

linux-only:
	@echo "neeko: make install is for Linux. On macOS, make release makes the app in dist/." >&2
	@false

# Deletes all of the app's data for this user, so its next launch is a first
# launch: its profiles and caches, what macOS keeps for it, its secrets in
# the keychain, and the dev build's profile, which `make` reuses. Never while
# it runs. It asks first; YES=1 doesn't.
wipe:
	bun tools/app.ts wipe $(APP) $(if $(YES),--yes)

# Quit a running dev build, rebuild, and relaunch it.
update: stop build run

# Quits this checkout's dev build: the browser and its child processes, run
# from engine/obj-*/dist/ (its .app on macOS, bin/firefox on Linux). Only
# command lines that start with them: a running build's compilers name
# dist/include in theirs, and packaging runs other tools from dist/
# (xpcshell). tools/app.ts (appRunning) matches the same.
DEV_BUILD := ^$(CURDIR)/engine/obj-[^/]*/dist/([^/]*\.app/Contents/MacOS/(firefox|[^/]*\.app/)|bin/(firefox|plugin-container))
stop:
	-pkill -f '$(DEV_BUILD)'

# The app's branding folder, then Surfer's mozconfig. Surfer's own build step
# only writes the mozconfig here (SURFER_MOZCONFIG_ONLY); mach does the build.
configure: import
	bun tools/app.ts branding $(APP)
	@$(SURFER) set brand release >/dev/null
	SURFER_MOZCONFIG_ONLY=1 $(SURFER) build

import: firefox
	$(SURFER) import

firefox: config
	@test -f $(ENGINE)/toolkit/moz.build || $(SURFER) download

# surfer.json, from Neeko's Firefox pin (neeko.json) and the app's identity.
config: deps
	bun tools/app.ts config $(APP)

# Surfer's sharp builds itself against a system libvips where there is one
# (Arch Linux has it), which needs node-gyp; its own prebuilt libvips needs
# nothing (docs/lessons.md).
deps:
	@SHARP_IGNORE_GLOBAL_LIBVIPS=1 bun install --frozen-lockfile
