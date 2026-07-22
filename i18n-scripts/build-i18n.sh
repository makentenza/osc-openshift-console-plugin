#!/usr/bin/env bash

set -exuo pipefail

# .claude holds Claude Code's task worktrees — full checkouts of this repo — so leaving them in
# scans a stale copy of every source file and resurrects strings this branch just removed.
FILE_PATTERN="{!(dist|node_modules|.claude)/**/*.{js,jsx,ts,tsx,json},*.{js,jsx,ts,tsx,json}}"

i18next "${FILE_PATTERN}" [-oc] -c "./i18next-parser.config.js" -o "locales/\$LOCALE/\$NAMESPACE.json"
