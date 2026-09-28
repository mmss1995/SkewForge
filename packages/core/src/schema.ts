import { z } from 'zod'
import { normalizeAssetPath } from './paths'

/** Same shape Next.js and most CI systems use: a git SHA, a tag, a build number. */
export const deploymentIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, 'deployment ids are 1-64 chars of [A-Za-z0-9._-] and start alphanumeric')

export const blobHashSchema = z.string().regex(/^[a-f0-9]{64}$/, 'expected a lower-case sha256 hex digest')

export const fileEntrySchema = z.object({
  hash: blobHashSchema,
  size: z.number().int().nonnegative(),
  type: z.string().min(1).max(200),
  /** Content-hashed file names never change meaning, so they are served with `immutable`. */
  immutable: z.boolean(),
})

const manifestPathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine((path) => normalizeAssetPath(path) === path, 'paths must be normalized (no leading slash, no ..)')

export const deploymentMetaSchema = z
  .object({
    commit: z.string().max(100).optional(),
    branch: z.string().max(200).optional(),
    message: z.string().max(500).optional(),
    author: z.string().max(200).optional(),
  })
  .strict()

export const deploymentInputSchema = z
  .object({
    id: deploymentIdSchema,
    /**
     * The HTML document served for page routes. Null makes an asset-only deployment, used when
     * another server renders the HTML and SkewForge only keeps old static files alive (Next.js).
     */
    entry: manifestPathSchema.nullable().default('index.html'),
    files: z.record(manifestPathSchema, fileEntrySchema).refine((files) => Object.keys(files).length > 0, 'a deployment needs at least one file'),
    meta: deploymentMetaSchema.default({}),
    /** Clients on older deployments must reload instead of being nudged. */
    mandatory: z.boolean().default(false),
    promote: z.boolean().default(false),
  })
  .refine((input) => input.entry === null || input.entry in input.files, {
    message: 'entry must be one of the uploaded files',
    path: ['entry'],
  })

export type FileEntry = z.infer<typeof fileEntrySchema>
export type DeploymentMeta = z.infer<typeof deploymentMetaSchema>
export type DeploymentInput = z.input<typeof deploymentInputSchema>
export type ParsedDeploymentInput = z.output<typeof deploymentInputSchema>

export const promoteInputSchema = z
  .object({
    mandatory: z.boolean().optional(),
  })
  .strict()

export const rollbackInputSchema = z
  .object({
    /** Target deployment; defaults to the one that was current before the current one. */
    to: deploymentIdSchema.optional(),
    /** Force clients running the rolled-back deployment to reload. On by default: it was bad. */
    revoke: z.boolean().default(true),
  })
  .strict()

export const beaconSchema = z
  .object({
    session: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    deployment: deploymentIdSchema,
  })
  .strict()
