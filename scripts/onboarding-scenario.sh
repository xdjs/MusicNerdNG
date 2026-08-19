#!/usr/bin/env bash
# Dev-only helper for iterating on the post-claim onboarding flow.
#
# Puts an artist into a known starting state so the onboarding chat can be
# replayed from the top without hand-writing SQL each time.
#
#   npm run onboarding -- <artist-name-or-uuid> [scenario] [--keep-progress]
#   npm run onboarding -- restore <artist-name-or-uuid>
#
# Scenarios (what the artist's platform links look like when the chat opens):
#   full         leave links exactly as they are (default)
#   deezer-only  keep Deezer, clear the rest — exercises profile discovery hardest
#   blank        clear every link — exercises the empty-state path
#
# Unless --keep-progress, this also clears onboarding step confirmations,
# interview answers, and the generated artist doc, and returns rejected vault
# sources to pending so there is something to curate again.
#
# Links are backed up before any clearing; `restore` puts them back.
set -euo pipefail
cd "$(dirname "$0")/.."

PROD_REF="cbabvmebugudeuylronz"   # never touch production
BACKUP_DIR=".superpowers/backups"
LINK_COLS="spotify deezer instagram tiktok x youtube youtubechannel soundcloud bandcamp twitch facebook linktree"

usage() { sed -n '2,20p' "$0" | sed 's/^# \?//'; exit "${1:-1}"; }
[ $# -ge 1 ] || usage
case "$1" in -h|--help|help) usage 0 ;; esac

CONN="$(grep '^SUPABASE_DB_CONNECTION' .env.local | cut -d= -f2- | tr -d '"')"
[ -n "$CONN" ] || { echo "No SUPABASE_DB_CONNECTION in .env.local" >&2; exit 1; }
case "$CONN" in
  *"$PROD_REF"*) echo "REFUSING: .env.local points at production ($PROD_REF)." >&2; exit 1 ;;
esac

q() { psql "$CONN" -t -A -c "$1"; }
sql_lit() { printf "'%s'" "${1//\'/\'\'}"; }

MODE="apply"
if [ "$1" = "restore" ]; then MODE="restore"; shift; [ $# -ge 1 ] || usage; fi

RAW="$1"; shift || true
if printf '%s' "$RAW" | grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-'; then
  ARTIST_ID="$RAW"
else
  ARTIST_ID="$(q "SELECT id FROM artists WHERE lower(name)=lower($(sql_lit "$RAW")) LIMIT 1;")"
fi
[ -n "$ARTIST_ID" ] || { echo "No artist matched '$RAW'" >&2; exit 1; }

NAME="$(q "SELECT coalesce(name,'(unnamed)') FROM artists WHERE id='$ARTIST_ID';")"
BACKUP="$BACKUP_DIR/links-$ARTIST_ID.json"

if [ "$MODE" = "restore" ]; then
  [ -f "$BACKUP" ] || { echo "No backup at $BACKUP" >&2; exit 1; }
  SET=""
  for c in $LINK_COLS; do
    v="$(python3 -c "import json;d=json.load(open('$BACKUP'));v=d.get('$c');print('' if v is None else v)")"
    if [ -n "$v" ]; then SET="$SET$c=$(sql_lit "$v"),"; else SET="$SET$c=NULL,"; fi
  done
  psql "$CONN" -q -c "UPDATE artists SET ${SET%,} WHERE id='$ARTIST_ID';"
  echo "Restored links for $NAME from $BACKUP"
  exit 0
fi

SCENARIO="full"; KEEP_PROGRESS=0
for arg in "$@"; do
  case "$arg" in
    full|deezer-only|blank) SCENARIO="$arg" ;;
    --keep-progress) KEEP_PROGRESS=1 ;;
    *) echo "Unknown argument: $arg" >&2; usage ;;
  esac
done

mkdir -p "$BACKUP_DIR"
SEL=""; for c in $LINK_COLS; do SEL="$SEL$c,"; done
q "SELECT row_to_json(t) FROM (SELECT ${SEL%,} FROM artists WHERE id='$ARTIST_ID') t;" > "$BACKUP"

if [ "$SCENARIO" != "full" ]; then
  SET=""
  for c in $LINK_COLS; do
    if [ "$SCENARIO" = "deezer-only" ] && [ "$c" = "deezer" ]; then continue; fi
    SET="$SET$c=NULL,"
  done
  psql "$CONN" -q -c "UPDATE artists SET ${SET%,} WHERE id='$ARTIST_ID';"
fi

if [ "$KEEP_PROGRESS" -eq 0 ]; then
  psql "$CONN" -q -c "DELETE FROM artist_onboarding_steps WHERE artist_id='$ARTIST_ID';
                      DELETE FROM artist_interview_answers WHERE artist_id='$ARTIST_ID';
                      DELETE FROM artist_docs WHERE artist_id='$ARTIST_ID';
                      UPDATE artist_vault_sources SET status='pending' WHERE artist_id='$ARTIST_ID' AND status='rejected';"
fi

LINKS="$(q "SELECT coalesce(string_agg(key,', '),'(none)') FROM jsonb_each_text(to_jsonb((SELECT a FROM artists a WHERE a.id='$ARTIST_ID'))) WHERE key = ANY(string_to_array('${LINK_COLS// /,}', ',')) AND value IS NOT NULL AND value <> '';")"
PENDING="$(q "SELECT count(*) FROM artist_vault_sources WHERE artist_id='$ARTIST_ID' AND status='pending';")"
CLAIM="$(q "SELECT coalesce((SELECT u.email FROM artist_claims c JOIN users u ON u.id=c.user_id WHERE c.artist_id='$ARTIST_ID' AND c.status='approved' LIMIT 1),'NONE — chat will not open');")"

cat <<EOF

  $NAME  ($ARTIST_ID)
  scenario         $SCENARIO
  links now        $LINKS
  pending sources  $PENDING
  claimed by       $CLAIM
  backup           $BACKUP
  restore with     npm run onboarding -- restore $ARTIST_ID

  https://localhost:3000/artist/$ARTIST_ID

EOF
