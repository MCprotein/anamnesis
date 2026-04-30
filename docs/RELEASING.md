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

1. Update `package.json` and `CHANGELOG.md`.
2. Run local verification:

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

3. Commit the release changes.
4. Tag the commit:

   ```bash
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

The tag push starts the publish workflow. Manual runs are also available
from the GitHub Actions UI via `workflow_dispatch`.

## Notes

- Do not add long-lived npm publish tokens for this workflow.
- After the first successful OIDC publish, npm package settings can be
  tightened to require two-factor authentication and disallow tokens.
- Trusted Publishing currently depends on GitHub-hosted runners.

References:

- npm Trusted Publishing: <https://docs.npmjs.com/trusted-publishers>
- GitHub Actions OIDC permissions: <https://docs.github.com/en/actions/reference/security/oidc>
