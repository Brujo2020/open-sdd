# Publishing `@brujo2020/open-sdd`

> **This document prepares the release. The owner performs it.** The publish needs the owner's npm
> credential — a granular access token, or the owner's OIDC trusted-publisher decision — and an
> explicit go decision. Nobody else, and no automation beyond `.github/workflows/publish.yml`, is
> authorised to run it.

The repository has **two manifests and only one is publishable**:

| Manifest | Package | Publishable? |
|---|---|---|
| `package.json` (repository root) | `@brujo2020/open-sdd` | **Yes** — this is what users install |
| `tools/open-sdd/package.json` | build toolchain, `"private": true` | No — never publish it |

Publishing from `tools/open-sdd` would ship an unscoped `open-sdd` that is **not** this project.
Always publish from the repository root.

---

## 0. The exact order the owner runs

The version is **already bumped** in the root `package.json` — a release is *prepared*, not published.
Do **not** run `npm version`, and do **not** create the tag first: the manual, OTP-bearing publish is
the only path that has ever worked in this repository (no CI credential route has produced a green
publish — see G-28 and §7), so the tag is created **after** the artifact is on the registry, to record
the release.

Every command below reads the version from the manifest, so this procedure cannot go stale again.

```bash
# 0. Preconditions. The working tree is the release commit: version bumped, CHANGELOG written,
#    dist/ rebuilt and tracked. Walk the checklist in §1 first.
V="$(node -p "require('./package.json').version")"   # the version being released
echo "releasing $V"

# 1. Stage the release. Review what you are about to commit.
git add -A
git status --short                                   # read it: this commit is the release

# 2. Commit.
git commit -m "release: v$V"

# 3. Push the commit.
git push origin main

# 4. Publish by hand, with the one-time password. THIS is the step that puts $V on the registry.
#    `--access public` is required for a scoped package; `--otp` is the interactive code.
#    No `--provenance`: it needs GitHub Actions OIDC and a local publish cannot produce it.
npm publish --access public --otp <code>

# 5. Prove it, before tagging. THIS is the step that decides success.
npm view @brujo2020/open-sdd version                 # must print $V
npm view @brujo2020/open-sdd dist-tags.latest        # must print $V

# 6. Record the release in git.
git tag -a "v$V" -m "v$V"
git push origin "v$V"
```

**Which step proves success: step 5.** `npm view @brujo2020/open-sdd version` must print the version
**and** `dist-tags.latest` must move to it. A zero exit from `npm publish` or a green `git push` is not
the proof — the registry is. If step 4 fails, apply the matching row of the table in §7 and re-run step
4; never create a tag for a version that is not on the registry.

Pushing the tag in step 6 triggers `.github/workflows/publish.yml`. That run attempts its own publish
and will fail at the publish step — with the authorisation 404 of route B, or with
`version already exists` if a token is configured and step 4 already landed the version. That is
expected and is exactly what G-28 records: the tag records the release, it is not how the release goes
out. Do not re-push a tag to try to overwrite a published version.

---

## 1. What must be true first

Do not run the publish command until every line below is true and verified on the release commit.

- [ ] **Tests are green.** From a clean install:
      `npm --prefix tools/open-sdd ci && npm --prefix tools/open-sdd run build && npm --prefix tools/open-sdd test`
      Baseline at the time of writing: **126 test files / 1462 tests, all passing**.
- [ ] **The build is current.** `npm run build` at the root, and `git status` shows no unexpected
      change under `tools/open-sdd/dist/` (the compiled CLI is tracked and is what ships).
- [ ] **The version is bumped** in the root `package.json`. One version, one release:
      `node -p "require('./package.json').version"`.
- [ ] **The CHANGELOG is updated.** `CHANGELOG.md` has a section for the version being released, with
      the date; `[Unreleased]` is empty or renamed.
- [ ] **The claims registry is intact** (must stay at `0 broken`):
      `node tools/open-sdd/dist/cli.js assure claims --verify`
- [ ] **The gate chain passes on the release tree:**
      `node tools/open-sdd/dist/cli.js gates run`
- [ ] **You are on the release commit**, with a clean working tree: `git status --short` prints
      nothing.

## 2. Verify the tarball before anything leaves the machine

`npm pack` is the dry run that proves what would be uploaded. Nothing is published by it.

```bash
npm pack --dry-run
```

Read the file list. It must contain `tools/open-sdd/dist/**` and `tools/open-sdd/templates/**`
(these are the `files` entries in the root `package.json`) and must **not** contain
`tools/open-sdd/src/**`, `tools/open-sdd/test/**`, `node_modules/**`, or any `*.tgz` from a previous
run. Then build the real tarball and inspect it byte by byte:

```bash
npm pack
tar -tzf brujo2020-open-sdd-*.tgz | head -50
```

Install that exact tarball into a throwaway directory and run the CLI from it — this is the closest
offline reproduction of what a user gets:

```bash
WORK="$(mktemp -d)"
cd "$WORK" && npm init -y >/dev/null
npm install /absolute/path/to/brujo2020-open-sdd-*.tgz
./node_modules/.bin/open-sdd --version
```

Remove the local tarball afterwards (`rm brujo2020-open-sdd-*.tgz`); `*.tgz` is already gitignored.

The workflow has a `workflow_dispatch` input `dry_run` that runs this whole section in CI and then
stops before publishing, so the pipeline can be exercised without spending a version:

```bash
gh workflow run publish.yml -f dry_run=true
```

A dry run executes install, build, test, the gate chain, the claims check and `npm pack --dry-run`,
prints `Publish route: …` and `Publish dry run: …`, and publishes **nothing**.

## 3. The tag

For **3.2.0**, the tag is created **after** the manual publish (§0, step 6), not before it: pushing
the tag only asks CI to attempt its own publish, and no CI credential route has produced a green
publish here (G-28). The tag's job in this release is to record the version that is already on the
registry.

```bash
git tag -a v3.2.0 -m "v3.2.0"
git push origin v3.2.0
```

Tag name must match the version exactly (`v` + `package.json.version`). If the tag does not match,
stop and fix the version before pushing. A version already on the registry cannot be overwritten: if
the tag points at a version that is already published, bump the version and tag again instead of
re-pushing the tag (see §7).

## 4. The two credential routes

The publish step supports **two credentials, tried in this order**:

1. **A granular access token** in the repository secret `NPM_TOKEN`, passed to the step as
   `NODE_AUTH_TOKEN`. When the secret exists, npm uses it.
2. **OIDC trusted publishing**, which needs no secret. It is attempted only when `NPM_TOKEN` is
   absent.

The workflow always declares the OIDC permission:

```yaml
permissions:
  id-token: write   # Required for OIDC provenance and for the trusted-publishing route
  contents: read
```

The publish step routes between the two and prints the route it chose:

```yaml
      - name: Publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
          DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run || 'false' }}
        run: |
          set -euo pipefail
          if [ -n "${NODE_AUTH_TOKEN:-}" ]; then
            echo "::notice title=Publish route::NPM_TOKEN is configured — using the granular access token route."
          else
            unset NODE_AUTH_TOKEN
            echo "::notice title=Publish route::No NPM_TOKEN configured — attempting the OIDC trusted-publishing route."
          fi
          if [ "${DRY_RUN}" = "true" ]; then
            echo "::notice title=Publish dry run::dry_run=true — packing the tarball and publishing nothing."
            npm pack --dry-run
            exit 0
          fi
          npm publish --access public --provenance
```

An **empty** secret is treated as *no secret*: when `NPM_TOKEN` is empty the step unsets
`NODE_AUTH_TOKEN` before calling npm, so npm never sees a blank token and the failure it reports is
about the route actually attempted. Provenance is requested explicitly with `--provenance`; it is
what makes the published artifact verifiable against this repository and this workflow.

### (a) Route A — granular access token (implemented, never exercised by a recorded run)

The token route is implemented in `publish.yml` and selected whenever `NPM_TOKEN` is present, but no
recorded workflow run has ever published through it. The versions that actually shipped — 3.1.0 and
3.1.1 — went out by hand with `npm publish --access public --otp <code>`. Setting route A up is the
**owner's** action, once:

1. Sign in to [npmjs.com](https://www.npmjs.com/) as the owner of `@brujo2020/open-sdd`.
2. Click the account avatar → **Access Tokens** → **Generate New Token** → **Granular Access
   Token**.
3. Give it a name (for example `open-sdd-ci-publish`) and an expiry you are willing to rotate.
4. Under **Packages and scopes**, choose **Only select packages and scopes**, pick the `@brujo2020`
   scope, then `@brujo2020/open-sdd`, and set the permission to **Read and write**. (`read-only` is
   not enough to publish.)
5. Enable **Bypass 2FA**. This is the field that matters: the account has 2FA enabled, and a granular
   token without bypass 2FA falls under `auth-and-writes`, which requires a one-time password that
   CI cannot supply — so every CI publish is rejected for a missing OTP.
6. Generate the token and copy it once (npm does not show it again).
7. Store it as a repository secret named exactly `NPM_TOKEN`:

   ```bash
   gh secret set NPM_TOKEN
   ```

   Or: repository → **Settings** → **Secrets and variables** → **Actions** → **New repository
   secret**, name `NPM_TOKEN`. Confirm it exists with `gh secret list`. **Never print or commit the
   value**; `NPM_TOKEN` is the only name the workflow reads.

With the secret present, the workflow takes route A and the OIDC configuration is bypassed.

### (b) Route B — OIDC trusted publishing (configured, never yet succeeded here)

The secret-free route. This is the reproducible one; it has **never yet gone green in this
repository** — every run on it has failed with a 404 from npm (see §7), so treat it as set up but
unproven.

1. Open the **package** settings for `@brujo2020/open-sdd` on npmjs.com — the package's own settings
   page, **not** the `@brujo2020` scope/organisation settings page.
2. Under **Trusted Publisher**, choose **GitHub Actions** and fill in the three fields:
   - Organization/user: `Brujo2020`
   - Repository: `open-sdd`
   - Workflow filename: `publish.yml`
   - Environment: leave empty unless the workflow is later given one.
3. Save. Then make sure **no `NPM_TOKEN` secret exists** (`gh secret delete NPM_TOKEN` if it does),
   because the workflow prefers it and would never reach the OIDC route otherwise.

**Known suspects to check when route B fails** (in the order worth checking):

- **The workflow filename must be the exact file that runs.** The value must match
  `.github/workflows/publish.yml` → `publish.yml`. A path, a different name, or a reusable workflow
  whose filename differs will not match.
- **The owner string must match GitHub exactly.** `Brujo2020` is the GitHub account/org login; a
  case or spelling difference is a mismatch.
- **The trusted publisher must be configured ON the package, not on the scope.** The scope-level
  page is not consulted.
- **The account must have 2FA enabled** (it does) and the npm CLI must support trusted publishing
  (npm ≥ 11.5.1). The workflow pins `node-version: '24'`, whose bundled npm is 11; Node 20 bundled
  npm 10.x, which could not perform the OIDC exchange at all.
- **The repository is public** and the workflow has `id-token: write` (it does).

## 5. The final command — the owner runs this for 3.2.0

The known-to-work path is the manual, OTP-bearing publish — the same one that shipped 3.1.0 and
3.1.1. **This is the command §0, step 4 tells the owner to run:**

```bash
npm publish --access public --otp <code>
```

- `--access public` is required because scoped packages default to private. It is mirrored by
  `publishConfig.access` in `package.json`.
- `--otp <code>` is the interactive one-time password from the owner's authenticator. It is what
  satisfies the account's 2FA, which is in `auth-and-writes` mode.
- **No `--provenance` here.** Provenance is produced from GitHub Actions OIDC; a local publish cannot
  generate it, so requesting it only adds a step that cannot succeed. The CI step in `publish.yml`
  does pass `--provenance`, and that path has never gone green (G-28).
- **The owner runs this.** It is not run by this repository's other workflows, by agents, or by
  anyone without the owner's credentials.

A CI route would run the same thing without `--otp`:

```bash
npm publish --access public --provenance
```

Neither CI route is proven here, so for 3.2.0 the manual command above is the one to use and the tag
is pushed afterwards (§0, step 6; §3), not to trigger a publish.

## 6. Verify the published artifact

After the publish succeeds, this is the proof that the release landed. Both lines must be true — the
version **and** the moving `latest` tag:

```bash
# The version that is actually on the registry — must print 3.2.0
npm view @brujo2020/open-sdd version

# The dist-tag that `npx @brujo2020/open-sdd@latest` resolves — must have moved to 3.2.0
npm view @brujo2020/open-sdd dist-tags

# The exact artifact digest and any attestations
npm view @brujo2020/open-sdd dist.integrity
npm view @brujo2020/open-sdd dist.attestations

# Run the published CLI in a throwaway directory and read its version
WORK="$(mktemp -d)"; cd "$WORK"
npx --yes @brujo2020/open-sdd@latest --version
```

Expected for this release: `npm view @brujo2020/open-sdd version` prints **`3.2.0`** and
`dist-tags.latest` is **`3.2.0`** (before the publish it is `3.1.1`, the last published version). If
the version printed is not the version you published, you are resolving a different package or a
cached one — check `npm view @brujo2020/open-sdd version` again rather than assuming the release
failed.

To verify a **CI run** rather than a hand publish:

```bash
gh run list --workflow publish.yml --limit 5
gh run watch          # the run id from the list
```

Read the log of the `Publish` step: it prints `Publish route: NPM_TOKEN …` or
`Publish route: No NPM_TOKEN configured …` before it touches the registry, so the credential in play
is never a guess. A green run on route B is the only thing that turns the trusted-publishing path
from "configured" into "proven".

Finally, confirm the *unscoped* trap is still documented and still true: `npx open-sdd@latest` is
**not** this project. The correct invocation is always the scoped name
`@brujo2020/open-sdd`.

---

## 7. If the publish fails, read this

Three failures have actually been seen in this repository. Map the message to the cause before
changing anything:

| Error | What it means | What to do |
|---|---|---|
| `E403 … Two-factor authentication … required` | The account is in **auth-and-writes**: the credential in play is not exempt from the OTP. | Use the granular token from route (a) with **Bypass 2FA enabled**, or publish manually with `--otp <code>`. A plain automation token without bypass 2FA cannot satisfy this from CI. |
| `E404 … PUT https://registry.npmjs.org/@brujo2020%2fopen-sdd - Not found` | **The CI authorisation failed.** npm returns **404 instead of 403** for an authorisation failure, so this is *not* "the package is missing" — the package exists and is owned by the account. | Do not create the package. Fix the credential route: check that `NPM_TOKEN` exists and has bypass 2FA (route a), or re-check the three trusted-publisher fields (route b). The `Publish route:` line printed by the step says which one was attempted. |
| `EPUBLISHCONFLICT` / `Cannot publish over previously published version` / `version already exists` | That exact version is already on the registry. npm does not allow overwriting a published version. | Bump the version in the root `package.json`, commit, and tag the **new** version. Never re-push an existing tag hoping to overwrite; the artifact is immutable. |

If the step reports route B and fails with 404, that is the unproven route: either finish the
trusted-publisher configuration (§4b) or add the bypass-2FA `NPM_TOKEN` (§4a). Neither has shipped a
release yet — the manual OTP publish (§0, step 4; §5) is the path that has. Until a CI run goes
green, use the manual command and treat the CI routes as configured but unproven (G-28).

---

## Rollback

npm does not allow re-publishing the same version. If a published version is wrong:

```bash
npm deprecate @brujo2020/open-sdd@latest "superseded by 3.2.1: <reason>"
```

then fix, bump, and publish a new patch version. Never try to overwrite history; deprecate and move
forward.
