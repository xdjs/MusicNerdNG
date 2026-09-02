#!/usr/bin/env bash
# Dev-only helper for iterating on social-post ingestion + question quality.
#
# Resolves an artist name/uuid, runs Instagram ingestion (live via Apify, or
# from a local Apify dataset JSON file), then prints the derived signals and
# the generated grounded interview questions — so question quality can be
# reviewed without going through the onboarding UI.
#
#   npm run ingest-social -- <artist-name-or-uuid> <instagram-handle> [--limit N] [--max N]
#   npm run ingest-social -- <artist-name-or-uuid> <instagram-handle> --from-file /tmp/ig-deep.json
#
# --from-file bypasses Apify entirely (no cost, instant) — use it to iterate
# on signal/question quality against an already-fetched scrape.
set -euo pipefail
cd "$(dirname "$0")/.."

PROD_REF="cbabvmebugudeuylronz"   # never touch production

usage() { sed -n '2,14p' "$0" | sed 's/^# \?//'; exit "${1:-1}"; }
[ $# -ge 2 ] || usage
case "$1" in -h|--help|help) usage 0 ;; esac

CONN="$(grep '^SUPABASE_DB_CONNECTION' .env.local | cut -d= -f2- | tr -d '"')"
[ -n "$CONN" ] || { echo "No SUPABASE_DB_CONNECTION in .env.local" >&2; exit 1; }
case "$CONN" in
  *"$PROD_REF"*) echo "REFUSING: .env.local points at production ($PROD_REF)." >&2; exit 1 ;;
esac

q() { psql "$CONN" -t -A -c "$1"; }
sql_lit() { printf "'%s'" "${1//\'/\'\'}"; }

RAW="$1"; HANDLE="$2"; shift 2

if printf '%s' "$RAW" | grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-'; then
  ARTIST_ID="$RAW"
else
  ARTIST_ID="$(q "SELECT id FROM artists WHERE lower(name)=lower($(sql_lit "$RAW")) LIMIT 1;")"
fi
[ -n "$ARTIST_ID" ] || { echo "No artist matched '$RAW'" >&2; exit 1; }

NAME="$(q "SELECT coalesce(name,'(unnamed)') FROM artists WHERE id='$ARTIST_ID';")"
echo "Target: $NAME ($ARTIST_ID) — Instagram handle @$HANDLE"

npx tsx scripts/ingest-social.ts "$ARTIST_ID" "$HANDLE" "$@"
