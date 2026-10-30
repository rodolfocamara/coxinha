import { meetingFixtures } from './fixtures';

interface MinimalEditor {
  insertBlocks: (
    blocks: Array<{
      type: 'meeting';
      props: { meetingId: string };
    }>,
    referenceBlock: unknown,
    placement: 'before' | 'after'
  ) => void;
  getTextCursorPosition: () => { block: unknown };
}

/**
 * Slash-menu entry that inserts a MeetingBlock pointing at a fixture
 * meeting row. Real picker (list-of-meetings + create-new) lands when
 * DB storage arrives. For now, picking is FIFO over the fixtures —
 * keeps the demo path functional without hauling in modal UI.
 */
export function buildMeetingSlashItem(editor: MinimalEditor) {
  return {
    title: 'Meeting',
    subtext: 'Insert a meeting card',
    aliases: ['meeting', 'reuniao', 'reunião'],
    group: 'Coxinha',
    onItemClick: () => {
      const fixture = meetingFixtures[0];
      if (!fixture) return;
      editor.insertBlocks(
        [{ type: 'meeting', props: { meetingId: fixture.id } }],
        editor.getTextCursorPosition().block,
        'after'
      );
    },
  };
}
