/** Spec 0126: what meeting-detail.mjs measures inside the page. Runs in the browser. */

// Everything in the panel stays inside it and clear of its edge. Elements that
// truncate on purpose say so with the `truncate` class and are listed, not failed.
export const MEASURE = (selector) => {
  const panel = document.querySelector(selector);
  const box = panel.getBoundingClientRect();
  const bad = [];
  const describe = (el) =>
    `${el.tagName.toLowerCase()}.${String(el.className.baseVal ?? el.className)
      .split(' ')
      .slice(0, 2)
      .join('.')} "${(el.textContent ?? '').trim().slice(0, 40)}"`;
  for (const el of panel.querySelectorAll('*')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (el.closest('.sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    // The head and body span the panel on purpose; their content must not.
    const edgeToEdge = el.matches('.ch-peek-head, .ch-peek-body');
    if (!edgeToEdge && (r.right > box.right - 8 || r.left < box.left)) {
      bad.push(`outside ${Math.round(r.right - box.right)}px: ${describe(el)}`);
    }
    const clips = style.overflowX !== 'visible';
    if (clips && el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('truncate'))
      bad.push(`clipped ${el.scrollWidth - el.clientWidth}px: ${describe(el)}`);
    if (el.classList.contains('cx-btn') && el.scrollWidth > el.clientWidth + 1)
      bad.push(`button text over ${el.scrollWidth - el.clientWidth}px: ${describe(el)}`);
  }
  const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (!node.textContent.trim() || node.parentElement.closest('.sr-only, .truncate')) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const r of range.getClientRects())
      if (r.right > box.right - 8) {
        bad.push(
          `text at edge ${Math.round(box.right - r.right)}px: ${describe(node.parentElement)}`
        );
        break;
      }
  }
  return [...new Set(bad)];
};

/** How far the body runs past what the panel shows. */
export const FIT = () => {
  const body = document.querySelector('.ch-peek-body');
  return {
    scroll: body.scrollHeight,
    client: body.clientHeight,
    over: body.scrollHeight - body.clientHeight,
  };
};

// Text in the body sits in a labelled row (dt and dd) or under a heading. Anything
// else is text thrown on the screen, which is what the property sheet removes.
export const LABELS = () => {
  const body = document.querySelector('.ch-peek-body');
  const bad = [];
  for (const row of body.querySelectorAll('.ch-prop')) {
    const term = row.querySelector(':scope > dt');
    if (!term?.textContent.trim())
      bad.push(`row without a label: "${row.textContent.trim().slice(0, 40)}"`);
    if (!row.querySelector(':scope > dd'))
      bad.push(`row without a value: "${term?.textContent.trim()}"`);
  }
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const el = walker.currentNode.parentElement;
    if (!walker.currentNode.textContent.trim() || el.closest('.sr-only, [hidden]')) continue;
    if (!el.getClientRects().length) continue;
    if (el.closest('dt, dd, h3, [data-titled]')) continue;
    bad.push(`text outside a row: "${walker.currentNode.textContent.trim().slice(0, 50)}"`);
  }
  return [...new Set(bad)];
};
