import { execFileSync } from 'node:child_process'

export default function globalSetup() {
  for (const app of ['react-app', 'vue-app']) {
    for (const release of ['1', '2']) {
      execFileSync('bash', ['scripts/build-release.sh', app, release], { stdio: 'inherit' })
    }
  }
}
