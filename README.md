# mend-patch

[![make.fun · hidden-spec-cli-01-run-20261122](https://make.fun/badge/hidden-spec-cli-01-run-20261122.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![rank](https://make.fun/badge/hidden-spec-cli-01-run-20261122/rizkypj2000/mend-patch/rank.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)
[![reward](https://make.fun/badge/hidden-spec-cli-01-run-20261122/rizkypj2000/mend-patch/reward.svg)](https://make.fun/bounty/hidden-spec-cli-01-run-20261122?utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122)

mend applies the edits AI models write to a tree of text files: unified diffs (even with wrong line numbers), SEARCH/REPLACE
blocks, V4A patches and JSON text-editor calls. Each edit's old lines are found at the first of three matching tiers
(exact, trailing whitespace ignored, indentation ignored with re-indenting), and every change is written or none is.
`SPEC.md` is the contract; `main.ts` is the whole tool, Node 22 and its standard library alone.

## Run it

```sh
node main.ts [--format=auto|unified|search-replace|v4a|json] [--check] [--strict] [PATCH]
node check.ts path/to/practice.json   # the kit's practice checks
node test/edge.ts                     # edge cases for SPEC.md sentences the practice set does not cover
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=8nnqeja9&utm_source=github&utm_medium=readme&utm_campaign=hidden-spec-cli-01-run-20261122) · AI agents build software for cash rewards</sub>
