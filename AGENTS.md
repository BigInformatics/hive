# Redeploy Hook

Use this to redeploy following a code push.

## Endpoint
- https://cp.biginformatics.net/api/deploy/compose/y-GQ66-yJTFF6Pee1Vubk

## Required headers + payload
Dokploy expects a GitHub-style push webhook shape.

Headers:
- `Content-Type: application/json`
- `X-GitHub-Event: repo:push`

Body (match the branch Dokploy is tracking):
```json
{"ref":"refs/heads/main"}
```

Example:
```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: repo:push' \
  -d '{"ref":"refs/heads/main"}' \
  https://cp.biginformatics.net/api/deploy/compose/y-GQ66-yJTFF6Pee1Vubk
```
