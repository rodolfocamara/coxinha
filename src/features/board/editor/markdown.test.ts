import { describe, expect, it } from 'vitest';
import { parseCanvasMarkdown as parse, canvasMarkdown as serialize } from './markdown';
import { Editor } from '@tiptap/core';
import { canvasExtensions } from './extensions';
describe('canvas Markdown preserves content through the real editor schema', () => {
  for (const source of [
    '# Plan\n\n- First\n- Second\n\nA free paragraph.\n',
    '# <span style="color: #d95d57">Important</span> title\n\nNormal <span style="color: #447fbe">**blue** text</span>.\n',
    '# Tasks\n\n- [x] Done\n- [ ] Next\n  - Nested\n\n1. One\n2. Two\n',
    '# Preserve\n\n| One | Two |\n| --- | --- |\n| a | b |\n\n![image](attachments/a.png) and [link](https://example.org)\n\n<meeting data-private="keep">original</meeting>\n',
    '# Code\n\n```rust\nfn main() { }\n```\n\n> Quoted\n\n---\n',
  ])
    it(`round trips ${source.split('\n')[0]}`, () => {
      const doc = parse(source);
      const editor = new Editor({ extensions: canvasExtensions(), content: doc });
      const saved = serialize(editor.getJSON());
      const reopened = new Editor({ extensions: canvasExtensions(), content: parse(saved) });
      expect(reopened.getJSON()).toEqual(editor.getJSON());
      reopened.destroy();
      if (source.includes('<meeting'))
        expect(saved).toContain('<meeting data-private="keep">original</meeting>');
      if (source.includes('#d95d57')) expect(saved).toContain('<span style="color: #d95d57">');
      editor.destroy();
    });
  it('uses the first paragraph as title only after an explicit edit', () => {
    const doc = parse('My title\n\nBody');
    expect(doc.content![0].type).toBe('paragraph');
    expect(serialize(doc)).toMatch(/^# My title/);
    expect(serialize(doc, false)).not.toMatch(/^#/);
  });
  it('keeps unsupported raw syntax inert instead of executing HTML', () => {
    const doc = parse('# Plan\n\n<script>alert(1)</script>\n');
    const editor = new Editor({ extensions: canvasExtensions(), content: doc });
    expect(editor.getHTML()).not.toContain('<script>');
    expect(serialize(editor.getJSON())).toContain('<script>alert(1)</script>');
    editor.destroy();
  });
});

it('preserves opaque content through the editor HTML clipboard representation', () => {
  const source = '# Plan\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n[link](https://example.org)';
  const editor = new Editor({ extensions: canvasExtensions(), content: parse(source) });
  const pasted = new Editor({ extensions: canvasExtensions(), content: editor.getHTML() });
  expect(serialize(pasted.getJSON())).toEqual(serialize(editor.getJSON()));
  editor.destroy();
  pasted.destroy();
});
