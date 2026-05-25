#!/bin/bash
# Wrapper so LaunchAgent works regardless of which nvm node version is active.
export NVM_DIR="$HOME/.nvm"
# shellcheck source=/dev/null
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
exec node /Users/miqueladell/code/mission-control/server.js
