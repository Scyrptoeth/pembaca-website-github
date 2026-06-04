"use client";

import { WebContainer, type FileSystemTree } from "@webcontainer/api";
import JSZip from "jszip";
import {
  ArrowUpRight,
  CheckCircle2,
  Code2,
  FileArchive,
  FileCode2,
  GitBranch,
  Globe2,
  Loader2,
  MousePointer2,
  Radar,
  ShieldAlert,
  TerminalSquare,
  UploadCloud,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

type StatusKind = "booting" | "ready" | "working" | "running" | "error";

type InspectorHit = {
  source: string;
  url: string;
  confidence: number;
  evidence: string[];
};

const defaultRepo = "https://github.com/Scyrptoeth/Website-Penilaian-Bisnis";

const pipeline = [
  "Load ZIP repository into WebContainer",
  "Inject data-github-source into JSX surfaces",
  "Run npm install and Next.js dev server",
  "Alt-click preview elements to capture source path",
];

export default function WebContainerIde() {
  const [status, setStatus] = useState("Booting WebContainer...");
  const [statusKind, setStatusKind] = useState<StatusKind>("booting");
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [wcInstance, setWcInstance] = useState<WebContainer | null>(null);
  const [rootFolderName, setRootFolderName] = useState("");
  const [githubUser, setGithubUser] = useState("Scyrptoeth");
  const [repoUrl, setRepoUrl] = useState(defaultRepo);
  const [branch, setBranch] = useState("main");
  const [selectedSource, setSelectedSource] = useState<InspectorHit | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let disposed = false;

    async function boot() {
      try {
        const webcontainerInstance = await WebContainer.boot();
        if (disposed) return;

        setWcInstance(webcontainerInstance);
        setStatus("Ready. Upload a Next.js or React ZIP repository.");
        setStatusKind("ready");

        webcontainerInstance.on("server-ready", (_port, url) => {
          setStatus(`Server running at ${url}. Waiting for preview HTML...`);
          setStatusKind("running");
          window.setTimeout(() => {
            setIframeUrl(url);
          }, 3000);
        });
      } catch (error) {
        setStatus(`WebContainer boot failed: ${messageFromError(error)}`);
        setStatusKind("error");
      }
    }

    boot();

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "GITHUB_INSPECTOR_CLICK") return;

      const sourcePath = String(event.data.source || "");
      if (!sourcePath) return;

      setSelectedSource({
        source: sourcePath,
        url: githubFileUrl(repoUrl, branch, sourcePath),
        confidence: confidenceForSource(sourcePath),
        evidence: evidenceForSource(sourcePath, rootFolderName),
      });
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [branch, repoUrl, rootFolderName]);

  const inferredRepoName = useMemo(() => {
    if (!rootFolderName) return "Waiting for ZIP";
    return rootFolderName.replace("-main", "").replace(/\/$/, "");
  }, [rootFolderName]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !wcInstance) return;

    setIframeUrl(null);
    setSelectedSource(null);
    setStatus("Extracting ZIP file...");
    setStatusKind("working");

    try {
      const zip = await JSZip.loadAsync(file);
      const filesObject: FileSystemTree = {};
      let detectedRootFolder = "";

      for (const relativePath in zip.files) {
        const zipEntry = zip.files[relativePath];
        if (zipEntry.dir) continue;

        const content = await zipEntry.async("string");
        const finalContent = instrumentSource(relativePath, content);
        const pathParts = relativePath.split("/");

        if (!detectedRootFolder && pathParts.length > 1) {
          detectedRootFolder = pathParts[0];
        }

        assignFile(filesObject, pathParts, finalContent);
      }

      const rootKeys = Object.keys(filesObject);
      const hasSingleRoot = rootKeys.length === 1 && "directory" in filesObject[rootKeys[0]];
      const rootFolder = hasSingleRoot
        ? (filesObject[rootKeys[0]] as { directory: FileSystemTree }).directory
        : filesObject;
      const finalRootName = hasSingleRoot ? rootKeys[0] : detectedRootFolder;

      setRootFolderName(finalRootName);
      if (finalRootName && repoUrl === defaultRepo) {
        setRepoUrl(`https://github.com/${githubUser}/${finalRootName.replace("-main", "")}`);
      }

      setStatus("Mounting files to WebContainer...");
      await wcInstance.mount(rootFolder);
      await removeIfExists(wcInstance, "package-lock.json");
      await stripUnsupportedTurbopackConfig(wcInstance);

      setStatus("Installing dependencies with npm...");
      const installProcess = await wcInstance.spawn("npm", [
        "install",
        "--no-audit",
        "--no-fund",
        "--legacy-peer-deps",
      ]);

      installProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            console.log("[webcontainer:npm install]", data);
          },
        }),
      );

      const installExitCode = await installProcess.exit;
      if (installExitCode !== 0) {
        throw new Error("Installation failed. Check browser console for WebContainer logs.");
      }

      setStatus("Starting Next.js dev server with webpack...");
      const devProcess = await wcInstance.spawn("npm", ["run", "dev", "--", "--webpack"]);
      devProcess.output.pipeTo(
        new WritableStream({
          write(data) {
            console.log("[webcontainer:npm run dev]", data);
          },
        }),
      );
    } catch (error) {
      setStatus(`Error: ${messageFromError(error)}`);
      setStatusKind("error");
    }
  };

  return (
    <div className="min-h-dvh bg-[var(--paper)] text-[var(--ink)]">
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="mx-auto grid max-w-[1500px] gap-6 px-5 py-6 lg:grid-cols-[1fr_420px] lg:px-8">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="mono inline-flex min-h-8 items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-strong)] px-3 text-sm font-medium text-[var(--teal-dark)]">
                <Radar size={16} aria-hidden="true" />
                Source mapping workbench
              </span>
              <StatusBadge statusKind={statusKind} />
            </div>
            <h1 className="mt-5 max-w-5xl text-4xl font-bold leading-[1.02] tracking-normal md:text-6xl">
              Pembaca Website & GitHub
            </h1>
            <p className="mt-4 max-w-3xl text-lg leading-8 text-[var(--muted)]">
              Upload repository ZIP, jalankan preview di browser, lalu Alt-click elemen untuk
              melihat file source GitHub yang paling mungkin menjadi pemilik UI tersebut.
            </p>
          </div>

          <section className="grid gap-4 border border-[var(--line)] bg-[var(--paper)] p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold">Project registry</h2>
              <Globe2 className="text-[var(--teal)]" size={22} aria-hidden="true" />
            </div>
            <Field label="GitHub username" value={githubUser} onChange={setGithubUser} />
            <Field label="Repository URL" value={repoUrl} onChange={setRepoUrl} />
            <Field label="Branch / ref" value={branch} onChange={setBranch} />
            <label className="grid gap-2">
              <span className="text-sm font-bold">Repository ZIP</span>
              <span className="flex min-h-12 items-center gap-3 border border-dashed border-[var(--teal)] bg-[var(--surface)] px-3 text-sm">
                <UploadCloud className="shrink-0 text-[var(--teal)]" size={19} aria-hidden="true" />
                <input
                  accept=".zip"
                  className="w-full text-sm"
                  disabled={!wcInstance}
                  onChange={handleFileUpload}
                  type="file"
                />
              </span>
            </label>
          </section>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-5 px-5 py-5 lg:grid-cols-[330px_minmax(0,1fr)_430px] lg:px-8">
        <aside className="grid content-start gap-4">
          <InfoPanel icon={TerminalSquare} title="Runtime status">
            <p className="leading-6 text-[var(--muted)]">{status}</p>
          </InfoPanel>

          <section className="grid gap-3">
            {pipeline.map((item, index) => (
              <div className="border border-[var(--line)] bg-[var(--surface)] p-4" key={item}>
                <div className="flex gap-3">
                  <span className="mono grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[var(--ink)] text-sm text-white">
                    {index + 1}
                  </span>
                  <p className="text-sm font-bold leading-6">{item}</p>
                </div>
              </div>
            ))}
          </section>

          <div className="border border-[var(--coral)] bg-[#fff7f3] p-4">
            <div className="flex items-center gap-2 font-bold text-[var(--coral)]">
              <ShieldAlert size={18} aria-hidden="true" />
              Security guardrail
            </div>
            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
              Prototype ini membaca ZIP yang user upload. Jangan gunakan untuk repository yang
              tidak dimiliki, dan jangan publish source maps produksi sebagai default.
            </p>
          </div>
        </aside>

        <section className="min-h-[680px] min-w-0 border border-[var(--line)] bg-[var(--surface)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] p-4">
            <div className="flex items-center gap-2 font-bold">
              <MousePointer2 size={19} aria-hidden="true" />
              <h2>Website preview</h2>
            </div>
            <span className="mono rounded-md bg-[var(--surface-strong)] px-3 py-2 text-sm text-[var(--muted)]">
              Alt + click inspect
            </span>
          </div>

          <div className="h-[calc(100%-65px)] min-h-[620px] bg-white">
            {iframeUrl ? (
              <iframe
                allow="cross-origin-isolated"
                className="h-full w-full border-0"
                ref={iframeRef}
                src={iframeUrl}
                title="WebContainer Preview"
              />
            ) : (
              <EmptyPreview rootFolderName={inferredRepoName} />
            )}
          </div>
        </section>

        <aside className="grid content-start gap-4">
          <InfoPanel icon={Code2} title="Source candidate">
            {selectedSource ? (
              <SourceResult hit={selectedSource} />
            ) : (
              <p className="leading-6 text-[var(--muted)]">
                Belum ada elemen yang dipilih. Setelah preview berjalan, tahan Alt lalu klik elemen
                di iframe untuk menangkap path source.
              </p>
            )}
          </InfoPanel>

          <InfoPanel icon={GitBranch} title="GitHub target">
            <div className="grid gap-2 text-sm leading-6 text-[var(--muted)]">
              <p>
                <strong className="text-[var(--ink)]">Repo inferred:</strong> {inferredRepoName}
              </p>
              <p className="break-words">
                <strong className="text-[var(--ink)]">URL:</strong> {repoUrl}
              </p>
              <p>
                <strong className="text-[var(--ink)]">Branch:</strong> {branch || "main"}
              </p>
            </div>
          </InfoPanel>

          <InfoPanel icon={FileArchive} title="Current MVP">
            <ul className="grid gap-2 text-sm leading-6 text-[var(--muted)]">
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--teal)]" size={16} />
                ZIP-based repository ingestion.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--teal)]" size={16} />
                WebContainer preview for Next.js/React projects.
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--teal)]" size={16} />
                DOM-to-source instrumentation via `data-github-source`.
              </li>
            </ul>
          </InfoPanel>
        </aside>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2">
      <span className="text-sm font-bold">{label}</span>
      <input
        className="min-h-11 w-full border border-[var(--line)] bg-[var(--surface)] px-3 text-sm"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      />
    </label>
  );
}

function InfoPanel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Code2;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-center gap-2 font-bold">
        <Icon className="text-[var(--teal)]" size={18} aria-hidden="true" />
        <h2>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function StatusBadge({ statusKind }: { statusKind: StatusKind }) {
  const labelByStatus: Record<StatusKind, string> = {
    booting: "Booting",
    ready: "Ready",
    working: "Working",
    running: "Running",
    error: "Needs attention",
  };

  return (
    <span className="mono inline-flex min-h-8 items-center gap-2 rounded-md border border-[var(--line)] px-3 text-sm text-[var(--muted)]">
      {statusKind === "working" || statusKind === "booting" ? (
        <Loader2 className="animate-spin" size={15} aria-hidden="true" />
      ) : null}
      {labelByStatus[statusKind]}
    </span>
  );
}

function EmptyPreview({ rootFolderName }: { rootFolderName: string }) {
  return (
    <div className="grid h-full min-h-[620px] place-items-center bg-[var(--paper)] p-5 text-center">
      <div className="max-w-md border border-[var(--line)] bg-[var(--surface)] p-6">
        <FileCode2 className="mx-auto text-[var(--teal)]" size={34} aria-hidden="true" />
        <h2 className="mt-4 text-2xl font-bold">Upload repository ZIP</h2>
        <p className="mt-3 leading-7 text-[var(--muted)]">
          Preview akan muncul di sini setelah dependency terpasang dan dev server di WebContainer
          siap. Folder terdeteksi: {rootFolderName}.
        </p>
      </div>
    </div>
  );
}

function SourceResult({ hit }: { hit: InspectorHit }) {
  return (
    <article className="grid gap-4">
      <div className="rounded-md bg-[var(--teal)] p-4 text-white">
        <span className="mono text-xs uppercase text-white/75">confidence</span>
        <strong className="mt-1 block text-3xl">{hit.confidence}%</strong>
      </div>

      <div className="rounded-md border border-[var(--line)] bg-[var(--paper)] p-3">
        <span className="mono text-xs uppercase text-[var(--muted)]">source path</span>
        <p className="mono mt-2 break-words text-sm font-medium">{hit.source}</p>
      </div>

      <a
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[var(--ink)] px-4 text-sm font-bold text-white"
        href={hit.url}
        rel="noreferrer"
        target="_blank"
      >
        Open GitHub file
        <ArrowUpRight size={16} aria-hidden="true" />
      </a>

      <ul className="grid gap-2">
        {hit.evidence.map((item) => (
          <li className="flex gap-2 text-sm leading-6 text-[var(--muted)]" key={item}>
            <CheckCircle2 className="mt-0.5 shrink-0 text-[var(--teal)]" size={16} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function instrumentSource(relativePath: string, content: string) {
  if (!relativePath.endsWith(".tsx") && !relativePath.endsWith(".jsx")) return content;

  const firstSlashIndex = relativePath.indexOf("/");
  const githubPath = firstSlashIndex !== -1 ? relativePath.substring(firstSlashIndex + 1) : relativePath;
  let finalContent = content.replace(
    /<(div|main|section|p|span|button|a)(\s+[^>]*)?>/g,
    (match, tag, rest = "") => {
      if (rest.includes("data-github-source")) return match;
      return `<${tag} data-github-source="${githubPath}"${rest}>`;
    },
  );

  if (relativePath.includes("layout.tsx") || relativePath.includes("_document.tsx")) {
    finalContent = finalContent.replace("</body>", `${inspectorScript()}\n</body>`);
  }

  return finalContent;
}

function inspectorScript() {
  return `<script dangerouslySetInnerHTML={{__html: "\\n" +
    "if (typeof window !== 'undefined' && !window.__INSPECTOR_INIT) {\\n" +
    "  window.__INSPECTOR_INIT = true;\\n" +
    "  window.addEventListener('click', (event) => {\\n" +
    "    if (!event.altKey) return;\\n" +
    "    const target = event.target;\\n" +
    "    const sourceNode = target.closest('[data-github-source]');\\n" +
    "    if (!sourceNode) return;\\n" +
    "    event.preventDefault();\\n" +
    "    event.stopPropagation();\\n" +
    "    window.parent.postMessage({ type: 'GITHUB_INSPECTOR_CLICK', source: sourceNode.getAttribute('data-github-source') }, '*');\\n" +
    "  }, { capture: true });\\n" +
    "}\\n"
  }} />`;
}

function assignFile(tree: FileSystemTree, pathParts: string[], content: string) {
  let currentLevel = tree;

  for (let i = 0; i < pathParts.length; i += 1) {
    const part = pathParts[i];

    if (i === pathParts.length - 1) {
      currentLevel[part] = { file: { contents: content } };
      return;
    }

    if (!currentLevel[part]) {
      currentLevel[part] = { directory: {} };
    }

    currentLevel = (currentLevel[part] as { directory: FileSystemTree }).directory;
  }
}

async function removeIfExists(webcontainer: WebContainer, path: string) {
  try {
    await webcontainer.fs.rm(path);
  } catch {
    // File is optional in uploaded projects.
  }
}

async function stripUnsupportedTurbopackConfig(webcontainer: WebContainer) {
  const configFiles = ["next.config.ts", "next.config.js", "next.config.mjs"];

  for (const fileName of configFiles) {
    try {
      const configContent = await webcontainer.fs.readFile(fileName, "utf-8");
      if (!configContent.includes("turbopack")) continue;

      const newConfig = configContent.replace(
        /turbopack:\s*\{[^}]*\},?/g,
        "/* removed turbopack for webcontainer */",
      );
      await webcontainer.fs.writeFile(fileName, newConfig);
    } catch {
      // Config file does not exist in every project.
    }
  }
}

function githubFileUrl(repoUrl: string, branch: string, sourcePath: string) {
  const cleanRepo = repoUrl.replace(/\/$/, "");
  const ref = encodeURIComponent(branch.trim() || "main");
  return `${cleanRepo}/blob/${ref}/${sourcePath}`;
}

function confidenceForSource(sourcePath: string) {
  if (sourcePath.includes("components/")) return 92;
  if (sourcePath.includes("app/")) return 84;
  return 76;
}

function evidenceForSource(sourcePath: string, rootFolderName: string) {
  return [
    "Clicked iframe element carries injected `data-github-source` metadata.",
    `Source path was produced from uploaded repository${rootFolderName ? ` root ${rootFolderName}` : ""}.`,
    sourcePath.includes("components/")
      ? "Component path indicates likely UI ownership."
      : "Route or library path indicates a supporting source candidate.",
  ];
}

function messageFromError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
