import { Node, mergeAttributes } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TextStyle, Color } from '@tiptap/extension-text-style';
const RawBlock = Node.create({
  name: 'rawBlock',
  priority: 1000,
  group: 'block',
  atom: true,
  addAttributes: () => ({
    source: { default: '', parseHTML: (element: HTMLElement) => element.textContent ?? '' },
  }),
  parseHTML: () => [{ tag: 'pre[data-canvas-raw]' }],
  renderHTML: ({ node }) => [
    'pre',
    { 'data-canvas-raw': '', class: 'canvas-preserved' },
    node.attrs.source,
  ],
});
const RawInline = Node.create({
  name: 'rawInline',
  priority: 1000,
  group: 'inline',
  inline: true,
  atom: true,
  addAttributes: () => ({
    source: { default: '', parseHTML: (element: HTMLElement) => element.textContent ?? '' },
  }),
  parseHTML: () => [{ tag: 'span[data-canvas-raw]' }],
  renderHTML: ({ node }) => ['span', { 'data-canvas-raw': '' }, node.attrs.source],
});
export const canvasExtensions = () => [
  StarterKit.configure({ link: false, underline: false, trailingNode: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TextStyle.extend({
    renderHTML: ({ HTMLAttributes }) => ['span', mergeAttributes(HTMLAttributes), 0],
  }),
  Color,
  RawBlock,
  RawInline,
];
