# AGENTS.md — Hive Development Guide

## ⚠️ Git Workflow (READ THIS FIRST)

Hive is **open source**. We follow a strict branching strategy:

### Branches
- **`dev`** — Active development branch. All agent work happens here.
- **`main`** — Release branch. Only updated via reviewed PRs from `dev`.
- **Feature branches** — Branch off `dev` for larger features: `feature/my-thing`

### Where to push
- **OneDev** (`origin`): Push to `dev` (or feature branches). This is the team's working repo at `dev.biginformatics.net`.
- **GitHub** (`github`): The `dev` branch is also pushed to GitHub for visibility.
- **Never push directly to `main`**. Always go through a PR.

### Deployment
- **Dokploy deploys from `dev` on OneDev** (not main, not GitHub).
- Deploy trigger after pushing to `dev`:

```bash
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: repo:push' \
  -d '{"ref":"refs/heads/dev"}' \
  https://cp.biginformatics.net/api/deploy/compose/y-GQ66-yJTFF6Pee1Vubk
```

### Release Process
1. Work on `dev` (or feature branch → merge to `dev`)
2. Test on team deployment (auto-deploys from `dev`)
3. When ready to release: **create a PR from `dev` → `main` on GitHub**
4. PR goes through code review
5. Once approved and merged, `main` is the public stable release

### Daily workflow
```bash
cd /tmp/hive-work
git checkout dev
# ... make changes ...
git add -A && git commit -m "feat: description"
git push origin dev        # Push to OneDev
git push github dev        # Push to GitHub
# Deploy triggers automatically, or manually:
curl -fsS -X POST \
  -H 'Content-Type: application/json' \
  -H 'X-GitHub-Event: repo:push' \
  -d '{"ref":"refs/heads/dev"}' \
  https://cp.biginformatics.net/api/deploy/compose/y-GQ66-yJTFF6Pee1Vubk
```

## Redeploy Hook

### Endpoint
- https://cp.biginformatics.net/api/deploy/compose/y-GQ66-yJTFF6Pee1Vubk

### Required headers + payload
Headers:
- `Content-Type: application/json`
- `X-GitHub-Event: repo:push`

Body:
```json
{"ref":"refs/heads/dev"}
```
