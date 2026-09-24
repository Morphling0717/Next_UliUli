# Next_UliUli desktop 0.8.3 compatibility QC

Validated on 2026-09-23 with Node 20.20.2 / npm 10.9.8 / Windows x64. The website continues to use shared WindChime 0.8.2; no dependency or database change is introduced by this QC.

Compared main 1288e3d508407699a10605bef1ccfe6dea78d26a with development commit 7f51447dd0131927756ba0c0ae5d25f2d02b3369. New detached worktree, its own npm ci, disposable database/media and synthetic authentication were used.

Production build, original-session HTTP regression and fresh/legacy/current migration fixtures (each twice) passed. Management/display credentials and login sessions were rejected by the other site. Cookie authentication did not elevate a display Bearer; desktop credentials could not mint management keys. Revocation invalidated the site key and its derived display credential.

Review covered existing authentication adapters, salt/database path compatibility, shared migration, public topic DTOs, mail/key UI integration, legacy route redirect and PWA exclusions. No new blocking finding was confirmed within that scope.

See report.json and logs here, plus WindChime/docs/evidence/0.8.3/consumers-review.md for the complete two-site assessment. The worker guard ran in a VM and the login test used HTTP; these are not browser-offline or visual checks. The retained NFT and Edge warnings are recorded. No production host or real database was accessed.

The original tsconfig.json was left byte-for-byte unchanged (SHA256 dd75b2ef28fc05eba3dc1cb6feb2eebfb249e976a891fe9255bdb8dd73492d67). Only this evidence directory was added to the original repository by this QC; no application source or deployment was changed. The evidence is submitted separately on the existing development branch for draft review.

UliUli production remains on shared WindChime 0.8.1. The latest recorded capacity check left 7.74 GiB free, below the 8 GiB build reserve, so no 0.8.2 production backup/preparation, build or cutover was performed. Mia is not being deployed. The overall Windows/native QC gate remains incomplete; this review must stay draft and must not merge until that gate passes. These HTTP results do not replace installation, upgrade, uninstallation or capture verification.
