import type { Manifest, ManifestStore, ValidationStatus } from '@contentauth/c2pa-web'
import { buildProvenanceTree, getActions, SIGNER_ONLY, type ProvenanceNode } from './provenance'

export interface ManifestSummary {
  label: string
  title: string | null
  format: string | null
  generator: string | null
  issuer: string | null
  signedAt: string | null
  thumbnail: { format: string; identifier: string } | null
  provenanceTree: ProvenanceNode[]
  successes: ValidationStatus[]
  failures: ValidationStatus[]
  /** How many of the files used to make this one have credentials that can't be validated. */
  brokenIngredients: number
  made: HowMade
}

/** What the credentials say about how the file was made, in the order Adobe's own checker shows it. */
export interface HowMade {
  madeWith: string | null
  /** Every app or service that signed a part of the file. */
  tools: string[]
  /** AI models named in the actions, like "gpt-image". */
  models: string[]
  /** "made": the file itself is AI-generated. "includes": it has AI-generated parts. */
  ai: 'made' | 'includes' | null
}

// Libraries that sign for someone else: the signer's name says more than these.
const SDKS = ['c2pa-rs', 'c2pa-js', 'c2pa-node', 'c2pa-python', 'c2patool']

const cleanName = (name: string) => name.replace(/\s*\(beta\)$/i, '').trim()

function toolOf(node: ProvenanceNode): string | undefined {
  const generator = node.generator?.name
  if (generator && !SDKS.some((sdk) => generator.toLowerCase().startsWith(sdk))) return cleanName(generator)
  return node.signer?.issuer ?? (generator ? cleanName(generator) : undefined)
}

function walk(nodes: ProvenanceNode[], visit: (node: ProvenanceNode) => void) {
  for (const node of nodes) {
    visit(node)
    walk(node.children, visit)
  }
}

function howMade(manifest: Manifest, tree: ProvenanceNode[], generator: string | null): HowMade {
  const tools = new Set<string>()
  const models = new Set<string>()
  let aiInside = false
  walk(tree, (node) => {
    const tool = toolOf(node)
    if (tool) tools.add(tool)
    if (node.aiGenerated || node.aiComposite) {
      aiInside = true
      if (node.softwareAgent?.name) models.add(node.softwareAgent.name)
    }
  })

  const sourceTypes = getActions(manifest).map((a) => a.digitalSourceType ?? '')
  for (const action of getActions(manifest)) {
    const agent = action.softwareAgent
    const name = typeof agent === 'string' ? agent : agent?.name
    if (name && action.digitalSourceType?.endsWith('TrainedAlgorithmicMedia')) models.add(name)
  }
  const ai = sourceTypes.some((t) => t.endsWith('/trainedAlgorithmicMedia'))
    ? 'made'
    : sourceTypes.some((t) => t.endsWith('/compositeWithTrainedAlgorithmicMedia')) || aiInside
      ? 'includes'
      : null

  return { madeWith: generator ? cleanName(generator) : null, tools: [...tools], models: [...models], ai }
}

/** "Video (MP4)" from "video/mp4". */
export function formatLabel(mime: string | null): string | null {
  if (!mime) return null
  const [type, sub] = mime.split('/')
  if (!sub) return mime
  const kind = type === 'application' ? (sub === 'pdf' ? 'Document' : 'File') : type[0].toUpperCase() + type.slice(1)
  const ext = sub.replace(/^x-/, '').replace('quicktime', 'mov').replace('mpeg', 'mp3').toUpperCase()
  return `${kind} (${ext})`
}

/** Reduces a raw manifest into the fields the UI needs to render. */
export function summarizeManifest(
  store: ManifestStore,
  manifest: Manifest,
  label: string,
  fallbackFormat: string | null,
): ManifestSummary {
  const generator =
    manifest.claim_generator_info?.[0]?.name ??
    manifest.claim_generator ??
    null

  const tree = buildProvenanceTree(manifest.ingredients, store)

  return {
    label,
    title: manifest.title ?? null,
    format: manifest.format ?? fallbackFormat,
    generator,
    issuer: manifest.signature_info?.issuer ?? null,
    signedAt: manifest.signature_info?.time ?? null,
    thumbnail: manifest.thumbnail
      ? { format: manifest.thumbnail.format, identifier: manifest.thumbnail.identifier }
      : null,
    provenanceTree: tree,
    successes: store.validation_results?.activeManifest?.success ?? [],
    failures: store.validation_results?.activeManifest?.failure ?? [],
    brokenIngredients: (store.validation_results?.ingredientDeltas ?? []).filter(
      (delta) => realFailures(delta.validationDeltas?.failure ?? []).length > 0,
    ).length,
    made: howMade(manifest, tree, generator),
  }
}

/** Failures that are about the file or its credentials, not about the signer's certificate. */
export function realFailures(failures: ValidationStatus[]): ValidationStatus[] {
  return failures.filter((f) => !SIGNER_ONLY.has(f.code))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i += 1
  }
  return `${value.toFixed(1)} ${units[i]}`
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

