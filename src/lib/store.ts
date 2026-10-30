import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

import type { Note } from './bindings';
import { sortByUpdated } from './notes';
import { deleteAfterPendingSaves, waitForNotePersistence } from './noteSessions';
import { mark } from './perf';

interface AppStore {
  notes: Note[];
  activeNoteId: string | null;

  loadNotes: () => Promise<void>;
  setActiveNote: (id: string | null) => void;
  newNote: () => Promise<Note>;
  saveNote: (id: string, markdown: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<Note>;
  deleteNote: (id: string) => Promise<void>;
  searchNotes: (query: string) => Promise<Note[]>;
  openDailyNote: (date?: string) => Promise<Note>;
}

export const useAppStore = create<AppStore>((set) => ({
  notes: [],
  activeNoteId: null,

  async loadNotes() {
    const notes = await invoke<Note[]>('list_notes');
    set({ notes });
  },

  setActiveNote(id) {
    set({ activeNoteId: id });
  },

  async newNote() {
    // Empty title + empty body on purpose: the editor opens with the
    // cursor in the body so the user can just start typing. A title
    // gets derived from the first `#` heading on save (see
    // `storage::update_note`), and the sidebar falls back to
    // "(untitled)" until then. Returns the created Note so callers
    // can route to `/notes/$id` with the router — store stays
    // data-only, navigation is the caller's concern (ADR-0016).
    mark('create-invoked');
    const note = await invoke<Note>('create_note', {
      title: '',
      content: '',
    });
    mark('note-created');
    set((state) => ({
      notes: [note, ...state.notes],
      activeNoteId: note.id,
    }));
    return note;
  },

  async saveNote(id, markdown) {
    const updated = await invoke<Note>('update_note', { id, content: markdown });
    set((state) => ({
      notes: sortByUpdated([updated, ...state.notes.filter((n) => n.id !== id)]),
    }));
  },

  async duplicateNote(id) {
    await waitForNotePersistence(id);
    const existing = await invoke<{ note: Note; markdown: string } | null>('get_note', { id });
    if (!existing) throw new Error(`note ${id} not found`);
    // Prepend a dupe marker to the first heading if one exists; else
    // just pass the markdown through — the backend derives the title
    // from the first heading on save either way.
    const dupedMd = existing.markdown.replace(
      /^(#\s+)(.+)$/m,
      (_m, prefix, heading) => `${prefix}${heading} (copy)`
    );
    const fresh = await invoke<Note>('create_note', {
      title: '',
      content: '',
    });
    const saved = await invoke<Note>('update_note', {
      id: fresh.id,
      content: dupedMd,
    });
    set((state) => ({
      notes: sortByUpdated([saved, ...state.notes.filter((n) => n.id !== saved.id)]),
      activeNoteId: saved.id,
    }));
    return saved;
  },

  async deleteNote(id) {
    await deleteAfterPendingSaves(id, () => invoke('delete_note', { id }));
    set((state) => ({
      activeNoteId: state.activeNoteId === id ? null : state.activeNoteId,
      notes: state.notes.filter((n) => n.id !== id),
    }));
  },

  async searchNotes(query) {
    return await invoke<Note[]>('search_notes', { query });
  },

  async openDailyNote(date) {
    const note = await invoke<Note>('get_or_create_daily_note', {
      date: date ?? null,
    });
    set((state) => ({
      notes: sortByUpdated([note, ...state.notes.filter((n) => n.id !== note.id)]),
      activeNoteId: note.id,
    }));
    return note;
  },
}));
