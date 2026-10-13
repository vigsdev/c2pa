import type { Manifest, ManifestStore, ValidationStatus } from '@contentauth/c2pa-web'
import { buildProvenanceTree, type ProvenanceNode } from './provenance'

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
    provenanceTree: buildProvenanceTree(manifest.ingredients, store),
    successes: store.validation_results?.activeManifest?.success ?? [],
    failures: store.validation_results?.activeManifest?.failure ?? [],
  }
}

/** Whether every failure is only about an unrecognized/untrusted signer, not structural tampering. */
export function isTrustOnlyIssue(failures: ValidationStatus[]): boolean {
  if (failures.length === 0) return false
  return failures.every((f) => f.code.toLowerCase().includes('trust'))
}

/** Failures that are about something other than an unverified signer — i.e. worth flagging plainly. */
export function nonTrustFailures(failures: ValidationStatus[]): ValidationStatus[] {
  return failures.filter((f) => !f.code.toLowerCase().includes('trust'))
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
  return date.toLocaleString()
}

