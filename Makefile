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

.PHONY: all build run release install uninstall linux-only update stop deps config firefox import configure

all: build run

# Dev build: an artifact build (Mozilla's prebuilt C++/Rust, about 30s).
build: configure
	$(MACH) build

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
release: configure
	@test "$(RUST_LTO)" = 1 || echo "neeko: $(MEM_GB) GB of memory, so skipping Rust LTO (RUST_LTO=1 forces it)."
	cd $(ENGINE) && $(if $(filter 0,$(RUST_LTO)),$(NO_RUST_LTO)) NEEKO_FULL_BUILD=1 ./mach build -j$(RELEASE_JOBS)
	cd $(ENGINE) && NEEKO_FULL_BUILD=1 ./mach package
	bun tools/app.ts dist $(APP)

# Linux: installs the app for this user from the dev build, packaged (no
# hours-long full build): the program in ~/.local/share/<name>/app, a launcher
# in ~/.local/bin that always gives it the app's own profile
# (~/.local/share/<name>/profile), a desktop entry and icons. Running it again
# updates it in place, profile untouched; `make uninstall` removes all but the
# profile.
install: $(if $(LINUX),build,linux-only)
	cd $(ENGINE) && ./mach package
	bun tools/app.ts install $(APP)

uninstall: $(if $(LINUX),,linux-only)
	bun tools/app.ts uninstall $(APP)

linux-only:
	@echo "neeko: make install is for Linux. On macOS, make release makes the app in dist/." >&2
	@false

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
