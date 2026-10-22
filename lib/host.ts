// 取图地址 = 协议 + 公网地址 + 公网端口，和端口映射软件的写法一样。公网地址留空时自动检测本机的公网 IP（只能是 http），
// 公网端口为 0 时：http 与本机端口相同（路由器端口转发通常两边一致），https 用 443（只有内网穿透、反向代理才给得出 https）
import http from 'node:http';
import https from 'node:https';
import { CodedError } from '../ui/convert/types.ts';
import type { HostConfig, HostExit, HostState } from '../ui/convert/types.ts';
import { settings, saveSettings, stamp, validPort, UI_PORT, IMG_PORT, TOKEN } from './config.ts';

const validPub = (n: number) => Number.isInteger(n) && n >= 1 && n <= 65535;
const PUB: Omit<HostConfig, 'imgPort'> = {
  host: typeof settings.host === 'string' ? settings.host : '',
  port: validPub(settings.port) ? settings.port : 0,
  proto: 'http',
};
if (PUB.host && settings.proto === 'https') PUB.proto = 'https';
// list：自动检测到的出口 [{ base, ip, seen, ok, passes, stale }]，seen = 本轮多少次探测落在这个出口；manual：填了公网地址时它的检测结果
const host: Omit<HostState, 'pick' | 'config'> & { manual: { base: string; ok: boolean } | null } = {
  checking: false,
  list: [],
  manual: null,
  checkedAt: 0,
  probes: 0,
};
let recheck = false,
  gen = 0;
const bracket = (h: string) => (h.includes(':') ? `[${h}]` : h);
function baseOf(h: string) {
  const def = PUB.proto === 'https' ? 443 : 80,
    port = PUB.port || (PUB.proto === 'https' ? 443 : IMG_PORT);
  return `${PUB.proto}://${bracket(h)}${port === def ? '' : ':' + port}`;
}
const IP_SRCS = [
  'https://myip.ipip.net',
  'http://ddns.oray.com/checkip',
  'https://ip.3322.net',
  'http://members.3322.org/dyndns/getip',
  'https://api-ipv4.ip.sb/ip',
  'https://ifconfig.me/ip',
  'https://checkip.amazonaws.com',
  'https://v4.ident.me',
  'https://ipv4.icanhazip.com',
];
const ROUNDS = 3;
const TTL = 5 * 60000;

/** 每次都新建 TCP 连接：多线负载均衡按连接分流，复用连接就永远只看到同一个出口 */
function getText(u: string, ms: number) {
  return new Promise<string | null>(resolve => {
    const lib = u.startsWith('https:') ? https : http;
    const req = lib.get(u, { agent: false, family: 4, timeout: ms, headers: { 'user-agent': 'curl/8' } }, r => {
      let b = '';
      r.setEncoding('utf8');
      r.on('data', c => {
        if (b.length < 4096) b += c;
      });
      r.on('end', () => resolve(r.statusCode === 200 ? b : null));
      // 读到一半连接断开或超时被掐断时没有 end，只有 close；不 resolve 的话这一轮检测永远结束不了
      r.on('close', () => resolve(null));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}
async function ping(base: string) {
  const t = await getText(base.replace(/\/+$/, '') + '/__ping', 6000);
  return t != null && t.trim() === TOKEN;
}
// 内网和保留地址微信永远连不上；查 IP 的网站被劫持（如校园网认证页）时回的可能就是本机内网地址，回连检测照样能通
function isPublicIPv4(ip: string) {
  const o = ip.split('.').map(Number);
  if (o.some(n => n > 255)) return false;
  const [a, b] = o;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b < 128) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b < 32) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
/** 检测回连也会被分到不同出口，一个出口试三次，有一次通就算通 */
async function pingN(base: string, n = 3) {
  const r = await Promise.all(Array.from({ length: n }, () => ping(base)));
  return r.filter(Boolean).length;
}
export async function checkHosts() {
  // 检测进行中又要求检测：这一轮结束后再测一轮；这一轮里设置改了（gen 变了），结果作废
  if (host.checking) {
    recheck = true;
    return;
  }
  host.checking = true;
  const g = gen;
  try {
    if (PUB.host) {
      // 填了公网地址就不查公网 IP，只测这个地址
      const base = baseOf(PUB.host),
        ok = (await pingN(base)) > 0;
      if (g !== gen) return;
      Object.assign(host, { manual: { base, ok }, list: [], probes: 0, checkedAt: Date.now() });
      console.log(`${stamp()}  取图地址  ${base}  ${ok ? '可以访问' : '无法访问'}`);
      return;
    }
    const jobs = [];
    for (let k = 0; k < ROUNDS; k++) for (const u of IP_SRCS) jobs.push(getText(u, 5000));
    const seen = new Map<string, number>();
    for (const t of await Promise.all(jobs)) {
      const ip = t && (t.match(/\b\d{1,3}(\.\d{1,3}){3}\b/) || [])[0];
      if (ip && isPublicIPv4(ip)) seen.set(ip, (seen.get(ip) || 0) + 1);
    }
    const fresh = await Promise.all(
      [...seen].map(async ([ip, n]): Promise<HostExit> => {
        const base = baseOf(ip);
        const passes = await pingN(base);
        return { base, ip, seen: n, ok: passes > 0, passes, stale: false };
      }),
    );
    if (g !== gen) return;
    // 上一轮见过、这轮没探到的出口先留着（可能只是这轮没分到），标成 stale
    const old = host.list.filter(h => !seen.has(h.ip)).map(h => ({ ...h, seen: 0, stale: true }));
    Object.assign(host, {
      list: [...fresh, ...old].sort((a: any, b: any) => b.ok - a.ok || b.seen - a.seen),
      manual: null,
      probes: jobs.length,
      checkedAt: Date.now(),
    });
    for (const h of fresh)
      console.log(
        `${stamp()}  取图地址  ${h.base}  ${h.ok ? '可以访问' : '无法访问'}  （${jobs.length} 次查询中有 ${h.seen} 次查到这个 IP）`,
      );
    if (!fresh.length) console.log(`${stamp()}  取图地址  没有检测到公网 IP`);
  } finally {
    host.checking = false;
    if (recheck || g !== gen) {
      recheck = false;
      checkHosts();
    }
  }
}
/** 页面开着（每 1.5 秒来问一次状态）才定期重测；没人看时不去打扰查 IP 的网站 */
export function checkIfStale() {
  if (!host.checking && Date.now() - host.checkedAt > TTL) checkHosts();
}
function pickBase(): HostState['pick'] {
  if (PUB.host) return host.manual || { base: baseOf(PUB.host), ok: null };
  const ok = host.list.find(h => h.ok);
  if (ok) return { base: ok.base, ok: true };
  return host.list[0] ? { base: host.list[0].base, ok: false } : null;
}
export const hostState = (): HostState => ({
  checking: host.checking,
  list: host.list,
  checkedAt: host.checkedAt,
  probes: host.probes,
  pick: pickBase(),
  config: { imgPort: IMG_PORT, host: PUB.host, port: PUB.port, proto: PUB.proto },
});

/** 公网地址：域名、IPv4 或 IPv6，不带协议、端口和路径；内网地址微信服务器连不上，不收 */
function cleanHost(v: unknown) {
  const s = String(v || '').trim();
  if (!s) return '';
  let u = null;
  try {
    u = new URL(`http://${s.includes(':') && !s.startsWith('[') ? `[${s}]` : s}/`);
  } catch {
    /* 下面报错 */
  }
  if (!u || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash)
    throw new CodedError('api.badHost');
  const h = u.hostname.replace(/^\[|\]$/g, '');
  const inner =
    /^localhost$/i.test(h) ||
    (/^\d+\.\d+\.\d+\.\d+$/.test(h) && !isPublicIPv4(h)) ||
    (h.includes(':') && /^(::1?$|::ffff:|f[cd]|fe[89ab])/i.test(h));
  if (inner) throw new CodedError('api.innerHost', { host: h });
  return h;
}
/** 页面上“取图地址”表单 { imgPort, host, port, proto } → 校验过的设置；不合格时抛出 CodedError（文案 api.*） */
export function parseHostForm(b: Record<string, unknown>): HostConfig {
  // 空串表示留空；其余按数字解析，解析不出是 NaN，下面的校验会拒绝
  const num = (v: unknown) => (v == null || String(v).trim() === '' ? 0 : Number(v));
  const imgPort = num(b.imgPort),
    port = num(b.port);
  if (!validPort(imgPort)) throw new CodedError('api.badImgPort');
  if (imgPort === UI_PORT) throw new CodedError('api.uiPort', { port: imgPort });
  if (port !== 0 && !validPub(port)) throw new CodedError('api.badPubPort');
  const h = cleanHost(b.host);
  return { imgPort, host: h, port, proto: h && b.proto === 'https' ? 'https' : 'http' };
}
/** 本机端口换绑之后调用：记下公网地址，存设置，清掉旧结果重测 */
export function applyHost(cfg: HostConfig) {
  Object.assign(PUB, { host: cfg.host, port: cfg.port, proto: cfg.proto });
  saveSettings({ imgPort: IMG_PORT, host: PUB.host, port: PUB.port, proto: PUB.proto });
  gen++;
  Object.assign(host, { list: [], manual: null, checkedAt: 0, probes: 0 });
  checkHosts();
}
