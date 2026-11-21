# 0042 — Demo server moves to ap-south-1b, still t4g.small

- **Date:** 2026-11-21
- **Status:** Accepted (the owner asked Claude to decide; the apply waits for the owner's OK, because it replaces the server)

## Context

The demo server (`t4g.small`, ADR 0033) sits in the public subnet in `ap-south-1a`. Starting it failed with `InsufficientInstanceCapacity` on 2026-11-19 and for a whole hour of retries on 2026-11-20, so the first deploy never happened. The database is in `ap-south-1b`. Constraints:

- **Free plan only** (ADRs 0030, 0033). In Mumbai the free-plan types are `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`, `t8i.micro`, `t8i.small`, `c7i-flex.large` and `m7i-flex.large` (`describe-instance-types --filters free-tier-eligible=true`, 2026-11-21).
- **Images are ARM64 only** (ADR 0034, built on GitHub's ARM64 runner).
- **Nothing that bills while idle** without the owner's OK.
- **The server holds no data:** the database is RDS, settings and secrets are in SSM, images are on GHCR, and the boot script rebuilds everything.

## Options considered

### Option A — keep retrying in ap-south-1a
- Pros: no change.
- Cons: failed two days running; every session's deploy depends on luck.

### Option B — t4g.micro (1 GB)
- Pros: ARM64, free plan, a different capacity pool.
- Cons: the whole stack already uses 773 MB of 1.8 GB, and P1.15 adds headless Chromium. 1 GB is too small.

### Option C — an x86 type (t3.small, t8i.small)
- Pros: a different capacity pool, 2 GB.
- Cons: every image would have to be built for two architectures (slower CI, a second runner, Chromium checks on both).

### Option D — t4g.small in ap-south-1b
- Pros: one line in `server.tf` (`aws_subnet.public[0]` → `[1]`; the subnet exists). It's the same zone as the database, so no hop between zones. $0 extra.
- Cons: Terraform replaces the server (new instance, new root disk). `1b` may be short of capacity too: RDS's `db.t4g.micro` there was refused twice on 2026-11-20 before it started.

### Option E — a capacity reservation
- Pros: guarantees the capacity.
- Cons: bills by the hour even while stopped. Ruled out by the Free plan rules.

## Decision

Keep `t4g.small` and move the server to `ap-south-1b` (option D). If `1b` refuses too, retry at a quieter hour; a third zone (`1c`) would need a new public subnet and is the next step after that.

## Why

It keeps the ARM64 images and the 2 GB of memory, costs nothing, and is a one-line change. The server is stateless, so replacing it loses nothing. Being in the database's zone is a small bonus.

## Consequences

- The apply destroys and recreates the instance. It needs the owner's explicit OK (CLAUDE.md rule 7) and a check that everything keyed to the instance ID follows: the nightly stop schedule, the deploy workflow's Run Command target, and the DuckDNS update on boot.
- The mail credentials timer and the backup timer are installed by the boot script, so they come back with the new server; check them after the first boot.
- If capacity in Mumbai stays tight, revisit option C (multi-architecture images) as its own ADR.

## Interview note

AWS can run out of a particular instance type in one zone, and stopping a server to save money gives its capacity back. My server keeps no state, so moving it to another zone is a one-line Terraform change, not a migration. I kept the ARM type and memory, and chose the zone the database already lives in.

## Dated notes

- **2026-11-21, applied** with the owner's OK: 1 added, 3 changed (the deploy and nightly-stop policies, the stop schedule), 1 destroyed, $0 extra. `ap-south-1b` had capacity at the first try. The GitHub `demo` environment's `DEMO_INSTANCE_ID` was updated by hand, since Terraform doesn't manage it (`docs/devops/terraform.md`, Replacing the server).
