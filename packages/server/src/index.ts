import type { Server } from 'node:http'
import { loadConfig } from './config'
import { createGateway, type Gateway } from './main'

const config = loadConfig()
const gateway = await createGateway(config)

function listen(app: Gateway['edge'], port: number, label: string): Promise<Server> {
  return new Promise((resolve) => {
    const server = app.listen(port, config.host, () => {
      console.log(`[skewforge] ${label} listening on http://${config.host}:${port}`)
      resolve(server)
    })
  })
}

const servers = [await listen(gateway.edge, config.port, 'edge (your app)'), await listen(gateway.admin, config.adminPort, 'admin API + dashboard')]
console.log(`[skewforge] current deployment: ${gateway.service.current() ?? 'none yet'} · data in ${config.dataDir}`)

let gcTimer: NodeJS.Timeout | undefined
if (config.gcIntervalMs > 0) {
  gcTimer = setInterval(() => {
    gateway.service
      .gc(false)
      .then((result) => {
        if (result.removedDeployments.length || result.removedBlobs) {
          console.log(`[skewforge] gc removed ${result.removedDeployments.length} deployment(s), ${result.removedBlobs} blob(s), ${result.freedBytes} bytes`)
        }
      })
      .catch((error: unknown) => console.error('[skewforge] gc failed', error))
  }, config.gcIntervalMs)
  gcTimer.unref()
}

function shutdown(signal: string) {
  console.log(`[skewforge] ${signal}, shutting down`)
  clearInterval(gcTimer)
  gateway.close()
  for (const server of servers) {
    server.close()
    server.closeIdleConnections()
  }
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
