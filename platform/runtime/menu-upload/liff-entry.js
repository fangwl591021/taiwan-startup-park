// Read only public routing hints. LIFF owns OAuth query/fragment processing.
const routingKeys = ['portalSlug', 'lineAccountId', 'ref', 'src', 'returnTo', 'memberLogin'];

// Only feature callers opt into named continuation hints; default routing does not expose activity capabilities.
export function liffEntryParams(search = '', pathname = '/liff/referral', additionalKeys = []) {
  const params = new URLSearchParams(search);
  const result = new URLSearchParams();
  const merge = source => {
    for (const key of [...routingKeys, ...additionalKeys]) {
      const values = source.getAll(key);
      // LINE combines the registered Compact Endpoint query and LIFF query.
      // Only this non-authorizing display hint may repeat with the same value.
      // Keep strict duplicate rejection for identity and activity capabilities.
      if (values.length > 1 && !(key === 'activityCompact' && values.every(value => value === '1'))) throw new Error('LIFF_ENTRY_INVALID');
      if (!source.has(key)) continue;
      const value = source.get(key);
      if (result.has(key) && result.get(key) !== value) throw new Error('LIFF_ENTRY_INVALID');
      result.set(key, value);
    }
  };
  merge(params);
  if (params.has('liff.state')) {
    if (params.getAll('liff.state').length !== 1) throw new Error('LIFF_ENTRY_INVALID');
    const state = params.get('liff.state');
    // Additional LIFF paths and query parameters arrive inside liff.state.
    // Never use it as a redirect, decode it twice, or retain provider tokens.
    if (state.length > 4096 || /[\\#\r\n]/.test(state)) throw new Error('LIFF_ENTRY_INVALID');
    // LIFF 2.31.2 preserves '?' within parameter values. Only the first '?'
    // separates the path: keep all later punctuation and let URLSearchParams
    // decode each parameter once, never replace '?' with '&' or decode twice.
    const queryIndex = state.indexOf('?');
    const additionalPath = queryIndex < 0 ? state : state.slice(0, queryIndex);
    if (additionalPath && additionalPath !== '/') {
      // LINE wraps the child of the legacy shared Endpoint as /portal/<slug>
      // during OAuth. Recover only this known public route so the SDK can
      // initialize on the unmodified primary URL and finish its own redirect.
      if (pathname !== '/liff/referral' || !additionalPath.startsWith('/portal/')) throw new Error('LIFF_ENTRY_INVALID');
      const slug = decodeURIComponent(additionalPath.slice('/portal/'.length).replace(/\/$/, ''));
      if (slug === 'default' || !/^[a-zA-Z0-9\u4e00-\u9fff_-]{1,100}$/.test(slug)) throw new Error('LIFF_ENTRY_INVALID');
      merge(new URLSearchParams({ portalSlug: slug }));
    }
    const nested = new URLSearchParams(queryIndex < 0 ? '' : state.slice(queryIndex + 1));
    if (nested.has('liff.state')) throw new Error('LIFF_ENTRY_INVALID');
    merge(nested);
  }
  return result;
}
