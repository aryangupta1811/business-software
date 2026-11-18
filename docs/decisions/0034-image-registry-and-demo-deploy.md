# 0034 — Images on GHCR built by GitHub Actions; the demo server deploys a commit through Run Command

- **Date:** 2026-11-18
- **Status:** Accepted

## Context

Stage 5 part 3 puts the skeleton live, so the server needs the two images (ADR 0020: one app image for api, worker and migrate; one web image with Caddy) from a registry. ADR 0011 left the registry to stage 6 ("GitHub Container Registry or ECR, whichever is free at our size"), but part 3 needs one now. Constraints:

- **₹0 budget** on the AWS Free plan (ADRs 0030, 0033): nothing that bills while idle.
- The server is **ARM64** (Graviton `t4g.small`, ADR 0032); CI's smoke job builds x86 images.
- **The repo is public**, and the images hold no secret (`docs/devops/secrets.md`): anyone may pull them.
- The laptop's GitHub token has no `write:packages` scope, and giving it one would leave a long-lived push token on the laptop.
- The server has **no SSH** and no port 22 (stage 5 part 2); shell access is through Systems Manager.

## Options considered

### Option A — GitHub Container Registry (GHCR), public packages, pushed by GitHub Actions
- Pros: free storage and pulls for public packages; the server pulls without any credential; pushed with the workflow's own `GITHUB_TOKEN`, which expires when the job ends, so no personal token exists anywhere; GitHub's ARM64 runner (`ubuntu-24.04-arm`) is free for public repositories and builds natively (no emulation); the package links to the repository.
- Cons: a second provider in the deploy path (GitHub as well as AWS); pulls come over the internet, not from inside AWS. (This first said a new package starts private and needs the owner to make it public. Corrected 2026-11-19: a package pushed by a public repository's workflow came out public, see Consequences.)

### Option B — Amazon ECR, private repositories
- Pros: inside AWS; pulls from the server use the instance role; image scanning built in.
- Cons: storage bills per GB-month and every commit adds a tag (a lifecycle rule would be needed); the push from GitHub Actions needs an AWS role for GitHub (OIDC), which is stage 6 work; on the Free plan it spends credits for no gain while the images are public anyway.

### Option C — GHCR, pushed from the laptop this once (the stage 5 plan's first idea)
- Pros: no workflow to write today.
- Cons: needs `write:packages` on the laptop's token for good; images built under emulation; the image that runs isn't one CI built.

## Decision

**Option A.** The new `images` workflow builds both images on every push to `main` on the ARM64 runner and pushes `ghcr.io/aryangupta1811/business-software-{app,web}:<commit hash>`.

The demo server deploys **one commit at a time**. `scripts/deploy/demo.sh <commit>` refuses a commit that isn't on `main` or whose images are missing. It then sends a Systems Manager Run Command that:
1. downloads the repository at exactly that commit from GitHub;
2. runs `deploy/demo/install.sh`, which installs the server files, creates the database roles once (`bootstrap-db.sh`) and restarts the `business-software` systemd service.

At every boot that service runs `start.sh`. It updates DuckDNS, writes the connection strings from SSM into root-only files in memory (`/run`) and starts the stack. Docker also keeps them in each container's config on the server's encrypted disk, readable by root only.

## Why

- It's free in every part.
- No long-lived credential exists for pushing or pulling.
- The image is built on the server's own architecture.
- What runs is identified by one commit hash: the files *and* the images.

Stage 6 then only has to call the same deploy from a workflow, with a manual go-ahead, a health check and a rollback.

## Consequences

- **Package visibility (corrected 2026-11-19):** this first asked the owner to set both packages public after the first `images` run. It wasn't needed: both came out public, because the workflow of a public repository pushed them and they're linked to it, and the server pulled them with no login. If one ever shows as private, set it public in the package's settings on GitHub.
- Every merge to `main` publishes images, docs-only merges included (about 3–5 minutes of free runner time). Old tags are never deleted; at about 0.4 GB per commit this is free on GHCR, but a cleanup can come later.
- The smoke job still tests x86 images built from the same commit. Stage 6 moves the smoke test onto the ARM64 build, so the image that was tested is the image that runs (2026-11-10 plan review).
- A deploy restarts the stack: a few seconds of downtime, acceptable for the demo.
- The server trusts GitHub, over HTTPS, to serve the right files for a commit; nothing on the server re-checks the download against the hash. Images are pulled by tag, not by digest, and a tag can be pushed again by anyone who can write the package (only `main`'s workflow can). Stage 6 can pin images by digest.

## Interview note

"Images go to GitHub's registry because they're public and free there, and they're pushed by the CI job's own short-lived token, so no push credential lives on anyone's laptop. Everything is tagged by the git commit, so a deploy is just 'run commit X'. The server fetches that commit's deploy files and pulls that commit's images over Systems Manager, with no SSH at all. The trade-off is depending on GitHub as well as AWS, which is fine for a free demo; with private images I'd move to ECR and pull with the instance role."
