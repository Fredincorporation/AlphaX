export function isAllowedHost(hostname: string, allowedDomain?: string): boolean {
  if (!allowedDomain) return true;
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const allowed = allowedDomain.toLowerCase().replace(/^www\./, '');
  return host === allowed || host.endsWith(`.${allowed}`);
}

export function validateNavigationTarget(
  target: string,
  currentUrl: string,
  allowedDomain?: string
): string {
  const value = target.trim();
  if (!value) throw new Error('Navigation rejected: target URL is empty.');

  let parsed: URL;
  try {
    parsed = value.startsWith('/') ? new URL(value, currentUrl) : new URL(value);
  } catch {
    throw new Error(`Navigation rejected: "${value}" is not a valid HTTP(S) URL or relative path.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Navigation rejected: protocol "${parsed.protocol}" is not allowed.`);
  }
  if (!parsed.hostname || /\s|WebMCP|Agent|Goal Runner/i.test(parsed.hostname)) {
    throw new Error(`Navigation rejected: "${value}" is not a real hostname.`);
  }
  if (!isAllowedHost(parsed.hostname, allowedDomain)) {
    throw new Error(`Navigation blocked: ${parsed.hostname} is outside the approved domain ${allowedDomain}.`);
  }
  return parsed.toString();
}
