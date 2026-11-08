import { invoke } from '@tauri-apps/api/core';

/** Spec 0105: a meeting (session) or an activity (note) that owns a folder. */
export type ItemKind = 'meeting' | 'activity';
export type ItemRef = { kind: ItemKind; id: string; title: string; date: string | null };
export type ItemFile = { name: string; kind: string; bytes: number; modified: string };
export type ItemReference = {
  target: string;
  label: string | null;
  addedAt: string;
  isUrl: boolean;
  missing: boolean;
};
export type ItemFilesData = {
  folder: string | null;
  files: ItemFile[];
  references: ItemReference[];
};
export type OpenTarget = { kind: 'file'; name: string } | { kind: 'reference'; target: string };
export type ItemLink = { session: string; note: string; createdAt: string };

export const items = {
  list: (item: ItemRef) => invoke<ItemFilesData>('items_list', { item }),
  include: (item: ItemRef, paths: string[]) =>
    invoke<ItemFilesData>('items_include', { item, paths }),
  reference: (item: ItemRef, target: string, label: string | null = null) =>
    invoke<ItemFilesData>('items_reference', { item, target, label }),
  removeReference: (item: ItemRef, target: string) =>
    invoke<ItemFilesData>('items_remove_reference', { item, target }),
  removeFile: (item: ItemRef, name: string) =>
    invoke<ItemFilesData>('items_remove_file', { item, name }),
  open: (item: ItemRef, target: OpenTarget) => invoke<void>('items_open', { item, target }),
  reveal: (item: ItemRef) => invoke<void>('items_reveal', { item }),
};

export const links = {
  ofSession: (session: string) => invoke<ItemLink[]>('links_list', { session, note: null }),
  ofNote: (note: string) => invoke<ItemLink[]>('links_list', { session: null, note }),
  add: (session: string, note: string) => invoke<void>('links_add', { session, note }),
  remove: (session: string, note: string) => invoke<void>('links_remove', { session, note }),
};

/** Local civil date of a meeting start, `YYYY-MM-DD`, for its folder name. */
export function civilDate(date: Date | null): string | null {
  if (!date) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
