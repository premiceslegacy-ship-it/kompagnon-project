import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('blocks normalized outbound sockets and promise DNS resolvers before they reach native transports', () => {
  const guardUrl = new URL('../../scripts/e2e/network-guard.mjs', import.meta.url).href
  const source = `
    import net from 'node:net'
    import dns from 'node:dns'

    // Sentinels prevent real network traffic even when the guard regresses.
    net.Socket.prototype.connect = function () {
      throw Object.assign(new Error('Native transport reached'), { code: 'UNGUARDED_SOCKET' })
    }
    dns.promises.Resolver.prototype.resolveTxt = async function () {
      throw Object.assign(new Error('Native resolver reached'), { code: 'UNGUARDED_DNS' })
    }

    await import(${JSON.stringify(guardUrl)})
    const result = { socket: 'NOT_BLOCKED', dns: 'NOT_BLOCKED' }
    try { net.createConnection({ host: '192.0.2.1', port: 443 }) }
    catch (error) { result.socket = error.code }
    try { await new dns.promises.Resolver().resolveTxt('qualification.invalid') }
    catch (error) { result.dns = error.code }
    console.log(JSON.stringify(result))
  `
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      NODE_ENV: 'test',
      E2E_QUALIFICATION: '1',
      E2E_EMAIL_SINK_URL: 'http://127.0.0.1:43127/v1',
      RESEND_API_KEY: 'qualification-only',
    },
  })
  if (result.status !== 0) throw new Error(`Network guard child failed: ${result.stderr}`)
  expect(JSON.parse(result.stdout)).toEqual({
    socket: 'E2E_EGRESS_BLOCKED',
    dns: 'E2E_EGRESS_BLOCKED',
  })
})
