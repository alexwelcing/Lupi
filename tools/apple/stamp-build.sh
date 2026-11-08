#!/bin/sh
# Runs during every app build. Records only a Git object id, source state and UTC time.
# Usage: stamp-build.sh <built-app-resource>/LupiBuildIdentity.json [repository]
set -eu

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  echo 'Usage: stamp-build.sh <output.json> [repository]' >&2
  exit 2
fi
stamp_output=$1
stamp_repo=${2:-$(CDPATH='' cd -- "$(dirname -- "$0")/../.." && pwd)}
stamp_revision=null
stamp_state=unknown

if stamp_head=$(git -C "$stamp_repo" rev-parse --verify HEAD 2>/dev/null); then
  case "$stamp_head" in
    *[!0-9a-fA-F]*|'') ;;
    *)
      if [ "${#stamp_head}" -eq 40 ] || [ "${#stamp_head}" -eq 64 ]; then
        stamp_revision="\"$stamp_head\""
        if stamp_changes=$(git -C "$stamp_repo" status --porcelain --untracked-files=all 2>/dev/null); then
          stamp_state=clean
          if [ -n "$stamp_changes" ]; then stamp_state=dirty; fi
        fi
      fi
      ;;
  esac
fi

stamp_time=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
mkdir -p "$(dirname -- "$stamp_output")"
stamp_temporary=$(mktemp "$stamp_output.tmp.XXXXXX")
trap 'rm -f "$stamp_temporary"' EXIT HUP INT TERM
printf '{"schemaVersion":1,"revision":%s,"workTree":"%s","builtAt":"%s"}\n' \
  "$stamp_revision" "$stamp_state" "$stamp_time" > "$stamp_temporary"
mv -f "$stamp_temporary" "$stamp_output"
