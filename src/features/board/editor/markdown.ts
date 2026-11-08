import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import type { JSONContent } from '@tiptap/core';
// Unknown syntax is kept as source, never silently dropped by the smaller schema.
type Md = {
  type: string;
  value?: string;
  children?: Md[];
  depth?: number;
  ordered?: boolean;
  start?: number;
  checked?: boolean | null;
  lang?: string;
  position?: { start: { offset?: number }; end: { offset?: number } };
};
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkStringify, { bullet: '-', fences: true });
const colorOpen = /^<span style="color: (#[0-9a-f]{6})">$/i;
export const hasCanvasColors = (markdown: string) =>
  /<span style="color: #[0-9a-f]{6}">/i.test(markdown);
const children = (n: JSONContent) => n.content ?? [];
export function parseCanvasMarkdown(markdown: string, activity = true): JSONContent {
  const source = (n: Md) =>
    markdown.slice(n.position?.start.offset ?? 0, n.position?.end.offset ?? 0);
  function inline(nodes: Md[], marks: JSONContent['marks'] = []): JSONContent[] {
    const result: JSONContent[] = [];
    const colors: string[] = [];
    const balancedColor = (index: number) => {
      let depth = 0;
      for (const candidate of nodes.slice(index)) {
        if (candidate.type !== 'html') continue;
        if (colorOpen.test(candidate.value ?? '')) depth++;
        else if (candidate.value === '</span>') {
          if (--depth === 0) return true;
        } else if (candidate.value?.startsWith('<span')) return false;
      }
      return false;
    };
    for (const [index, n] of nodes.entries()) {
      if (n.type === 'html' && colorOpen.test(n.value ?? '') && balancedColor(index)) {
        colors.push(colorOpen.exec(n.value!)![1]);
        continue;
      }
      if (n.type === 'html' && n.value === '</span>' && colors.length) {
        colors.pop();
        continue;
      }
      const styled = [
        ...(marks ?? []),
        ...(colors.length ? [{ type: 'textStyle', attrs: { color: colors.at(-1) } }] : []),
      ];
      const mark = { strong: 'bold', emphasis: 'italic', delete: 'strike' }[n.type];
      if (mark) result.push(...inline(n.children ?? [], [...styled, { type: mark }]));
      else if (n.type === 'text' || n.type === 'inlineCode') {
        if (n.value)
          result.push({
            type: 'text',
            text: n.value,
            marks: [...styled, ...(n.type === 'inlineCode' ? [{ type: 'code' }] : [])],
          });
      } else if (n.type === 'break') result.push({ type: 'hardBreak' });
      else result.push({ type: 'rawInline', attrs: { source: source(n) || n.value || '' } });
    }
    return result;
  }
  function block(n: Md): JSONContent[] {
    if (n.type === 'paragraph' || n.type === 'heading')
      return [
        {
          type: n.type,
          ...(n.type === 'heading' ? { attrs: { level: n.depth } } : {}),
          content: inline(n.children ?? []),
        },
      ];
    if (n.type === 'list') {
      // Mixed checked/unchecked rows remain separate list groups, retaining their order.
      const groups: JSONContent[] = [];
      for (const item of n.children ?? []) {
        const task = typeof item.checked === 'boolean';
        const type = task ? 'taskList' : n.ordered ? 'orderedList' : 'bulletList';
        if (groups.at(-1)?.type !== type)
          groups.push({
            type,
            attrs: n.ordered
              ? { start: (n.start ?? 1) + groups.reduce((sum, g) => sum + children(g).length, 0) }
              : {},
            content: [],
          });
        groups.at(-1)!.content!.push({
          type: task ? 'taskItem' : 'listItem',
          ...(task ? { attrs: { checked: item.checked } } : {}),
          content: (item.children ?? []).flatMap(block),
        });
      }
      return groups;
    }
    if (n.type === 'blockquote')
      return [{ type: 'blockquote', content: (n.children ?? []).flatMap(block) }];
    if (n.type === 'code')
      return [
        {
          type: 'codeBlock',
          attrs: { language: n.lang ?? null },
          content: n.value ? [{ type: 'text', text: n.value }] : [],
        },
      ];
    if (n.type === 'thematicBreak') return [{ type: 'horizontalRule' }];
    return [{ type: 'rawBlock', attrs: { source: source(n) || n.value || '' } }];
  }
  const content = (processor.parse(markdown).children as Md[]).flatMap(block);
  if (!content.length)
    return {
      type: 'doc',
      content: activity
        ? [
            { type: 'heading', attrs: { level: 1 } },
            {
              type: 'bulletList',
              content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
            },
          ]
        : [{ type: 'paragraph' }],
    };
  // Rendering styles the first line as title; writing normalizes a first paragraph to H1.
  return { type: 'doc', content };
}
export function canvasMarkdown(doc: JSONContent, activity = true): string {
  function inline(nodes: JSONContent[]): Md[] {
    return nodes.flatMap((n): Md[] => {
      if (n.type === 'hardBreak') return [{ type: 'break' }];
      if (n.type === 'rawInline') return [{ type: 'html', value: n.attrs?.source ?? '' }];
      let current: Md = {
        type: n.marks?.some((m) => m.type === 'code') ? 'inlineCode' : 'text',
        value: n.text ?? '',
      };
      for (const mark of n.marks ?? []) {
        const type = { bold: 'strong', italic: 'emphasis', strike: 'delete' }[mark.type];
        if (type) current = { type, children: [current] };
      }
      const color = n.marks?.find((m) => m.type === 'textStyle')?.attrs?.color;
      return /^#[0-9a-f]{6}$/i.test(color ?? '')
        ? [
            { type: 'html', value: `<span style="color: ${color}">` },
            current,
            { type: 'html', value: '</span>' },
          ]
        : [current];
    });
  }
  function block(n: JSONContent, index = -1): Md {
    if (n.type === 'rawBlock') return { type: 'html', value: n.attrs?.source ?? '' };
    if (n.type === 'heading' || n.type === 'paragraph') {
      const heading = n.type === 'heading' || (activity && index === 0);
      return {
        type: heading ? 'heading' : 'paragraph',
        ...(heading ? { depth: index === 0 && activity ? 1 : (n.attrs?.level ?? 1) } : {}),
        children: inline(children(n)),
      };
    }
    if (['bulletList', 'orderedList', 'taskList'].includes(n.type!))
      return {
        type: 'list',
        ordered: n.type === 'orderedList',
        start: n.attrs?.start ?? 1,
        children: children(n).map((item) => ({
          type: 'listItem',
          checked: n.type === 'taskList' ? !!item.attrs?.checked : null,
          children: children(item).map((c) => block(c)),
        })),
      };
    if (n.type === 'blockquote')
      return { type: 'blockquote', children: children(n).map((c) => block(c)) };
    if (n.type === 'codeBlock')
      return {
        type: 'code',
        lang: n.attrs?.language ?? undefined,
        value: children(n)
          .map((c) => c.text ?? '')
          .join(''),
      };
    if (n.type === 'horizontalRule') return { type: 'thematicBreak' };
    throw new Error(`Unsupported canvas node: ${n.type}`);
  }
  return processor.stringify({ type: 'root', children: children(doc).map(block) } as never);
}
