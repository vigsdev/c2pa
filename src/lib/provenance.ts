import type { Action, Ingredient, Manifest, ManifestStore } from '@contentauth/c2pa-web'

/**
 * Signer reports that say nothing about the file itself: "untrusted" because this page doesn't load a trust list,
 * "expired" because a certificate can expire after it signed. Adobe's own checker doesn't flag either.
 */
export const SIGNER_ONLY = new Set(['signingCredential.untrusted', 'signingCredential.expired'])

export type MediaType = 'image' | 'video' | 'audio' | 'document' | 'unknown'

export interface ProvenanceNode {
  id: string
  title: string
  format?: string
  mediaType?: MediaType

  relationship?: string

  generator?: { name?: string; version?: string }
  softwareAgent?: { name?: string; version?: string }
  signer?: { issuer?: string; commonName?: string }

  action?: string
  createdAt?: string

  digitalSourceType?: string
  aiGenerated?: boolean
  aiComposite?: boolean

  instanceId?: string
  manifestId?: string
  hasFailures?: boolean

  children: ProvenanceNode[]
}

/** Tool names that indicate AI generation even without an explicit digitalSourceType. */
const KNOWN_AI_TOOLS = [
  'elevenlabs',
  'openai',
  'gpt-image',
  'dall-e',
  'dalle',
  'midjourney',
  'stable diffusion',
  'runway',
  'firefly',
]

function looksLikeAiTool(name: string | undefined): boolean {
  if (!name) return false
  const lower = name.toLowerCase()
  return KNOWN_AI_TOOLS.some((tool) => lower.includes(tool))
}

function classifyDigitalSourceType(type: string | null | undefined) {
  if (!type) return { aiGenerated: false, aiComposite: false }
  return {
    aiGenerated: type.endsWith('/trainedAlgorithmicMedia'),
    aiComposite: type.endsWith('/compositeWithTrainedAlgorithmicMedia'),
  }
}

function mediaTypeFromFormat(format: string | null | undefined): MediaType {
  if (!format) return 'unknown'
  if (format === 'application/pdf') return 'document'
  const [type] = format.split('/')
  if (type === 'image' || type === 'video' || type === 'audio') return type
  return 'unknown'
}

function parseSoftwareAgent(
  agent: Action['softwareAgent'],
): { name?: string; version?: string } | undefined {
  if (!agent) return undefined
  if (typeof agent === 'string') return { name: agent }
  return { name: agent.name, version: agent.version ?? undefined }
}

/** Finds the actions list from a manifest's c2pa.actions.v2 (preferred) or c2pa.actions assertion. */
export function getActions(manifest: Manifest | undefined): Action[] {
  const assertion =
    manifest?.assertions?.find((a) => a.label === 'c2pa.actions.v2') ??
    manifest?.assertions?.find((a) => a.label === 'c2pa.actions')
  const data = assertion?.data as { actions?: Action[] } | undefined
  return Array.isArray(data?.actions) ? data.actions : []
}

/** Prefers the action carrying the most useful provenance info (source type or software agent). */
function pickPrimaryAction(actions: Action[]): Action | undefined {
  return actions.find((a) => a.digitalSourceType || a.softwareAgent) ?? actions[0]
}

function deriveTitle(opts: {
  manifestTitle?: string | null
  softwareAgentName?: string
  generatorName?: string
  mediaType?: MediaType
}): string {
  if (opts.manifestTitle) return opts.manifestTitle
  if (opts.softwareAgentName) return opts.softwareAgentName
  if (opts.generatorName) return opts.generatorName
  const mediaLabels: Partial<Record<MediaType, string>> = {
    image: 'Image file',
    video: 'Video file',
    audio: 'Audio file',
    document: 'Document',
  }
  if (opts.mediaType && mediaLabels[opts.mediaType]) return mediaLabels[opts.mediaType]!
  return 'Source file'
}

/**
 * Recursively resolves an ingredient list into a provenance tree, following each ingredient's
 * `active_manifest` into `manifestStore.manifests`. Safe against missing manifests and cycles.
 */
export function buildProvenanceTree(
  ingredients: Ingredient[] | undefined,
  manifestStore: ManifestStore,
  visitedManifestIds: Set<string> = new Set(),
  path = 'root',
): ProvenanceNode[] {
  if (!ingredients) return []

  return ingredients.map((ingredient, index) => {
    const nodePath = `${path}.${index}`
    const manifestId = ingredient.active_manifest ?? undefined
    const resolvedManifest =
      manifestId && !visitedManifestIds.has(manifestId)
        ? manifestStore.manifests?.[manifestId]
        : undefined

    const actions = getActions(resolvedManifest)
    const primaryAction = pickPrimaryAction(actions)
    const softwareAgent = parseSoftwareAgent(primaryAction?.softwareAgent)
    const generatorInfo = resolvedManifest?.claim_generator_info?.[0]
    const generator = generatorInfo
      ? { name: generatorInfo.name, version: generatorInfo.version ?? undefined }
      : undefined
    const digitalSourceType = primaryAction?.digitalSourceType ?? undefined
    const sourceTypeFlags = classifyDigitalSourceType(digitalSourceType)
    const aiGenerated =
      sourceTypeFlags.aiGenerated || looksLikeAiTool(softwareAgent?.name) || looksLikeAiTool(generator?.name)
    const mediaType = mediaTypeFromFormat(ingredient.format ?? resolvedManifest?.format)

    let children: ProvenanceNode[] = []
    if (resolvedManifest && manifestId) {
      const nextVisited = new Set(visitedManifestIds)
      nextVisited.add(manifestId)
      children = buildProvenanceTree(resolvedManifest.ingredients, manifestStore, nextVisited, nodePath)
    }

    const idBase = manifestId ?? ingredient.instance_id ?? undefined

    return {
      id: idBase ? `${nodePath}:${idBase}` : nodePath,
      title: deriveTitle({
        manifestTitle: resolvedManifest?.title,
        softwareAgentName: softwareAgent?.name,
        generatorName: generator?.name,
        mediaType,
      }),
      format: ingredient.format ?? resolvedManifest?.format ?? undefined,
      mediaType,
      relationship: ingredient.relationship ?? undefined,
      generator,
      softwareAgent,
      signer: resolvedManifest?.signature_info
        ? {
            issuer: resolvedManifest.signature_info.issuer ?? undefined,
            commonName: resolvedManifest.signature_info.common_name ?? undefined,
          }
        : undefined,
      action: primaryAction?.action ?? undefined,
      createdAt: primaryAction?.when ?? undefined,
      digitalSourceType,
      aiGenerated,
      aiComposite: sourceTypeFlags.aiComposite,
      instanceId: ingredient.instance_id ?? undefined,
      manifestId,
      hasFailures: (ingredient.validation_status ?? []).some(
        (s) => s.success === false && !SIGNER_ONLY.has(s.code),
      ),
      children,
    }
  })
}
