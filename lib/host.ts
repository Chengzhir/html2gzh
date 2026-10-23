// 取图地址 = 协议 + 公网地址 + 公网端口，和端口映射软件的写法一样。公网地址留空时自动检测本机的公网 IP（只能是 http），
// 公网端口为 0 时：http 与本机端口相同（路由器端口转发通常两边一致），https 用 443（只有内网穿透、反向代理才给得出 https）
import http from 'node:http';
import https from 'node:https';
import { CodedError } from '../ui/convert/types.ts';
import type { HostConfig, HostExit, HostState } from '../ui/convert/types.ts';
import { settings, saveSettings, stamp, validPort, UI_PORT, IMG_PORT, TOKEN } from './config.ts';

const validPublicPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;
const publicAddress: Omit<HostConfig, 'imgPort'> = {
  host: typeof settings.host === 'string' ? settings.host : '',
  port: validPublicPort(settings.port) ? settings.port : 0,
  proto: 'http',
};
if (publicAddress.host && settings.proto === 'https') publicAddress.proto = 'https';
// list：自动检测到的出口 [{ base, ip, seen, ok, passes, stale }]，seen = 本轮多少次探测落在这个出口；manual：填了公网地址时它的检测结果
const host: Omit<HostState, 'pick' | 'config'> & { manual: { base: string; ok: boolean } | null } = {
  checking: false,
  list: [],
  manual: null,
  checkedAt: 0,
  probes: 0,
};
let recheck = false,
  generation = 0;
const bracket = (hostname: string) => (hostname.includes(':') ? `[${hostname}]` : hostname);
function baseOf(hostname: string) {
  const defaultPort = publicAddress.proto === 'https' ? 443 : 80,
    port = publicAddress.port || (publicAddress.proto === 'https' ? 443 : IMG_PORT);
  return `${publicAddress.proto}://${bracket(hostname)}${port === defaultPort ? '' : ':' + port}`;
}
const IP_SOURCES = [
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
function getText(url: string, timeoutMs: number) {
  return new Promise<string | null>(resolve => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(
      url,
      { agent: false, family: 4, timeout: timeoutMs, headers: { 'user-agent': 'curl/8' } },
      response => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', chunk => {
          if (body.length < 4096) body += chunk;
        });
        response.on('end', () => resolve(response.statusCode === 200 ? body : null));
        // 读到一半连接断开或超时被掐断时没有 end，只有 close；不 resolve 的话这一轮检测永远结束不了
        response.on('close', () => resolve(null));
      },
    );
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}
async function ping(base: string) {
  const text = await getText(base.replace(/\/+$/, '') + '/__ping', 6000);
  return text != null && text.trim() === TOKEN;
}
// 内网和保留地址微信永远连不上；查 IP 的网站被劫持（如校园网认证页）时回的可能就是本机内网地址，回连检测照样能通
function isPublicIPv4(ip: string) {
  const octets = ip.split('.').map(Number);
  if (octets.some(octet => octet > 255)) return false;
  const [first, second] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second < 128) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second < 32) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19))
  );
}
/** 检测回连也会被分到不同出口，一个出口试三次，有一次通就算通 */
async function countPings(base: string, attempts = 3) {
  const results = await Promise.all(Array.from({ length: attempts }, () => ping(base)));
  return results.filter(Boolean).length;
}
export async function checkHosts() {
  // 检测进行中又要求检测：这一轮结束后再测一轮；这一轮里设置改了（gen 变了），结果作废
  if (host.checking) {
    recheck = true;
    return;
  }
  host.checking = true;
  const startGeneration = generation;
  try {
    if (publicAddress.host) {
      // 填了公网地址就不查公网 IP，只测这个地址
      const base = baseOf(publicAddress.host),
        ok = (await countPings(base)) > 0;
      if (startGeneration !== generation) return;
      Object.assign(host, { manual: { base, ok }, list: [], probes: 0, checkedAt: Date.now() });
      console.log(`${stamp()}  取图地址  ${base}  ${ok ? '可以访问' : '无法访问'}`);
      return;
    }
    const jobs = [];
    for (let k = 0; k < ROUNDS; k++) for (const source of IP_SOURCES) jobs.push(getText(source, 5000));
    const seen = new Map<string, number>();
    for (const text of await Promise.all(jobs)) {
      const ip = text && (text.match(/\b\d{1,3}(\.\d{1,3}){3}\b/) || [])[0];
      if (ip && isPublicIPv4(ip)) seen.set(ip, (seen.get(ip) || 0) + 1);
    }
    const fresh = await Promise.all(
      [...seen].map(async ([ip, hits]): Promise<HostExit> => {
        const base = baseOf(ip);
        const passes = await countPings(base);
        return { base, ip, seen: hits, ok: passes > 0, passes, stale: false };
      }),
    );
    if (startGeneration !== generation) return;
    // 上一轮见过、这轮没探到的出口先留着（可能只是这轮没分到），标成 stale
    const missing = host.list.filter(exit => !seen.has(exit.ip)).map(exit => ({ ...exit, seen: 0, stale: true }));
    Object.assign(host, {
      list: [...fresh, ...missing].sort((a: any, b: any) => b.ok - a.ok || b.seen - a.seen),
      manual: null,
      probes: jobs.length,
      checkedAt: Date.now(),
    });
    for (const exit of fresh)
      console.log(
        `${stamp()}  取图地址  ${exit.base}  ${exit.ok ? '可以访问' : '无法访问'}  （${jobs.length} 次查询中有 ${exit.seen} 次查到这个 IP）`,
      );
    if (!fresh.length) console.log(`${stamp()}  取图地址  没有检测到公网 IP`);
  } finally {
    host.checking = false;
    if (recheck || startGeneration !== generation) {
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
  if (publicAddress.host) return host.manual || { base: baseOf(publicAddress.host), ok: null };
  const reachable = host.list.find(h => h.ok);
  if (reachable) return { base: reachable.base, ok: true };
  return host.list[0] ? { base: host.list[0].base, ok: false } : null;
}
export const hostState = (): HostState => ({
  checking: host.checking,
  list: host.list,
  checkedAt: host.checkedAt,
  probes: host.probes,
  pick: pickBase(),
  config: { imgPort: IMG_PORT, host: publicAddress.host, port: publicAddress.port, proto: publicAddress.proto },
});

/** 公网地址：域名、IPv4 或 IPv6，不带协议、端口和路径；内网地址微信服务器连不上，不收 */
function cleanHost(input: unknown) {
  const text = String(input || '').trim();
  if (!text) return '';
  let parsed = null;
  try {
    parsed = new URL(`http://${text.includes(':') && !text.startsWith('[') ? `[${text}]` : text}/`);
  } catch {
    /* 下面报错 */
  }
  if (
    !parsed ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  )
    throw new CodedError('api.badHost');
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '');
  const inner =
    /^localhost$/i.test(hostname) ||
    (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && !isPublicIPv4(hostname)) ||
    (hostname.includes(':') && /^(::1?$|::ffff:|f[cd]|fe[89ab])/i.test(hostname));
  if (inner) throw new CodedError('api.innerHost', { host: hostname });
  return hostname;
}
/** 页面上“取图地址”表单 { imgPort, host, port, proto } → 校验过的设置；不合格时抛出 CodedError（文案 api.*） */
export function parseHostForm(form: Record<string, unknown>): HostConfig {
  // 空串表示留空；其余按数字解析，解析不出是 NaN，下面的校验会拒绝
  const asPort = (value: unknown) => (value == null || String(value).trim() === '' ? 0 : Number(value));
  const imgPort = asPort(form.imgPort),
    port = asPort(form.port);
  if (!validPort(imgPort)) throw new CodedError('api.badImgPort');
  if (imgPort === UI_PORT) throw new CodedError('api.uiPort', { port: imgPort });
  if (port !== 0 && !validPublicPort(port)) throw new CodedError('api.badPubPort');
  const hostname = cleanHost(form.host);
  return { imgPort, host: hostname, port, proto: hostname && form.proto === 'https' ? 'https' : 'http' };
}
/** 本机端口换绑之后调用：记下公网地址，存设置，清掉旧结果重测 */
export function applyHost(config: HostConfig) {
  Object.assign(publicAddress, { host: config.host, port: config.port, proto: config.proto });
  saveSettings({ imgPort: IMG_PORT, host: publicAddress.host, port: publicAddress.port, proto: publicAddress.proto });
  generation++;
  Object.assign(host, { list: [], manual: null, checkedAt: 0, probes: 0 });
  checkHosts();
}
