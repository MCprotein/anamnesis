# Releasing

anamnesis publishes `@mcprotein/anamnesis` to npm from GitHub Actions.

## Trusted Publishing

The release workflow is `.github/workflows/publish.yml`. It uses npm
Trusted Publishing with GitHub Actions OIDC, so it does not need an
`NPM_TOKEN` secret.

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

## Release Steps

Every version bump must end in one of two explicit states:

- published to npmjs.org, or
- documented as intentionally unpublished / blocked with the reason in
  `CHANGELOG.md` and this release doc if the failure changes procedure.

1. Update `package.json` and `CHANGELOG.md`.
2. Record the dogfood self-check:

   ```bash
   npm run dogfood
   npm run benchmark:gallery
   ```

   Commit the appended `docs/DOGFOOD.md` entry and refreshed generated
   `docs/BENCHMARK-GALLERY.md` evidence region with the release prep
   changes. The score should not regress unless the release notes explain
   the tradeoff.

3. Run local publish readiness verification:

   ```bash
   npm run release:check
   ```

   This verifies dogfood continuity, benchmark gallery freshness, the
   standalone doctor diagnostics, the prompt-time context delta gate, and the
   distribution build.

4. Commit the release changes.
5. Tag the commit:

   ```bash
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

The tag push starts the publish workflow. Manual runs are also available
from the GitHub Actions UI via `workflow_dispatch`.

## Post-Publish Smoke Gate

After npmjs.org shows the new version, verify the published package rather
than the local source tree. Force npmjs.org so local scoped registry overrides
cannot accidentally read GitHub Packages:

```bash
npm view '@mcprotein/anamnesis@X.Y.Z' version --@mcprotein:registry=https://registry.npmjs.org/
cd "$(mktemp -d)"
npm exec --@mcprotein:registry=https://registry.npmjs.org/ \
  --yes --package=@mcprotein/anamnesis@X.Y.Z -- anamnesis --version
```

The printed CLI version must exactly match `X.Y.Z`. Treat any mismatch as a
release blocker and cut a patch release before calling the release stable.

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
read GitHub Packages instead of npmjs.org. Force npmjs.org when checking or
recovering a release:

```bash
npm view @mcprotein/anamnesis versions --@mcprotein:registry=https://registry.npmjs.org/
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

After a manual publish, push the matching tag. The workflow will run and
skip `npm publish` when the exact version already exists on npmjs.org.

## Notes

- Do not add long-lived npm publish tokens for this workflow.
- `v1.4.4` verified successful OIDC publish from the tag workflow.
- npm package settings can be tightened to require two-factor authentication
  and disallow tokens once the maintainer is comfortable with the incident
  recovery path.
- Trusted Publishing currently depends on GitHub-hosted runners.

References:

- npm Trusted Publishing: <https://docs.npmjs.com/trusted-publishers>
- GitHub Actions OIDC permissions: <https://docs.github.com/en/actions/reference/security/oidc>
