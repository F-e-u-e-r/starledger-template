/**
 * Untrusted-input preprocessing. Every function here is PURE: it takes a string
 * and returns a string. It has no network access, so a link, image, or
 * instruction embedded in a README can never cause a fetch or any side effect
 * (README-6). The goal is a bounded, de-noised, factual text for classification —
 * not to render or trust the content.
 */

const HTML_COMMENT = /<!--[\s\S]*?-->/g;
/** `[![alt](badge.svg)](href)` — a linked shield/badge. Removed before plain images. */
const LINKED_IMAGE = /\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g;
/** `![alt](src)` — a markdown image. */
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const HTML_IMG = /<img\b[^>]*>/gi;
const HTML_PICTURE = /<\/?(?:picture|source)\b[^>]*>/gi;

/** Per-fenced-block body cap: a generated or minified blob cannot dominate the budget. */
export const README_CODE_BLOCK_MAX_CHARS = 1_500;

/**
 * Truncate the body of each fenced code block (``` or ~~~) so a single huge
 * block cannot crowd out prose. The fence and language hint are preserved; the
 * body is sliced and marked. Deterministic and bounded.
 */
function capCodeBlocks(text: string, maxPerBlock: number): string {
  return text.replace(
    /(^|\n)(```|~~~)([^\n]*)\n([\s\S]*?)(\n\2)/g,
    (match: string, pre: string, fence: string, info: string, body: string, close: string) => {
      if (body.length <= maxPerBlock) return match;
      return `${pre}${fence}${info}\n${body.slice(0, maxPerBlock)}\n… [code truncated]${close}`;
    },
  );
}

export interface PreprocessReadmeOptions {
  /** Hard ceiling on the returned text length. */
  maxChars: number;
  /** Per-fenced-block body cap (defaults to README_CODE_BLOCK_MAX_CHARS). */
  codeBlockMaxChars?: number;
}

/**
 * Normalize and bound a raw README into untrusted classification input:
 * NFC, LF line endings, badge/image/comment noise removed, code blocks capped,
 * blank runs collapsed, then truncated to `maxChars`. Never fetches anything.
 */
export function preprocessReadme(raw: string, opts: PreprocessReadmeOptions): string {
  const codeMax = opts.codeBlockMaxChars ?? README_CODE_BLOCK_MAX_CHARS;
  let text = raw.normalize('NFC').replace(/\r\n?/g, '\n');
  text = text.replace(HTML_COMMENT, '');
  text = text.replace(LINKED_IMAGE, '');
  text = text.replace(MARKDOWN_IMAGE, '');
  text = text.replace(HTML_IMG, '');
  text = text.replace(HTML_PICTURE, '');
  text = capCodeBlocks(text, codeMax);
  text = text.replace(/[ \t]+\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();
  return text.length > opts.maxChars ? text.slice(0, opts.maxChars).trimEnd() : text;
}

/**
 * Bound a short canonical metadata string (e.g. the repository description) for a
 * metadata-only classification: NFC, whitespace collapsed, capped. Pure.
 */
export function clampMetadataText(text: string, maxChars: number): string {
  const normalized = text
    .normalize('NFC')
    .replace(/\r\n?/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return normalized.length > maxChars ? normalized.slice(0, maxChars).trimEnd() : normalized;
}
