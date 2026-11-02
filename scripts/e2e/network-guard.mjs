import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import net, { isIP } from 'node:net'
import tls from 'node:tls'
import { syncBuiltinESMExports } from 'node:module'

if (process.env.E2E_QUALIFICATION !== '1') {
  throw new Error('The qualification network guard is only valid in an explicit E2E qualification process.')
}

function isLoopbackHost(rawHost) {
  const host = String(rawHost ?? '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  return host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'))
}

function blocked() {
  const error = new Error('E2E_EGRESS_BLOCKED: only loopback network destinations are allowed.')
  error.code = 'E2E_EGRESS_BLOCKED'
  return error
}

function assertHost(host) {
  if (!isLoopbackHost(host)) throw blocked()
}

function assertUrl(value) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw blocked()
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw blocked()
  assertHost(url.hostname)
}

const originalFetch = globalThis.fetch.bind(globalThis)
const resendKey = 'qualification-only'
const sinkBase = new URL(process.env.E2E_EMAIL_SINK_URL ?? '')
if (
  process.env.E2E_QUALIFICATION !== '1'
  || sinkBase.protocol !== 'http:'
  || !isLoopbackHost(sinkBase.hostname)
  || !sinkBase.port
  || Number(sinkBase.port) === 0
  || sinkBase.pathname !== '/v1'
  || sinkBase.search
  || sinkBase.hash
  || process.env.RESEND_API_KEY !== resendKey
) {
  throw new Error('The qualification network guard requires its explicit local-only sink configuration.')
}

globalThis.fetch = function guardedFetch(input, init) {
  const target = typeof input === 'string' || input instanceof URL ? new URL(input) : new URL(input?.url)
  if (target.hostname === 'api.resend.com') {
    if (target.protocol !== 'https:' || target.port || target.username || target.password || target.pathname !== '/emails' || target.search || target.hash) throw blocked()
    const source = input instanceof Request ? new Request(input, init) : new Request(target, init)
    if (source.method.toUpperCase() !== 'POST') throw blocked()
    const sinkUrl = new URL(`${sinkBase.toString().replace(/\/$/, '')}/emails`)
    const request = new Request(sinkUrl, source)
    request.headers.delete('authorization')
    return originalFetch(request, { redirect: 'error' })
  }
  assertUrl(target)
  return originalFetch(input, { ...init, redirect: 'error' })
}

function requestHosts(args) {
  const hosts = []
  for (const value of args.slice(0, 2)) {
    if (value instanceof URL) hosts.push(value.hostname)
    else if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
      try {
        hosts.push(new URL(value).hostname)
      } catch {
        throw blocked()
      }
    } else if (value && typeof value === 'object') {
      if (value.hostname) hosts.push(value.hostname)
      if (value.host) hosts.push(value.host)
    }
  }
  return hosts.length ? hosts : ['localhost']
}

for (const transport of [http, https]) {
  const originalRequest = transport.request
  transport.request = function guardedRequest(...args) {
    for (const host of requestHosts(args)) assertHost(host)
    return originalRequest.apply(this, args)
  }
  const originalGet = transport.get
  transport.get = function guardedGet(...args) {
    for (const host of requestHosts(args)) assertHost(host)
    return originalGet.apply(this, args)
  }
}

const originalSocketConnect = net.Socket.prototype.connect
net.Socket.prototype.connect = function guardedSocketConnect(...args) {
  const normalized = Array.isArray(args[0]) ? args[0] : args
  const first = normalized[0]
  if (first && typeof first === 'object') {
    if (!first.path) assertHost(first.host ?? first.hostname ?? 'localhost')
  } else if (typeof first === 'number') {
    assertHost(typeof normalized[1] === 'string' ? normalized[1] : 'localhost')
  } else if (typeof first === 'string' && !first.startsWith('/')) {
    assertHost(first)
  }
  return originalSocketConnect.apply(this, args)
}

const originalTlsConnect = tls.connect
tls.connect = function guardedTlsConnect(...args) {
  const options = args[0]
  if (options && typeof options === 'object' && !options.socket) {
    assertHost(options.host ?? options.hostname ?? options.servername ?? 'localhost')
  } else if (options && typeof options === 'object' && options.servername) {
    assertHost(options.servername)
  }
  return originalTlsConnect.apply(this, args)
}

const originalLookup = dns.lookup
dns.lookup = function guardedLookup(hostname, ...args) {
  try {
    assertHost(hostname)
  } catch (error) {
    const callback = [...args].reverse().find((arg) => typeof arg === 'function')
    if (callback) {
      queueMicrotask(() => callback(error))
      return undefined
    }
    throw error
  }
  return originalLookup.call(this, hostname, ...args)
}

const originalPromiseLookup = dns.promises.lookup.bind(dns.promises)
dns.promises.lookup = async function guardedPromiseLookup(hostname, options) {
  assertHost(hostname)
  return originalPromiseLookup(hostname, options)
}
const DNS_QUERY_METHODS = ['resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse']

function rejectDnsQuery(args) {
  const callback = [...args].reverse().find((arg) => typeof arg === 'function')
  const error = blocked()
  if (callback) {
    queueMicrotask(() => callback(error))
    return undefined
  }
  throw error
}

for (const name of DNS_QUERY_METHODS) {
  if (typeof dns[name] === 'function') {
    dns[name] = function guardedDnsQuery(...args) {
      return rejectDnsQuery(args)
    }
  }
  if (typeof dns.promises[name] === 'function') {
    dns.promises[name] = async function guardedPromiseDnsQuery() {
      throw blocked()
    }
  }
  if (typeof dns.Resolver?.prototype?.[name] === 'function') {
    dns.Resolver.prototype[name] = function guardedResolverQuery(...args) {
      return rejectDnsQuery(args)
    }
  }
  if (typeof dns.promises.Resolver?.prototype?.[name] === 'function') {
    dns.promises.Resolver.prototype[name] = async function guardedPromiseResolverQuery() {
      throw blocked()
    }
  }
}


dns.setServers = function blockedSetServers() {
  throw blocked()
}
if (dns.Resolver?.prototype) {
  dns.Resolver.prototype.setServers = function blockedResolverSetServers() {
    throw blocked()
  }
}

if (dns.promises.Resolver?.prototype) {
  dns.promises.Resolver.prototype.setServers = function blockedPromiseResolverSetServers() {
    throw blocked()
  }
}

syncBuiltinESMExports()
