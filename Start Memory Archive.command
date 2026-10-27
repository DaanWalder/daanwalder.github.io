#!/bin/bash
# Double click to start the Memory Archive. Close this window to stop it.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  Node.js is needed to run the archive (version 18 or newer)."
  echo "  Install it from https://nodejs.org (the LTS version), then double click this file again."
  echo ""
  open "https://nodejs.org"
  read -n 1 -s -r -p "  Press any key to close."
  exit 1
fi
(sleep 1; open "http://localhost:${PORT:-4321}") &
node server.js
