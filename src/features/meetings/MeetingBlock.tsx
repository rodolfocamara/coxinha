import { createReactBlockSpec } from '@blocknote/react';

import { MeetingCard } from './MeetingCard';

/**
 * Custom BlockNote block that references a meeting by id. Storage
 * shape is intentionally minimal — just the meetingId pointer —
 * because real content (title, transcript, summary) lives in the
 * meetings table (spec 0057 DB-first). The block is self-contained
 * for edits: editing a tab writes to the meeting row, never to the
 * host note body.
 *
 * Markdown round-trip: in this fixture-only iteration the block
 * does not serialize through blocksToMarkdownLossy. When DB storage
 * lands (follow-up spec), an HTML comment marker (<!-- meeting:id -->)
 * will preserve the link so external Markdown editors see an opaque
 * comment they can safely round-trip.
 */
const meetingBlockFactory = createReactBlockSpec(
  {
    type: 'meeting',
    propSchema: {
      meetingId: { default: '', type: 'string' as const },
    },
    content: 'none',
  },
  {
    render: ({ block }) => (
      <div className="my-3">
        <MeetingCard meetingId={block.props.meetingId} />
      </div>
    ),
  }
);

// createReactBlockSpec returns a factory `(options?) => BlockSpec`;
// call it once with no options so consumers get the BlockSpec
// BlockNoteSchema.create expects.
export const meetingBlockSpec = meetingBlockFactory();
