import { describe, expect, it } from 'vitest';
import {
  clampMetadataText,
  preprocessReadme,
  README_CODE_BLOCK_MAX_CHARS,
} from '../src/preprocess';

describe('README preprocessing', () => {
  it('README-5: truncates to maxChars and caps oversized code blocks', () => {
    const out = preprocessReadme(`# Title\n\n${'x'.repeat(5000)}`, { maxChars: 1000 });
    expect(out.length).toBeLessThanOrEqual(1000);

    const code = '```js\n' + 'a'.repeat(README_CODE_BLOCK_MAX_CHARS + 500) + '\n```';
    const capped = preprocessReadme(`intro\n\n${code}\n\nmore`, { maxChars: 100_000 });
    expect(capped).toContain('[code truncated]');
    expect(capped.length).toBeLessThan(README_CODE_BLOCK_MAX_CHARS + 200);
  });

  it('README-6: removes badge/image embeds and HTML comments (nothing fetchable remains)', () => {
    const raw = [
      '<!-- hidden comment -->',
      '[![build](https://img.shields.io/x.svg)](https://ci.example/x)',
      '![logo](https://example.com/logo.png)',
      '<img src="https://example.com/banner.png" alt="banner">',
      'Real prose describing the project.',
    ].join('\n');
    const out = preprocessReadme(raw, { maxChars: 100_000 });
    expect(out).not.toContain('shields.io');
    expect(out).not.toContain('logo.png');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('hidden comment');
    expect(out).toContain('Real prose describing the project.');
  });

  it('normalizes Unicode (NFC) and line endings (CRLF/CR → LF)', () => {
    expect(preprocessReadme('a\r\nb\rc', { maxChars: 100 })).toBe('a\nb\nc');
    expect(preprocessReadme('é', { maxChars: 100 })).toBe('é');
  });

  it('clampMetadataText collapses whitespace and bounds length', () => {
    expect(clampMetadataText('  a   b\tc  ', 100)).toBe('a b c');
    expect(clampMetadataText('x'.repeat(50), 10).length).toBeLessThanOrEqual(10);
  });
});
