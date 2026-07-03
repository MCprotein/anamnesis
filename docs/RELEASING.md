# Releasing

anamnesis publishes `@mcprotein/anamnesis` to both npmjs.org and GitHub
Packages from GitHub Actions. The tag workflow also creates the matching
GitHub Release. Both registries and the GitHub Release must carry the same
version before a release is considered complete.

## Agent Quick Rule

Agents must use the scripted release path. Do not rely on memory, older chat
context, or a hand-written checklist.

Normal path:

```bash
npm run release:prepare -- --version X.Y.Z
npm run release:publish -- --version X.Y.Z --push --cleanup-branch
npm run release:verify -- --version X.Y.Z
```

Do not hand-run `npm publish`, hand-create GitHub Releases, or hand-create /
push release tags unless the incident recovery path in this document explicitly
applies.

## Trusted Publishing

The release workflow is `.github/workflows/publish.yml`. It uses npm
Trusted Publishing with GitHub Actions OIDC for npmjs.org, so it does not
need an `NPM_TOKEN` secret. The same workflow then publishes the exact same
package version to GitHub Packages using the repository `GITHUB_TOKEN`.

Configure this once in npmjs.com package settings:

| Field | Value |
|---|---|
| Package | `@mcprotein/anamnesis` |
| Publisher | GitHub Actions |
| Organization or user | `MCprotein` |
| Repository | `anamnesis` |
| Workflow filename | `publish.yml` |
| Environment name | leave blank |

npm Trusted Publishing requires npm CLI 11.5.1 or newer and Node.js
22.14.0 or newer. The workflow uses Node.js 24 on GitHub-hosted
`ubuntu-latest` runners and grants `id-token: write`, which npm uses to
exchange the GitHub OIDC token during `npm publish`.

The workflow also grants `packages: write` so it can publish to
`https://npm.pkg.github.com` after npmjs.org succeeds or is already
published. Each registry is checked independently and skipped only when the
exact `package.json` version already exists there.

The workflow grants `contents: write` so tag builds can create or update the
matching GitHub Release after registry parity is verified. Release notes are
derived from the matching `CHANGELOG.md` section and include the npmjs.org and
GitHub Packages package targets.

## Branch Policy

The current unreleased WIP line is grandfathered in as-is. Do not reshuffle the
existing local WIP solely to satisfy this policy. Starting with the next version
line after the current WIP is cut, development must use version-scoped branches
instead of accumulating unreleased work directly on `main`.

Branch roles:

- `main` is the stable release line. It should not carry next-version WIP before
  the current version is published.
- `release/vX.Y` owns one minor release line. Create it before starting
  version-specific implementation work. Delete it after the verified release
  is merged, tagged, published, and no longer needed for patch recovery.
- `feat/vX.Y/<topic>` owns focused work for that release line and merges back
  into `release/vX.Y`.
- `hotfix/vX.Y.Z` is reserved for urgent patch work from the released state.

Release flow from the next version line onward:

1. Create `release/vX.Y` from the current stable `main`.
2. Merge focused feature branches into `release/vX.Y`.
3. Keep `package.json`, `CHANGELOG.md`, roadmap status, and registry targets
   aligned on that release branch.
4. Run the release readiness checks on the release branch.
5. Merge the verified release branch into `main`, tag `vX.Y.Z`, then push
   `main` and the tag.
6. After both registries and the post-publish smoke gate pass, delete the
   merged release branch locally and remotely:

   ```bash
   git branch -d release/vX.Y
   git push origin --delete release/vX.Y
   ```

   Keep the branch only when a documented release blocker or immediate patch
   recovery need still exists.
7. Do not start `release/vX.(Y+1)` work on `main` until `vX.Y.Z` is published
   or explicitly documented as blocked / intentionally unpublished.

## Release Steps

Every version bump must end in one of two explicit states:

- published to both npmjs.org and GitHub Packages with the same version and a
  matching GitHub Release, or
- documented as intentionally unpublished / blocked with the reason in
  `CHANGELOG.md` and this release doc if the failure changes procedure.

The normal path is script-driven. Do not hand-run individual version, commit,
tag, npm publish, or GitHub Release steps unless the recovery section applies.

1. Write the release notes under `CHANGELOG.md` `## [Unreleased]`.
2. Prepare the version:

   ```bash
   npm run release:prepare -- --version X.Y.Z
   ```

   This updates `package.json`, `package-lock.json`, `CHANGELOG.md`, and the
   README patch marker when applicable. It also records the dogfood self-check,
   refreshes the benchmark gallery, and runs `npm run release:check`.

   Use dry-run when checking the next cut without touching files:

   ```bash
   npm run release:prepare -- --version X.Y.Z --dry-run
   ```

3. Publish from the release or hotfix branch:

   ```bash
   npm run release:publish -- --version X.Y.Z --push --cleanup-branch
   ```

   This commits release files when needed, fast-forwards `release/*` or
   `hotfix/*` into `main`, tags `vX.Y.Z`, pushes `main` plus the tag, and
   optionally deletes the merged branch. Without `--push`, it stops before
   remote changes and prints the next push command.

4. Wait for the tag-triggered `Publish` workflow to complete. The workflow
   publishes or verifies npmjs.org and GitHub Packages, checks registry parity,
   then creates or updates the GitHub Release for the tag. Manual runs are also
   available from the GitHub Actions UI via `workflow_dispatch`, but only tag
   runs create a GitHub Release.

5. Verify the public release:

   ```bash
   npm run release:verify -- --version X.Y.Z
   ```

## Post-Publish Smoke Gate

After both registries show the new version, verify the published package
rather than the local source tree. Force each registry explicitly so local
scoped registry overrides cannot accidentally hide a mismatch:

```bash
npm run release:verify -- --version X.Y.Z
```

The command performs the same checks as the manual sequence below:

```bash
npm view '@mcprotein/anamnesis@X.Y.Z' version --@mcprotein:registry=https://registry.npmjs.org/
npm view '@mcprotein/anamnesis@X.Y.Z' version --@mcprotein:registry=https://npm.pkg.github.com/
gh release view vX.Y.Z --repo MCprotein/anamnesis
cd "$(mktemp -d)"
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@X.Y.Z -- anamnesis --version
npm exec --@mcprotein:registry=https://npm.pkg.github.com/ \
  --yes --package=@mcprotein/anamnesis@X.Y.Z -- anamnesis --version
```

Both printed CLI versions must exactly match `X.Y.Z`. The GitHub Release must
exist for `vX.Y.Z`. Treat any mismatch between package registries,
`package.json`, the GitHub Release tag, and CLI output as a release blocker and
cut a patch release before calling the release stable.

Then run one fresh-fixture smoke with the published CLI:

```bash
tmp="$(mktemp -d)"
mkdir -p "$tmp/prisma"
printf 'datasource db { provider = "postgresql" url = env("DATABASE_URL") }\n' \
  > "$tmp/prisma/schema.prisma"
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@X.Y.Z -- \
  anamnesis init --project-root "$tmp" --tools all --allow-exec-adapters
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@X.Y.Z -- \
  anamnesis status --project-root "$tmp"
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@X.Y.Z -- \
  anamnesis doctor --project-root "$tmp"
```

Run the published CLI checks from the fresh temp directory, not from the
anamnesis repository. Otherwise `npm exec` can resolve a local or globally
installed `anamnesis` binary before the just-published package binary.

For releases that claim sanitized fixture continuity improvements, also repeat
the published-package smoke on the current fixture snapshot and record the
result in `docs/DOGFOOD.md`.

## Recovery Notes

Trusted Publishing is the primary release path. The `v1.4.4` tag workflow
completed successfully and npmjs.org returned `1.4.4`, proving the current
GitHub Actions OIDC configuration can publish the package.

If a future tag workflow passes install/typecheck/test/build but fails at
`npm publish` with an npm registry authorization error, first verify the
case-sensitive Trusted Publishing fields above in npmjs.com. npm does not
validate those fields when they are saved, so a repository owner, workflow
filename, or environment mismatch may only appear at publish time.

Local developer machines may also have a scoped registry override such as
`@mcprotein:registry=https://npm.pkg.github.com`, which can make `npm view`
read GitHub Packages instead of npmjs.org. Force the target registry when
checking or recovering a release:

```bash
npm view @mcprotein/anamnesis versions --@mcprotein:registry=https://registry.npmjs.org/
npm view @mcprotein/anamnesis versions --@mcprotein:registry=https://npm.pkg.github.com/
npm publish --access public --@mcprotein:registry=https://registry.npmjs.org/
```

Use the manual `npm publish` fallback only from a committed release state
with local package-owner authentication and only when the OIDC workflow is
blocked by a registry or GitHub incident. Do not add long-lived npm publish
tokens to GitHub Actions; the workflow remains OIDC-first and skips publish
when the exact package version already exists on npmjs.org.

If OIDC fails after the settings above are checked and the release must not
wait, use the documented manual fallback:

```bash
npm whoami --registry https://registry.npmjs.org/
npm publish --access public --@mcprotein:registry=https://registry.npmjs.org/
```

After a manual npmjs.org publish, push the matching tag. The workflow will
run and skip npmjs.org publish when the exact version already exists, then
publish or verify the same version on GitHub Packages.

## Notes

- Do not add long-lived npm publish tokens for this workflow.
- `v1.4.4` verified successful npmjs.org OIDC publish from the tag workflow.
- The tag workflow treats npmjs.org, GitHub Packages, and GitHub Releases as
  paired release targets. Do not call a release complete until both registries
  report the same version and `gh release view vX.Y.Z` succeeds.
- npm package settings can be tightened to require two-factor authentication
  and disallow tokens once the maintainer is comfortable with the incident
  recovery path.
- Trusted Publishing currently depends on GitHub-hosted runners.

References:

- npm Trusted Publishing: <https://docs.npmjs.com/trusted-publishers>
- GitHub Actions OIDC permissions: <https://docs.github.com/en/actions/reference/security/oidc>
