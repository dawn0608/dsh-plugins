/** Host DetailDocument/CodeBlock chrome adapted from Harness 0.2.2-rc.1 (MIT).
 * A local unified/mdast pipeline keeps GFM and math self-contained; HTML and
 * unauthorized images never enter the document. See THIRD_PARTY_NOTICES.md.
 */
import { createElement as h, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import { highlightTokens, subscribeGrammarLoaded, grammarLoadCount } from './host-highlight.js';
import { Button, StateDot } from './host-controls.js';

export function detailDocumentState(read) {
  if (read?.status === 'ready') return read.markdown === undefined ? { status: 'none' } : { status: 'found', markdown: read.markdown };
  return read?.status === 'error' ? read : { status: 'loading' };
}

export function useDetailDocumentLabels(copy) {
  const { title, loading, retry, footnotes, copy: copyLabel, copied: copiedLabel, codeBlock: codeLabel, wrap: wrapLabel, unwrap: unwrapLabel } = copy;
  return useMemo(() => ({ title, loading, retry, markdown: { code: { copyLabel, copiedLabel, toolbarLabels: { codeLabel, wrapLabel, unwrapLabel } }, footnotes } }),
    [title, loading, retry, footnotes, copyLabel, copiedLabel, codeLabel, wrapLabel, unwrapLabel]);
}

function CodeBlock({ children, labels }) {
  const code = children?.props;
  const text = String(code?.children ?? '').replace(/\n$/, '');
  const language = /(?:^|\s)language-([^\s]+)/.exec(code?.className ?? '')?.[1];
  const grammarVersion = useSyncExternalStore(subscribeGrammarLoaded, grammarLoadCount, grammarLoadCount);
  const tokens = useMemo(() => highlightTokens(text, language), [text, language, grammarVersion]);
  const highlighted = tokens?.flatMap((line, index) => [index ? '\n' : '', ...line.map((token, column) => h('span', {
    key: `${index}-${column}`, style: { color: token.color,
      fontStyle: token.fontStyle & 1 ? 'italic' : undefined,
      fontWeight: token.fontStyle & 2 ? 'bold' : undefined,
      textDecoration: [token.fontStyle & 4 ? 'underline' : '', token.fontStyle & 8 ? 'line-through' : ''].filter(Boolean).join(' ') || undefined },
  }, token.content))]);
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const timer = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearTimeout(timer.current); };
  }, []);
  const copy = async () => {
    try {
      if (!globalThis.navigator?.clipboard?.writeText) return;
      await navigator.clipboard.writeText(text);
      if (!alive.current) return;
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch { /* Keep the copy action available when the host denies clipboard access. */ }
  };
  return h('div', { className: 'dshdoc_code_block' },
    h('div', { className: 'dshdoc_code_bannerWrap' }, h('div', { className: 'dshdoc_code_banner' },
      h('span', { className: 'dshdoc_code_infostring' }, language || labels.toolbarLabels.codeLabel),
      h('div', { className: 'dshdoc_code_action' },
        h(Button, { size: 'sm', 'aria-pressed': wrap, onClick: () => setWrap(value => !value) }, wrap ? labels.toolbarLabels.unwrapLabel : labels.toolbarLabels.wrapLabel),
        h(Button, { size: 'sm', onClick: copy }, copied ? labels.copiedLabel : labels.copyLabel)))),
    h('pre', { style: { whiteSpace: wrap ? 'pre-wrap' : 'pre', wordBreak: wrap ? 'break-all' : 'normal' } }, h('code', { className: code?.className }, highlighted ?? text)));
}

function safeUrl(url) {
  if (url.startsWith('#')) return url;
  try {
    const parsed = new URL(url);
    return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '';
  } catch { return ''; }
}

function Document({ markdown, labels }) {
  const prefix = `dshdoc-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-`;
  const components = useMemo(() => ({
    // Images have no authorized resolver in skill previews, including remote ones.
    img: () => null,
    a: ({ href, children, node: _node, ...props }) => !href ? h('span', null, children)
      : h('a', { ...props, href, ...(href.startsWith('#') ? {} : { target: '_blank', rel: 'noopener noreferrer' }) }, children),
    pre: ({ children }) => h(CodeBlock, { labels: labels.code }, children),
    table: ({ children }) => h('div', { className: 'dshdoc_md_tableScroll dshdoc_md_tableFill', tabIndex: 0 }, h('table', null, children)),
  }), [labels.code]);
  return h('div', { className: 'dshdoc_md_markdown' }, h(Markdown, {
    skipHtml: true, urlTransform: safeUrl,
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [[rehypeKatex, { trust: false, throwOnError: false, strict: 'ignore' }]],
    remarkRehypeOptions: { footnoteLabel: labels.footnotes, footnoteBackLabel: labels.footnotes, clobberPrefix: prefix },
    components,
  }, markdown));
}

export function DetailDocument({ state, labels, onRetry }) {
  if (state.status === 'none') return null;
  let body;
  if (state.status === 'found') body = h('div', { className: 'dshdoc_detail_document', role: 'region', 'aria-label': labels.title, tabIndex: 0 },
    h(Document, { markdown: state.markdown, labels: labels.markdown }));
  else if (state.status === 'error') body = h('div', { className: 'dshdoc_detail_failure' },
    h('p', { className: 'dshdoc_detail_error', role: 'alert' }, h(StateDot, { state: 'error' }), state.message),
    h(Button, { variant: 'outline', size: 'sm', onClick: onRetry }, labels.retry));
  else body = h('div', { className: 'dshdoc_detail_skeleton', role: 'status', 'aria-label': labels.loading, 'aria-busy': true },
    ...['long', 'long', 'short'].map((width, index) => h('span', { key: index, className: `dshdoc_detail_bar dshdoc_detail_${width}` })));
  return h('section', { className: 'dshdoc_detail_section', 'data-detail-document': '' }, body);
}
