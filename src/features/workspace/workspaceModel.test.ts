import { describe, expect, it } from 'vitest';
import type { Note } from '../../lib/bindings';
import type { Board, BoardItem } from '../board/model';
import { freeSpot } from './freeSpot';
import {
  CARD_SIZE,
  addItem,
  cardForTask,
  demote,
  excerpt,
  itemForNote,
  noteItem,
  offBoardNotes,
  promote,
} from './workspaceModel';

const note = (id: string, title = id): Note => ({
  id,
  title,
  path: `notes/${id}.md`,
  tags: [],
  created_at: '',
  updated_at: '',
});
const item = (id: string, kind: BoardItem['kind'], extra: Partial<BoardItem> = {}): BoardItem => ({
  id,
  kind,
  x: 0,
  y: 0,
  width: 220,
  height: 104,
  color: 'neutral',
  label: '',
  progress: 30,
  parentId: null,
  noteId: kind === 'area' ? null : `n-${id}`,
  notePath: kind === 'area' ? null : `notes/n-${id}.md`,
  ...extra,
});
const board = (items: BoardItem[], edges: Board['edges'] = []): Board => ({
  version: 3,
  revision: 1,
  items,
  edges,
});

describe('notes and board items are one object', () => {
  it('lists only notes no item references, by id or by Markdown path', () => {
    const notes = [note('n-a'), note('n-b'), note('n-meeting'), note('n-moved')];
    const b = board([
      item('a', 'card'),
      item('b', 'text'),
      item('moved', 'text', { noteId: 'stale-uuid', notePath: 'notes/n-moved.md' }),
    ]);
    expect(offBoardNotes(notes, b).map((n) => n.id)).toEqual(['n-meeting']);
    expect(offBoardNotes(notes, null)).toEqual([]);
  });

  it('promote and demote change only the kind (progress 0 on promote), never the note', () => {
    const b = board(
      [item('t', 'text', { progress: 40 }), item('c', 'card')],
      [{ id: 'e', source: 'c', target: 'x' }]
    );
    const promoted = promote(b, 't').items.find((i) => i.id === 't')!;
    expect(promoted).toMatchObject({
      kind: 'card',
      progress: 0,
      noteId: 'n-t',
      notePath: 'notes/n-t.md',
    });
    const { kind: _k, progress: _p, ...rest } = promoted;
    const { kind: _k2, progress: _p2, ...original } = b.items[0];
    expect(rest).toEqual(original);
    const demoted = demote(b, 'c');
    expect(demoted.items.find((i) => i.id === 'c')).toMatchObject({
      kind: 'text',
      noteId: 'n-c',
      notePath: 'notes/n-c.md',
    });
    // The link to an unknown item cannot survive; a link to an activity does.
    expect(demoted.edges).toEqual([]);
    const linked = board(
      [item('c', 'card'), item('d', 'card'), item('t', 'text')],
      [
        { id: 'cd', source: 'c', target: 'd' },
        { id: 'tc', source: 't', target: 'c' },
      ]
    );
    expect(demote(linked, 'c').edges.map((e) => e.id)).toEqual(['cd']);
    expect(demote(linked, 'd').edges.map((e) => e.id)).toEqual(['cd', 'tc']);
  });

  it('finds the item showing a note, preferring the explicitly selected duplicate', () => {
    const notes = [note('n-a')];
    const b = board([
      item('a', 'card'),
      item('a2', 'text', { noteId: 'n-a', notePath: 'notes/n-a.md' }),
    ]);
    expect(itemForNote(b, notes, 'n-a')?.id).toBe('a');
    expect(itemForNote(b, notes, 'n-a', 'a2')?.id).toBe('a2');
    expect(itemForNote(b, notes, 'n-none')).toBeUndefined();
  });

  it('links a new activity to its source note or activity, and grows the area', () => {
    const area = item('area', 'area', { x: 0, y: 0, width: 300, height: 200 });
    const source = item('s', 'card', { x: 16, y: 52, parentId: 'area' });
    const created = noteItem('new', note('n-new'), { x: 16, y: 400 }, 'card', 'area');
    const next = addItem(board([area, source]), created, source);
    expect(next.edges).toEqual([{ id: expect.any(String), source: 's', target: 'new' }]);
    expect(next.items.find((i) => i.id === 'area')!.height).toBeGreaterThanOrEqual(
      400 + CARD_SIZE.height
    );
    const fromNote = addItem(board([item('t', 'text')]), created, item('t', 'text'));
    expect(fromNote.edges).toEqual([{ id: expect.any(String), source: 't', target: 'new' }]);
    const noteToNote = noteItem('n2', note('n-n2'), { x: 0, y: 0 }, 'text');
    expect(addItem(board([item('t', 'text')]), noteToNote, item('t', 'text')).edges).toEqual([]);
  });

  it('recognises the card a checklist line became, preferring the linked one', () => {
    const notes = [
      note('n-s', 'Source'),
      note('n-x', 'Revisão de segurança'),
      note('n-y', 'revisão  de segurança '),
    ];
    const b = board(
      [
        item('s', 'card', { noteId: 'n-s' }),
        item('x', 'card', { noteId: 'n-x' }),
        item('y', 'card', { noteId: 'n-y' }),
      ],
      [{ id: 'e', source: 's', target: 'y' }]
    );
    expect(cardForTask(b, notes, 's', 'Revisão de segurança')?.id).toBe('y');
    expect(cardForTask(b, notes, 's', 'Outra coisa')).toBeUndefined();
  });

  it('previews the first prose line without Markdown marks', () => {
    expect(excerpt('# Title\n\n**Revisar** com a [Rita](x).\n')).toBe('Revisar com a Rita.');
    expect(excerpt('# Só título\n')).toBe('');
    expect(excerpt('- [ ] Primeira tarefa')).toBe('Primeira tarefa');
  });
});

describe('freeSpot', () => {
  it('never lands on another card, another area or any area header', () => {
    const crm = item('crm', 'area', { x: 0, y: 0, width: 600, height: 400 });
    const lgpd = item('lgpd', 'area', { x: 0, y: 440, width: 400, height: 200 });
    const src = item('src', 'card', { x: 20, y: 60, parentId: 'crm' });
    const below = item('below', 'card', { x: 20, y: 200, parentId: 'crm' });
    const b = board([crm, lgpd, src, below]);
    const spot = freeSpot(b, { x: src.x, y: src.y + src.height + 32 }, CARD_SIZE, {
      areaId: 'crm',
    });
    const r = { ...spot, ...CARD_SIZE };
    const hit = (o: BoardItem) =>
      r.x < o.x + o.width && r.x + r.width > o.x && r.y < o.y + o.height && r.y + r.height > o.y;
    expect(hit(src) || hit(below) || hit(lgpd)).toBe(false);
    // Inside the source's area, below its header.
    expect(r.x).toBeGreaterThanOrEqual(crm.x + 16);
    expect(r.y).toBeGreaterThanOrEqual(crm.y + 52);
    expect(r.x + r.width).toBeLessThanOrEqual(crm.x + crm.width - 16);
    expect(r.y + r.height).toBeLessThanOrEqual(crm.y + crm.height - 16);
  });

  it('keeps a loose card out of every area and returns the preferred point when free', () => {
    const crm = item('crm', 'area', { x: 0, y: 0, width: 600, height: 400 });
    const b = board([crm]);
    expect(freeSpot(b, { x: 800, y: 100 }, CARD_SIZE)).toEqual({ x: 800, y: 100 });
    const spot = freeSpot(b, { x: 100, y: 100 }, CARD_SIZE);
    const inside =
      spot.x < 600 && spot.x + CARD_SIZE.width > 0 && spot.y < 400 && spot.y + CARD_SIZE.height > 0;
    expect(inside).toBe(false);
  });
});
