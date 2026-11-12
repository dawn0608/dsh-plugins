/** Mount refresh plus visible-only polling; each owner cancels its own requests. */
export function watchRefresh(refresh, interval, doc = globalThis.document) {
  let timer;
  const visible = () => !doc || doc.visibilityState !== 'hidden';
  function schedule() {
    clearInterval(timer);
    timer = undefined;
    if (visible()) timer = setInterval(refresh, interval);
  }
  function changed() {
    schedule();
    if (visible()) refresh();
  }
  refresh();
  schedule();
  doc?.addEventListener('visibilitychange', changed);
  return () => {
    clearInterval(timer);
    doc?.removeEventListener('visibilitychange', changed);
  };
}
