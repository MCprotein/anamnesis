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
   ```

   Commit the appended `docs/DOGFOOD.md` entry with the release prep
   changes. The score should not regress unless the release notes explain
   the tradeoff.

3. Run local publish readiness verification:

   ```bash
   npm run release:check
   ```

4. Commit the release changes.
5. Tag the commit:

   ```bash
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

The tag push starts the publish workflow. Manual runs are also available
from the GitHub Actions UI via `workflow_dispatch`.

## Recovery Notes

If the tag workflow passes install/typecheck/test/build but fails at
`npm publish` with an npm registry authorization error, first verify the
case-sensitive Trusted Publishing fields above in npmjs.com. npm does not
validate those fields when they are saved, so a repository owner, workflow
filename, or environment mismatch only appears at publish time.

As of the `v0.4.4` verification tag, the workflow reaches `npm publish`
but npmjs.org still returns E404 during the publish step even when the
trusted publisher appears to be configured as `MCprotein/anamnesis` +
`publish.yml` with no environment. Treat that as an unresolved npm/GitHub
OIDC matching issue, not a release blocker.

Local developer machines may also have a scoped registry override such as
`@mcprotein:registry=https://npm.pkg.github.com`, which can make `npm view`
read GitHub Packages instead of npmjs.org. Force npmjs.org when checking or
recovering a release:

```bash
npm view @mcprotein/anamnesis versions --@mcprotein:registry=https://registry.npmjs.org/
npm publish --access public --@mcprotein:registry=https://registry.npmjs.org/
```

Use the manual `npm publish` fallback only from a committed release state
with local package-owner authentication. Do not add long-lived npm publish
tokens to GitHub Actions; the workflow remains OIDC-first and skips publish
when the exact package version already exists on npmjs.org.

If OIDC continues to fail after the settings above are checked, prefer the
manual fallback over further release blocking:

```bash
npm whoami --registry https://registry.npmjs.org/
npm publish --access public --@mcprotein:registry=https://registry.npmjs.org/
```

After a manual publish, push the matching tag. The workflow will run and
skip `npm publish` when the exact version already exists on npmjs.org.

## Notes

- Do not add long-lived npm publish tokens for this workflow.
- After the first successful OIDC publish, npm package settings can be
  tightened to require two-factor authentication and disallow tokens.
- Trusted Publishing currently depends on GitHub-hosted runners.

References:

- npm Trusted Publishing: <https://docs.npmjs.com/trusted-publishers>
- GitHub Actions OIDC permissions: <https://docs.github.com/en/actions/reference/security/oidc>
