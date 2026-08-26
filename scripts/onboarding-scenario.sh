#!/usr/bin/env bash
# Dev-only helper for iterating on the post-claim onboarding flow.
#
# Puts an artist into a known starting state so the onboarding chat can be
# replayed from the top without hand-writing SQL each time.
#
#   npm run onboarding -- <artist-name-or-uuid> [scenario] [--keep-progress] [--fresh]
#   npm run onboarding -- restore <artist-name-or-uuid>
#
# Scenarios (what the artist's platform links look like when the chat opens):
#   full         leave links exactly as they are (default)
#   deezer-only  keep Deezer, clear the rest — exercises profile discovery hardest
#   blank        clear every link — exercises the empty-state path
#
# Unless --keep-progress, this also clears onboarding step confirmations,
# interview answers, the generated artist doc, the artist's doc corrections, the
# credits and statements read out of their captions, and returns EVERY vault
# source to pending — approved ones too, since a source
# already approved is one the vault step won't ask about, and the point is to
# replay the step from the top.
#
# --fresh DELETES the vault sources instead of resetting them, so discovery
# genuinely runs again. Resetting to pending keeps the stored rows, and the
# unique index on (artist_id, url) means re-discovery quietly skips every URL it
# already has — so the scrape, the relevance judge and the publication dates all
# keep whatever they produced the first time. Use --fresh when the thing under
# test is discovery itself; the plain reset is for iterating on the chat.
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

SCENARIO="full"; KEEP_PROGRESS=0; FRESH=0
for arg in "$@"; do
  case "$arg" in
    full|deezer-only|blank) SCENARIO="$arg" ;;
    --keep-progress) KEEP_PROGRESS=1 ;;
    --fresh) FRESH=1 ;;
    *) echo "Unknown argument: $arg" >&2; usage ;;
  esac
done

mkdir -p "$BACKUP_DIR"
SEL=""; for c in $LINK_COLS; do SEL="$SEL$c,"; done
# Back up ONCE. Re-running a scenario would otherwise snapshot the already-cleared
# state over the original, so `restore` would put back the cleared links instead of
# the real ones — silently destroying the only copy of them. Delete the backup file
# by hand if the artist's real links have genuinely changed since.
if [ -f "$BACKUP" ]; then
  echo "  keeping existing link backup ($BACKUP)"
else
  q "SELECT row_to_json(t) FROM (SELECT ${SEL%,} FROM artists WHERE id='$ARTIST_ID') t;" > "$BACKUP"
fi

if [ "$SCENARIO" != "full" ]; then
  SET=""
  for c in $LINK_COLS; do
    if [ "$SCENARIO" = "deezer-only" ] && [ "$c" = "deezer" ]; then continue; fi
    SET="$SET$c=NULL,"
  done
  psql "$CONN" -q -c "UPDATE artists SET ${SET%,} WHERE id='$ARTIST_ID';"
fi

if [ "$KEEP_PROGRESS" -eq 0 ]; then
  # Corrections are progress too: they are the artist's answers about a document
  # that is about to be thrown away, and carrying them into a fresh run would
  # apply them to claims that no longer exist.
  # Caption credits are progress too. They are extracted once per ingest and
  # skipped if already present, so leaving them behind means a replayed run
  # silently reuses the last run's extraction instead of doing it again.
  # The scraped POSTS are deliberately kept: re-scraping costs an Apify run and
  # one to five minutes, and the extraction reads the stored posts anyway.
  psql "$CONN" -q -c "DELETE FROM artist_onboarding_steps WHERE artist_id='$ARTIST_ID';
                      DELETE FROM artist_interview_answers WHERE artist_id='$ARTIST_ID';
                      DELETE FROM artist_docs WHERE artist_id='$ARTIST_ID';
                      DELETE FROM artist_doc_corrections WHERE artist_id='$ARTIST_ID';
                      DELETE FROM artist_social_credits WHERE artist_id='$ARTIST_ID';"
  if [ "$FRESH" -eq 1 ]; then
    GONE="$(q "WITH d AS (DELETE FROM artist_vault_sources WHERE artist_id='$ARTIST_ID' RETURNING 1) SELECT count(*) FROM d;")"
    echo "  --fresh: deleted $GONE vault source(s); discovery will run again"
  else
    psql "$CONN" -q -c "UPDATE artist_vault_sources SET status='pending' WHERE artist_id='$ARTIST_ID';"
  fi
fi

# Pre-run vault discovery, mirroring production's approval-time discovery. The
# chat's own fallback discovery is bounded by a turn deadline, but a grounded
# search plus verification takes ~60s — longer than a turn can wait — so without
# this the walkthrough reaches the vault step before any source exists.
if [ "$KEEP_PROGRESS" -eq 0 ]; then
  PENDING_NOW="$(q "SELECT count(*) FROM artist_vault_sources WHERE artist_id='$ARTIST_ID' AND status='pending';")"
  if [ "$PENDING_NOW" -eq 0 ]; then
    echo "  running vault discovery (~60s, mirrors approval-time discovery)…"
    npx tsx scripts/discover-vault.ts "$ARTIST_ID" 2>&1 | tail -3
  fi
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
