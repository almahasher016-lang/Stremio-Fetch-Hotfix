import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';
import { httpError } from './httpError.js';

const MAX_REMOTE_URL_LENGTH = 8_192;
const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home', '.lan'];
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'instance-data', 'metadata.google.internal']);
const blockedIpv4Addresses = new BlockList();
const blockedIpv6Addresses = new BlockList();

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['192.88.99.0', 24],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]) {
  blockedIpv4Addresses.addSubnet(network, prefix, 'ipv4');
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
]) {
  blockedIpv6Addresses.addSubnet(network, prefix, 'ipv6');
}

function normalizedHostname(hostname) {
  return String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

export function isBlockedRemoteAddress(address) {
  const value = normalizedHostname(address);
  const family = isIP(value);
  if (family === 4) return blockedIpv4Addresses.check(value, 'ipv4');
  if (family === 6) return blockedIpv6Addresses.check(value, 'ipv6');
  return true;
}

export function parsePublicRemoteUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > MAX_REMOTE_URL_LENGTH) throw httpError(400, 'Invalid subtitle URL');

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw httpError(400, 'Invalid subtitle URL');
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) throw httpError(400, 'Unsupported subtitle URL protocol');
  if (parsed.username || parsed.password) throw httpError(400, 'Subtitle URL credentials are not allowed');

  const hostname = normalizedHostname(parsed.hostname);
  if (
    !hostname
    || BLOCKED_HOSTS.has(hostname)
    || BLOCKED_HOST_SUFFIXES.some(suffix => hostname.endsWith(suffix))
  ) {
    throw httpError(400, 'Private subtitle URL is not allowed');
  }
  if (isIP(hostname) && isBlockedRemoteAddress(hostname)) throw httpError(400, 'Private subtitle URL is not allowed');
  parsed.hash = '';
  return parsed;
}

function normalizeLookupRecords(result) {
  const records = Array.isArray(result) ? result : [result];
  const output = [];
  const seen = new Set();
  for (const record of records) {
    const address = normalizedHostname(typeof record === 'string' ? record : record?.address);
    const family = Number(typeof record === 'object' ? record?.family : isIP(address)) || isIP(address);
    if (!address || ![4, 6].includes(family) || isIP(address) !== family) {
      throw httpError(502, 'Subtitle host returned an invalid DNS address');
    }
    const key = `${family}:${address}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push({ address, family });
    }
  }
  return output;
}

export async function resolvePublicRemoteUrl(value, { lookup = dnsLookup } = {}) {
  const parsed = parsePublicRemoteUrl(value);
  const hostname = normalizedHostname(parsed.hostname);
  const family = isIP(hostname);
  let records;
  try {
    records = family
      ? [{ address: hostname, family }]
      : normalizeLookupRecords(await lookup(hostname, { all: true, verbatim: true }));
  } catch (error) {
    if (error?.status) throw error;
    throw httpError(502, 'Subtitle host could not be resolved');
  }

  if (!records.length) throw httpError(502, 'Subtitle host did not resolve');
  if (records.some(record => isBlockedRemoteAddress(record.address))) {
    throw httpError(400, 'Subtitle host resolves to a private or reserved address');
  }
  return { url: parsed.toString(), records };
}

export function createPinnedLookup(records) {
  const vetted = normalizeLookupRecords(records);
  return (_hostname, options, callback) => {
    const requestedFamily = Number(options?.family) || 0;
    const matching = requestedFamily ? vetted.filter(record => record.family === requestedFamily) : vetted;
    const selected = matching.length ? matching : vetted;
    if (options?.all) {
      callback(null, selected.map(record => ({ ...record })));
      return;
    }
    const first = selected[0];
    callback(null, first.address, first.family);
  };
}

export async function createSafeRemoteDispatcher(value, options = {}) {
  const resolved = await resolvePublicRemoteUrl(value, options);
  const dispatcher = new Agent({
    connect: {
      lookup: createPinnedLookup(resolved.records),
      autoSelectFamily: true,
      autoSelectFamilyAttemptTimeout: 250,
    },
  });
  return { ...resolved, dispatcher };
}
