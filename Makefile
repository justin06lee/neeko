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

.PHONY: all build run release update stop deps config firefox import configure

all: build run

# Dev build: an artifact build (Mozilla's prebuilt C++/Rust, about 30s).
build: configure
	$(MACH) build

# Same `mach run` that `surfer run` wraps, pointed at the app's UI folder, so
# UI changes only need a relaunch. Dev launches also allow Firefox's Browser
# Toolbox, which Neeko's privacy defaults turn off for shipped browsers.
run:
	$(MACH) run --setpref neeko.ui.path=$(abspath $(APP))/ui \
		--setpref devtools.chrome.enabled=true \
		--setpref devtools.debugger.remote-enabled=true \
		--setpref devtools.debugger.prompt-connection=false

# Release build: everything compiled from source (hours), so the program
# carries the app's own name and profile folder, then packaged into the app's
# dist/ folder as <Name>.app and <name>-<version>.dmg. Its build files live in
# engine/obj-release, apart from the dev build's.
release: configure
	cd $(ENGINE) && NEEKO_FULL_BUILD=1 ./mach build
	cd $(ENGINE) && NEEKO_FULL_BUILD=1 ./mach package
	bun tools/app.ts dist $(APP)

# Quit a running dev build, rebuild, and relaunch it.
update: stop build run

# The [e] keeps pkill from matching this shell's own command line.
stop:
	-pkill -f '$(CURDIR)/[e]ngine/obj-[^/]*/dist/'

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

deps:
	@bun install --frozen-lockfile
