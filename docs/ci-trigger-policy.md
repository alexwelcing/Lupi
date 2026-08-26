# CI trigger policy

The August 2026 CI-noise audit found no duplicate event pair to prune. `LUPI CI` runs on relevant pull-request paths, on relevant pushes to `main`, and by explicit operator dispatch. Production Cloudflare release is manual and approval-bound; the reconciliation workflow is retained because both its weekly read-only check and post-release reconciliation produce distinct release-control evidence. The render-backend deploy remains path-filtered to `main`.

The recurring high-severity audit failure was dependency state, not a trigger defect: main now pins patched `fast-uri` 3.1.5. Do not weaken or retry the production dependency gate to hide an advisory.
