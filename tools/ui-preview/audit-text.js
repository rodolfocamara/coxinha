// In-page audit of clipped text (spec 0125). Plain script, so Chromium, WebKit
// and the WebKitGTK driver all run the same checks. Sets window.__cxAuditText.
(() => {
  const SLOP = 1.5;
  const describe = (el) => {
    const parts = [];
    for (let at = el; at && at !== document.body && parts.length < 3; at = at.parentElement) {
      const cls = typeof at.className === 'string' ? at.className : '';
      const named = cls.split(/\s+/).filter((c) => /^(cx|mh|hoje|wk|canvas|bn|board)-/.test(c));
      parts.unshift(at.tagName.toLowerCase() + (named[0] ? `.${named[0]}` : ''));
    }
    return parts.join(' > ');
  };
  const isHidden = (el) => {
    for (let at = el; at; at = at.parentElement) {
      const cs = getComputedStyle(at);
      if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return true;
      if (at.classList.contains('sr-only') || cs.clipPath.includes('inset(50%')) return true;
    }
    return false;
  };
  const clips = (value) => value === 'hidden' || value === 'clip';
  const scrolls = (value) => value === 'auto' || value === 'scroll';
  const hasBox = (cs, el) =>
    /^(BUTTON|A|LABEL|SUMMARY|TD|TH)$/.test(el.tagName) ||
    (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') ||
    parseFloat(cs.borderTopWidth) > 0;

  // Neither label is covered by something opaque at this point (a sticky header, a sheet).
  const bothVisible = (a, b, x, y) => {
    let found = 0;
    for (const layer of document.elementsFromPoint(x, y)) {
      if (layer === a || layer === b || a.contains(layer) || b.contains(layer)) found += 1;
      if (found === 2) return true;
      if (layer.contains(a) && layer.contains(b)) return found > 0;
      const bg = getComputedStyle(layer).backgroundColor;
      const alpha = /rgba?\(([^)]+)\)/.exec(bg)?.[1].split(/[,/]/)[3];
      const solid = bg !== 'transparent' && (alpha === undefined || Number(alpha) > 0.9);
      if (found === 1 && solid) return false;
    }
    return false;
  };

  window.__cxAuditText = () => {
    const issues = [];
    const warnings = [];
    const texts = [];
    let truncated = 0;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    const add = (kind, el, node, extra = {}) => {
      if (issues.length < 400) {
        issues.push({
          kind,
          text: node ? node.textContent.trim().slice(0, 48) : '',
          where: describe(el),
          fontPx: parseFloat(getComputedStyle(el).fontSize),
          ...extra,
        });
      }
    };
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim()) continue;
      const el = node.parentElement;
      if (!el || /^(SCRIPT|STYLE|NOSCRIPT|OPTION|TITLE)$/.test(el.tagName) || isHidden(el)) continue;
      const closed = el.closest('details:not([open])');
      if (closed && !el.closest('summary')) continue;
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
      if (!rects.length) continue;
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      let ellipsis = false;
      let clamp = false;
      let freeX = false;
      let freeY = false;
      for (let at = el; at && at !== document.documentElement; at = at.parentElement) {
        const cs = getComputedStyle(at);
        const box = at.getBoundingClientRect();
        if (cs.textOverflow === 'ellipsis' && clips(cs.overflowX)) ellipsis = true;
        if (cs.webkitLineClamp && cs.webkitLineClamp !== 'none') clamp = true;
        const deliberate = ellipsis || clamp;
        if (!freeX && clips(cs.overflowX) && !deliberate) {
          if (right > box.right + SLOP || left < box.left - SLOP) {
            add('clipped-x', at, node, { by: Math.round(Math.max(right - box.right, box.left - left)) });
            break;
          }
        }
        if (!freeY && clips(cs.overflowY) && !clamp) {
          if (bottom > box.bottom + SLOP + 1 || top < box.top - SLOP - 1) {
            add('clipped-y', at, node, { by: Math.round(Math.max(bottom - box.bottom, box.top - top)) });
            break;
          }
        }
        if (!freeX && !freeY && !deliberate && hasBox(cs, at) && at.clientWidth > 0) {
          if (right > box.right + SLOP) {
            add('escapes-box', at, node, { by: Math.round(right - box.right) });
            break;
          }
        }
        if (scrolls(cs.overflowX)) freeX = true;
        if (scrolls(cs.overflowY)) freeY = true;
      }
      if (ellipsis) {
        truncated += 1;
        // Barely a letter left. A tooltip still names it, so that is a warning.
        const cut = el.scrollWidth > el.clientWidth + 1;
        if (cut && el.clientWidth > 0 && el.clientWidth < 2.5 * parseFloat(getComputedStyle(el).fontSize))
          warnings.push({ kind: 'truncated-to-nothing', text: node.textContent.trim().slice(0, 48), where: describe(el), hasTitle: !!el.closest('[title]') });
      }
      if (!freeX && !ellipsis && right > window.innerWidth + SLOP) add('off-window', el, node, { by: Math.round(right - window.innerWidth) });
      let shown = left < window.innerWidth && right > 0 && top < window.innerHeight && bottom > 0;
      for (let at = el; shown && at !== document.documentElement; at = at.parentElement) {
        const cs = getComputedStyle(at);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const box = at.getBoundingClientRect();
        shown = right > box.left && left < box.right && bottom > box.top && top < box.bottom;
      }
      if (shown) {
        // What actually paints: an ellipsis hides the rest of the line's rect.
        for (const raw of rects) {
          const r = { left: raw.left, right: raw.right, top: raw.top, bottom: raw.bottom, height: raw.height };
          for (let at = el; at !== document.documentElement; at = at.parentElement) {
            const cs = getComputedStyle(at);
            if (cs.overflowX === 'visible') continue;
            const box = at.getBoundingClientRect();
            r.left = Math.max(r.left, box.left);
            r.right = Math.min(r.right, box.right);
          }
          if (r.right > r.left) texts.push({ node, el, r });
        }
      }
    }
    // Two labels drawn over each other. Blocks on top of a grid do not count:
    // the hit test keeps only pairs where one of the two is what actually shows.
    if (texts.length < 1500) {
      for (let i = 0; i < texts.length; i++) {
        for (let j = i + 1; j < texts.length; j++) {
          const a = texts[i];
          const b = texts[j];
          if (a.node === b.node || a.el.contains(b.el) || b.el.contains(a.el)) continue;
          const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
          const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
          if (w <= 2 || h <= Math.min(a.r.height, b.r.height) * 0.4) continue;
          const x = (Math.min(a.r.right, b.r.right) + Math.max(a.r.left, b.r.left)) / 2;
          const y = (Math.min(a.r.bottom, b.r.bottom) + Math.max(a.r.top, b.r.top)) / 2;
          if (bothVisible(a.el, b.el, x, y)) {
            add('overlap', a.el, a.node, { with: b.node.textContent.trim().slice(0, 32) });
          }
        }
      }
    }
    // Native date and time fields clip inside their shadow DOM, out of reach of the
    // text walk above, so check they have room for their full value and picker icon.
    for (const el of document.querySelectorAll('input[type="time"], input[type="date"]')) {
      if (isHidden(el) || !el.clientWidth) continue;
      const cs = getComputedStyle(el);
      const room = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const needed = (el.type === 'time' ? 7 : 8.2) * parseFloat(cs.fontSize);
      if (room < needed - 1) add('field-too-narrow', el, null, { by: Math.round(needed - room) });
    }
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (scrolls(cs.overflowX) && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !isHidden(el)) {
        add('hscroll', el, null, { by: el.scrollWidth - el.clientWidth });
      }
    }
    return { issues, warnings, truncated, textCount: texts.length };
  };
})();
