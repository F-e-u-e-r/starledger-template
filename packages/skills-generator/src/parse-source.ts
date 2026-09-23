import type { SkillsCategory } from '@starred/skills-schema';
import { normalizePlainText } from '@starred/skills-schema';

/**
 * Strict parser for the vendored `skills-classified.md` (P7 §4.9, option B):
 * the source stays VERBATIM and this parser owns the explicit source→semantic
 * normalization. Gate 1: NO generic cleanup — lines are read raw (trailing
 * whitespace is a violation, not something to trim away), table cells must
 * sit in exact `| content |` form, and the ONLY normalizations performed are
 * the documented ones (§4.2 NFC/whitespace canonicalization of free text and
 * the §4.9 editorial-annotation projection). Required structure — the scheme
 * heading, both kind headings, both section h1s, the total line, the
 * multi-fit table, the closing verification line — must each appear exactly
 * once, in order; every data-bearing line must match its whitelisted form;
 * anything else fails, named with its line number, and all violations are
 * collected before reporting.
 */

/**
 * §4.9 target-pack source grammar: the COMPLETE accepted forms, mapped to
 * their semantic projection. Anything else — `opus-pack foo`, `opus-pack
 * (later)`, missing space, case variants, trailing text — is a generator
 * error. No trim/startsWith/leading-token parsing.
 */
const TARGET_PACK_SOURCE_FORMS = new Map<string, 'opus-pack' | 'design-pack'>([
  ['opus-pack', 'opus-pack'],
  ['design-pack', 'design-pack'],
  ['opus-pack (to be split out later)', 'opus-pack'],
]);

/** §4.9 slug rule: non-[a-z0-9] runs → single '-', trimmed. */
export function deriveCategoryId(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface ParsedEntry {
  source_name_with_owner: string;
  summary: string;
  primary_category_id: string;
  secondary_category_ids: string[];
  /** 1-based line in the vendored source — diagnostics only. */
  source_line: number;
}

export interface ParsedSource {
  categories: SkillsCategory[];
  entries: ParsedEntry[];
}

export type ParseSourceResult =
  | { ok: true; source: ParsedSource }
  | { ok: false; issues: string[] };

interface SchemeRow {
  label: string;
  definition: string;
  declaredCount: number;
  packSource: string | null;
  kind: 'domain' | 'infrastructure';
  line: number;
}

interface Section {
  label: string;
  declaredCount: number;
  packSource: string | null;
  definition: string | null;
  h1Kind: 'domain' | 'infrastructure';
  entries: RawEntry[];
  line: number;
}

interface RawEntry {
  name: string;
  summaryRaw: string;
  secondaryLabel: string | null;
  line: number;
}

interface MultiFitRow {
  name: string;
  primaryLabel: string;
  secondaryLabel: string;
  line: number;
}

const SCHEME_HEADING = '## Category scheme';
const DOMAIN_H3 = '### Domain-skill categories';
const INFRA_H3 = '### Infrastructure categories (excluded from domain skill packs)';
const DOMAIN_H1 = '# Domain-skill categories';
const INFRA_H1 = '# Infrastructure categories';
const MULTI_FIT_HEADING = '## Multi-fit repos (primary / secondary)';

const SECTION_RE = /^## (.+?) \((\d+)\)(?: — target pack: \*\*(.+?)\*\*)?$/;
/** ★count: plain digits or standard thousands grouping — read and discarded (§4.2). */
const ENTRY_RE = /^- (\S+) \(★(\d{1,3}(?:,\d{3})*|\d+)\) — (.+)$/;
/** Exactly one space before the marker; the label itself must carry no padding. */
const SECONDARY_RE = /^(.*) \[secondary: ([^\]]+)\]$/;
const TABLE_DIVIDER_RE = /^\|(?:-+\|)+$/;
const TOTAL_RE = /^\*\*Total: (\d+) \+ (\d+) = (\d+) repos\.\*\*$/;
const SUBTOTAL_DOMAIN_RE = /^\| \*\*Subtotal\*\* \| \| \*\*(\d+)\*\* \| \|$/;
const SUBTOTAL_INFRA_RE = /^\| \*\*Subtotal\*\* \| \| \*\*(\d+)\*\* \|$/;

/**
 * Exact cell grammar: a row is `|` + N cells + `|`, each cell either empty,
 * a lone space (an intentionally blank cell), or ` content ` with exactly one
 * space of padding and no inner leading/trailing whitespace. Anything else is
 * malformed — padded/misaligned cells are rejected, never trimmed into shape.
 */
function splitStrictTableRow(line: string): { cells?: string[]; problem?: string } {
  if (!line.startsWith('|') || !line.endsWith('|')) {
    return { problem: 'table row must start and end with "|"' };
  }
  const rawCells = line.slice(1, -1).split('|');
  const cells: string[] = [];
  for (const raw of rawCells) {
    if (raw === '' || raw === ' ') {
      cells.push('');
      continue;
    }
    if (!raw.startsWith(' ') || !raw.endsWith(' ')) {
      return { problem: `cell ${JSON.stringify(raw)} lacks the exact single-space padding` };
    }
    const content = raw.slice(1, -1);
    if (content !== content.trim()) {
      return { problem: `cell ${JSON.stringify(raw)} carries extra inner whitespace` };
    }
    cells.push(content);
  }
  return { cells };
}

/**
 * Shapes that always carry data in this grammar. Prose positions (preamble,
 * table intros) may hold anything EXCEPT these — so a stray table row, entry
 * bullet, heading, total, or verification line can never hide as "prose".
 */
function isDataBearingShape(line: string): boolean {
  return (
    line.startsWith('|') ||
    line.startsWith('- ') ||
    line.startsWith('#') ||
    line.startsWith('**Total:') ||
    line.startsWith('**Verification:')
  );
}

export function parseSkillsClassifiedSource(text: string): ParseSourceResult {
  const issues: string[] = [];
  const lines = text.split('\n');

  const schemeRows: SchemeRow[] = [];
  const sections: Section[] = [];
  const multiFit: MultiFitRow[] = [];
  let totalLine: { domain: number; infra: number; total: number } | null = null;
  const subtotals = new Map<'domain' | 'infrastructure', { value: number; line: number }>();

  type Zone = 'preamble' | 'scheme' | 'sections' | 'multi-fit' | 'tail';
  let zone: Zone = 'preamble';
  let schemeKind: 'domain' | 'infrastructure' | null = null;
  let schemeHeaderSeen = false;
  let schemeDividerSeen = false;
  let schemeTableStarted = false;
  let sectionH1: 'domain' | 'infrastructure' | null = null;
  let multiFitHeaderSeen = false;
  let multiFitDividerSeen = false;
  let currentSection: Section | null = null;
  let titleSeen = false;
  let verificationSeen = false;
  const seenOnce = new Map<string, number>();
  const hrIndices: number[] = [];

  const requireOnce = (marker: string, lineNo: number): boolean => {
    const prior = seenOnce.get(marker);
    if (prior !== undefined) {
      issues.push(`line ${lineNo}: duplicate ${marker} (first at line ${prior})`);
      return false;
    }
    seenOnce.set(marker, lineNo);
    return true;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const lineNo = index + 1;
    if (/[ \t]+$/.test(line)) {
      issues.push(`line ${lineNo}: trailing whitespace (gate 1 forbids cleanup; fix the source)`);
      continue;
    }
    if (line === '') continue;
    if (line === '---') {
      if (zone === 'tail') {
        issues.push(`line ${lineNo}: unexpected content after the verification line: ${line}`);
      } else {
        hrIndices.push(index);
      }
      continue;
    }

    // --- zone transitions (each structural marker exactly once, in order) ---
    if (line === SCHEME_HEADING) {
      if (requireOnce(SCHEME_HEADING, lineNo) && zone !== 'preamble') {
        issues.push(`line ${lineNo}: ${SCHEME_HEADING} out of order (in ${zone})`);
      }
      zone = 'scheme';
      continue;
    }
    if (line === DOMAIN_H1 || line === INFRA_H1) {
      requireOnce(line, lineNo);
      if (line === DOMAIN_H1 && zone !== 'scheme') {
        issues.push(`line ${lineNo}: ${DOMAIN_H1} out of order (in ${zone})`);
      }
      if (line === INFRA_H1 && !(zone === 'sections' && sectionH1 === 'domain')) {
        issues.push(`line ${lineNo}: ${INFRA_H1} out of order`);
      }
      zone = 'sections';
      sectionH1 = line === DOMAIN_H1 ? 'domain' : 'infrastructure';
      currentSection = null;
      continue;
    }
    if (line === MULTI_FIT_HEADING) {
      if (requireOnce(MULTI_FIT_HEADING, lineNo) && zone !== 'sections') {
        issues.push(`line ${lineNo}: ${MULTI_FIT_HEADING} out of order (in ${zone})`);
      }
      zone = 'multi-fit';
      currentSection = null;
      continue;
    }

    if (zone === 'preamble') {
      if (line.startsWith('# ')) {
        if (titleSeen) issues.push(`line ${lineNo}: second title heading in the preamble`);
        titleSeen = true;
        continue;
      }
      if (line.startsWith('#')) {
        issues.push(`line ${lineNo}: unrecognized heading in preamble: ${line}`);
        continue;
      }
      if (isDataBearingShape(line)) {
        issues.push(`line ${lineNo}: data-bearing line in the preamble: ${line}`);
        continue;
      }
      continue; // preamble prose is not data-bearing
    }

    if (zone === 'scheme') {
      if (line === DOMAIN_H3) {
        requireOnce(DOMAIN_H3, lineNo);
        schemeKind = 'domain';
        schemeHeaderSeen = false;
        schemeDividerSeen = false;
        continue;
      }
      if (line === INFRA_H3) {
        if (requireOnce(INFRA_H3, lineNo) && !seenOnce.has(DOMAIN_H3)) {
          issues.push(`line ${lineNo}: infrastructure scheme table precedes the domain table`);
        }
        schemeKind = 'infrastructure';
        schemeHeaderSeen = false;
        schemeDividerSeen = false;
        continue;
      }
      const totalMatch = TOTAL_RE.exec(line);
      if (totalMatch) {
        if (requireOnce('total line', lineNo)) {
          if (!subtotals.has('domain') || !subtotals.has('infrastructure')) {
            issues.push(`line ${lineNo}: total line before both subtotal rows`);
          }
          totalLine = {
            domain: Number(totalMatch[1]),
            infra: Number(totalMatch[2]),
            total: Number(totalMatch[3]),
          };
        }
        continue;
      }
      if (line.startsWith('**Total:')) {
        issues.push(`line ${lineNo}: malformed total line: ${line}`);
        continue;
      }
      if (line.startsWith('|')) {
        schemeTableStarted = true;
        if (schemeKind === null) {
          issues.push(`line ${lineNo}: scheme table row before a category-kind heading`);
          continue;
        }
        if (totalLine !== null) {
          issues.push(`line ${lineNo}: table row after the total line`);
          continue;
        }
        if (subtotals.has(schemeKind)) {
          issues.push(`line ${lineNo}: table row after the ${schemeKind} subtotal`);
          continue;
        }
        const expectedColumns = schemeKind === 'domain' ? 4 : 3;
        if (TABLE_DIVIDER_RE.test(line)) {
          const columns = line.split('|').length - 2;
          if (!schemeHeaderSeen) {
            issues.push(`line ${lineNo}: table divider before its header row`);
          } else if (schemeDividerSeen) {
            issues.push(`line ${lineNo}: duplicate table divider`);
          } else if (columns !== expectedColumns) {
            issues.push(
              `line ${lineNo}: divider has ${columns} columns, expected ${expectedColumns}`,
            );
          }
          schemeDividerSeen = true;
          continue;
        }
        const subtotalRe = schemeKind === 'domain' ? SUBTOTAL_DOMAIN_RE : SUBTOTAL_INFRA_RE;
        const subtotalMatch = subtotalRe.exec(line);
        if (subtotalMatch) {
          if (!schemeDividerSeen) {
            issues.push(`line ${lineNo}: subtotal row before the required divider`);
          }
          const priorSubtotal = subtotals.get(schemeKind);
          if (priorSubtotal !== undefined) {
            issues.push(
              `line ${lineNo}: duplicate ${schemeKind} subtotal (first at line ${priorSubtotal.line})`,
            );
          } else {
            subtotals.set(schemeKind, { value: Number(subtotalMatch[1]), line: lineNo });
          }
          continue;
        }
        if (line.includes('**Subtotal**')) {
          issues.push(`line ${lineNo}: malformed subtotal row: ${line}`);
          continue;
        }
        const split = splitStrictTableRow(line);
        if (split.problem !== undefined) {
          issues.push(`line ${lineNo}: ${split.problem}`);
          continue;
        }
        const cells = split.cells!;
        if (!schemeHeaderSeen) {
          schemeHeaderSeen = true;
          const expected =
            schemeKind === 'domain'
              ? ['Category', 'Definition', 'Count', 'Target pack']
              : ['Category', 'Definition', 'Count'];
          if (JSON.stringify(cells) !== JSON.stringify(expected)) {
            issues.push(`line ${lineNo}: unexpected ${schemeKind} scheme table header: ${line}`);
          }
          continue;
        }
        if (!schemeDividerSeen) {
          issues.push(`line ${lineNo}: table row before the required divider`);
        }
        const expectedWidth = expectedColumns;
        if (cells.length !== expectedWidth) {
          issues.push(
            `line ${lineNo}: ${schemeKind} scheme row has ${cells.length} cells, expected ${expectedWidth}`,
          );
          continue;
        }
        const [label, definition, countText] = cells as [string, string, string];
        const packCell = schemeKind === 'domain' ? (cells[3] ?? '') : '';
        if (!/^\d+$/.test(countText)) {
          issues.push(`line ${lineNo}: non-numeric count ${countText} for ${label}`);
          continue;
        }
        let packSource: string | null = null;
        if (schemeKind === 'domain' && packCell !== '-') {
          if (!TARGET_PACK_SOURCE_FORMS.has(packCell)) {
            issues.push(
              `line ${lineNo}: target-pack source form not in the §4.9 whitelist: ${JSON.stringify(packCell)}`,
            );
            continue;
          }
          packSource = packCell;
        }
        schemeRows.push({
          label,
          definition,
          declaredCount: Number(countText),
          packSource,
          kind: schemeKind,
          line: lineNo,
        });
        continue;
      }
      if (schemeTableStarted) {
        issues.push(`line ${lineNo}: unrecognized line inside the scheme zone: ${line}`);
        continue;
      }
      if (isDataBearingShape(line)) {
        issues.push(`line ${lineNo}: data-bearing line in the scheme intro: ${line}`);
      }
      continue; // intro prose before any table is not data-bearing
    }

    if (zone === 'sections') {
      const sectionMatch = SECTION_RE.exec(line);
      if (sectionMatch) {
        let packSource: string | null = null;
        const packText = sectionMatch[3];
        if (packText !== undefined) {
          if (!TARGET_PACK_SOURCE_FORMS.has(packText)) {
            issues.push(
              `line ${lineNo}: target-pack source form not in the §4.9 whitelist: ${JSON.stringify(packText)}`,
            );
          } else {
            packSource = packText;
          }
        }
        currentSection = {
          label: sectionMatch[1] ?? '',
          declaredCount: Number(sectionMatch[2]),
          packSource,
          definition: null,
          h1Kind: sectionH1 ?? 'domain',
          entries: [],
          line: lineNo,
        };
        sections.push(currentSection);
        continue;
      }
      if (line.startsWith('## ')) {
        issues.push(`line ${lineNo}: section heading does not match the §4.9 form: ${line}`);
        currentSection = null;
        continue;
      }
      if (/^\*[^*].*\*$/.test(line)) {
        if (currentSection === null) {
          // A zone-level italic preface (e.g. under `# Infrastructure
          // categories`) — prose, not data-bearing. Section definitions stay
          // mandatory and cross-validated, so nothing can silently skip.
          continue;
        } else if (currentSection.definition !== null) {
          issues.push(`line ${lineNo}: second definition line in section ${currentSection.label}`);
        } else {
          currentSection.definition = line.slice(1, -1);
        }
        continue;
      }
      if (line.startsWith('- ')) {
        const entryMatch = ENTRY_RE.exec(line);
        if (!entryMatch || currentSection === null) {
          issues.push(
            `line ${lineNo}: entry bullet does not match the §4.9 form${currentSection === null ? ' (outside any section)' : ''}: ${line}`,
          );
          continue;
        }
        // ★count is source-only: validated by the regex, read, and discarded (§4.2).
        let summaryRaw = entryMatch[3] ?? '';
        let secondaryLabel: string | null = null;
        // Reserved-marker guard: '[secondary:' may appear ONLY as exactly one
        // valid tail marker — a malformed variant (missing space) or a second
        // marker must fail, never be absorbed into the summary as prose.
        const markerCount = summaryRaw.split('[secondary:').length - 1;
        const secondaryMatch = SECONDARY_RE.exec(summaryRaw);
        if (markerCount > 1 || (markerCount === 1 && !secondaryMatch)) {
          issues.push(`line ${lineNo}: malformed or repeated [secondary: ...] marker: ${line}`);
          continue;
        }
        if (secondaryMatch) {
          const beforeMarker = secondaryMatch[1] ?? '';
          const label = secondaryMatch[2] ?? '';
          // Gate 1: exact marker grammar — no padded labels, no doubled
          // separator space silently absorbed.
          if (label !== label.trim() || beforeMarker !== beforeMarker.trimEnd()) {
            issues.push(`line ${lineNo}: malformed [secondary: …] marker spacing: ${line}`);
            continue;
          }
          if (beforeMarker.includes('[secondary:')) {
            issues.push(`line ${lineNo}: repeated [secondary: ...] marker: ${line}`);
            continue;
          }
          summaryRaw = beforeMarker;
          secondaryLabel = label;
        }
        const entryName = entryMatch[1] ?? '';
        if (entryName.split('/').length !== 2 || entryName.split('/').some((part) => part === '')) {
          issues.push(`line ${lineNo}: entry name is not <owner/name>: ${entryName}`);
          continue;
        }
        currentSection.entries.push({
          name: entryName,
          summaryRaw,
          secondaryLabel,
          line: lineNo,
        });
        continue;
      }
      issues.push(`line ${lineNo}: unrecognized line inside the sections zone: ${line}`);
      continue;
    }

    if (zone === 'multi-fit') {
      if (line.startsWith('|')) {
        if (TABLE_DIVIDER_RE.test(line)) {
          const columns = line.split('|').length - 2;
          if (!multiFitHeaderSeen) {
            issues.push(`line ${lineNo}: multi-fit divider before its header row`);
          } else if (multiFitDividerSeen) {
            issues.push(`line ${lineNo}: duplicate multi-fit divider`);
          } else if (columns !== 3) {
            issues.push(`line ${lineNo}: multi-fit divider has ${columns} columns, expected 3`);
          }
          multiFitDividerSeen = true;
          continue;
        }
        const split = splitStrictTableRow(line);
        if (split.problem !== undefined) {
          issues.push(`line ${lineNo}: ${split.problem}`);
          continue;
        }
        const cells = split.cells!;
        if (!multiFitHeaderSeen) {
          multiFitHeaderSeen = true;
          if (JSON.stringify(cells) !== JSON.stringify(['Repo', 'Primary', 'Secondary'])) {
            issues.push(`line ${lineNo}: unexpected multi-fit table header: ${line}`);
          }
          continue;
        }
        if (!multiFitDividerSeen) {
          issues.push(`line ${lineNo}: multi-fit row before the required divider`);
        }
        if (cells.length !== 3) {
          issues.push(`line ${lineNo}: multi-fit row has ${cells.length} cells, expected 3`);
          continue;
        }
        multiFit.push({
          name: cells[0] ?? '',
          primaryLabel: cells[1] ?? '',
          secondaryLabel: cells[2] ?? '',
          line: lineNo,
        });
        continue;
      }
      if (line.startsWith('**Verification:')) {
        if (!/^\*\*Verification: .+\*\*$/.test(line)) {
          issues.push(`line ${lineNo}: malformed verification line (must close with **): ${line}`);
          continue;
        }
        requireOnce('verification line', lineNo);
        verificationSeen = true;
        zone = 'tail';
        continue;
      }
      if (multiFitHeaderSeen) {
        issues.push(`line ${lineNo}: unrecognized line inside the multi-fit zone: ${line}`);
        continue;
      }
      if (isDataBearingShape(line)) {
        issues.push(`line ${lineNo}: data-bearing line in the multi-fit intro: ${line}`);
      }
      continue; // the single prose intro sentence before the table
    }

    // tail: nothing but blank lines/hr after the verification line.
    issues.push(`line ${lineNo}: unexpected content after the verification line: ${line}`);
  }

  // Horizontal rules are zone separators ONLY: each must immediately precede
  // a zone-boundary line (a section h1, the multi-fit heading, or the closing
  // verification line). An hr inside a table or between entries is a
  // misplaced separator, not decoration (hosted review finding).
  for (const hrIndex of hrIndices) {
    let next = '';
    for (let j = hrIndex + 1; j < lines.length; j += 1) {
      const candidate = lines[j] ?? '';
      if (candidate !== '') {
        next = candidate;
        break;
      }
    }
    const allowed =
      next === '' ||
      next === DOMAIN_H1 ||
      next === INFRA_H1 ||
      next === MULTI_FIT_HEADING ||
      /^\*\*Verification: .+\*\*$/.test(next);
    if (!allowed) {
      issues.push(
        `line ${hrIndex + 1}: horizontal rule in a non-boundary position (next content: ${next})`,
      );
    }
  }

  // ---- required structure present exactly once ----
  for (const marker of [
    SCHEME_HEADING,
    DOMAIN_H3,
    INFRA_H3,
    DOMAIN_H1,
    INFRA_H1,
    MULTI_FIT_HEADING,
  ]) {
    if (!seenOnce.has(marker)) issues.push(`missing required structure: ${marker}`);
  }
  if (!titleSeen) issues.push('missing title heading');
  if (totalLine === null) issues.push('missing total line (**Total: … repos.**)');
  if (!multiFitHeaderSeen && seenOnce.has(MULTI_FIT_HEADING)) {
    issues.push('multi-fit section has no table header');
  }
  if (multiFitHeaderSeen && !multiFitDividerSeen) {
    issues.push('multi-fit table has no divider row');
  }
  if (!verificationSeen) issues.push('missing closing **Verification: …** line');

  // ---- cross-validation (§4.9): source self-consistency ----

  const byLabel = new Map<string, SchemeRow>();
  for (const row of schemeRows) {
    if (byLabel.has(row.label)) {
      issues.push(`line ${row.line}: duplicate scheme-table category label ${row.label}`);
    }
    byLabel.set(row.label, row);
  }
  const idToLabel = new Map<string, string>();
  for (const row of schemeRows) {
    const id = deriveCategoryId(row.label);
    if (idToLabel.has(id) && idToLabel.get(id) !== row.label) {
      issues.push(`derived category id ${id} collides: ${idToLabel.get(id)!} vs ${row.label}`);
    }
    idToLabel.set(id, row.label);
  }

  const sectionByLabel = new Map<string, Section>();
  for (const section of sections) {
    if (sectionByLabel.has(section.label)) {
      issues.push(`line ${section.line}: duplicate section ${section.label}`);
    }
    sectionByLabel.set(section.label, section);
    const scheme = byLabel.get(section.label);
    if (!scheme) {
      issues.push(`line ${section.line}: section ${section.label} has no scheme-table row`);
      continue;
    }
    if (scheme.kind !== section.h1Kind) {
      issues.push(
        `section ${section.label}: filed under the ${section.h1Kind} h1 but the scheme table declares it ${scheme.kind}`,
      );
    }
    if ((scheme.packSource ?? null) !== (section.packSource ?? null)) {
      issues.push(
        `section ${section.label}: target-pack source form mismatch — scheme table ${JSON.stringify(scheme.packSource)} vs section header ${JSON.stringify(section.packSource)}`,
      );
    }
    if (section.definition === null) {
      issues.push(`section ${section.label}: missing italic definition line`);
    } else if (section.definition !== scheme.definition) {
      issues.push(
        `section ${section.label}: definition mismatch — scheme table ${JSON.stringify(scheme.definition)} vs section ${JSON.stringify(section.definition)}`,
      );
    }
    if (section.entries.length !== section.declaredCount) {
      issues.push(
        `section ${section.label}: declares ${section.declaredCount} entries, contains ${section.entries.length}`,
      );
    }
    if (section.declaredCount !== scheme.declaredCount) {
      issues.push(
        `section ${section.label}: declared count ${section.declaredCount} != scheme-table count ${scheme.declaredCount}`,
      );
    }
  }
  for (const row of schemeRows) {
    if (!sectionByLabel.has(row.label)) {
      issues.push(`scheme-table category ${row.label} has no entry section`);
    }
  }

  const domainSum = schemeRows
    .filter((row) => row.kind === 'domain')
    .reduce((sum, row) => sum + row.declaredCount, 0);
  const infraSum = schemeRows
    .filter((row) => row.kind === 'infrastructure')
    .reduce((sum, row) => sum + row.declaredCount, 0);
  const domainSubtotal = subtotals.get('domain');
  const infraSubtotal = subtotals.get('infrastructure');
  if (domainSubtotal === undefined) issues.push('missing domain subtotal row');
  else if (domainSubtotal.value !== domainSum) {
    issues.push(`domain subtotal ${domainSubtotal.value} != sum of domain counts ${domainSum}`);
  }
  if (infraSubtotal === undefined) issues.push('missing infrastructure subtotal row');
  else if (infraSubtotal.value !== infraSum) {
    issues.push(
      `infrastructure subtotal ${infraSubtotal.value} != sum of infra counts ${infraSum}`,
    );
  }
  if (totalLine !== null) {
    if (totalLine.domain !== domainSum || totalLine.infra !== infraSum) {
      issues.push(
        `total line ${totalLine.domain}+${totalLine.infra} != table sums ${domainSum}+${infraSum}`,
      );
    }
    if (totalLine.total !== domainSum + infraSum) {
      issues.push(`total line sum ${totalLine.total} != ${domainSum + infraSum}`);
    }
  }

  const allEntries: ParsedEntry[] = [];
  const seenNames = new Map<string, number>();
  const labelToId = new Map<string, string>();
  for (const row of schemeRows) labelToId.set(row.label, deriveCategoryId(row.label));
  for (const section of sections) {
    const primaryId = labelToId.get(section.label);
    for (const raw of section.entries) {
      const lowered = raw.name.toLowerCase();
      const priorLine = seenNames.get(lowered);
      if (priorLine !== undefined) {
        issues.push(
          `line ${raw.line}: duplicate source_name_with_owner ${raw.name} (first at line ${priorLine})`,
        );
      }
      seenNames.set(lowered, raw.line);
      const secondaryIds: string[] = [];
      if (raw.secondaryLabel !== null) {
        const secondaryId = labelToId.get(raw.secondaryLabel);
        if (secondaryId === undefined) {
          issues.push(
            `line ${raw.line}: secondary label ${JSON.stringify(raw.secondaryLabel)} matches no category`,
          );
        } else {
          secondaryIds.push(secondaryId);
        }
      }
      // §4.2 documented normalization only (NFC + whitespace); nothing else.
      const summary = normalizePlainText(raw.summaryRaw);
      allEntries.push({
        source_name_with_owner: raw.name,
        summary,
        primary_category_id: primaryId ?? deriveCategoryId(section.label),
        secondary_category_ids: secondaryIds,
        source_line: raw.line,
      });
    }
  }

  const secondaryCarrying = new Map<string, ParsedEntry>();
  for (const entry of allEntries) {
    if (entry.secondary_category_ids.length > 0) {
      secondaryCarrying.set(entry.source_name_with_owner.toLowerCase(), entry);
    }
  }
  if (multiFit.length !== secondaryCarrying.size) {
    issues.push(
      `multi-fit table has ${multiFit.length} rows but ${secondaryCarrying.size} entries carry a secondary marker`,
    );
  }
  const multiFitSeen = new Set<string>();
  for (const row of multiFit) {
    const key = row.name.toLowerCase();
    if (multiFitSeen.has(key)) {
      issues.push(`line ${row.line}: duplicate multi-fit row for ${row.name}`);
    }
    multiFitSeen.add(key);
    const entry = secondaryCarrying.get(key);
    if (!entry) {
      issues.push(`line ${row.line}: multi-fit row ${row.name} has no secondary-carrying entry`);
      continue;
    }
    const expectedPrimary = labelToId.get(row.primaryLabel);
    const expectedSecondary = labelToId.get(row.secondaryLabel);
    if (expectedPrimary === undefined) {
      issues.push(`line ${row.line}: multi-fit primary label ${row.primaryLabel} unknown`);
    } else if (entry.primary_category_id !== expectedPrimary) {
      issues.push(
        `multi-fit row ${row.name}: primary ${row.primaryLabel} != entry section ${entry.primary_category_id}`,
      );
    }
    if (expectedSecondary === undefined) {
      issues.push(`line ${row.line}: multi-fit secondary label ${row.secondaryLabel} unknown`);
    } else if (!entry.secondary_category_ids.includes(expectedSecondary)) {
      issues.push(
        `multi-fit row ${row.name}: secondary ${row.secondaryLabel} != entry marker ${entry.secondary_category_ids.join(',')}`,
      );
    }
  }
  for (const [key, entry] of secondaryCarrying) {
    if (!multiFitSeen.has(key)) {
      issues.push(
        `entry ${entry.source_name_with_owner} carries a secondary marker but has no multi-fit row`,
      );
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  // Categories in canonical shape: table appearance order is `order` (§4.9).
  const categories: SkillsCategory[] = schemeRows.map((row, index) => ({
    id: deriveCategoryId(row.label),
    label: normalizePlainText(row.label),
    kind: row.kind,
    definition: normalizePlainText(row.definition),
    order: index,
    target_pack: row.packSource === null ? null : TARGET_PACK_SOURCE_FORMS.get(row.packSource)!,
  }));

  return { ok: true, source: { categories, entries: allEntries } };
}
