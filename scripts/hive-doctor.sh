#!/usr/bin/env bash
# hive doctor — CLI wrapper around /api/doctor
set -euo pipefail

# Load token
if [ -f "$HOME/.openclaw/.env" ]; then
  source "$HOME/.openclaw/.env" 2>/dev/null
fi
if [ -f "/etc/clawdbot/vault.env" ]; then
  source "/etc/clawdbot/vault.env" 2>/dev/null
fi

BASE_URL="${HIVE_API_URL:-https://hello.biginformatics.com/api}"
TOKEN="${HIVE_TOKEN:-}"
VERBOSE=false
JSON=false
ADMIN=false

usage() {
  echo "Usage: hive-doctor [--json] [--verbose] [--admin]"
  echo "  --json      Raw JSON output"
  echo "  --verbose   Show per-probe details"
  echo "  --admin     Include admin probes (requires admin token)"
  exit 0
}

for arg in "$@"; do
  case "$arg" in
    --json) JSON=true ;;
    --verbose) VERBOSE=true ;;
    --admin) ADMIN=true ;;
    --help|-h) usage ;;
  esac
done

# Preflight
if [ -z "$TOKEN" ]; then
  echo "❌ HIVE_TOKEN not set. Set it in ~/.openclaw/.env or export it."
  exit 1
fi

# Validate URL is parseable
if ! echo "$BASE_URL" | grep -qE '^https?://'; then
  echo "❌ Invalid HIVE_API_URL: $BASE_URL"
  exit 1
fi

# Run doctor
ENDPOINT="$BASE_URL/doctor"
if [ "$ADMIN" = true ]; then
  ENDPOINT="$BASE_URL/doctor/admin"
fi

RESPONSE=$(curl -sS -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" "$ENDPOINT" 2>&1)

if [ "$JSON" = true ]; then
  echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"
  exit 0
fi

# Pretty print
STATUS=$(echo "$RESPONSE" | jq -r '.status // "unknown"' 2>/dev/null)
TOTAL_MS=$(echo "$RESPONSE" | jq -r '.totalDurationMs // "?"' 2>/dev/null)

case "$STATUS" in
  pass) echo "✅ All checks passed (${TOTAL_MS}ms)" ;;
  warn) echo "⚠️  Some warnings (${TOTAL_MS}ms)" ;;
  fail) echo "❌ Failures detected (${TOTAL_MS}ms)" ;;
  *) echo "❓ Unknown status: $STATUS"; echo "$RESPONSE"; exit 1 ;;
esac

echo ""

# Print probes
echo "$RESPONSE" | jq -r '.probes[]? | 
  (if .status == "pass" then "  ✅" elif .status == "warn" then "  ⚠️ " else "  ❌" end) + 
  " " + .name + " — " + .summary + " (" + (.durationMs|tostring) + "ms)"' 2>/dev/null

if [ "$VERBOSE" = true ]; then
  DETAILS=$(echo "$RESPONSE" | jq -r '.probes[]? | select(.details != null) | "  → " + .name + ": " + .details' 2>/dev/null)
  if [ -n "$DETAILS" ]; then
    echo ""
    echo "Details:"
    echo "$DETAILS"
  fi
fi

# Warnings/errors summary
WARNINGS=$(echo "$RESPONSE" | jq -r '.warnings[]?' 2>/dev/null)
ERRORS=$(echo "$RESPONSE" | jq -r '.errors[]?' 2>/dev/null)

if [ -n "$ERRORS" ]; then
  echo ""
  echo "Errors:"
  echo "$ERRORS" | while read -r line; do echo "  ❌ $line"; done
fi

if [ -n "$WARNINGS" ]; then
  echo ""
  echo "Warnings:"
  echo "$WARNINGS" | while read -r line; do echo "  ⚠️  $line"; done
fi
