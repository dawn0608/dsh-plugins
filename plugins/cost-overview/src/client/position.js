// Adapted from DeepSeek Harness 0.2.2-rc.1's useAnchoredPosition.
// Copyright (c) 2026 DeepSeek. MIT, see the packaged LICENSE.
import { useLayoutEffect, useState } from 'react';

const MARGIN = 12;
const GAP = 8;

export function usePanelPosition(open, anchorRef, panelRef) {
  const [position, setPosition] = useState(null);
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    const root = anchor?.ownerDocument.documentElement;
    const view = anchor?.ownerDocument.defaultView;
    if (!view || !panel) return;

    const viewport = view.visualViewport;
    const webkit = view.CSS?.supports('-webkit-backdrop-filter', 'none');
    const place = () => {
      const rect = anchor.getBoundingClientRect();
      const x = viewport?.offsetLeft ?? 0;
      const y = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? (root.clientWidth || view.innerWidth);
      const height = viewport?.height ?? (root.clientHeight || view.innerHeight);
      const clearance = Number.parseFloat(view.getComputedStyle(root).getPropertyValue('--dsh-frame-top-clearance'));
      const topMargin = Number.isNaN(clearance) ? MARGIN : Math.max(MARGIN, Math.min(
        (root.hasAttribute('data-fullscreen') ? 0 : clearance) + 20,
        rect.top >= 0 ? rect.bottom + GAP : Infinity,
      ));

      panel.style.setProperty('--dsh-anchored-max-width', `${Math.max(0, width - MARGIN * 2)}px`);
      panel.style.setProperty('--dsh-anchored-max-height', `${Math.max(0, height - topMargin - MARGIN)}px`);
      const left = Math.max(x + MARGIN, Math.min(rect.left + (webkit ? x : 0),
        x + width - MARGIN - panel.offsetWidth));
      const top = Math.max(y + topMargin, Math.min(rect.top - GAP - panel.offsetHeight + (webkit ? y : 0),
        y + height - MARGIN - panel.offsetHeight));
      setPosition(previous => previous?.left === left && previous?.top === top ? previous : { left, top });
    };

    place();
    const observer = view.ResizeObserver ? new view.ResizeObserver(place) : null;
    observer?.observe(anchor);
    observer?.observe(panel);
    view.addEventListener('resize', place);
    view.addEventListener('scroll', place, true);
    viewport?.addEventListener('resize', place);
    viewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect();
      view.removeEventListener('resize', place);
      view.removeEventListener('scroll', place, true);
      viewport?.removeEventListener('resize', place);
      viewport?.removeEventListener('scroll', place);
      panel.style.removeProperty('--dsh-anchored-max-width');
      panel.style.removeProperty('--dsh-anchored-max-height');
    };
  }, [open, anchorRef, panelRef]);
  return position;
}
