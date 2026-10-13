import { useCallback, useEffect, useRef, useState } from "react"
import { AssetTooLargeError, Reader } from "@contentauth/c2pa-web"
import { CopyIcon, ShieldCheckIcon, UploadIcon } from "lucide-react"
import { OverscrollMessages } from "@/components/overscroll-messages"
import { SiteFooter } from "@/components/site-footer"
import { cn } from "@/lib/utils"
import { getC2pa } from "./lib/c2pa"
import {
  formatBytes,
  formatDate,
  nonTrustFailures,
  summarizeManifest,
  type ManifestSummary,
} from "./lib/manifest"
import { getFlatProvenanceSummaries, type ProvenanceNode } from "./lib/provenance"

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
          {node.aiGenerated && <span className="text-foreground italic"> · AI-generated</span>}
          {node.hasFailures && <span className={warningNote}> · couldn't be fully verified</span>}
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
                <p className="text-[13px] leading-[18px] text-foreground/70 italic">
                  Web Tool · C2PA · Content Credentials
                </p>
              </div>
            </div>

            <div className={cn(body, "flex flex-col gap-3 pt-2")}>
              <p className="text-foreground">Is this file real?</p>
              <p>
                Check a photo, video, audio file, or PDF for <Strong>Content Credentials</Strong>, a
                digital record of how a file was created or edited.
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
                    <div className={cn(badgeBase, badgeStyles.none)}>No Content Credentials found</div>
                    <div className="flex flex-col gap-4 sm:flex-row">
                      <FilePreview thumbnailUrl={null} fileUrl={result.fileUrl} fileType={result.fileType} />
                      <p className={body}>
                        We couldn't find C2PA Content Credentials attached to this file. That{" "}
                        <Strong>doesn't mean the file is fake</Strong>. It simply means there's no
                        Content Credentials record here for us to check.
                      </p>
                    </div>
                    <MediaPlayer fileUrl={result.fileUrl} fileType={result.fileType} />
                  </>
                ) : (
                  (() => {
                    const failures = result.summary?.failures ?? []
                    const realIssues = nonTrustFailures(failures)
                    const verified = failures.length === 0
                    const generator = result.summary?.generator
                    const issuer = result.summary?.issuer
                    const provenanceTree = result.summary?.provenanceTree ?? []

                    return (
                      <>
                        <div
                          className={cn(
                            badgeBase,
                            realIssues.length > 0 ? badgeStyles.warning : badgeStyles.good,
                          )}
                        >
                          {realIssues.length > 0
                            ? "Content Credentials found, but something changed"
                            : verified
                              ? "Verified Content Credentials"
                              : "Content Credentials found"}
                        </div>

                        {realIssues.length > 0 ? (
                          <p className={body}>
                            This file contains Content Credentials, but they didn't fully pass
                            validation. The file may have been modified after the credentials were
                            added, or part of the credential could not be verified.
                          </p>
                        ) : verified ? (
                          <p className={body}>
                            This file has Content Credentials attached. The credentials are intact, and
                            the signer could be verified.
                          </p>
                        ) : (
                          <p className={body}>
                            This file has Content Credentials attached, and they haven't been altered
                            since they were signed. We couldn't verify the signer's identity against a
                            trusted source, so we'll show you exactly what the file tells us.
                          </p>
                        )}

                        <div className="flex flex-col gap-4 sm:flex-row">
                          <FilePreview
                            thumbnailUrl={result.thumbnailUrl}
                            fileUrl={result.fileUrl}
                            fileType={result.fileType}
                          />
                          <dl className="grid min-w-0 flex-1 grid-cols-[auto_1fr] content-start gap-x-4 gap-y-1.5 text-[13px] leading-[18px]">
                            <dt className="text-muted-foreground">Title</dt>
                            <dd className="break-words text-foreground">{result.summary?.title ?? "—"}</dd>
                            <dt className="text-muted-foreground">File type</dt>
                            <dd className="break-words text-foreground">{result.summary?.format ?? "—"}</dd>
                            <dt className="text-muted-foreground">Created with</dt>
                            <dd className="break-words text-foreground">{generator ?? "—"}</dd>
                            <dt className="text-muted-foreground">Signed by</dt>
                            <dd className="break-words text-foreground">{issuer ?? "—"}</dd>
                            <dt className="text-muted-foreground">Date signed</dt>
                            <dd className="break-words text-foreground">
                              {formatDate(result.summary?.signedAt ?? null) ?? "—"}
                            </dd>
                          </dl>
                        </div>

                        <MediaPlayer fileUrl={result.fileUrl} fileType={result.fileType} />

                        {provenanceTree.length > 0 && (
                          <div className="flex flex-col gap-2 border-t border-border pt-4">
                            <h3 className="text-[15px] leading-5 font-medium">Where this file came from</h3>
                            <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px] leading-[18px]">
                              {getFlatProvenanceSummaries(provenanceTree).map((s, i) => (
                                <li key={i}>
                                  <span className="font-medium text-foreground">{s.heading}</span>
                                  {s.detail && <span className="text-muted-foreground"> · {s.detail}</span>}
                                  {s.hasFailures && (
                                    <span className={warningNote}> · couldn't be fully verified</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                            <details className="text-[13px] leading-[18px] text-muted-foreground">
                              <summary className="w-fit cursor-pointer transition-colors hover:text-foreground">
                                View provenance tree
                              </summary>
                              <ProvenanceTreeView nodes={provenanceTree} />
                            </details>
                          </div>
                        )}

                        {realIssues.length === 0 && (generator || issuer) && (
                          <div className="flex flex-col gap-2 border-t border-border pt-4">
                            <h3 className="text-[15px] leading-5 font-medium">What does this mean?</h3>
                            <p className="text-[13px] leading-[18px] text-muted-foreground">
                              The Content Credentials attached to this file are intact.
                              {generator && (
                                <>
                                  {" "}
                                  They say the file was created with <Strong>{generator}</Strong>
                                </>
                              )}
                              {issuer && (
                                <>
                                  {generator ? " and signed by " : " They were signed by "}
                                  <Strong>{issuer}</Strong>
                                </>
                              )}
                              .
                            </p>
                            <p className="text-[13px] leading-[18px] text-muted-foreground">
                              This does <Strong>not</Strong> independently prove that everything in the
                              file is true. It verifies the provenance information attached to it.
                            </p>
                          </div>
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
