#!/usr/bin/env bash
set -euo pipefail

# Apply custom email templates to Supabase
# Requires SUPABASE_ACCESS_TOKEN from https://supabase.com/dashboard/account/tokens

PROJECT_REF="xurzogysgkvckvmjiibs"
API="https://api.supabase.com/v1/projects/$PROJECT_REF/config/auth"

if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ]; then
  echo "❌ Set SUPABASE_ACCESS_TOKEN env var."
  echo "   Get one at: https://supabase.com/dashboard/account/tokens"
  exit 1
fi

# Read the confirmation email template
CONFIRMATION_HTML=$(<"$(dirname "$0")/../email-templates/confirmation.html")

# Escape for JSON
escape_json() {
  python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))'
}

TEMPLATE_JSON=$(echo "$CONFIRMATION_HTML" | escape_json)
SUBJECT="Confirm your email — Orion"

echo "Applying email templates to project $PROJECT_REF..."

PAYLOAD=$(cat <<EOF
{
  "mailer_subjects_confirmation": $(echo "$SUBJECT" | escape_json),
  "mailer_templates_confirmation_content": $TEMPLATE_JSON
}
EOF
)

curl -s -X PATCH "$API" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD" \
  | python3 -m json.tool 2>/dev/null || echo "(raw response above)"

echo ""
echo "✅ Email templates applied."
echo "   Subject: $SUBJECT"
echo "   Template: email-templates/confirmation.html"
