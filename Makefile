# Neeko's build entry point. A bare `make` sets everything up on first run
# (bun deps, Firefox source), applies Neeko's changes, builds, and launches
# the browser with a throwaway dev profile.

SURFER := bun run --silent surfer
ENGINE := engine

.PHONY: all build run update stop deps firefox import

all: build run

build: import
	$(SURFER) build

# Mozilla's prebuilt binaries look for helper apps named "Firefox GPU Helper"
# and "Firefox Media Plugin Helper", but our build names them after its own
# brand. These prefs make Firefox use plugin-container for those processes
# instead. (They move into Neeko's own default prefs once Neeko has a prefs
# file; this is the same `mach run` that `surfer run` wraps.)
RUN_PREFS := --setpref layers.gpu-process-executable.enabled=false \
             --setpref media.plugin_helper_process.enabled=false

run:
	cd $(ENGINE) && ./mach run $(RUN_PREFS)

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
