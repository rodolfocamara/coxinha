/* Test harness for the Workspace (spec 0096 P5): an in-memory backend for the
   board and note IPC, a React Flow stand-in that renders the real node
   components, and a NoteEditor stand-in that exposes the overlay with a
   BlockNote-like document built from the note's Markdown. */
import { useEffect, type ComponentType, type ReactNode } from 'react';
import type { Board } from '../board/model';
import type { Note } from '../../lib/bindings';

export type Backend = ReturnType<typeof createBackend>;

const note = (id: string, title: string): Note => ({
  id,
  title,
  path: `notes/${id}.md`,
  tags: [],
  created_at: '2026-10-28T10:00:00Z',
  updated_at: '2026-10-30T10:00:00Z',
});

export function fixtureBoard(): Board {
  const card = (
    id: string,
    noteId: string,
    x: number,
    y: number,
    progress: number,
    parentId: string | null
  ) => ({
    id,
    kind: 'card' as const,
    x,
    y,
    width: 210,
    height: 96,
    color: 'neutral' as const,
    label: '',
    progress,
    parentId,
    noteId,
    notePath: `notes/${noteId}.md`,
  });
  return {
    version: 3,
    revision: 1,
    items: [
      {
        id: 'a-crm',
        kind: 'area',
        x: 20,
        y: 28,
        width: 540,
        height: 392,
        color: 'blue',
        label: 'Migração do CRM',
        parentId: null,
        noteId: null,
        notePath: null,
      },
      card('c-integ', 'n-integ', 40, 92, 100, 'a-crm'),
      card('c-api', 'n-api', 300, 180, 55, 'a-crm'),
      card('c-comm', 'n-comm', 590, 92, 0, null),
      { ...card('t-idea', 'n-idea', 590, 250, 0, null), kind: 'text' },
    ],
    edges: [
      { id: 'e-1', source: 'c-integ', target: 'c-api' },
      { id: 'e-2', source: 'c-api', target: 'c-comm' },
    ],
  };
}

export function createBackend(invoke: {
  mockImplementation: (fn: (cmd: string, args?: any) => Promise<unknown>) => unknown;
}) {
  const state = {
    board: fixtureBoard(),
    notes: [
      note('n-integ', 'Levantar integrações'),
      note('n-api', 'Contrato de API v2'),
      note('n-comm', 'Comunicar áreas'),
      note('n-idea', 'Resumo semanal automático'),
      note('n-rita', '1:1 com a Rita'),
      note('n-quick', 'Ideia rápida'),
    ],
    bodies: {
      'n-api':
        '# Contrato de API v2\n\nRevisar com a Rita.\n\n- [x] Validar escopo\n- [ ] Revisão de segurança na quinta\n- [ ] Publicar contrato no portal\n',
      'n-idea': '# Resumo semanal automático\n\nUsar a transcrição do Comitê.\n',
    } as Record<string, string>,
    sessions: [
      {
        id: 's-rita',
        title: '1:1 com a Rita',
        starts_at: '2026-10-28T16:00:00Z',
        personal_note: { id: 'n-rita', relative_path: 'notes/n-rita.md' },
      },
    ],
    loadError: null as string | null,
    saveError: null as string | null,
    next: 1,
  };
  invoke.mockImplementation(async (cmd: string, args: any = {}) => {
    switch (cmd) {
      case 'board_load':
        if (state.loadError) {
          const error = state.loadError;
          state.loadError = null;
          throw error;
        }
        return structuredClone(state.board);
      case 'board_save':
        if (state.saveError) throw state.saveError;
        state.board = { ...structuredClone(args.board), revision: args.board.revision + 1 };
        return structuredClone(state.board);
      case 'board_export_recovery':
        return 'recovery/board-1.json';
      case 'get_note': {
        const found = state.notes.find((n) => n.id === args.id);
        if (!found) throw `note ${args.id} not found`;
        return { note: found, markdown: state.bodies[args.id] ?? `# ${found.title}\n` };
      }
      case 'create_note': {
        const created = note(`00000000-0000-4000-8000-00000000000${state.next++}`, '');
        state.notes.unshift(created);
        state.bodies[created.id] = '';
        return created;
      }
      case 'update_note': {
        const found = state.notes.find((n) => n.id === args.id)!;
        state.bodies[args.id] = args.content;
        found.title = (args.content.match(/^#\s+(.+)$/m) ?? [, ''])[1];
        return { ...found };
      }
      case 'delete_note':
        state.notes = state.notes.filter((n) => n.id !== args.id);
        return null;
      case 'library_sessions':
        return state.sessions;
      case 'search_notes':
        return state.notes.filter((n) => (state.bodies[n.id] ?? '').includes(args.query));
      case 'get_backlinks':
        return [];
      default:
        throw `unexpected command ${cmd}`;
    }
  });
  return state;
}

type FlowNode = {
  id: string;
  type: string;
  data: unknown;
  selected?: boolean;
  ariaLabel?: string;
  style?: object;
};
type FlowEdge = { id: string; source: string; target: string; data?: { fresh?: boolean } };
export const flow: { props: Record<string, any> } = { props: {} };

/** React Flow stand-in: real node components, focusable wrappers, edges as markers. */
export function ReactFlowStub(props: {
  nodes: FlowNode[];
  edges: FlowEdge[];
  nodeTypes: Record<string, ComponentType<any>>;
  onNodeClick?: (event: unknown, node: FlowNode) => void;
  onInit?: (instance: unknown) => void;
  children?: ReactNode;
}) {
  flow.props = props;
  useEffect(() => {
    props.onInit?.({
      setViewport: () => Promise.resolve(true),
      screenToFlowPosition: (p: object) => p,
    });
  }, []);
  return (
    <div className="react-flow">
      {props.nodes.map((node) => {
        const Component = props.nodeTypes[node.type];
        return (
          <div
            key={node.id}
            className={`react-flow__node${node.selected ? ' selected' : ''}`}
            data-id={node.id}
            data-testid={`node-${node.id}`}
            role="button"
            tabIndex={0}
            aria-label={node.ariaLabel}
            style={node.style}
            onClick={(event) => props.onNodeClick?.(event, node)}
          >
            <Component id={node.id} data={node.data} selected={node.selected} />
          </div>
        );
      })}
      {props.edges.map((edge) => (
        <span
          key={edge.id}
          data-testid={`edge-${edge.source}-${edge.target}`}
          data-fresh={edge.data?.fresh || undefined}
        />
      ))}
      {props.children}
    </div>
  );
}

/** BlockNote-like document from Markdown task lines. */
export function fakeEditor(markdown: string) {
  const document = markdown
    .split('\n')
    .map((line, index) => line.match(/^- \[( |x)\] (.+)$/) && { line, index })
    .filter(Boolean)
    .map((entry) => {
      const [, mark, text] = entry!.line.match(/^- \[( |x)\] (.+)$/)!;
      return {
        id: `block-${entry!.index}`,
        type: 'checkListItem',
        props: { checked: mark === 'x' },
        content: [{ type: 'text', text }],
        children: [],
      };
    });
  return { document, onChange: () => () => {} };
}
