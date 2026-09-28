import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { emptyRegistry, type Registry } from '@skewforge/core'

export interface RegistryPersistence {
  load(): Promise<Registry>
  save(registry: Registry): Promise<void>
}

/** The registry as one JSON file, replaced atomically (write to a temp file, then rename). */
export class RegistryFile implements RegistryPersistence {
  constructor(private readonly file: string) {}

  async load(): Promise<Registry> {
    try {
      return { ...emptyRegistry(), ...(JSON.parse(await readFile(this.file, 'utf8')) as Registry) }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyRegistry()
      throw error
    }
  }

  async save(registry: Registry): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = join(dirname(this.file), `.registry.${process.pid}.tmp`)
    await writeFile(tmp, JSON.stringify(registry))
    await rename(tmp, this.file)
  }
}

export class MemoryRegistry implements RegistryPersistence {
  private snapshot = JSON.stringify(emptyRegistry())

  async load(): Promise<Registry> {
    return JSON.parse(this.snapshot) as Registry
  }

  async save(registry: Registry): Promise<void> {
    this.snapshot = JSON.stringify(registry)
  }
}
