# Public package verification — v0.9.174

Verified locally on 2026-10-18 with Node.js 24.19.0, Python 3.12.14 and the
installed TypeScript 5.9.3 matching package-lock.json. Network dependency
installation and the remote GitHub Actions workflow were not exercised.

- `npm run typecheck`: passed all three strict application/worker configurations.
- `npm run test:public`: passed all 90 complete suites, including the 19 quick
  suites. No skipped private-model test is counted as a pass.
- The real About source download and extracted source rebuild passed as part of
  the public suite. The built HTML and index are byte-identical to the original
  v0.9.174 release (5,097,152 bytes; SHA-256
  `daff75a8c7a8bcc253c35db2dbd6c666c9723414802e535455411ac67c8eff47`).
- All application TypeScript/template inputs and original build scripts are
  byte-identical to v0.9.174. Included original test scripts and assertions are
  unchanged. The public runner, manifests, repository configuration and public
  documentation are separate distribution additions.
- All npm script targets and relative Markdown links resolve. The workflow YAML
  parses, has push/pull-request/manual events, read-only repository permissions
  and no publishing/deployment action. Actual GitHub execution remains untested.
- Stored fixture hashes match the reviewed manifest. The archive is made from
  an explicit reviewed file list; runtime output, installed dependencies,
  private/unknown-origin model fixtures, original local benchmarks, raw logs and
  historical screenshots are excluded. A limited scan found no matches for
  known credential/private-key patterns or local workstation/workspace paths.

The complete private test project is unchanged. Twenty-one mixed suites and
their private attachments are absent here; this result is public coverage only.
UI fixtures are largely stub DOM/WebGL, not a browser/GPU visual or FPS check.
Optional OCP STEP and internal GLES driver checks were not run.

See `PUBLIC_TEST_DATA.md` and `tests/public-suites.json` for scope and provenance.
