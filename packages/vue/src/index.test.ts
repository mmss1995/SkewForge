import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { SkewClient } from '@skewforge/client'
import { createSkewForge, installSkewRouterGuard, useSkew } from './index'

class FakeEventSource extends EventTarget {
  static last: FakeEventSource | null = null
  readyState = 0
  constructor(readonly url: string) {
    super()
    FakeEventSource.last = this
  }
  push(data: object) {
    this.dispatchEvent(Object.assign(new Event('version'), { data: JSON.stringify(data) }))
  }
  close() {}
}

const update = { current: 'v2', running: 'v1', updateAvailable: true, mandatory: false, reason: 'update' }

function makeClient(navigate = vi.fn<(href: string) => void>()) {
  return new SkewClient({
    deploymentId: 'v1',
    EventSource: FakeEventSource as unknown as typeof EventSource,
    beaconIntervalMs: false,
    reload: vi.fn(),
    navigate,
  })
}

describe('Vue bindings', () => {
  it('exposes reactive state through useSkew()', async () => {
    const Status = defineComponent({
      setup() {
        const { state } = useSkew()
        return () => h('p', state.value.updateAvailable ? `update to ${state.value.current}` : 'up to date')
      },
    })
    const plugin = createSkewForge(makeClient())
    const wrapper = mount(Status, { global: { plugins: [plugin] } })
    expect(wrapper.text()).toBe('up to date')
    FakeEventSource.last!.push(update)
    await nextTick()
    expect(wrapper.text()).toBe('update to v2')
    wrapper.unmount()
  })

  it('turns router navigations into full page loads once an update is waiting', async () => {
    const navigate = vi.fn<(href: string) => void>()
    const client = makeClient(navigate).start()
    const Empty = defineComponent({ render: () => null })
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: Empty },
        { path: '/cart', component: Empty },
        { path: '/checkout', component: Empty },
      ],
    })
    installSkewRouterGuard(router, client)
    await router.push('/')
    await router.push('/cart')
    expect(router.currentRoute.value.fullPath).toBe('/cart')
    expect(navigate).not.toHaveBeenCalled()

    FakeEventSource.last!.push(update)
    await router.push('/checkout')
    expect(router.currentRoute.value.fullPath).toBe('/cart')
    expect(navigate).toHaveBeenCalledWith('/checkout')
    client.destroy()
  })

  it('explains a missing plugin', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const Broken = defineComponent({ setup: () => (useSkew(), () => null) })
    expect(() => mount(Broken)).toThrow(/createSkewForge/)
  })
})
