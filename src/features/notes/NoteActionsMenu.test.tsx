import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

import { NoteActionsMenu, type NoteActionsMenuProps } from './NoteActionsMenu';

function defaults(overrides: Partial<NoteActionsMenuProps> = {}): NoteActionsMenuProps {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  anchor.getBoundingClientRect = () =>
    ({
      top: 0,
      bottom: 40,
      left: 100,
      right: 140,
      width: 40,
      height: 40,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
  const anchorRef = { current: anchor };
  return {
    open: true,
    onClose: vi.fn(),
    anchorRef,
    footer: { wordCount: 42 },
    onCopyLink: vi.fn(),
    onCopyContents: vi.fn(),
    onDuplicate: vi.fn(),
    onMoveToTrash: vi.fn(),
    onUndo: vi.fn(),
    font: 'default',
    onFontChange: vi.fn(),
    smallText: false,
    onSmallTextChange: vi.fn(),
    fullWidth: false,
    onFullWidthChange: vi.fn(),
    ...overrides,
  };
}

describe('NoteActionsMenu', () => {
  it('renders nothing when closed', () => {
    render(<NoteActionsMenu {...defaults({ open: false })} />);
    expect(screen.queryByTestId('note-actions-menu')).toBeNull();
  });

  it('renders only implemented actions and the footer when open', () => {
    render(<NoteActionsMenu {...defaults()} />);
    expect(screen.getByText('noteMenu.font.default')).toBeInTheDocument();
    expect(screen.getByText('noteMenu.font.serif')).toBeInTheDocument();
    expect(screen.getByText('noteMenu.font.mono')).toBeInTheDocument();
    expect(screen.getByText('noteMenu.copyLink')).toBeInTheDocument();
    expect(screen.getByText('noteMenu.copyContents')).toBeInTheDocument();
    expect(screen.getByText('noteMenu.duplicate')).toBeInTheDocument();
    expect(screen.getByText('noteMenu.moveToTrash')).toBeInTheDocument();
    expect(screen.getByText('noteMenu.smallText')).toBeInTheDocument();
    expect(screen.getByText('noteMenu.fullWidth')).toBeInTheDocument();
    expect(screen.getByText('noteMenu.undo')).toBeInTheDocument();
    expect(screen.queryByText('noteMenu.archive')).toBeNull();
    expect(screen.queryByText('noteMenu.present')).toBeNull();
    expect(screen.queryByText('noteMenu.useWithAi')).toBeNull();
    expect(screen.queryByText('noteMenu.versionHistory')).toBeNull();
    expect(screen.getByTestId('note-actions-footer').textContent).toContain('42');
  });

  it('fires the real actions through their callbacks and closes the menu', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCopyLink = vi.fn();
    const onMoveToTrash = vi.fn();
    render(<NoteActionsMenu {...defaults({ onClose, onCopyLink, onMoveToTrash })} />);
    await user.click(screen.getByText('noteMenu.copyLink'));
    expect(onCopyLink).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();

    await user.click(screen.getByText('noteMenu.moveToTrash'));
    expect(onMoveToTrash).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('filters rows when the user types in the search box', async () => {
    const user = userEvent.setup();
    render(<NoteActionsMenu {...defaults()} />);
    await user.type(screen.getByPlaceholderText('noteMenu.search'), 'trash');
    expect(screen.getByText('noteMenu.moveToTrash')).toBeInTheDocument();
    expect(screen.queryByText('noteMenu.copyLink')).toBeNull();
    expect(screen.queryByText('noteMenu.font.default')).toBeNull();
  });

  it('forwards font changes to the onFontChange callback', async () => {
    const user = userEvent.setup();
    const onFontChange = vi.fn();
    render(<NoteActionsMenu {...defaults({ onFontChange })} />);
    await user.click(screen.getByText('noteMenu.font.serif'));
    expect(onFontChange).toHaveBeenCalledWith('serif');
  });

  it('toggles fullWidth via the Full width row', async () => {
    const user = userEvent.setup();
    const onFullWidthChange = vi.fn();
    render(<NoteActionsMenu {...defaults({ onFullWidthChange })} />);
    await user.click(screen.getByText('noteMenu.fullWidth'));
    expect(onFullWidthChange).toHaveBeenCalledWith(true);
  });

  it('hides duplicate and delete rows for session notes when allowDuplicateAndDelete is false', () => {
    render(<NoteActionsMenu {...defaults({ allowDuplicateAndDelete: false })} />);
    expect(screen.queryByText('noteMenu.duplicate')).toBeNull();
    expect(screen.queryByText('noteMenu.moveToTrash')).toBeNull();
    expect(screen.getByText('noteMenu.copyLink')).toBeInTheDocument();
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<NoteActionsMenu {...defaults({ onClose })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('closes when the user clicks outside the menu', () => {
    const onClose = vi.fn();
    const anchorRef = createRef<HTMLButtonElement>();
    render(
      <>
        <button ref={anchorRef} type="button" data-testid="anchor">
          open
        </button>
        <NoteActionsMenu {...defaults({ onClose, anchorRef })} />
      </>
    );
    const outside = document.createElement('div');
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);
    expect(onClose).toHaveBeenCalled();
  });
});
