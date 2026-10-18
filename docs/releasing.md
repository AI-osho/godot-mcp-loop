# Releasing

Releases are cut from `main` by pushing a version tag; `.github/workflows/release.yml` does the rest. The npm package
only goes live after a maintainer approves it with two-factor authentication.

## One-time setup (npm trusted publishing)

On npmjs.com, open **godot-mcp-loop › Settings › Trusted Publisher**, choose **GitHub Actions** and enter:

| Field | Value |
|---|---|
| Organization or user | `AI-osho` |
| Repository | `godot-mcp-loop` |
| Workflow filename | `release.yml` |
| Environment | `npm` |
| Allowed actions | staged publishing only (leave direct `npm publish` off) |

Or from a terminal with npm ≥ 11.15 (asks for 2FA):
`npm trust github godot-mcp-loop --file release.yml --repo AI-osho/godot-mcp-loop --env npm --allow-stage-publish`.

No npm token is stored in GitHub. The workflow's `npm` job runs in the `npm` environment; add required reviewers to
that environment in the repository settings if you want a second approval before anything is staged.

## Each release

1. **Release PR**: on a branch, `cd server && npm version X.Y.Z --no-git-tag-version`, set `version="X.Y.Z"` in
   `addons/mcp_loop/plugin.cfg`, and turn `## [Unreleased]` in `CHANGELOG.md` into `## [X.Y.Z] - YYYY-MM-DD` (keep an
   empty `## [Unreleased]` above it). The text of that section becomes the release notes, so start it with a short
   summary. CI must pass; rebase-merge.
2. **Dry run** (optional): Actions › Release › Run workflow with the version. It builds and checks everything and
   publishes nothing; the artifacts are attached to the run.
3. **Tag**: `git tag vX.Y.Z <merge commit> && git push origin vX.Y.Z`. The workflow
   - checks that the tag, `server/package.json`, `plugin.cfg` and the CHANGELOG agree, runs type check and unit tests;
   - builds `godot-mcp-loop-addon-X.Y.Z.zip`, `godot-mcp-loop-X.Y.Z.tgz` and `SHA256SUMS.txt`
     (`scripts/release-artifacts.sh`, the same script works locally), checks the tarball holds no tests or secrets and
     runs `npm publish --dry-run` on it;
   - creates the GitHub release (marked Latest) with those files and notes from the CHANGELOG section;
   - stages exactly that tarball on npm with `npm stage publish` (provenance from trusted publishing).
4. **Approve on npm**: `npm stage list godot-mcp-loop` → `npm stage approve <stage-id>` (2FA), or npmjs.com ›
   godot-mcp-loop › **Staged Packages** › Approve. To inspect first: `npm stage view <id>` / `npm stage download <id>`.
   `npm stage reject <id>` discards it (the version number stays usable only while nothing was published).
5. **Check**: `npm view godot-mcp-loop dist-tags.latest --prefer-online` shows X.Y.Z, and
   `npm view godot-mcp-loop@X.Y.Z dist.integrity --prefer-online` equals
   `sha512-$(openssl dgst -sha512 -binary godot-mcp-loop-X.Y.Z.tgz | base64)` for the tarball on the GitHub release.

If the npm job fails (for example before trusted publishing is set up), the GitHub release is already there; publish
the attached tarball by hand (`npm publish ./godot-mcp-loop-X.Y.Z.tgz --access public` — keep the `./`, or npm reads the path as a GitHub repository) or re-run the job after fixing
the setup.
