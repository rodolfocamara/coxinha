import { describe, expect, it } from 'vitest';

import { isInteractiveClickTarget } from './editorFocus';

/**
 * Unit test for the selector that decides whether a click inside
 * the editor surface should rescue focus. Keeps the NoteEditor
 * `onMouseDown` handler cheap to reason about — every element
 * shape it has to recognise is pinned here.
 */
describe('isInteractiveClickTarget', () => {
  it('returns false for null / non-Element targets', () => {
    expect(isInteractiveClickTarget(null)).toBe(false);
    expect(isInteractiveClickTarget({} as EventTarget)).toBe(false);
  });

  it('returns false for plain padding divs', () => {
    const div = document.createElement('div');
    div.className = 'mx-auto max-w-[760px]';
    expect(isInteractiveClickTarget(div)).toBe(false);
  });

  it('returns true for a contenteditable descendant', () => {
    const host = document.createElement('div');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    const span = document.createElement('span');
    editor.appendChild(span);
    host.appendChild(editor);
    expect(isInteractiveClickTarget(editor)).toBe(true);
    expect(isInteractiveClickTarget(span)).toBe(true);
  });

  it('returns true when the target is or sits inside a button', () => {
    const button = document.createElement('button');
    const icon = document.createElement('span');
    button.appendChild(icon);
    expect(isInteractiveClickTarget(button)).toBe(true);
    expect(isInteractiveClickTarget(icon)).toBe(true);
  });

  it('returns true for anchors, inputs, textareas, selects', () => {
    expect(isInteractiveClickTarget(document.createElement('a'))).toBe(true);
    expect(isInteractiveClickTarget(document.createElement('input'))).toBe(true);
    expect(isInteractiveClickTarget(document.createElement('textarea'))).toBe(true);
    expect(isInteractiveClickTarget(document.createElement('select'))).toBe(true);
  });

  it('returns true for role="button" / role="link" even on non-button tags', () => {
    const roleBtn = document.createElement('div');
    roleBtn.setAttribute('role', 'button');
    const roleLink = document.createElement('span');
    roleLink.setAttribute('role', 'link');
    expect(isInteractiveClickTarget(roleBtn)).toBe(true);
    expect(isInteractiveClickTarget(roleLink)).toBe(true);
  });
});
