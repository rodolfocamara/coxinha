import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// findBy*/waitFor default to 1s; with ~90 files in parallel, async loads on a
// busy machine exceed it and fail at random (same reason as testTimeout).
configure({ asyncUtilTimeout: 5000 });

// Layout/pointer APIs supplied by browsers, absent in jsdom.
HTMLElement.prototype.hasPointerCapture ??= () => false;
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};
HTMLElement.prototype.scrollIntoView ??= () => {};
