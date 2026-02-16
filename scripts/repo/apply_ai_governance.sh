#!/usr/bin/env bash
set -euo pipefail

REPO="${1:-Prekzursil/AdrianaArt}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "Authenticate first: gh auth login" >&2
  exit 1
fi

declare -a LABELS=(
  "audit:deep|5319E7|Opt-in deep AI audit trigger for PRs."
  "audit:ux|0E8A16|UX audit finding."
  "audit:ia|1D76DB|Information architecture audit finding."
  "audit:seo|A371F7|SEO-related audit finding."
  "audit:correctness|B60205|Correctness or runtime quality finding."
  "surface:storefront|0969DA|Storefront-facing surface."
  "surface:account|1E9C48|Account/self-service surface."
  "surface:admin|C2E0C6|Admin/operations surface."
  "severity:s1|B60205|Critical severity finding."
  "severity:s2|D93F0B|High severity finding."
  "severity:s3|FBCA04|Medium severity finding."
  "severity:s4|0E8A16|Low severity finding."
  "ai:ready|0366D6|Ready for AI agent execution."
  "ai:in-progress|FBCA04|AI agent is processing."
  "ai:automerge|1D76DB|Eligible for guarded auto-merge lane."
  "ai:blocked|B60205|AI task blocked by policy or risk."
  "ai:done|0E8A16|AI task completed."
)

echo "Applying audit/AI labels to ${REPO}..."
for spec in "${LABELS[@]}"; do
  IFS="|" read -r name color description <<<"${spec}"
  gh label create "${name}" \
    --repo "${REPO}" \
    --color "${color}" \
    --description "${description}" \
    --force >/dev/null
done

echo "Applying checks-only branch protection baseline + audit evidence check..."
tmp_payload="$(mktemp)"
cat > "${tmp_payload}" <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Backend CI / backend (pull_request)",
      "Backend CI / backend-postgres (pull_request)",
      "Frontend CI / frontend (pull_request)",
      "Docker Compose Smoke / compose-smoke (pull_request)",
      "Audit PR Evidence / audit-pr-evidence (pull_request)"
    ]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
JSON

gh api \
  --method PUT \
  "repos/${REPO}/branches/main/protection" \
  -H "Accept: application/vnd.github+json" \
  --input "${tmp_payload}" >/dev/null
rm -f "${tmp_payload}"

echo "Done."
echo "Verify with:"
echo "  gh api repos/${REPO}/branches/main/protection --jq '.required_status_checks.contexts'"
