import { useCallback, useEffect, useRef, useState } from "react"
import { AssetTooLargeError, Reader } from "@contentauth/c2pa-web"
import { CopyIcon, ShieldCheckIcon, TriangleAlertIcon, UploadIcon } from "lucide-react"
import { OverscrollMessages } from "@/components/overscroll-messages"
import { SiteFooter } from "@/components/site-footer"
import { cn } from "@/lib/utils"
import { getC2pa } from "./lib/c2pa"
import {
  formatBytes,
  formatDate,
  formatLabel,
  realFailures,
  summarizeManifest,
  type ManifestSummary,
} from "./lib/manifest"
import type { ProvenanceNode } from "./lib/provenance"

type Status = "engine-loading" | "ready" | "checking" | "done" | "error"

interface CheckResult {
  fileName: string
  fileSize: number
  fileType: string
  fileUrl: string
  hasManifest: boolean
  summary: ManifestSummary | null
  thumbnailUrl: string | null
  rawJson: string
}

interface CheckFailure {
  fileName: string
  fileSize: number
  tooLarge: boolean
}

const SITE_URL = "https://vigs.dev"
const STORY_URL = "https://labs.vigs.dev/provenance"
const C2PA_URL = "https://c2pa.org/"
const SOURCE_URL = "https://github.com/contentauth/c2pa-js"

const sectionHeading =
  "text-[17px] leading-[22px] font-medium tracking-[-0.02em] text-foreground"

const label = "text-[13px] leading-[18px] font-normal text-muted-foreground"

const pill =
  "inline-flex rounded-full border border-border px-3 py-1.5 text-[13px] leading-4 text-foreground transition-colors hover:bg-card"

const card = "rounded-[24px] border border-border bg-card p-5"

const body = "text-[15px] leading-6 text-muted-foreground"

const badgeBase =
  "inline-flex self-start rounded-full border px-3 py-1.5 text-[13px] leading-4"

const badgeStyles = {
  good: "border-transparent bg-foreground text-background",
  none: "border-border text-muted-foreground",
  warning: "border-destructive/40 bg-destructive/10 text-destructive",
}

const thumbnail =
  "size-[120px] shrink-0 rounded-xl border border-border bg-muted object-cover"

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-medium text-foreground">{children}</strong>
}

function SectionMarker({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-medium text-muted-foreground tabular-nums">
      {children}
    </p>
  )
}

/** Renders a native browser preview for the checked file, falling back to the manifest's own thumbnail when present. */
function FilePreview({
  thumbnailUrl,
  fileUrl,
  fileType,
}: {
  thumbnailUrl: string | null
  fileUrl: string
  fileType: string
}) {
  if (thumbnailUrl) {
    return <img src={thumbnailUrl} alt="Preview of the checked file" className={thumbnail} />
  }
  if (fileType.startsWith("image/")) {
    return <img src={fileUrl} alt="Preview of the checked file" className={thumbnail} />
  }
  if (fileType.startsWith("video/")) {
    return <video src={fileUrl} className={thumbnail} muted playsInline preload="metadata" />
  }
  if (fileType === "application/pdf") {
    return <embed src={fileUrl} type="application/pdf" className={thumbnail} />
  }
  if (fileType.startsWith("audio/")) {
    return (
      <div
        className={cn(thumbnail, "flex items-center justify-center text-2xl text-muted-foreground")}
        aria-hidden="true"
      >
        ♪
      </div>
    )
  }
  return (
    <div
      className={cn(thumbnail, "flex items-center justify-center text-xs text-muted-foreground")}
      aria-hidden="true"
    >
      No preview
    </div>
  )
}

/** Renders an actual playable/viewable control for media types where a static thumbnail isn't enough. */
function MediaPlayer({ fileUrl, fileType }: { fileUrl: string; fileType: string }) {
  if (fileType.startsWith("audio/")) {
    return <audio className="w-full" controls src={fileUrl} />
  }
  if (fileType.startsWith("video/")) {
    return (
      <video
        className="max-h-[360px] w-full rounded-xl border border-border bg-black"
        controls
        src={fileUrl}
      />
    )
  }
  if (fileType === "application/pdf") {
    return (
      <embed
        className="h-[480px] w-full rounded-xl border border-border"
        src={fileUrl}
        type="application/pdf"
      />
    )
  }
  return null
}

const warningNote = "text-destructive"

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words text-foreground">{children}</dd>
    </div>
  )
}

function Chips({ items }: { items: string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span key={item} className="rounded-full border border-border px-2.5 py-1 text-xs leading-4">
          {item}
        </span>
      ))}
    </span>
  )
}

function IssueLine({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <TriangleAlertIcon className="mt-px size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span>{children}</span>
    </li>
  )
}

/** Recursively renders the full resolved provenance tree for the "View provenance tree" toggle. */
function ProvenanceTreeView({ nodes, root = true }: { nodes: ProvenanceNode[]; root?: boolean }) {
  if (nodes.length === 0) return null
  return (
    <ul className={cn("flex list-disc flex-col gap-1 pl-5 text-xs leading-4", root && "mt-2")}>
      {nodes.map((node) => (
        <li key={node.id}>
          <span className="text-foreground">{node.title}</span>
          {node.signer?.issuer && (
            <span className="text-muted-foreground"> · {node.signer.issuer}</span>
          )}
          {node.aiGenerated && <span className="text-foreground"> · AI-generated</span>}
          {node.hasFailures && <span className={warningNote}> · can't be validated</span>}
          <ProvenanceTreeView nodes={node.children} root={false} />
        </li>
      ))}
    </ul>
  )
}

function ResultHead({
  name,
  size,
  onReset,
}: {
  name: string
  size: number
  onReset: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-[15px] leading-5 font-medium break-all">{name}</h2>
        <p className="text-xs text-muted-foreground tabular-nums">{formatBytes(size)}</p>
      </div>
      <button type="button" className={cn(pill, "shrink-0 cursor-pointer")} onClick={onReset}>
        Check another file
      </button>
    </div>
  )
}

function App() {
  const [status, setStatus] = useState<Status>("engine-loading")
  const [engineError, setEngineError] = useState<string | null>(null)
  const [result, setResult] = useState<CheckResult | null>(null)
  const [checkError, setCheckError] = useState<CheckFailure | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const thumbnailUrlRef = useRef<string | null>(null)
  const fileUrlRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let cancelled = false
    getC2pa()
      .then(() => {
        if (!cancelled) setStatus("ready")
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEngineError(err instanceof Error ? err.message : String(err))
          setStatus("error")
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    return () => {
      if (thumbnailUrlRef.current) URL.revokeObjectURL(thumbnailUrlRef.current)
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current)
    }
  }, [])

  const copyRawJson = useCallback(async (json: string) => {
    await navigator.clipboard.writeText(json)
    setCopied(true)
  }, [])

  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(id)
  }, [copied])

  const checkFile = useCallback(async (file: File) => {
    setStatus("checking")
    setCheckError(null)
    setResult(null)
    if (thumbnailUrlRef.current) {
      URL.revokeObjectURL(thumbnailUrlRef.current)
      thumbnailUrlRef.current = null
    }
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current)
      fileUrlRef.current = null
    }
    const fileUrl = URL.createObjectURL(file)
    fileUrlRef.current = fileUrl

    let reader: Reader | null = null
    try {
      const c2pa = await getC2pa()
      reader = await Reader.fromBlob(c2pa, file.type, file)

      if (!reader) {
        setResult({
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          fileUrl,
          hasManifest: false,
          summary: null,
          thumbnailUrl: null,
          rawJson: "",
        })
        setStatus("done")
        return
      }

      const store = await reader.manifestStore()
      const activeLabel = await reader.activeLabel()
      const manifest = await reader.activeManifest()
      const summary = summarizeManifest(store, manifest, activeLabel ?? "unknown", file.type || null)

      let thumbnailUrl: string | null = null
      if (summary.thumbnail) {
        const bytes = await reader.resourceToBytes(summary.thumbnail.identifier)
        const blob = new Blob([bytes], { type: summary.thumbnail.format })
        thumbnailUrl = URL.createObjectURL(blob)
        thumbnailUrlRef.current = thumbnailUrl
      }

      setResult({
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        fileUrl,
        hasManifest: true,
        summary,
        thumbnailUrl,
        rawJson: JSON.stringify(store, null, 2),
      })
      setStatus("done")
    } catch (err) {
      setCheckError({
        fileName: file.name,
        fileSize: file.size,
        tooLarge: err instanceof AssetTooLargeError,
      })
      setStatus("done")
    } finally {
      await reader?.free()
    }
  }, [])

  const handleFile = useCallback(
    (fileList: FileList | null) => {
      const file = fileList?.[0]
      if (!file) return
      void checkFile(file)
    },
    [checkFile],
  )

  const handleReset = useCallback(() => {
    setResult(null)
    setCheckError(null)
    setStatus("ready")
    if (thumbnailUrlRef.current) {
      URL.revokeObjectURL(thumbnailUrlRef.current)
      thumbnailUrlRef.current = null
    }
    if (fileUrlRef.current) {
      URL.revokeObjectURL(fileUrlRef.current)
      fileUrlRef.current = null
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ""
      fileInputRef.current.click()
    }
  }, [])

  const isBusy = status === "checking"
  const engineReady = status !== "engine-loading"

  return (
    <>
      <OverscrollMessages />
      <main className="min-h-svh bg-background px-6 py-20 text-foreground">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-16">
          {/* Intro */}
          <header className="flex flex-col gap-3 pt-16">
            <div className="flex items-center gap-3">
              <img
                src="/favicon.svg"
                alt=""
                width={40}
                height={40}
                className="size-10 shrink-0"
              />
              <div className="flex flex-col gap-1">
                <h1 className="text-[26px] leading-8 font-medium tracking-[-0.025em] text-foreground/90">
                  Provenance
                </h1>
                <p className="text-[13px] leading-[18px] text-foreground/70">
                  Web Tool · C2PA · Content Credentials
                </p>
              </div>
            </div>

            <div className={cn(body, "flex flex-col gap-3 pt-2")}>
              <p className="text-foreground">How was this file made?</p>
              <p>
                Check a photo, video, audio file, or PDF for <Strong>Content Credentials</Strong>: a
                signed record of the apps, edits, and AI used to make it.
              </p>
              <p>No uploads. No server. The check happens in your browser.</p>
            </div>
          </header>

          {/* 01 — Check */}
          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <SectionMarker>01</SectionMarker>
              <h2 className={sectionHeading}>Drop a file</h2>
              <p className={label}>Drag it here, or click to choose one.</p>
            </div>

            {status === "error" && engineError ? (
              <div className="rounded-[24px] border border-destructive/30 bg-destructive/10 p-4 text-[13px] leading-[18px] text-destructive">
                Something went wrong starting the checker. Try reloading the page.
              </div>
            ) : (
              <div
                className={cn(
                  "relative flex h-[170px] flex-col items-center justify-center gap-1.5 rounded-[24px] border border-dashed bg-card text-center transition-colors duration-200 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
                  isDragging ? "border-foreground/40" : "border-border hover:border-muted-foreground/40",
                  isBusy && "opacity-70",
                )}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (engineReady && !isBusy) setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  if (engineReady && !isBusy) handleFile(e.dataTransfer.files)
                }}
              >
                <input
                  ref={fileInputRef}
                  id="file-input"
                  type="file"
                  className="absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                  disabled={!engineReady || isBusy}
                  onChange={(e) => handleFile(e.target.files)}
                />
                <UploadIcon className="mb-1 size-5 text-muted-foreground" />
                {!engineReady && <p className="text-[13px] text-muted-foreground">Getting ready…</p>}
                {engineReady && isBusy && (
                  <>
                    <p className="text-[15px] leading-5 font-medium">Checking for Content Credentials…</p>
                    <p className="text-[13px] text-muted-foreground">
                      Looking for provenance, signatures, and other C2PA information.
                    </p>
                  </>
                )}
                {engineReady && !isBusy && (
                  <>
                    <p className="text-[15px] leading-5 font-medium">Choose a file</p>
                    <p className="text-[13px] text-muted-foreground">or drag and drop</p>
                    <p className="mt-2 text-xs text-muted-foreground/70">
                      Photos, videos, audio, and PDFs.
                    </p>
                  </>
                )}
              </div>
            )}

            {checkError && (
              <div className={cn(card, "flex flex-col gap-4")}>
                <ResultHead name={checkError.fileName} size={checkError.fileSize} onReset={handleReset} />
                <div className={cn(badgeBase, badgeStyles.warning)}>
                  {checkError.tooLarge ? "This file is too large to check" : "We couldn't check this file"}
                </div>
                <p className={body}>
                  {checkError.tooLarge ? (
                    <>
                      Files over 1 GB can't be checked in the browser. This one is{" "}
                      {formatBytes(checkError.fileSize)}. Try a smaller or compressed version of the
                      file.
                    </>
                  ) : (
                    <>
                      Something stopped us from reading this file or its Content Credentials. Try the
                      original file if you have it, or check another one.
                    </>
                  )}
                </p>
              </div>
            )}

            {result && (
              <div className={cn(card, "flex flex-col gap-4")}>
                <ResultHead name={result.fileName} size={result.fileSize} onReset={handleReset} />

                {!result.hasManifest ? (
                  <>
                    <div className={cn(badgeBase, badgeStyles.none)}>No Content Credentials</div>
                    <div className="flex flex-col gap-4 sm:flex-row">
                      <FilePreview thumbnailUrl={null} fileUrl={result.fileUrl} fileType={result.fileType} />
                      <div className={cn(body, "flex flex-col gap-3")}>
                        <p>This file doesn't carry Content Credentials, so there's no record of how it was made.</p>
                        <p>
                          That's normal. Most files don't have them yet: plenty of apps don't add them, and
                          many sites strip them when you upload. So it doesn't tell you anything either way.
                        </p>
                      </div>
                    </div>
                    <MediaPlayer fileUrl={result.fileUrl} fileType={result.fileType} />
                  </>
                ) : (
                  (() => {
                    const summary = result.summary
                    const made = summary?.made
                    const issues = realFailures(summary?.failures ?? [])
                    const broken = summary?.brokenIngredients ?? 0
                    const provenanceTree = summary?.provenanceTree ?? []
                    const meta = [
                      formatLabel(summary?.format ?? null),
                      formatDate(summary?.signedAt ?? null),
                      summary?.issuer && `Signed by ${summary.issuer}`,
                    ].filter(Boolean)

                    return (
                      <>
                        <div className="flex flex-col gap-1">
                          <div className={cn(badgeBase, badgeStyles.good)}>Content Credentials found</div>
                          {meta.length > 0 && (
                            <p className="pt-1 text-[13px] leading-[18px] text-muted-foreground">
                              {meta.join(" · ")}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-col gap-4 sm:flex-row">
                          <FilePreview
                            thumbnailUrl={result.thumbnailUrl}
                            fileUrl={result.fileUrl}
                            fileType={result.fileType}
                          />
                          <div className="flex min-w-0 flex-1 flex-col gap-3">
                            <h3 className="text-[15px] leading-5 font-medium">How this was made</h3>
                            <dl className="flex flex-col gap-3 text-[13px] leading-[18px]">
                              <Fact label="Made with">{made?.madeWith ?? "Not recorded"}</Fact>
                              {made && made.tools.length > 0 && (
                                <Fact label="Includes parts made with">
                                  <Chips items={made.tools} />
                                </Fact>
                              )}
                              {made && made.models.length > 0 && (
                                <Fact label="AI models used">
                                  <Chips items={made.models} />
                                </Fact>
                              )}
                              <Fact label="AI">
                                {made?.ai === "made"
                                  ? "Made with AI"
                                  : made?.ai === "includes"
                                    ? "Includes AI-generated parts"
                                    : "No AI recorded"}
                              </Fact>
                            </dl>
                          </div>
                        </div>

                        <MediaPlayer fileUrl={result.fileUrl} fileType={result.fileType} />

                        {(issues.length > 0 || broken > 0) && (
                          <div className="flex flex-col gap-2 border-t border-border pt-4">
                            <h3 className="text-[15px] leading-5 font-medium">Some details need a second look</h3>
                            <ul className="flex flex-col gap-1.5 text-[13px] leading-[18px] text-muted-foreground">
                              {issues.length > 0 && (
                                <IssueLine>
                                  {issues.some((f) => /mismatch|hash/i.test(f.code))
                                    ? "The file was changed after its Content Credentials were signed, so they may not describe what you're looking at."
                                    : "Part of this file's Content Credentials can't be validated."}
                                </IssueLine>
                              )}
                              {broken > 0 && (
                                <IssueLine>
                                  {broken === 1
                                    ? "One of the files used to make this has Content Credentials that can't be validated."
                                    : `${broken} of the files used to make this have Content Credentials that can't be validated.`}
                                </IssueLine>
                              )}
                            </ul>
                          </div>
                        )}

                        {provenanceTree.length > 0 && (
                          <details className="border-t border-border pt-4 text-[13px] leading-[18px] text-muted-foreground">
                            <summary className="w-fit cursor-pointer transition-colors hover:text-foreground">
                              Show sources
                            </summary>
                            <ProvenanceTreeView nodes={provenanceTree} />
                          </details>
                        )}

                        <details className="border-t border-border pt-4 text-[13px] leading-[18px] text-muted-foreground">
                          <summary className="cursor-pointer list-none transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                            <span className="flex items-center justify-between gap-3">
                              Technical details
                              <button
                                type="button"
                                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs text-foreground transition-colors hover:bg-muted"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  void copyRawJson(result.rawJson)
                                }}
                              >
                                <CopyIcon className="size-3" aria-hidden="true" />
                                {copied ? "Copied" : "Copy"}
                              </button>
                            </span>
                          </summary>
                          <pre className="mt-3 max-h-80 overflow-auto rounded-xl border border-border bg-background p-3 font-mono text-xs leading-4 text-foreground/80">
                            {result.rawJson}
                          </pre>
                        </details>
                      </>
                    )
                  })()
                )}
              </div>
            )}
          </section>

          {/* Privacy */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheckIcon className="size-4 text-muted-foreground" />
              <h2 className={sectionHeading}>Your files stay yours</h2>
            </div>
            <p className={label}>
              The check runs in your browser using WebAssembly. Nothing is uploaded, stored, or sent
              anywhere, so you can safely check private files.
            </p>
          </section>

          <ul className="flex flex-wrap gap-2">
            <li>
              <a href={STORY_URL} className={pill}>
                How I built it ↗
              </a>
            </li>
            <li>
              <a href={C2PA_URL} target="_blank" rel="noreferrer" className={pill}>
                About C2PA ↗
              </a>
            </li>
            <li>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer" className={pill}>
                c2pa-js ↗
              </a>
            </li>
            <li>
              <a href={SITE_URL} className={pill}>
                Back to portfolio ↗
              </a>
            </li>
          </ul>

          <SiteFooter />
        </div>
      </main>
    </>
  )
}

export default App
