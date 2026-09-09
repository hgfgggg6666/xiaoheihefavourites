import * as crypto from 'crypto';

const f3 = (e: number) => (e & 128 ? ((e << 1) ^ 27) & 255 : e << 1);
const Pc = (e: number) => f3(e) ^ e;
const Sf = (e: number) => Pc(f3(e));
const Lh = (e: number) => Sf(Pc(f3(e)));
const ig = (e: number) => Lh(e) ^ Sf(e) ^ Pc(e);

function Rwe(e: number[]): number[] {
  const t = [0, 0, 0, 0];
  t[0] = ig(e[0]) ^ Lh(e[1]) ^ Sf(e[2]) ^ Pc(e[3]);
  t[1] = Pc(e[0]) ^ ig(e[1]) ^ Lh(e[2]) ^ Sf(e[3]);
  t[2] = Sf(e[0]) ^ Pc(e[1]) ^ ig(e[2]) ^ Lh(e[3]);
  t[3] = Lh(e[0]) ^ Sf(e[1]) ^ Pc(e[2]) ^ ig(e[3]);
  e[0] = t[0];
  e[1] = t[1];
  e[2] = t[2];
  e[3] = t[3];
  return e;
}

const Owe = (e: number[]) => e.reduce((a, b) => a + b, 0);

function Iwe(a: string[]): string {
  let t = '';
  const m = Math.max(...a.map((x: string) => x.length));
  for (let n = 0; n < m; n++) {
    a.forEach((x: string) => {
      if (n < x.length) t += x[n];
    });
  }
  return t;
}

function OM(e: string, t: string, n: number): string {
  let r = '';
  const o = t.slice(0, n);
  for (let a = 0; a < e.length; a++) {
    r += o[e.charCodeAt(a) % o.length];
  }
  return r;
}

function MM(e: string, t: string): string {
  let n = '';
  for (let r = 0; r < e.length; r++) {
    n += t[e.charCodeAt(r) % t.length];
  }
  return n;
}

const md5 = (s: string) => crypto.createHash('md5').update(s).digest('hex');

function Tr(e: string, t: number, n: string): string {
  e = '/' + e.split('/').filter(Boolean).join('/') + '/';
  const r = 'AB45STUVWZEFGJ6CH01D237IXYPQRKLMN89';
  const o = OM(String(t), r, -2);
  const a = MM(e, r);
  const s = MM(n, r);
  let l = md5(Iwe([o, a, s]).slice(0, 20));
  const u = String(
    Owe(Rwe(l.slice(-6).split('').map((f: string) => f.charCodeAt(0)))) % 100,
  ).padStart(2, '0');
  return OM(l.substring(0, 5), r, -4) + u;
}

export const HEYBOX_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export const HEYBOX_PUBLIC_PARAMS: Record<string, string> = {
  app: 'heybox',
  os_type: 'web',
  x_app: 'heybox_website',
  x_client_type: 'web',
  x_os_type: 'Windows',
  x_client_version: '',
  client_type: 'web',
  web_version: '3.0',
};

export interface HeyboxSignResult {
  version: string;
  hkey: string;
  _time: number;
  nonce: string;
}

export function heyboxSign(path: string): HeyboxSignResult {
  const _time = Math.floor(Date.now() / 1000);
  const nonce = md5(_time + String(Date.now()) + String(Math.random())).toUpperCase();
  return {
    version: '999.0.4',
    hkey: Tr(path, _time + 1, nonce),
    _time,
    nonce,
  };
}

export function buildHeyboxUrl(
  basePath: string,
  bizParams: Record<string, string | number | boolean>,
): string {
  const sign = heyboxSign(basePath);
  const params = new URLSearchParams();

  for (const [k, v] of Object.entries(HEYBOX_PUBLIC_PARAMS)) {
    params.set(k, v);
  }

  for (const [k, v] of Object.entries(bizParams)) {
    params.set(k, String(v));
  }

  params.set('version', sign.version);
  params.set('hkey', sign.hkey);
  params.set('_time', String(sign._time));
  params.set('nonce', sign.nonce);

  return `https://api.xiaoheihe.cn${basePath}?${params.toString()}`;
}

export function buildHeyboxHeaders(cookie: string): Record<string, string> {
  return {
    'User-Agent': HEYBOX_UA,
    Referer: 'https://xiaoheihe.cn/',
    Origin: 'https://xiaoheihe.cn',
    Accept: 'application/json, text/plain, */*',
    Cookie: cookie,
  };
}
