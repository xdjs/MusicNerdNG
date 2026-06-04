#!/usr/bin/env bash
set -euo pipefail

# Quick progress checker — run from any SSH session.
# No need to reattach tmux.
# Only looks at top-level logs in LOG_DIR (ignores old/ subdirectory).

LOG_DIR="${LOG_DIR:-/var/log/id-mapping}"

if [[ ! -d "$LOG_DIR" ]]; then
  echo "No log directory found at $LOG_DIR"
  exit 1
fi

total_runs=$(find "$LOG_DIR" -maxdepth 1 -name '*-run-*.log' -type f | wc -l | tr -d ' ')
successful_runs=$(find "$LOG_DIR" -maxdepth 1 -name '*-run-*.log' -type f -exec grep -l 'ID Mapping Session Report' {} + 2>/dev/null | wc -l | tr -d ' ')
failed_runs=$((total_runs - successful_runs))

# Count active workers (log files with activity in last 10 min)
active_workers=$(find "$LOG_DIR" -maxdepth 1 -name '*-run-*.log' -type f -mmin -10 2>/dev/null | wc -l | tr -d ' ')

echo "========================================"
echo " ID Mapping — Progress Report"
echo "========================================"
echo " Log dir:         $LOG_DIR"
echo " Total runs:      $total_runs"
echo " Successful:      $successful_runs"
echo " Failed:          $failed_runs"
echo " Active (10min):  $active_workers"
echo ""

# Sum resolved across all runs (only top-level logs)
if [[ $successful_runs -gt 0 ]]; then
  total_resolved=$(grep -ohE '\*?\*?Resolved\*?\*?:\*?\*?[[:space:]]+\*?\*?[0-9]+\*?\*?[[:space:]]+total' "$LOG_DIR"/*-run-*.log 2>/dev/null | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')
  total_excluded=$(grep -ohE '\*?\*?Excluded\*?\*?:\*?\*?[[:space:]]+\*?\*?[0-9]+\*?\*?[[:space:]]+total' "$LOG_DIR"/*-run-*.log 2>/dev/null | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')
  total_conflicts=$(grep -ohE '\*?\*?Conflicts[^:]*\*?\*?:\*?\*?[[:space:]]+[0-9]+' "$LOG_DIR"/*-run-*.log 2>/dev/null | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')
  total_name_mismatches=$(grep -ohE '\*?\*?Name mismatches\*?\*?:\*?\*?[[:space:]]+[0-9]+' "$LOG_DIR"/*-run-*.log 2>/dev/null | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')
  total_ambiguous=$(grep -ohE '\*?\*?Too ambiguous\*?\*?:\*?\*?[[:space:]]+[0-9]+' "$LOG_DIR"/*-run-*.log 2>/dev/null | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')
  total_errors=$(grep -ohE '\*?\*?Errors\*?\*?:\*?\*?[[:space:]]+[0-9]+' "$LOG_DIR"/*-run-*.log 2>/dev/null | grep -oE '[0-9]+' | awk '{s+=$1} END {print s+0}')
  total_skipped=$(grep -ohE '\*?\*?Skipped/Unresolved[^:]*\*?\*?:\*?\*?[[:space:]]+[0-9]+' "$LOG_DIR"/*-run-*.log 2>/dev/null | grep -oE '[0-9]+$' | awk '{s+=$1} END {print s+0}')

  echo " Total resolved:  $total_resolved"
  echo " Total excluded:  $total_excluded"
  echo "   Conflicts:     $total_conflicts"
  echo "   Name mismatch: $total_name_mismatches"
  echo "   Too ambiguous: $total_ambiguous"
  echo " Total skipped:   $total_skipped"
  echo " Total errors:    $total_errors"
  echo ""

  # Estimate completion
  if [[ $total_resolved -gt 0 && $successful_runs -gt 0 ]]; then
    rate=$(echo "$total_resolved / $successful_runs" | bc -l 2>/dev/null | xargs printf "%.1f" 2>/dev/null || echo "?")
    echo " Avg resolved/run: $rate"

    # Try to find remaining count from last successful run
    last_log=$(find "$LOG_DIR" -maxdepth 1 -name '*-run-*.log' -type f -exec grep -l 'ID Mapping Session Report' {} + 2>/dev/null | sort | tail -1)
    if [[ -n "$last_log" ]]; then
      remaining=$(grep -oE 'totalUnmapped.*?[0-9]+' "$last_log" 2>/dev/null | grep -oE '[0-9]+' | tail -1 || true)
      if [[ -n "$remaining" && "$remaining" =~ ^[0-9]+$ && "$remaining" -gt 0 && "$rate" != "?" ]]; then
        runs_left=$(echo "$remaining / $rate" | bc -l 2>/dev/null | xargs printf "%.0f" 2>/dev/null || echo "?")
        echo " Remaining:        ~$remaining artists"
        echo " Est. runs left:   ~$runs_left"
      fi
    fi
  fi
fi

echo ""

# Per-worker breakdown
worker_ids=$(find "$LOG_DIR" -maxdepth 1 -name '*-run-*.log' -type f | xargs -I{} basename {} | sed 's/-run-.*//' | sort -u)
if [[ -n "$worker_ids" ]] && [[ $(echo "$worker_ids" | wc -l) -gt 1 ]]; then
  echo "--- Per-Worker Breakdown ---"
  for wid in $worker_ids; do
    w_total=$(find "$LOG_DIR" -maxdepth 1 -name "${wid}-run-*.log" -type f | wc -l | tr -d ' ')
    w_success=$(grep -l 'ID Mapping Session Report' "$LOG_DIR"/${wid}-run-*.log 2>/dev/null | wc -l | tr -d ' ' || echo 0)
    w_last=$(find "$LOG_DIR" -maxdepth 1 -name "${wid}-run-*.log" -type f | sort | tail -1)
    w_time=""
    if [[ -n "$w_last" ]]; then
      w_time=$(stat -c '%Y' "$w_last" 2>/dev/null || stat -f '%m' "$w_last" 2>/dev/null || echo "")
      if [[ -n "$w_time" ]]; then
        w_time=$(date -d "@$w_time" '+%H:%M:%S' 2>/dev/null || date -r "$w_time" '+%H:%M:%S' 2>/dev/null || echo "")
      fi
    fi
    echo "  $wid: $w_success/$w_total runs${w_time:+ (last: $w_time)}"
  done
  echo ""
fi

# Last run details per worker
for wid in $(find "$LOG_DIR" -maxdepth 1 -name '*-run-*.log' -type f | xargs -I{} basename {} | sed 's/-run-.*//' | sort -u); do
  last_log=$(find "$LOG_DIR" -maxdepth 1 -name "${wid}-run-*.log" -type f | sort | tail -1)
  if [[ -n "$last_log" ]]; then
    echo "--- Last Run ($wid): $(basename "$last_log") ---"

    if grep -q 'ID Mapping Session Report' "$last_log" 2>/dev/null; then
      grep -A 30 'ID Mapping Session Report' "$last_log" | head -30
    else
      echo "(no session report — run may have failed)"
      tail -5 "$last_log"
    fi
    echo ""
  fi
done

echo "========================================"
