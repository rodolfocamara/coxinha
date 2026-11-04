// Directory photos (spec 0117 P1). Off unless a check sets state.photosOn; the
// image is a flat square, so no real face ever sits in the repo.
(() => {
  const f = (window.__cxFixtures = window.__cxFixtures || {});
  const state = (window.__cxState = window.__cxState || {});
  const source = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAU0lEQVR4nO3UUQ0AIAzEUIQhDKXTgwvKx0smYLm0XXP2V7fyDzxkIQyxrA6PDlkIQyyrw6NDFsIQy+rw6JCFMMSyOjw6ZCEMsawOjw5ZCEPz1rIL/oXaxDkOCEQAAAAASUVORK5CYII=';
  const people = [
    { personId: 'p-rita', name: 'Rita Souza' },
    { personId: 'p-tiago', name: 'Tiago Prado' },
  ];
  const calls = (state.photoCalls = state.photoCalls || []);
  f.directory_photos_status = () => ({
    enabled: !!state.photosOn,
    blocked: state.photosBlocked ?? null,
    stored: state.photosOn ? people.length : 0,
  });
  f.person_photo_index = () => (state.photosOn ? people : []);
  f.person_photo = ({ personId }) => {
    calls.push(`person_photo ${personId}`);
    return state.photosOn && people.some((p) => p.personId === personId) ? source : null;
  };
  f.directory_photos_disable = () => {
    calls.push('directory_photos_disable');
    state.photosOn = false;
    return null;
  };
  f.calendar_begin = ({ directoryPhotos }) => {
    calls.push(`calendar_begin ${directoryPhotos}`);
    return { id: 'attempt', url: 'about:blank' };
  };
  f.calendar_complete = () => {
    calls.push('calendar_complete');
    if (calls.includes('calendar_begin true')) state.photosOn = true;
    return window.__cxFixtures.calendar_status();
  };
  f.calendar_cancel = () => null;
})();
