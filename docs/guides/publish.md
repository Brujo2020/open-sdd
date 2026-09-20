# Publishing `@brujo2020/open-sdd`

> **This document prepares the release. It does not perform it.** The final `npm publish` needs the
> owner's npm credentials (or the owner's OIDC trusted-publisher decision) and an explicit go
> decision. Nobody else, and no automation in this repository, is authorised to run it.

The repository has **two manifests and only one is publishable**:

| Manifest | Package | Publishable? |
|---|---|---|
| `package.json` (repository root) | `@brujo2020/open-sdd` | **Yes** — this is what users install |
| `tools/open-sdd/package.json` | build toolchain, `"private": true` | No — never publish it |

Publishing from `tools/open-sdd` would ship an unscoped `open-sdd` that is **not** this project.
Always publish from the repository root.

---

## 1. What must be true first

Do not run the publish command until every line below is true and verified on the release commit.

- [ ] **Tests are green.** From a clean install:
      `npm --prefix tools/open-sdd ci && npm --prefix tools/open-sdd run build && npm --prefix tools/open-sdd test`
      Baseline at the time of writing: **105 test files / 1155 tests, all passing**.
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

## 3. The tag

The publish workflow (`.github/workflows/publish.yml`) triggers on a version tag. Creating and
pushing the tag is what asks CI to publish — so **the tag is part of the release decision**, not a
formality.

```bash
git tag -a v3.0.2 -m "the version you just published"
git push origin v3.0.2
```

Tag name must match the version exactly (`v` + `package.json.version`). If the tag does not match,
stop and fix the version before pushing.

## 4. Trusted publishing (OIDC) — set up once, by the owner

The workflow already declares the two things OIDC needs:

```yaml
permissions:
  id-token: write   # Required for OIDC provenance
  contents: read
```

The remaining setup is on npmjs.com and is the **owner's** action:

1. Open the package settings for `@brujo2020/open-sdd` on npmjs.com.
2. Under **Trusted Publisher**, choose **GitHub Actions** and fill in:
   - Organization/user: `Brujo2020`
   - Repository: `open-sdd`
   - Workflow filename: `publish.yml`
   - Environment: leave empty unless the workflow is later given one.
3. Save. From then on, the workflow can publish with a short-lived OIDC token and no long-lived
   `NPM_TOKEN` secret. If trusted publishing is *not* configured, the owner must instead add an
   `NPM_TOKEN` secret and pass `NODE_AUTH_TOKEN` to the publish step — a strictly weaker setup,
   because a long-lived token is a credential that can leak.

Provenance is requested explicitly with `--provenance`; it is what makes the published artifact
verifiable against this repository and this workflow.

## 5. The final command — the owner runs this

```bash
npm publish --access public --provenance
```

- `--access public` is required because scoped packages default to private. It is mirrored by
  `publishConfig.access` in `package.json`.
- `--provenance` attaches the signed build attestation produced from GitHub Actions OIDC.
- **The owner runs this, or pushes the tag in step 3 to let the owner's CI run it.** It is not run
  by this repository's other workflows, by agents, or by anyone without the owner's credentials.

## 6. Verify the published artifact

After the publish succeeds:

```bash
# The version that is actually on the registry
npm view @brujo2020/open-sdd version

# The exact artifact digest and any attestations
npm view @brujo2020/open-sdd dist.integrity
npm view @brujo2020/open-sdd dist.attestations

# Run the published CLI in a throwaway directory and read its version
WORK="$(mktemp -d)"; cd "$WORK"
npx --yes @brujo2020/open-sdd@latest --version
```

Expected: `the version you just published`. If the version printed is not the version you published, you are
resolving a different package or a cached one — check `npm view @brujo2020/open-sdd version` again
rather than assuming the release failed.

Finally, confirm the *unscoped* trap is still documented and still true: `npx open-sdd@latest` is
**not** this project. The correct invocation is always the scoped name
`@brujo2020/open-sdd`.

---

## Rollback

npm does not allow re-publishing the same version. If a published version is wrong:

```bash
npm deprecate @brujo2020/open-sdd@latest "superseded by 3.0.3: <reason>"
```

then fix, bump, and publish a new patch version. Never try to overwrite history; deprecate and move
forward.
