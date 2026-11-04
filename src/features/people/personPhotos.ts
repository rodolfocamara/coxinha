import { useEffect } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { create } from 'zustand';
import { nameKey } from '../meetings/personChoices';

export type DirectoryPhotoStatus = {
  enabled: boolean;
  /** An i18n code; stays until the owner acts. */
  blocked: string | null;
  stored: number;
};

const OFF: DirectoryPhotoStatus = { enabled: false, blocked: null, stored: 0 };
const PHOTOS_CHANGED = 'person-photos-changed';

export function onPhotosChanged(handler: () => void): () => void {
  if (!isTauri()) return () => {};
  const pending = listen(PHOTOS_CHANGED, handler).catch(() => null);
  return () => void pending.then((stop) => stop?.());
}

type PhotoState = {
  ids: Record<string, true>;
  idByName: Record<string, string>;
  /** Image sources by person; `null` when the backend no longer has one. */
  photos: Record<string, string | null>;
};

const usePhotos = create<PhotoState>(() => ({ ids: {}, idByName: {}, photos: {} }));
let index: Promise<void> | null = null;
let watching = false;
/** A reply from before a reset must not bring photos back after the opt-out. */
let generation = 0;
const reading = new Set<string>();

function loadIndex() {
  if (!isTauri() || index) return;
  if (!watching) {
    watching = true;
    onPhotosChanged(() => reloadPersonPhotos());
  }
  const asked = generation;
  index = invoke<{ personId: string; name: string }[]>('person_photo_index')
    .then((entries) => {
      if (asked !== generation) return;
      const ids: PhotoState['ids'] = {};
      const idByName: PhotoState['idByName'] = {};
      for (const { personId, name } of Array.isArray(entries) ? entries : []) {
        ids[personId] = true;
        idByName[nameKey(name)] = personId;
      }
      usePhotos.setState({ ids, idByName, photos: {} });
    })
    .catch(() => {
      if (asked === generation) index = null;
    });
}

function loadPhoto(personId: string) {
  if (reading.has(personId)) return;
  reading.add(personId);
  const asked = generation;
  void invoke<string | null>('person_photo', { personId })
    .then((source) => {
      if (asked !== generation) return;
      usePhotos.setState((state) => ({
        photos: { ...state.photos, [personId]: typeof source === 'string' ? source : null },
      }));
    })
    .catch(() => undefined)
    .finally(() => reading.delete(personId));
}

/** The photos changed or left: nothing cached here may outlive them. */
export function reloadPersonPhotos() {
  generation += 1;
  index = null;
  reading.clear();
  usePhotos.setState({ ids: {}, idByName: {}, photos: {} });
  loadIndex();
}

/** Tests start from an empty cache. */
export function resetPersonPhotos() {
  generation += 1;
  index = null;
  reading.clear();
  usePhotos.setState({ ids: {}, idByName: {}, photos: {} });
}

/** The person's image source, by id or else by name (spec 0102's matching), or null. */
export function usePersonPhoto(person: { personId?: string; name?: string }): string | null {
  const id = usePhotos((state) =>
    person.personId
      ? state.ids[person.personId]
        ? person.personId
        : null
      : person.name
        ? (state.idByName[nameKey(person.name)] ?? null)
        : null
  );
  const source = usePhotos((state) => (id ? state.photos[id] : undefined));
  useEffect(loadIndex, []);
  useEffect(() => {
    if (id && source === undefined) loadPhoto(id);
  }, [id, source]);
  return source ?? null;
}

export const directoryPhotos = {
  status: () =>
    isTauri() ? invoke<DirectoryPhotoStatus>('directory_photos_status') : Promise.resolve(OFF),
  disable: () => invoke<void>('directory_photos_disable').then(reloadPersonPhotos),
};
