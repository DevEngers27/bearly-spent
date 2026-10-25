# Branches, reviews and versions

- `main` only receives work that passed the three-step loop: a batch spec,
  an implementation by Codex on its own branch, an independent review by
  Gemini, then verification (tests, reproduction scripts, diff read, browser
  smoke where the UI changed) and a `--no-ff` merge by Claude. The merge
  commit message names the review trail.
- `fix/<batch>` and `feat/<batch>` are batch branches, one per spec, cut from
  `main` (or from an integration branch when a batch depends on unmerged
  work). They are not rebased; conflicts are resolved in the merge commit.
- `wave<N>` is an integration branch for batches that must land together
  (for example the accounts server and client).
- Versions are annotated tags on `main` following SemVer: `v0.x.y` while the
  product is pre-release. Every tag has a `CHANGELOG.md` entry.
- Secrets never enter git: `.env` is ignored; keys live only in `.env`.
- Commit messages end with a `Co-Authored-By` trailer for the AI that wrote
  them; the human owner is the committer.
