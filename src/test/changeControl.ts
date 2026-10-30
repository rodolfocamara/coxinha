import { fireEvent } from '@testing-library/react';

/** Exercise custom selects through their public keyboard and option interactions. */
export function changeControl(element: Element, event: { target: { value: string } }) {
  if (element.getAttribute('role') !== 'combobox' || element.tagName === 'SELECT') {
    return fireEvent.change(element, event);
  }
  fireEvent.keyDown(element, { key: 'ArrowDown' });
  const option = [...document.querySelectorAll('[role="option"][data-value]')].find(
    (entry) => entry.getAttribute('data-value') === event.target.value
  );
  if (!option) throw new Error(`Select option not found: ${event.target.value}`);
  fireEvent.click(option);
}
