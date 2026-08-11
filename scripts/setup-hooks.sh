#!/bin/sh
# Point git at the versioned hooks in .githooks/.
#
# .git/hooks is not tracked, so hooks committed to a repo do nothing until git
# is told where to look. Run this once per clone.
set -e
git config core.hooksPath .githooks
echo "core.hooksPath -> .githooks"
echo "Direct commits to main and staging will now be refused; merges still work."
