import type { Action, Ingredient, Manifest, ManifestStore } from '@contentauth/c2pa-web'

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

export interface ProvenanceSummary {
  heading: string
  detail?: string
  hasFailures: boolean
}

/** Known generator names mapped to a friendlier, human-facing label. */
const GENERATOR_LABELS: Record<string, string> = {
  'adobe after effects (beta)': 'After Effects composition',
  'adobe after effects': 'After Effects composition',
  'adobe premiere pro (beta)': 'Premiere Pro edit',
  'adobe premiere pro': 'Premiere Pro edit',
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
function getActions(manifest: Manifest | undefined): Action[] {
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
      hasFailures: (ingredient.validation_status ?? []).some((s) => s.success === false),
      children,
    }
  })
}

function collectAiSources(nodes: ProvenanceNode[]): string[] {
  const sources: string[] = []
  for (const node of nodes) {
    if (node.aiGenerated) {
      const source = node.signer?.issuer ?? node.softwareAgent?.name ?? node.generator?.name
      if (source) sources.push(source)
    }
    sources.push(...collectAiSources(node.children))
  }
  return sources
}

function mostCommon(items: string[]): string | undefined {
  if (items.length === 0) return undefined
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

/** Turns a resolved node into a short, human-facing heading + detail line. */
export function describeProvenanceNode(node: ProvenanceNode): ProvenanceSummary {
  const mediaWord = node.mediaType && node.mediaType !== 'unknown' ? node.mediaType : 'file'
  const hasFailures = !!node.hasFailures

  if (node.aiGenerated) {
    return {
      heading: `AI-generated ${mediaWord}`,
      detail: node.softwareAgent?.name ?? node.generator?.name ?? node.signer?.issuer,
      hasFailures,
    }
  }

  const generatorName = node.generator?.name ?? node.softwareAgent?.name
  const friendlyGeneratorName = generatorName
    ? (GENERATOR_LABELS[generatorName.toLowerCase()] ?? generatorName)
    : undefined

  const aiSources = collectAiSources(node.children)
  if (aiSources.length > 0) {
    const dominant = mostCommon(aiSources)
    const plural = aiSources.length === 1 ? mediaWord : `${mediaWord}s`
    return {
      heading: friendlyGeneratorName ?? 'Composite file',
      detail: `Contains ${aiSources.length} AI-generated ${plural}${dominant ? ` from ${dominant}` : ''}`,
      hasFailures,
    }
  }

  if (friendlyGeneratorName) {
    return { heading: friendlyGeneratorName, hasFailures }
  }

  return { heading: node.title, hasFailures }
}

/** Skips single-child pass-through hops with no distinguishing info, surfacing the most descriptive node. */
function collapseForSummary(node: ProvenanceNode): ProvenanceNode {
  let current = node
  while (current.children.length === 1 && !current.aiGenerated && !current.aiComposite) {
    current = current.children[0]
  }
  return current
}

/** Produces one summary per top-level ingredient for the flat "Where this file came from" list. */
export function getFlatProvenanceSummaries(tree: ProvenanceNode[]): ProvenanceSummary[] {
  return tree.map((node) => describeProvenanceNode(collapseForSummary(node)))
}
