const PRODUCTION_APP_ORIGIN = 'https://vicompare.pages.dev';

const isLocalPreviewOrigin = (origin) => {
  try {
    const hostname = new URL(origin).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
};

export function buildCanvasImageCandidates(url, appOrigin = '') {
  const source = String(url || '').trim();
  if (!source) return [];

  const isRemote = source.startsWith('https://') || source.startsWith('http://');
  const isAlreadyProxied = source.includes('/cors-proxy?url=');
  if (!isRemote || isAlreadyProxied) return [source];

  const proxyOrigin = isLocalPreviewOrigin(appOrigin) ? PRODUCTION_APP_ORIGIN : '';
  return [
    `${proxyOrigin}/cors-proxy?url=${encodeURIComponent(source)}`,
    source
  ];
}
