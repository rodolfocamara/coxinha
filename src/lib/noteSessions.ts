import { SaveQueue } from './saveQueue';
import { registerSaveParticipant, discardEditorUploads } from './lifecycle';
const sessions = new Map<
  string,
  {
    queue: SaveQueue;
    unregister: () => void;
    writer: { current: (markdown: string) => Promise<void> };
  }
>();
/** One serialization lane per note, shared across editor mounts and deletion callers. */
export function noteSaveQueue(id: string, save: (markdown: string) => Promise<void>) {
  let session = sessions.get(id);
  if (!session) {
    const writer = { current: save };
    const queue = new SaveQueue((markdown) => writer.current(markdown));
    session = { queue, writer, unregister: registerSaveParticipant(() => queue.flush()) };
    sessions.set(id, session);
  }
  // A retained queue can outlive its editor; report failures to the current mount.
  session.writer.current = save;
  return session.queue;
}
export async function waitForNotePersistence(id: string) {
  await sessions.get(id)?.queue.flush();
}
export async function deleteAfterPendingSaves(id: string, remove: () => Promise<void>) {
  const session = sessions.get(id);
  if (!session) {
    await remove();
    discardEditorUploads(id);
    return;
  }
  await session.queue.remove(remove);
  discardEditorUploads(id);
  session.unregister();
  sessions.delete(id);
}

export async function readRetainedNoteSnapshot(id: string) {
  return sessions.get(id)?.queue.readRetainedSnapshot() ?? { kind: 'unavailable' as const };
}
