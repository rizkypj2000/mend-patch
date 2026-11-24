// mend: applies the edits AI models write (unified diffs, SEARCH/REPLACE blocks, V4A patches and JSON text-editor
// calls) to a tree of text files, every change or none, as SPEC.md specifies. Node 22 and its standard library only.
// Run it as `node main.ts [--format=NAME] [--check] [--strict] [PATCH]` from the root of the tree.
//
// In a trial the grader runs `node /bot/main.ts` with MAKEFUN_ENV_URL set, and the last lines below hand the trial over
// to the kit's runner.ts, which runs this file once per check.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

const FORMAT_NAMES = ['auto', 'unified', 'search-replace', 'v4a', 'json'];

/** An exit-2 answer: one line, nothing written. */
class Stop {
  readonly line: string;
  constructor(line: string) {
    this.line = line;
  }
}

/** One failed edit: its code and the path the failure concerns. */
class Failure {
  readonly code: string;
  readonly path: string;
  constructor(code: string, path: string) {
    this.code = code;
    this.path = path;
  }
}

const parseError = (lineNo: number): Stop => new Stop(`error: parse ${lineNo}`);

/** Empty or only whitespace. */
const isBlank = (s: string): boolean => s.trim() === '';

/** A patch's lines: split at \n, one trailing \r removed from each, no empty piece after a final \n. */
function splitPatch(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (text.endsWith('\n')) parts.pop();
  return parts.map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
}

/** A safe path: not empty, no leading /, no \, no empty, . or .. segment. */
function isSafe(p: string): boolean {
  if (p === '' || p.startsWith('/') || p.includes('\\')) return false;
  return p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

// ---------------------------------------------------------------------------------------------------------------
// Files as lines (SPEC.md section 3)

interface Doc {
  lines: string[];
  br: string;
  final: boolean;
}

function toDoc(text: string): Doc {
  const lf = text.indexOf('\n');
  const br = lf > 0 && text[lf - 1] === '\r' ? '\r\n' : '\n';
  if (text === '') return { lines: [], br, final: false };
  const lines = text.split(br);
  const final = text.endsWith(br);
  if (final) lines.pop();
  return { lines, br, final };
}

function fromDoc(doc: Doc): string {
  if (doc.lines.length === 0) return '';
  return doc.lines.join(doc.br) + (doc.final ? doc.br : '');
}

/** A file an edit creates: LF breaks, a final break unless the format says otherwise; no lines is empty. */
function createdText(lines: string[], finalBreak: boolean): string {
  if (lines.length === 0) return '';
  return lines.join('\n') + (finalBreak ? '\n' : '');
}

// ---------------------------------------------------------------------------------------------------------------
// The tree as the edits leave it

class Tree {
  readonly before = new Map<string, string | null>();
  readonly after = new Map<string, string | null>();

  original(p: string): string | null {
    if (!this.before.has(p)) {
      let text: string | null = null;
      try {
        if (statSync(p).isFile()) text = readFileSync(p, 'utf8');
      } catch {
        text = null;
      }
      this.before.set(p, text);
    }
    return this.before.get(p)!;
  }

  read(p: string): string | null {
    return this.after.has(p) ? this.after.get(p)! : this.original(p);
  }

  /** Whether something is at the path now: a file, or a directory on disk the edits have not touched. */
  occupied(p: string): boolean {
    if (this.read(p) !== null) return true;
    if (this.after.has(p)) return false;
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  }

  write(p: string, text: string | null): void {
    this.after.set(p, text);
  }
}

interface Edit {
  apply(tree: Tree, strict: boolean): void;
  /** A move edit's old and new paths, recorded when it succeeds. */
  move?: [string, string];
}

function needSafe(...paths: string[]): void {
  for (const p of paths) if (!isSafe(p)) throw new Failure('unsafe', p);
}

function needFile(tree: Tree, p: string): string {
  const text = tree.read(p);
  if (text === null) throw new Failure('missing', p);
  return text;
}

function needFree(tree: Tree, p: string): void {
  if (tree.occupied(p)) throw new Failure('exists', p);
}

// ---------------------------------------------------------------------------------------------------------------
// Matching lines at three tiers (SPEC.md section 5)

const dropTrailing = (s: string): string => s.replace(/[ \t]+$/, '');
const dropBoth = (s: string): string => s.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
const TIERS: Array<(s: string) => string> = [(s) => s, dropTrailing, dropBoth];
const leading = (s: string): string => /^[ \t]*/.exec(s)![0];

interface Found {
  tier: number;
  hits: number[];
}

/** The occurrences of `old` in `file` at the first tier with one, among the positions `allowed` admits. */
function locate(file: string[], old: string[], strict: boolean, allowed: (pos: number) => boolean): Found | null {
  const k = old.length;
  const tiers = strict ? 1 : 3;
  for (let tier = 0; tier < tiers; tier += 1) {
    const norm = TIERS[tier]!;
    const want = old.map(norm);
    const have = file.map(norm);
    const hits: number[] = [];
    for (let pos = 0; pos + k <= file.length; pos += 1) {
      if (!allowed(pos)) continue;
      let same = true;
      for (let j = 0; j < k; j += 1) {
        if (have[pos + j] !== want[j]) {
          same = false;
          break;
        }
      }
      if (same) hits.push(pos);
    }
    if (hits.length > 0) return { tier, hits };
  }
  return null;
}

/** One line of N: its text, and for a context line its index in O. */
interface NewLine {
  text: string;
  ctx: number;
}

/** N as written over the k lines of O matched at `at`: context lines are the file's own, re-indented at tier 2. */
function replacement(file: string[], at: number, old: string[], neu: NewLine[], tier: number): string[] {
  const fileIndent = old.length > 0 && at < file.length ? leading(file[at]!) : '';
  const patchIndent = old.length > 0 ? leading(old[0]!) : '';
  return neu.map((n) => {
    if (n.ctx >= 0) return file[at + n.ctx]!;
    if (tier === 2 && !isBlank(n.text) && n.text.startsWith(patchIndent)) return fileIndent + n.text.slice(patchIndent.length);
    return n.text;
  });
}

/** O and N of a body of context (' '), old ('-') and new ('+') lines, each context line tied to its place in O. */
function splitBody(body: Array<{ kind: string; text: string }>): { old: string[]; neu: NewLine[] } {
  const old: string[] = [];
  const neu: NewLine[] = [];
  for (const b of body) {
    if (b.kind === ' ') {
      neu.push({ text: b.text, ctx: old.length });
      old.push(b.text);
    } else if (b.kind === '-') old.push(b.text);
    else if (b.kind === '+') neu.push({ text: b.text, ctx: -1 });
  }
  return { old, neu };
}

// ---------------------------------------------------------------------------------------------------------------
// Detecting the format (SPEC.md section 4)

function detectFormat(lines: string[]): string | null {
  const first = lines.findIndex((l) => !isBlank(l));
  if (first < 0) return null;
  if (lines[first]!.trim() === '*** Begin Patch') return 'v4a';
  const c = lines[first]!.trimStart()[0];
  if (c === '[' || c === '{') return 'json';
  if (lines.some((l) => l.trimEnd() === '<<<<<<< SEARCH')) return 'search-replace';
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i]!;
    if (l.startsWith('diff --git ')) return 'unified';
    if (l.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) return 'unified';
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// Unified diffs (SPEC.md section 6)

interface Hunk {
  start: number;
  body: Array<{ kind: string; text: string }>;
}

interface Section {
  git: boolean;
  gitOld: string | null;
  gitNew: string | null;
  dashed: boolean;
  dashOld: string | null;
  dashNew: string | null;
  renameFrom: string | null;
  renameTo: string | null;
  newMode: boolean;
  deletedMode: boolean;
  hunks: Hunk[];
}

function newSection(git: boolean): Section {
  return {
    git,
    gitOld: null,
    gitNew: null,
    dashed: false,
    dashOld: null,
    dashNew: null,
    renameFrom: null,
    renameTo: null,
    newMode: false,
    deletedMode: false,
    hunks: [],
  };
}

/** The path a --- or +++ line names: up to the first tab, trimmed, a/ or b/ removed; null for /dev/null. */
function dashPath(line: string): string | null {
  let t = line.slice(4);
  const tab = t.indexOf('\t');
  if (tab >= 0) t = t.slice(0, tab);
  t = t.trim();
  if (t === '/dev/null') return null;
  if (t.startsWith('a/') || t.startsWith('b/')) t = t.slice(2);
  return t;
}

/** The two paths of `diff --git a/<X> b/<Y>`, or null when the line is not of that form. */
function gitPaths(line: string): [string, string] | null {
  const rest = line.slice('diff --git '.length);
  if (!rest.startsWith('a/')) return null;
  const splits: Array<[string, string]> = [];
  for (let k = rest.indexOf(' b/'); k >= 0; k = rest.indexOf(' b/', k + 1)) {
    const x = rest.slice(2, k);
    const y = rest.slice(k + 3);
    if (x !== '' && y !== '') splits.push([x, y]);
  }
  if (splits.length === 0) return null;
  return splits.find(([x, y]) => x === y) ?? splits[0]!;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function startsSectionPair(lines: string[], i: number): boolean {
  return lines[i]!.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ');
}

function parseUnified(lines: string[]): Edit[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  let inHeader = false;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('diff --git ')) {
      const paths = gitPaths(line);
      if (paths === null) throw parseError(i + 1);
      cur = newSection(true);
      cur.gitOld = paths[0];
      cur.gitNew = paths[1];
      sections.push(cur);
      inHeader = true;
      i += 1;
      continue;
    }
    if (startsSectionPair(lines, i)) {
      if (!(cur !== null && inHeader && cur.git && !cur.dashed)) {
        cur = newSection(false);
        sections.push(cur);
        inHeader = true;
      }
      cur.dashed = true;
      cur.dashOld = dashPath(line);
      cur.dashNew = dashPath(lines[i + 1]!);
      i += 2;
      continue;
    }
    if (line.startsWith('@@')) {
      const m = HUNK_HEADER.exec(line);
      if (m === null || cur === null) throw parseError(i + 1);
      inHeader = false;
      const body: Array<{ kind: string; text: string }> = [];
      let j = i + 1;
      while (j < lines.length) {
        const b = lines[j]!;
        if (b.startsWith('diff --git ') || startsSectionPair(lines, j)) break;
        if (b === '') body.push({ kind: ' ', text: '' });
        else if (b[0] === ' ' || b[0] === '-' || b[0] === '+' || b[0] === '\\') body.push({ kind: b[0]!, text: b.slice(1) });
        else break;
        j += 1;
      }
      // Empty lines at the end of a body are not part of it.
      let end = body.length;
      while (end > 0 && body[end - 1]!.kind === ' ' && body[end - 1]!.text === '' && lines[i + end] === '') end -= 1;
      cur.hunks.push({ start: Number(m[1]), body: body.slice(0, end) });
      i = j;
      continue;
    }
    if (cur !== null && inHeader) {
      if (line.startsWith('--- ')) throw parseError(i + 2);
      if (line.startsWith('rename from ')) cur.renameFrom = line.slice('rename from '.length).trim();
      else if (line.startsWith('rename to ')) cur.renameTo = line.slice('rename to '.length).trim();
      else if (line.startsWith('new file mode')) cur.newMode = true;
      else if (line.startsWith('deleted file mode')) cur.deletedMode = true;
    }
    i += 1;
  }
  return sections.map(unifiedEdit);
}

/** Whether a `\` line follows the last context or `+` line of a body. */
function noFinalBreak(body: Array<{ kind: string; text: string }>): boolean {
  for (let j = body.length - 1; j >= 0; j -= 1) {
    const k = body[j]!.kind;
    if (k === ' ' || k === '+') return body[j + 1]?.kind === '\\';
  }
  return false;
}

function applyHunks(text: string, hunks: Hunk[], strict: boolean, where: string): string {
  const doc = toDoc(text);
  let drift = 0;
  for (const h of hunks) {
    const { old, neu } = splitBody(h.body);
    let at: number;
    let tier = 0;
    if (old.length > 0) {
      const found = locate(doc.lines, old, strict, () => true);
      if (found === null) throw new Failure('no-match', where);
      const target = h.start - 1 + drift;
      at = found.hits[0]!;
      for (const pos of found.hits) if (Math.abs(pos - target) < Math.abs(at - target)) at = pos;
      tier = found.tier;
    } else {
      at = Math.min(Math.max(h.start + drift, 0), doc.lines.length);
    }
    const toEnd = at + old.length === doc.lines.length;
    const written = replacement(doc.lines, at, old, neu, tier);
    doc.lines.splice(at, old.length, ...written);
    if (toEnd) doc.final = !noFinalBreak(h.body);
    drift += neu.length - old.length;
  }
  return fromDoc(doc);
}

function unifiedEdit(s: Section): Edit {
  const oldPath = s.dashed ? s.dashOld : (s.renameFrom ?? s.gitOld);
  const newPath = s.dashed ? s.dashNew : (s.renameTo ?? s.gitNew);
  if ((s.dashed && s.dashOld === null) || s.newMode) {
    const p = newPath ?? oldPath ?? '';
    return {
      apply(tree) {
        needSafe(p);
        needFree(tree, p);
        const added: string[] = [];
        let last: Hunk | null = null;
        for (const h of s.hunks) {
          for (const b of h.body) if (b.kind === '+') added.push(b.text);
          if (h.body.some((b) => b.kind === '+')) last = h;
        }
        const plain = last === null || !noFinalBreakAfterPlus(last.body);
        tree.write(p, createdText(added, plain));
      },
    };
  }
  if ((s.dashed && s.dashNew === null) || s.deletedMode) {
    const p = oldPath ?? newPath ?? '';
    return {
      apply(tree) {
        needSafe(p);
        needFile(tree, p);
        tree.write(p, null);
      },
    };
  }
  const from = oldPath ?? '';
  const to = newPath ?? from;
  if (from !== to) {
    const edit: Edit = {
      apply(tree, strict) {
        needSafe(from, to);
        const text = needFile(tree, from);
        needFree(tree, to);
        const out = applyHunks(text, s.hunks, strict, from);
        tree.write(from, null);
        tree.write(to, out);
      },
      move: [from, to],
    };
    return edit;
  }
  return {
    apply(tree, strict) {
      needSafe(from);
      const text = needFile(tree, from);
      tree.write(from, applyHunks(text, s.hunks, strict, from));
    },
  };
}

/** Whether a `\` line follows the last `+` line of a body. */
function noFinalBreakAfterPlus(body: Array<{ kind: string; text: string }>): boolean {
  for (let j = body.length - 1; j >= 0; j -= 1) {
    if (body[j]!.kind === '+') return body[j + 1]?.kind === '\\';
  }
  return false;
}

// ---------------------------------------------------------------------------------------------------------------
// SEARCH/REPLACE blocks (SPEC.md section 7)

const SEARCH = '<<<<<<< SEARCH';
const DIVIDER = '=======';
const REPLACE = '>>>>>>> REPLACE';

function parseSearchReplace(lines: string[]): Edit[] {
  const edits: Edit[] = [];
  let floor = 0;
  let prevPath: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i]!.trimEnd() !== SEARCH) continue;
    let path: string | null = null;
    for (let j = i - 1; j >= floor; j -= 1) {
      const t = lines[j]!.trim();
      if (t === '' || t.startsWith('```')) continue;
      path = t;
      break;
    }
    if (path === null) path = prevPath;
    if (path === null) throw parseError(i + 1);
    let mid = -1;
    for (let j = i + 1; j < lines.length; j += 1) {
      if (lines[j]!.trimEnd() === DIVIDER) {
        mid = j;
        break;
      }
    }
    if (mid < 0) throw parseError(i + 1);
    let end = -1;
    for (let j = mid + 1; j < lines.length; j += 1) {
      if (lines[j]!.trimEnd() === REPLACE) {
        end = j;
        break;
      }
    }
    if (end < 0) throw parseError(i + 1);
    edits.push(searchReplaceEdit(path, lines.slice(i + 1, mid), lines.slice(mid + 1, end)));
    prevPath = path;
    floor = end + 1;
    i = end;
  }
  return edits;
}

function searchReplaceEdit(p: string, old: string[], neu: string[]): Edit {
  return {
    apply(tree, strict) {
      needSafe(p);
      if (old.length === 0) {
        needFree(tree, p);
        tree.write(p, createdText(neu, true));
        return;
      }
      const doc = toDoc(needFile(tree, p));
      const found = locate(doc.lines, old, strict, () => true);
      if (found === null) throw new Failure('no-match', p);
      if (found.hits.length > 1) throw new Failure('ambiguous', p);
      const at = found.hits[0]!;
      const written = replacement(doc.lines, at, old, neu.map((text) => ({ text, ctx: -1 })), found.tier);
      doc.lines.splice(at, old.length, ...written);
      tree.write(p, fromDoc(doc));
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// V4A patches (SPEC.md section 8)

interface V4ALine {
  text: string;
  no: number;
}

interface Chunk {
  anchor: string | null;
  body: Array<{ kind: string; text: string }>;
  eof: boolean;
}

function parseV4A(lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !isBlank(l));
  if (first < 0) throw parseError(1);
  if (lines[first]!.trim() !== '*** Begin Patch') throw parseError(first + 1);
  let last = lines.length - 1;
  while (last > first && isBlank(lines[last]!)) last -= 1;
  if (last === first || lines[last]!.trim() !== '*** End Patch') throw parseError(lines.length + 1);

  const sections: Array<{ kind: string; path: string; no: number; body: V4ALine[] }> = [];
  let cur: (typeof sections)[number] | null = null;
  const heads: Array<[string, string]> = [
    ['add', '*** Add File: '],
    ['delete', '*** Delete File: '],
    ['update', '*** Update File: '],
  ];
  for (let i = first + 1; i < last; i += 1) {
    const line = lines[i]!;
    const head = heads.find(([, prefix]) => line.startsWith(prefix));
    if (head !== undefined) {
      cur = { kind: head[0], path: line.slice(head[1].length).trim(), no: i + 1, body: [] };
      sections.push(cur);
      continue;
    }
    if (cur === null) {
      if (isBlank(line)) continue;
      throw parseError(i + 1);
    }
    cur.body.push({ text: line, no: i + 1 });
  }

  const edits: Edit[] = [];
  for (const s of sections) {
    const body = s.body.slice();
    while (body.length > 0 && isBlank(body[body.length - 1]!.text)) body.pop();
    if (s.kind === 'add') {
      const fileLines: string[] = [];
      for (const b of body) {
        if (b.text === '') fileLines.push('');
        else if (b.text.startsWith('+')) fileLines.push(b.text.slice(1));
        else throw parseError(b.no);
      }
      edits.push(v4aAdd(s.path, fileLines));
    } else if (s.kind === 'delete') {
      if (body.length > 0) throw parseError(body[0]!.no);
      edits.push(v4aDelete(s.path));
    } else {
      let k = 0;
      let moveTo: string | null = null;
      if (body.length > 0 && body[0]!.text.startsWith('*** Move to: ')) {
        moveTo = body[0]!.text.slice('*** Move to: '.length).trim();
        k = 1;
      }
      const chunks: Chunk[] = [];
      let open: Chunk | null = null;
      for (; k < body.length; k += 1) {
        const t = body[k]!.text;
        if (t.startsWith('@@')) {
          const anchor = t.slice(2).trim();
          open = { anchor: anchor === '' ? null : anchor, body: [], eof: false };
          chunks.push(open);
          continue;
        }
        if (t.trim() === '*** End of File') {
          if (open === null) throw parseError(body[k]!.no);
          open.eof = true;
          open = null;
          continue;
        }
        if (t === '' || t[0] === ' ' || t[0] === '-' || t[0] === '+') {
          if (open === null) {
            if (chunks.length > 0) throw parseError(body[k]!.no);
            open = { anchor: null, body: [], eof: false };
            chunks.push(open);
          }
          open.body.push(t === '' ? { kind: ' ', text: '' } : { kind: t[0]!, text: t.slice(1) });
          continue;
        }
        throw parseError(body[k]!.no);
      }
      if (chunks.length === 0 && moveTo === null) throw parseError(s.no);
      edits.push(v4aUpdate(s.path, moveTo, chunks));
    }
  }
  return edits;
}

function v4aAdd(p: string, fileLines: string[]): Edit {
  return {
    apply(tree) {
      needSafe(p);
      needFree(tree, p);
      tree.write(p, createdText(fileLines, true));
    },
  };
}

function v4aDelete(p: string): Edit {
  return {
    apply(tree) {
      needSafe(p);
      needFile(tree, p);
      tree.write(p, null);
    },
  };
}

function v4aUpdate(p: string, moveTo: string | null, chunks: Chunk[]): Edit {
  const edit: Edit = {
    apply(tree, strict) {
      if (moveTo !== null) needSafe(p, moveTo);
      else needSafe(p);
      const text = needFile(tree, p);
      if (moveTo !== null) needFree(tree, moveTo);
      const doc = toDoc(text);
      let cursor = 0;
      for (const c of chunks) {
        if (c.anchor !== null) {
          const found = locate(doc.lines, [c.anchor], strict, (pos) => pos >= cursor);
          if (found === null) throw new Failure('no-match', p);
          cursor = found.hits[0]! + 1;
        }
        const { old, neu } = splitBody(c.body);
        let at: number;
        let tier = 0;
        if (old.length > 0) {
          const from = cursor;
          const fits = c.eof ? (pos: number) => pos >= from && pos + old.length === doc.lines.length : (pos: number) => pos >= from;
          const found = locate(doc.lines, old, strict, fits);
          if (found === null) throw new Failure('no-match', p);
          at = found.hits[0]!;
          tier = found.tier;
        } else {
          at = c.eof ? doc.lines.length : Math.min(cursor, doc.lines.length);
        }
        const written = replacement(doc.lines, at, old, neu, tier);
        doc.lines.splice(at, old.length, ...written);
        cursor = at + written.length;
      }
      const out = fromDoc(doc);
      if (moveTo !== null) {
        tree.write(p, null);
        tree.write(moveTo, out);
      } else tree.write(p, out);
    },
  };
  if (moveTo !== null) edit.move = [p, moveTo];
  return edit;
}

// ---------------------------------------------------------------------------------------------------------------
// JSON edits (SPEC.md section 9)

function jsonEdit(v: unknown): Edit | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const p = o.path;
  if (typeof p !== 'string') return null;
  if (o.command === 'create') {
    if (typeof o.file_text !== 'string') return null;
    const fileText = o.file_text;
    return {
      apply(tree) {
        needSafe(p);
        needFree(tree, p);
        tree.write(p, fileText);
      },
    };
  }
  if (o.command === 'str_replace') {
    if (typeof o.old_str !== 'string' || o.old_str === '') return null;
    if (o.new_str !== undefined && typeof o.new_str !== 'string') return null;
    const oldStr = o.old_str;
    const newStr = typeof o.new_str === 'string' ? o.new_str : '';
    return {
      apply(tree) {
        needSafe(p);
        const before = needFile(tree, p);
        const crlf = toDoc(before).br === '\r\n';
        const plain = (s: string): string => (crlf ? s.replaceAll('\r\n', '\n') : s);
        const text = plain(before);
        const needle = plain(oldStr);
        let count = 0;
        for (let k = text.indexOf(needle); k >= 0; k = text.indexOf(needle, k + 1)) count += 1;
        if (count === 0) throw new Failure('no-match', p);
        if (count > 1) throw new Failure('ambiguous', p);
        const at = text.indexOf(needle);
        const out = text.slice(0, at) + plain(newStr) + text.slice(at + needle.length);
        tree.write(p, crlf ? out.replaceAll('\n', '\r\n') : out);
      },
    };
  }
  if (o.command === 'insert') {
    if (typeof o.insert_line !== 'number' || !Number.isInteger(o.insert_line) || typeof o.new_str !== 'string') return null;
    const after = o.insert_line;
    const added = splitPatch(o.new_str);
    return {
      apply(tree) {
        needSafe(p);
        const doc = toDoc(needFile(tree, p));
        if (after < 0 || after > doc.lines.length) throw new Failure('no-match', p);
        doc.lines.splice(after, 0, ...added);
        tree.write(p, fromDoc(doc));
      },
    };
  }
  return null;
}

function parseJson(text: string, lines: string[]): Edit[] {
  const first = lines.findIndex((l) => !isBlank(l));
  if (first < 0) return [];
  const edits: Edit[] = [];
  if (lines[first]!.trimStart().startsWith('[')) {
    let v: unknown;
    try {
      v = JSON.parse(text);
    } catch {
      throw parseError(first + 1);
    }
    if (!Array.isArray(v)) throw parseError(first + 1);
    for (const item of v) {
      const e = jsonEdit(item);
      if (e === null) throw parseError(first + 1);
      edits.push(e);
    }
    return edits;
  }
  for (let i = 0; i < lines.length; i += 1) {
    if (isBlank(lines[i]!)) continue;
    let e: Edit | null;
    try {
      e = jsonEdit(JSON.parse(lines[i]!));
    } catch {
      e = null;
    }
    if (e === null) throw parseError(i + 1);
    edits.push(e);
  }
  return edits;
}

// ---------------------------------------------------------------------------------------------------------------
// The command line, the edits in order, and the all-or-nothing write (SPEC.md sections 1, 2 and 10)

const byteOrder = (a: string, b: string): number => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));

function mend(args: string[], stdin: () => string): { code: number; out: string[] } {
  let format: string | null = null;
  let check = false;
  let strict = false;
  let optionsEnded = false;
  const positional: string[] = [];
  for (const a of args) {
    if (!optionsEnded && a === '--') {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && a.startsWith('-') && a !== '-') {
      if (a.startsWith('--format=') && format === null && FORMAT_NAMES.includes(a.slice('--format='.length))) format = a.slice('--format='.length);
      else if (a === '--check' && !check) check = true;
      else if (a === '--strict' && !strict) strict = true;
      else return { code: 2, out: ['error: usage'] };
      continue;
    }
    positional.push(a);
  }
  if (positional.length > 1) return { code: 2, out: ['error: usage'] };

  const source = positional.length === 0 || positional[0] === '-' ? null : positional[0]!;
  let text: string;
  if (source === null) text = stdin();
  else {
    try {
      text = readFileSync(source, 'utf8');
    } catch {
      return { code: 2, out: ['error: no-patch'] };
    }
  }

  const lines = splitPatch(text);
  const kind = format === null || format === 'auto' ? detectFormat(lines) : format;
  if (kind === null) return { code: 2, out: ['error: format'] };

  let edits: Edit[];
  try {
    if (kind === 'unified') edits = parseUnified(lines);
    else if (kind === 'search-replace') edits = parseSearchReplace(lines);
    else if (kind === 'v4a') edits = parseV4A(lines);
    else edits = parseJson(text, lines);
    if (edits.length === 0) throw parseError(1);
  } catch (e) {
    if (e instanceof Stop) return { code: 2, out: [e.line] };
    throw e;
  }

  const tree = new Tree();
  const failures: Failure[] = [];
  const moves: Array<[string, string]> = [];
  for (const edit of edits) {
    const saved = new Map(tree.after);
    try {
      edit.apply(tree, strict);
      if (edit.move !== undefined) moves.push(edit.move);
    } catch (e) {
      if (!(e instanceof Failure)) throw e;
      tree.after.clear();
      for (const [k, v] of saved) tree.after.set(k, v);
      failures.push(e);
    }
  }
  if (failures.length > 0) {
    return {
      code: 1,
      out: [...failures.map((f) => `error: ${f.code} ${f.path}`), `failed: ${failures.length} of ${edits.length} edits`],
    };
  }

  // Each path whose state changed; a successful move whose old path is gone and new path is new is one R line.
  const changed = new Map<string, { was: string | null; now: string | null }>();
  for (const [p, now] of tree.after) {
    const was = tree.original(p);
    if (was !== now) changed.set(p, { was, now });
  }
  const rows: Array<{ key: string; line: string }> = [];
  const used = new Set<string>();
  for (const [from, to] of moves) {
    const a = changed.get(from);
    const b = changed.get(to);
    if (used.has(from) || used.has(to) || a === undefined || b === undefined) continue;
    if (a.was !== null && a.now === null && b.was === null && b.now !== null) {
      used.add(from);
      used.add(to);
      rows.push({ key: to, line: `R ${from} -> ${to}` });
    }
  }
  for (const [p, { was, now }] of changed) {
    if (used.has(p)) continue;
    rows.push({ key: p, line: `${was === null ? 'A' : now === null ? 'D' : 'M'} ${p}` });
  }
  rows.sort((x, y) => byteOrder(x.key, y.key));

  if (!check) {
    for (const [p, { now }] of [...changed].sort((x, y) => byteOrder(x[0], y[0]))) {
      if (now === null) rmSync(p, { force: true });
    }
    for (const [p, { now }] of [...changed].sort((x, y) => byteOrder(x[0], y[0]))) {
      if (now === null) continue;
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, now);
    }
  }
  return { code: 0, out: [...rows.map((r) => r.line), `ok: ${rows.length} ${rows.length === 1 ? 'file' : 'files'}`] };
}

function readStdin(): string {
  try {
    return readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

const trialEnv = process.env.MAKEFUN_ENV_URL;
if (trialEnv !== undefined && trialEnv !== '') {
  // A trial: the kit's runner reads the checks from the env and runs this file on each one, without this variable.
  const { runTrial } = await import('./runner.ts');
  await runTrial(trialEnv);
} else {
  const r = mend(process.argv.slice(2), readStdin);
  writeSync(1, r.out.map((l) => `${l}\n`).join(''));
  process.exitCode = r.code;
}
