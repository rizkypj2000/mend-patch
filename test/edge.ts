// Edge cases for SPEC.md sentences the public practice set does not exercise: `node test/edge.ts [name prefix]`.
// Each case is one run of main.ts (through the kit's runner, as a trial runs it) with what SPEC.md says it must do,
// worked out by hand from the sentence it tests.

import { runCheck } from '../runner.ts';

interface Case {
  name: string;
  argv: string[];
  stdin?: string;
  files: Record<string, string>;
  exit: number;
  stdout: string;
  changes?: Record<string, string | null>;
}

const SR = (path: string, old: string, neu: string): string => `${path}\n<<<<<<< SEARCH\n${old}=======\n${neu}>>>>>>> REPLACE\n`;

const cases: Case[] = [
  // --- section 1: the command line
  { name: 'cli-dashdash-positional', argv: ['--', '--check'], files: { '--check': SR('a.txt', 'x\n', 'y\n'), 'a.txt': 'x\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'y\n' } },
  { name: 'cli-dash-stdin-check', argv: ['-', '--check'], stdin: SR('a.txt', 'x\n', 'y\n'), files: { 'a.txt': 'x\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n' },
  { name: 'cli-two-positionals', argv: ['a', 'b'], files: {}, exit: 2, stdout: 'error: usage\n' },
  { name: 'cli-usage-beats-no-patch', argv: ['missing.patch', '--bogus'], files: {}, exit: 2, stdout: 'error: usage\n' },
  { name: 'cli-format-twice', argv: ['--format=json', '--format=json', 'p'], files: { p: '[]' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'cli-format-no-value', argv: ['--format', 'json', 'p'], files: { p: '[]' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'cli-dash-and-file', argv: ['-', 'p'], files: { p: 'x' }, exit: 2, stdout: 'error: usage\n' },
  { name: 'cli-patch-is-dir', argv: ['d'], files: { 'd/x': 'y\n' }, exit: 2, stdout: 'error: no-patch\n' },
  { name: 'cli-empty-stdin', argv: [], stdin: '', files: {}, exit: 2, stdout: 'error: format\n' },
  { name: 'cli-forced-json-empty', argv: ['--format=json'], stdin: '\n\n', files: {}, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'cli-forced-unified-prose', argv: ['--format=unified', 'p'], files: { p: 'just words\n' }, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'cli-auto-explicit', argv: ['--format=auto', 'p'], files: { p: SR('a.txt', 'x\n', 'y\n'), 'a.txt': 'x\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'y\n' } },
  { name: 'cli-strict-trailing-ws', argv: ['--strict', 'p'], files: { p: SR('a.txt', 'x\n', 'y\n'), 'a.txt': 'x \n' }, exit: 1, stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n' },

  // --- section 2: output order and counts
  {
    name: 'out-byte-order',
    argv: ['p'],
    files: { p: '{"command":"create","path":"a.txt","file_text":"1"}\n{"command":"create","path":"_x","file_text":"2"}\n{"command":"create","path":"B.txt","file_text":"3"}\n' },
    exit: 0,
    stdout: 'A B.txt\nA _x\nA a.txt\nok: 3 files\n',
    changes: { 'a.txt': '1', _x: '2', 'B.txt': '3' },
  },
  {
    name: 'out-noop',
    argv: ['p'],
    files: { p: SR('a.txt', 'x\n', 'x\n'), 'a.txt': 'x\n' },
    exit: 0,
    stdout: 'ok: 0 files\n',
  },
  {
    name: 'out-delete-recreate-same',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Delete File: a.txt\n*** Add File: a.txt\n+x\n*** End Patch\n', 'a.txt': 'x\n' },
    exit: 0,
    stdout: 'ok: 0 files\n',
  },
  {
    name: 'out-check-failure',
    argv: ['--check', 'p'],
    files: { p: SR('a.txt', 'nope\n', 'y\n'), 'a.txt': 'x\n' },
    exit: 1,
    stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n',
  },
  {
    name: 'out-rename-sorted-by-new',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Update File: z.txt\n*** Move to: b.txt\n*** Update File: a.txt\n@@\n-x\n+y\n*** End Patch\n', 'z.txt': 'q\n', 'a.txt': 'x\n' },
    exit: 0,
    stdout: 'M a.txt\nR z.txt -> b.txt\nok: 2 files\n',
    changes: { 'z.txt': null, 'b.txt': 'q\n', 'a.txt': 'y\n' },
  },
  {
    name: 'out-move-then-move',
    argv: ['p'],
    files: { p: '*** Begin Patch\n*** Update File: a.txt\n*** Move to: b.txt\n*** Update File: b.txt\n*** Move to: c.txt\n*** End Patch\n', 'a.txt': 'q\n' },
    exit: 0,
    stdout: 'D a.txt\nA c.txt\nok: 2 files\n',
    changes: { 'a.txt': null, 'c.txt': 'q\n' },
  },

  // --- section 3: paths and files
  { name: 'path-double-slash', argv: ['p'], files: { p: '{"command":"create","path":"a//b","file_text":"x"}\n' }, exit: 1, stdout: 'error: unsafe a//b\nfailed: 1 of 1 edits\n' },
  { name: 'path-dot', argv: ['p'], files: { p: '{"command":"create","path":"./a","file_text":"x"}\n' }, exit: 1, stdout: 'error: unsafe ./a\nfailed: 1 of 1 edits\n' },
  { name: 'path-trailing-slash', argv: ['p'], files: { p: '{"command":"create","path":"a/","file_text":"x"}\n' }, exit: 1, stdout: 'error: unsafe a/\nfailed: 1 of 1 edits\n' },
  { name: 'path-backslash', argv: ['p'], files: { p: '{"command":"create","path":"a\\\\b","file_text":"x"}\n' }, exit: 1, stdout: 'error: unsafe a\\b\nfailed: 1 of 1 edits\n' },
  { name: 'path-absolute', argv: ['p'], files: { p: '{"command":"create","path":"/etc/x","file_text":"x"}\n' }, exit: 1, stdout: 'error: unsafe /etc/x\nfailed: 1 of 1 edits\n' },
  { name: 'path-nested-create', argv: ['p'], files: { p: '{"command":"create","path":"a/b/c.txt","file_text":"x"}\n' }, exit: 0, stdout: 'A a/b/c.txt\nok: 1 file\n', changes: { 'a/b/c.txt': 'x' } },
  { name: 'file-all-lines-deleted', argv: ['p'], files: { p: SR('a.txt', 'x\ny\n', ''), 'a.txt': 'x\ny\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': '' } },
  { name: 'file-crlf-sr', argv: ['p'], files: { p: SR('a.txt', 'y\n', 'Y\nZ\n'), 'a.txt': 'x\r\ny\r\nz' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'x\r\nY\r\nZ\r\nz' } },
  // An LF file (its first \n follows no \r) keeps a stray \r inside its line, while patch lines lose theirs: no tier
  // strips \r, so the block finds nothing.
  { name: 'file-mixed-first-lf', argv: ['p'], files: { p: SR('a.txt', 'y\r\n', 'Y\n'), 'a.txt': 'x\ny\r\nz\n' }, exit: 1, stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n' },
  { name: 'file-crlf-stray-lf', argv: ['p'], files: { p: SR('a.txt', 'y\n', 'Y\n'), 'a.txt': 'x\r\ny\r\nz\nw\r\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'x\r\nY\r\nz\nw\r\n' } },
  { name: 'seq-create-then-edit', argv: ['p'], files: { p: '[{"command":"create","path":"n.txt","file_text":"a\\nb\\n"},{"command":"str_replace","path":"n.txt","old_str":"b","new_str":"c"}]' }, exit: 0, stdout: 'A n.txt\nok: 1 file\n', changes: { 'n.txt': 'a\nc\n' } },
  { name: 'atomic-later-still-runs', argv: ['p'], files: { p: '{"command":"str_replace","path":"m.txt","old_str":"a","new_str":"b"}\n{"command":"create","path":"n.txt","file_text":"x"}\n{"command":"create","path":"n.txt","file_text":"y"}\n' }, exit: 1, stdout: 'error: missing m.txt\nerror: exists n.txt\nfailed: 2 of 3 edits\n' },

  { name: 'tree-dir-replaced-by-file', argv: ['p'], files: { p: '*** Begin Patch\n*** Delete File: a/b\n*** Add File: a\n+x\n*** End Patch\n', 'a/b': 'y\n' }, exit: 0, stdout: 'A a\nD a/b\nok: 2 files\n', changes: { 'a/b': null, a: 'x\n' } },
  { name: 'tree-create-over-dir', argv: ['p'], files: { p: '{"command":"create","path":"src","file_text":"x"}\n', 'src/x.js': 'y\n' }, exit: 1, stdout: 'error: exists src\nfailed: 1 of 1 edits\n' },
  { name: 'tier1-context-kept', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n', f: 'a  \nb\n' }, exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a  \nB\n' } },

  // --- section 4: detection
  { name: 'detect-begin-indented', argv: ['p'], files: { p: '\n   *** Begin Patch  \n*** Add File: n.txt\n+a\n*** End Patch\n' }, exit: 0, stdout: 'A n.txt\nok: 1 file\n', changes: { 'n.txt': 'a\n' } },
  { name: 'detect-json-indented', argv: ['p'], files: { p: '\n  \t[{"command":"create","path":"n.txt","file_text":"a"}]\n' }, exit: 0, stdout: 'A n.txt\nok: 1 file\n', changes: { 'n.txt': 'a' } },
  { name: 'detect-search-leading-space', argv: ['p'], files: { p: 'a.txt\n <<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n', 'a.txt': 'x\n' }, exit: 2, stdout: 'error: format\n' },

  // --- section 5: tiers and re-indenting
  { name: 'tier2-reindent-sr', argv: ['p'], files: { p: SR('a.py', 'if x:\n    y = 1\n', 'if x:\n    y = 2\n    z = 3\n'), 'a.py': 'def f():\n    if x:\n        y = 1\n' }, exit: 0, stdout: 'M a.py\nok: 1 file\n', changes: { 'a.py': 'def f():\n    if x:\n        y = 2\n        z = 3\n' } },
  { name: 'tier1-no-reindent', argv: ['p'], files: { p: SR('a.py', 'x = 1\n', '  y = 2\n'), 'a.py': 'x = 1   \n' }, exit: 0, stdout: 'M a.py\nok: 1 file\n', changes: { 'a.py': '  y = 2\n' } },
  { name: 'tier2-reindent-prefix-mismatch', argv: ['p'], files: { p: SR('a.py', '  a\n  b\n', '  a\n\tc\n   \n'), 'a.py': '    a\n    b\n' }, exit: 0, stdout: 'M a.py\nok: 1 file\n', changes: { 'a.py': '    a\n\tc\n   \n' } },
  { name: 'tier-ambiguous-at-first-tier', argv: ['p'], files: { p: SR('a.txt', 'x\n', 'y\n'), 'a.txt': 'x \nx\t\n' }, exit: 1, stdout: 'error: ambiguous a.txt\nfailed: 1 of 1 edits\n' },
  { name: 'tier0-unique-beats-tier1', argv: ['p'], files: { p: SR('a.txt', 'x\n', 'y\n'), 'a.txt': 'x \nx\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'x \ny\n' } },

  // --- section 6: unified diffs
  { name: 'u-create-noeol', argv: ['p'], files: { p: '--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n\\ No newline at end of file\n' }, exit: 0, stdout: 'A new.txt\nok: 1 file\n', changes: { 'new.txt': 'a\nb' } },
  { name: 'u-delete', argv: ['p'], files: { p: 'diff --git a/x.txt b/x.txt\ndeleted file mode 100644\nindex 123..000\n--- a/x.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n', 'x.txt': 'x\n' }, exit: 0, stdout: 'D x.txt\nok: 1 file\n', changes: { 'x.txt': null } },
  { name: 'u-delete-missing', argv: ['p'], files: { p: '--- a/x.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n' }, exit: 1, stdout: 'error: missing x.txt\nfailed: 1 of 1 edits\n' },
  { name: 'u-create-exists', argv: ['p'], files: { p: '--- /dev/null\n+++ b/x.txt\n@@ -0,0 +1 @@\n+y\n', 'x.txt': 'x\n' }, exit: 1, stdout: 'error: exists x.txt\nfailed: 1 of 1 edits\n' },
  { name: 'u-hunk-before-section', argv: ['--format=unified', 'p'], files: { p: '@@ -1 +1 @@\n-a\n+b\n' }, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'u-bad-git-line', argv: ['p'], files: { p: 'diff --git x y\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' }, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'u-dash-without-plus', argv: ['p'], files: { p: 'diff --git a/x b/x\n--- a/x\nfoo\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n' }, exit: 2, stdout: 'error: parse 3\n' },
  { name: 'u-dash-last-line', argv: ['p'], files: { p: 'diff --git a/x b/x\nindex 1..2\n--- a/x' }, exit: 2, stdout: 'error: parse 4\n' },
  { name: 'u-insert-empty-old', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -1,0 +2,1 @@\n+X\n', f: 'a\nb\nc\n' }, exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\nX\nb\nc\n' } },
  { name: 'u-insert-at-end-adds-break', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -2,0 +3 @@\n+c\n', f: 'a\nb' }, exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\nb\nc\n' } },
  { name: 'u-insert-past-end', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -9,0 +10 @@\n+c\n', f: 'a\nb\n' }, exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\nb\nc\n' } },
  { name: 'u-to-end-noeol-marker', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n+c\n\\ No newline at end of file\n', f: 'a\nb\n' }, exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\nc' } },
  { name: 'u-to-end-marker-after-minus', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n a\n-b\n\\ No newline at end of file\n+c\n', f: 'a\nb' }, exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\nc\n' } },
  { name: 'u-not-to-end-keeps-noeol', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -1,2 +1,2 @@\n-a\n+A\n b\n', f: 'a\nb\nc' }, exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'A\nb\nc' } },
  { name: 'u-prose-and-fence', argv: ['p'], files: { p: 'Here is the fix:\n```diff\n--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n```\nDone.\n', 'f.txt': 'a\nb\n' }, exit: 0, stdout: 'M f.txt\nok: 1 file\n', changes: { 'f.txt': 'a\nB\n' } },
  { name: 'u-trailing-empty-body-lines', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -2 +2 @@\n-b\n+B\n\n\n', f: 'a\nb\n' }, exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a\nB\n' } },
  { name: 'u-rename-no-hunks', argv: ['p'], files: { p: 'diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n', 'old.txt': 'x\n' }, exit: 0, stdout: 'R old.txt -> new.txt\nok: 1 file\n', changes: { 'old.txt': null, 'new.txt': 'x\n' } },
  { name: 'u-move-to-existing', argv: ['p'], files: { p: '--- a/x\n+++ b/y\n@@ -1 +1 @@\n-a\n+b\n', x: 'a\n', y: 'z\n' }, exit: 1, stdout: 'error: exists y\nfailed: 1 of 1 edits\n' },
  { name: 'u-move-missing', argv: ['p'], files: { p: '--- a/x\n+++ b/y\n@@ -1 +1 @@\n-a\n+b\n' }, exit: 1, stdout: 'error: missing x\nfailed: 1 of 1 edits\n' },
  { name: 'u-move-dashed', argv: ['p'], files: { p: '--- a/x\n+++ b/y\n@@ -1 +1 @@\n-a\n+b\n', x: 'a\n' }, exit: 0, stdout: 'R x -> y\nok: 1 file\n', changes: { x: null, y: 'b\n' } },
  { name: 'u-unsafe', argv: ['p'], files: { p: '--- a/../x\n+++ b/../x\n@@ -1 +1 @@\n-a\n+b\n' }, exit: 1, stdout: 'error: unsafe ../x\nfailed: 1 of 1 edits\n' },
  { name: 'u-bad-hunk-header', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+b\nprose\n@@ bad @@\n', f: 'a\n' }, exit: 2, stdout: 'error: parse 7\n' },
  { name: 'u-reindent-tier2', argv: ['p'], files: { p: '--- a/f.py\n+++ b/f.py\n@@ -1,2 +1,2 @@\n if x:\n-    y = 1\n+    y = 2\n', 'f.py': '    if x:\n        y = 1\n' }, exit: 0, stdout: 'M f.py\nok: 1 file\n', changes: { 'f.py': '    if x:\n        y = 2\n' } },
  { name: 'u-nearest-tie-earlier', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -2 +2 @@\n-x\n+X\n', f: 'x\na\nx\nb\nx\n' }, exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'X\na\nx\nb\nx\n' } },
  { name: 'u-new-file-mode-empty', argv: ['p'], files: { p: 'diff --git a/e.txt b/e.txt\nnew file mode 100644\nindex 0000000..e69de29\n' }, exit: 0, stdout: 'A e.txt\nok: 1 file\n', changes: { 'e.txt': '' } },
  { name: 'u-two-sections-one-fails', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -1 +1 @@\n-a\n+A\n--- a/g\n+++ b/g\n@@ -1 +1 @@\n-zz\n+B\n', f: 'a\n', g: 'b\n' }, exit: 1, stdout: 'error: no-match g\nfailed: 1 of 2 edits\n' },
  { name: 'u-tab-after-path', argv: ['p'], files: { p: '--- a/f.txt\t2024-01-01 00:00:00\n+++ b/f.txt\t2024-01-02 00:00:00\n@@ -1 +1 @@\n-a\n+b\n', 'f.txt': 'a\n' }, exit: 0, stdout: 'M f.txt\nok: 1 file\n', changes: { 'f.txt': 'b\n' } },
  { name: 'u-drift', argv: ['p'], files: { p: '--- a/f\n+++ b/f\n@@ -1,1 +1,3 @@\n-a\n+a1\n+a2\n+a3\n@@ -3,1 +5,1 @@\n-x\n+X\n', f: 'a\nx\nx\nx\n' }, exit: 0, stdout: 'M f\nok: 1 file\n', changes: { f: 'a1\na2\na3\nx\nX\nx\n' } },
  { name: 'u-svn-index', argv: ['p'], files: { p: 'Index: f.txt\n===================================================================\n--- f.txt\t(revision 1)\n+++ f.txt\t(working copy)\n@@ -1 +1 @@\n-a\n+b\n', 'f.txt': 'a\n' }, exit: 0, stdout: 'M f.txt\nok: 1 file\n', changes: { 'f.txt': 'b\n' } },

  // --- section 7: SEARCH/REPLACE
  { name: 's-path-before-fence', argv: ['p'], files: { p: 'src/a.py\n```python\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n```\n', 'src/a.py': 'x\n' }, exit: 0, stdout: 'M src/a.py\nok: 1 file\n', changes: { 'src/a.py': 'y\n' } },
  { name: 's-prev-path', argv: ['p'], files: { p: 'a.txt\n<<<<<<< SEARCH\nx\n=======\nX\n>>>>>>> REPLACE\n\n<<<<<<< SEARCH\ny\n=======\nY\n>>>>>>> REPLACE\n', 'a.txt': 'x\ny\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'X\nY\n' } },
  { name: 's-marker-trailing-ws', argv: ['p'], files: { p: 'a.txt\n<<<<<<< SEARCH  \nx\n=======\t\ny\n>>>>>>> REPLACE \n', 'a.txt': 'x\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'y\n' } },
  { name: 's-create', argv: ['p'], files: { p: 'new.txt\n<<<<<<< SEARCH\n=======\nhello\n>>>>>>> REPLACE\n' }, exit: 0, stdout: 'A new.txt\nok: 1 file\n', changes: { 'new.txt': 'hello\n' } },
  { name: 's-create-exists', argv: ['p'], files: { p: 'a.txt\n<<<<<<< SEARCH\n=======\nhello\n>>>>>>> REPLACE\n', 'a.txt': '' }, exit: 1, stdout: 'error: exists a.txt\nfailed: 1 of 1 edits\n' },
  { name: 's-missing-divider', argv: ['p'], files: { p: 'a.txt\n<<<<<<< SEARCH\nx\n>>>>>>> REPLACE\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 's-path-after-prose', argv: ['p'], files: { p: 'Change this:\n\nfoo.txt\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n', 'foo.txt': 'x\n' }, exit: 0, stdout: 'M foo.txt\nok: 1 file\n', changes: { 'foo.txt': 'y\n' } },
  { name: 's-path-indented', argv: ['p'], files: { p: '   foo.txt  \n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n', 'foo.txt': 'x\n' }, exit: 0, stdout: 'M foo.txt\nok: 1 file\n', changes: { 'foo.txt': 'y\n' } },
  { name: 's-second-block-parse', argv: ['p'], files: { p: 'a.txt\n<<<<<<< SEARCH\nx\n=======\ny\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nq\n', 'a.txt': 'x\n' }, exit: 2, stdout: 'error: parse 7\n' },
  { name: 's-unsafe', argv: ['p'], files: { p: SR('../a.txt', 'x\n', 'y\n') }, exit: 1, stdout: 'error: unsafe ../a.txt\nfailed: 1 of 1 edits\n' },

  // --- section 8: V4A
  { name: 'v-add-inner-empty', argv: ['p'], files: { p: '*** Begin Patch\n*** Add File: n.txt\n+a\n\n+b\n\n\n*** End Patch\n' }, exit: 0, stdout: 'A n.txt\nok: 1 file\n', changes: { 'n.txt': 'a\n\nb\n' } },
  { name: 'v-move-only', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.txt\n*** Move to: d/b.txt\n*** End Patch\n', 'a.txt': 'x' }, exit: 0, stdout: 'R a.txt -> d/b.txt\nok: 1 file\n', changes: { 'a.txt': null, 'd/b.txt': 'x' } },
  { name: 'v-missing-end', argv: ['p'], files: { p: '*** Begin Patch\n*** Add File: n.txt\n+a\n\n' }, exit: 2, stdout: 'error: parse 5\n' },
  { name: 'v-junk-between', argv: ['p'], files: { p: '*** Begin Patch\n\nhello\n*** Add File: n.txt\n+a\n*** End Patch\n' }, exit: 2, stdout: 'error: parse 3\n' },
  { name: 'v-update-empty', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.txt\n\n*** End Patch\n', 'a.txt': 'x\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 'v-anchor-missing', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.txt\n@@ def nope():\n-x\n+y\n*** End Patch\n', 'a.txt': 'x\n' }, exit: 1, stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n' },
  { name: 'v-eof-insert', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.txt\n@@\n+tail\n*** End of File\n*** End Patch\n', 'a.txt': 'x\ny\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'x\ny\ntail\n' } },
  { name: 'v-cursor-forward-only', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.txt\n@@\n-b\n+B\n@@\n-a\n+A\n*** End Patch\n', 'a.txt': 'a\nb\n' }, exit: 1, stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n' },
  { name: 'v-eof-must-end', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.txt\n-x\n+X\n*** End of File\n*** End Patch\n', 'a.txt': 'x\ny\nx\nz\n' }, exit: 1, stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n' },
  { name: 'v-move-exists', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.txt\n*** Move to: b.txt\n*** End Patch\n', 'a.txt': 'x\n', 'b.txt': 'y\n' }, exit: 1, stdout: 'error: exists b.txt\nfailed: 1 of 1 edits\n' },
  { name: 'v-move-unsafe', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.txt\n*** Move to: /b.txt\n*** End Patch\n', 'a.txt': 'x\n' }, exit: 1, stdout: 'error: unsafe /b.txt\nfailed: 1 of 1 edits\n' },
  { name: 'v-delete-with-lines', argv: ['p'], files: { p: '*** Begin Patch\n*** Delete File: a.txt\n-x\n*** End Patch\n', 'a.txt': 'x\n' }, exit: 2, stdout: 'error: parse 3\n' },
  { name: 'v-delete-blank-then-junk', argv: ['p'], files: { p: '*** Begin Patch\n*** Delete File: a.txt\n\njunk\n*** End Patch\n', 'a.txt': 'x\n' }, exit: 2, stdout: 'error: parse 4\n' },
  { name: 'v-delete-blank-lines-ok', argv: ['p'], files: { p: '*** Begin Patch\n*** Delete File: a.txt\n\n  \n*** Add File: b.txt\n+y\n*** End Patch\n', 'a.txt': 'x\n' }, exit: 0, stdout: 'D a.txt\nA b.txt\nok: 2 files\n', changes: { 'a.txt': null, 'b.txt': 'y\n' } },
  // V4A paths lose their surrounding spaces only (SPEC.md section 8): a tab stays part of the path.
  { name: 'v-path-spaces-only', argv: ['p'], files: { p: '*** Begin Patch\n*** Delete File:   a.txt  \n*** Delete File: b.txt\t\n*** End Patch\n', 'a.txt': 'x\n', 'b.txt': 'y\n' }, exit: 1, stdout: 'error: missing b.txt\t\nfailed: 1 of 2 edits\n' },
  { name: 'v-anchor-spaces-stripped', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.py\n@@    def g():   \n-    x = 1\n+    x = 2\n*** End Patch\n', 'a.py': 'def f():\n    x = 1\ndef g():\n    x = 1\n' }, exit: 0, stdout: 'M a.py\nok: 1 file\n', changes: { 'a.py': 'def f():\n    x = 1\ndef g():\n    x = 2\n' } },
  { name: 'u-path-spaces-stripped', argv: ['p'], files: { p: '---   a/f.txt  \n+++   b/f.txt  \n@@ -1 +1 @@\n-a\n+b\n', 'f.txt': 'a\n' }, exit: 0, stdout: 'M f.txt\nok: 1 file\n', changes: { 'f.txt': 'b\n' } },
  { name: 'v-add-bad-line', argv: ['p'], files: { p: '*** Begin Patch\n*** Add File: n.txt\n+a\nb\n*** End Patch\n' }, exit: 2, stdout: 'error: parse 4\n' },
  { name: 'v-anchor-tier1', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.py\n@@ def g():\n-    x = 1\n+    x = 2\n*** End Patch\n', 'a.py': 'def f():\n    x = 1\ndef g():  \n    x = 1\n' }, exit: 0, stdout: 'M a.py\nok: 1 file\n', changes: { 'a.py': 'def f():\n    x = 1\ndef g():  \n    x = 2\n' } },
  { name: 'v-update-keeps-noeol', argv: ['p'], files: { p: '*** Begin Patch\n*** Update File: a.txt\n-y\n+Y\n*** End Patch\n', 'a.txt': 'x\ny' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'x\nY' } },
  { name: 'v-empty-patch', argv: ['p'], files: { p: '*** Begin Patch\n*** End Patch\n' }, exit: 2, stdout: 'error: parse 1\n' },

  // --- section 9: JSON
  { name: 'j-jsonl-blank-lines', argv: ['p'], files: { p: '\n{"command":"create","path":"n.txt","file_text":"a"}\n\n   \n{"command":"create","path":"m.txt","file_text":"b"}\n' }, exit: 0, stdout: 'A m.txt\nA n.txt\nok: 2 files\n', changes: { 'n.txt': 'a', 'm.txt': 'b' } },
  { name: 'j-insert-crlf-top', argv: ['p'], files: { p: '{"command":"insert","path":"a.txt","insert_line":0,"new_str":"top\\r\\nnext\\n"}\n', 'a.txt': 'x\r\ny\r\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'top\r\nnext\r\nx\r\ny\r\n' } },
  { name: 'j-new-str-absent', argv: ['p'], files: { p: '{"command":"str_replace","path":"a.txt","old_str":"b\\n"}\n', 'a.txt': 'a\nb\nc\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'a\nc\n' } },
  { name: 'j-insert-out-of-range', argv: ['p'], files: { p: '{"command":"insert","path":"a.txt","insert_line":3,"new_str":"z"}\n', 'a.txt': 'a\nb\n' }, exit: 1, stdout: 'error: no-match a.txt\nfailed: 1 of 1 edits\n' },
  { name: 'j-unknown-command', argv: ['p'], files: { p: '{"command":"create","path":"n.txt","file_text":"a"}\n{"command":"view","path":"a.txt"}\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 'j-array-bad-element', argv: ['p'], files: { p: '\n[\n{"command":"create","path":"n.txt","file_text":"a"},\n{"command":"insert","path":"n.txt","insert_line":"1","new_str":"x"}\n]\n' }, exit: 2, stdout: 'error: parse 2\n' },
  { name: 'j-overlap-ambiguous', argv: ['p'], files: { p: '{"command":"str_replace","path":"a.txt","old_str":"aa","new_str":"b"}\n', 'a.txt': 'aaa' }, exit: 1, stdout: 'error: ambiguous a.txt\nfailed: 1 of 1 edits\n' },
  { name: 'j-insert-empty-file', argv: ['p'], files: { p: '{"command":"insert","path":"a.txt","insert_line":0,"new_str":"a\\nb\\n"}\n', 'a.txt': '' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'a\nb' } },
  { name: 'j-null-new-str', argv: ['p'], files: { p: '{"command":"str_replace","path":"a.txt","old_str":"a","new_str":null}\n', 'a.txt': 'a\n' }, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'j-str-replace-crlf-strings', argv: ['p'], files: { p: '{"command":"str_replace","path":"a.txt","old_str":"a\\r\\nb","new_str":"x\\ny"}\n', 'a.txt': 'a\r\nb\r\n' }, exit: 0, stdout: 'M a.txt\nok: 1 file\n', changes: { 'a.txt': 'x\r\ny\r\n' } },
  { name: 'j-float-insert-line', argv: ['p'], files: { p: '{"command":"insert","path":"a.txt","insert_line":1.5,"new_str":"x"}\n', 'a.txt': 'a\n' }, exit: 2, stdout: 'error: parse 1\n' },
  { name: 'j-pretty-object', argv: ['p'], files: { p: '{\n  "command": "create",\n  "path": "n.txt",\n  "file_text": "a"\n}\n' }, exit: 2, stdout: 'error: parse 1\n' },
];

const only = process.argv[2];
let passed = 0;
let ran = 0;
for (const c of cases) {
  if (only !== undefined && !c.name.startsWith(only)) continue;
  ran += 1;
  const want: Record<string, string> = { ...c.files };
  for (const [p, v] of Object.entries(c.changes ?? {})) {
    if (v === null) delete want[p];
    else want[p] = v;
  }
  const got = runCheck({ id: c.name, argv: c.argv, stdin: c.stdin ?? null, files: c.files });
  const why: string[] = [];
  if (got.exit !== c.exit) why.push(`exit ${got.exit}, expected ${c.exit}`);
  if (got.stdout !== c.stdout) why.push(`stdout ${JSON.stringify(got.stdout)}, expected ${JSON.stringify(c.stdout)}`);
  for (const p of new Set([...Object.keys(want), ...Object.keys(got.files)])) {
    if (want[p] === undefined) why.push(`${p} should not exist`);
    else if (got.files[p] === undefined) why.push(`${p} is missing`);
    else if (got.files[p] !== want[p]) why.push(`${p}: expected ${JSON.stringify(want[p])}, got ${JSON.stringify(got.files[p])}`);
  }
  if (why.length === 0) passed += 1;
  else process.stdout.write(`FAIL ${c.name}\n  ${why.join('\n  ')}\n`);
}
process.stdout.write(`${passed} of ${ran} edge cases passed\n`);
