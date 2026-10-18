# Publishing the public source package

This is a separate, curated GitHub source distribution of v0.9.174. The
internal project archive is not needed. Nothing in this package uploads code,
publishes a release or creates a repository automatically.

## Repository contents

Extract the ZIP. Put the contents of `LamjaCraft-3D/` at the repository root,
so README.md, package.json, src/, tests/ and .github/ are directly in that root.
Include the supplied `.github/`, `.gitignore` and `.gitattributes` files.

Use GitHub Desktop or Git for the initial upload. GitHub's browser upload is
limited to 100 files per batch, while this package contains more than 100 files.
It also limits each file to 25 MiB. All files here are smaller than that limit,
but uploading the ZIP alone would store an archive rather than a usable source
tree. Current limits: [GitHub: Adding a file](https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository).

With GitHub Desktop, create a local repository from the extracted project
folder, review the file list, commit it, then use Publish repository. Choose the
repository name and public visibility there. If using an existing local clone,
copy the package contents into it instead, then review and commit the files.

Alternatively, create an empty GitHub repository without an extra README or
license. In the extracted source folder, use the commands below. Replace the
example URL with the URL shown by GitHub for your repository:

```sh
git init
git branch -M main
git add .
git status
git commit -m "Initial public source release v0.9.174"
git remote add origin https://github.com/YOUR-ACCOUNT/LamjaCraft-3D.git
git push -u origin main
```

Before the commit, `git status` should show source, public tests and documents;
it should not show private models, node_modules, build/, dist/ or diagnostic
history. The supplied .gitignore protects common local paths; newly added
attachments still need a contents/provenance review.

## Validate and create an end-user release

```sh
npm ci
npm run typecheck
npm test
```

For the extended public checks, use `npm run test:public` instead of repeating
the quick set. Read `docs/TESTING.md` for the limits of public coverage.
GitHub Actions performs the quick checks on pushes/pull requests; a manual
workflow run selects the extended set. Its configuration uses the official
[checkout](https://github.com/actions/checkout) and
[setup-node](https://github.com/actions/setup-node) actions. Local verification
does not mean the workflow has run on GitHub yet.

Build with `npm run build`, then create a GitHub Release tagged `v0.9.174` and
attach `dist/LamjaCraft-3D.html` and optionally the matching generated source
ZIP. Describe it as an offline standalone application. Keep generated HTML
and repeated ZIPs out of ordinary source commits. For later application
versions, update both package version fields and the lockfile before building.

Keep the existing MIT application license and DejaVu notices. Model attachments
are governed separately by their provenance, not by their presence in the
private development project. See `docs/PUBLIC_TEST_DATA.md`.
