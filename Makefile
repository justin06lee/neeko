# Neeko's build entry point. A bare `make` sets everything up on first run
# (bun deps, Firefox source), applies Neeko's changes, builds, and launches
# the browser with a throwaway dev profile.

SURFER := bun run --silent surfer
ENGINE := engine

.PHONY: all build run update stop deps firefox import

all: build run

build: import
	$(SURFER) build

# Same `mach run` that `surfer run` wraps, pointed at the custom UI in ui/.
run:
	cd $(ENGINE) && ./mach run --setpref neeko.ui.path=$(CURDIR)/ui

# Quit a running dev build, rebuild, and relaunch it.
update: stop build run

# The [e] keeps pkill from matching this shell's own command line.
stop:
	-pkill -f '$(CURDIR)/[e]ngine/obj-[^/]*/dist/'

import: firefox
	$(SURFER) import

firefox: deps
	@test -f $(ENGINE)/toolkit/moz.build || $(SURFER) download

deps:
	@bun install --frozen-lockfile
