import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import { existsSync } from "fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import net from "net";
import os from "os";
import path from "path";
import JSZip from "jszip";
import { isTransformableSource, transformUploadedTextFile } from "@/lib/preview-transform";

type PackageJson = {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

export type LocalPreviewResult = {
  url: string;
  rootFolderName: string;
  framework: string;
  command: string;
  workspace: string;
};

type ActivePreview = {
  process: ChildProcessWithoutNullStreams;
  workspace: string;
};

const activePreviewKey = Symbol.for("pwg.localPreview.active");
const globalWithPreview = globalThis as typeof globalThis & {
  [activePreviewKey]?: ActivePreview;
};

export async function startLocalPreviewFromZip(file: File): Promise<LocalPreviewResult> {
  if (process.env.VERCEL) {
    throw new Error("Local preview runner is disabled on hosted Vercel deployments.");
  }

  await stopActivePreview();

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pwg-preview-"));
  const sourceRoot = path.join(tempRoot, "source");
  await mkdir(sourceRoot, { recursive: true });

  const zip = await JSZip.loadAsync(Buffer.from(await file.arrayBuffer()));
  const rootFolderName = await extractZipToWorkspace(zip, sourceRoot);
  const packageJson = await readPackageJson(sourceRoot);
  const port = await getAvailablePort();
  const framework = detectFramework(packageJson);
  const install = installCommand(sourceRoot);
  const dev = devCommand(packageJson, framework, port);

  await runCommand(install.command, install.args, sourceRoot, "dependency install");

  const previewProcess = spawn(dev.command, dev.args, {
    cwd: sourceRoot,
    env: {
      ...process.env,
      NEXT_TELEMETRY_DISABLED: "1",
      PORT: String(port),
      HOST: "127.0.0.1",
      HOSTNAME: "127.0.0.1",
    },
  });

  previewProcess.stdout.on("data", (data) => {
    process.stdout.write(`[local-preview] ${data}`);
  });
  previewProcess.stderr.on("data", (data) => {
    process.stderr.write(`[local-preview] ${data}`);
  });

  globalWithPreview[activePreviewKey] = {
    process: previewProcess,
    workspace: tempRoot,
  };

  previewProcess.once("exit", () => {
    if (globalWithPreview[activePreviewKey]?.process === previewProcess) {
      globalWithPreview[activePreviewKey] = undefined;
    }
  });

  const url = `http://127.0.0.1:${port}`;
  await waitForPreview(url, previewProcess);

  return {
    url,
    rootFolderName,
    framework,
    command: [dev.command, ...dev.args].join(" "),
    workspace: sourceRoot,
  };
}

export async function stopActivePreview() {
  const activePreview = globalWithPreview[activePreviewKey];
  if (!activePreview) return;

  activePreview.process.kill();
  await waitForProcessExit(activePreview.process, 5000);
  globalWithPreview[activePreviewKey] = undefined;
  await rm(activePreview.workspace, { recursive: true, force: true });
}

async function extractZipToWorkspace(zip: JSZip, workspace: string) {
  let detectedRoot = "";

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir || shouldSkipPath(relativePath)) continue;

    const normalizedPath = path.posix.normalize(relativePath);
    if (normalizedPath.startsWith("../") || path.isAbsolute(normalizedPath)) {
      throw new Error(`Unsafe ZIP path rejected: ${relativePath}`);
    }

    const pathParts = normalizedPath.split("/").filter(Boolean);
    if (!detectedRoot && pathParts.length > 1) {
      detectedRoot = pathParts[0];
    }

    const outputPath = path.join(workspace, ...pathParts);
    await mkdir(path.dirname(outputPath), { recursive: true });

    const textFile = isTextFile(normalizedPath);
    if (textFile) {
      const rawContent = await zipEntry.async("string");
      const transformedContent =
        isTransformableSource(normalizedPath) || normalizedPath.endsWith("package.json")
          ? transformUploadedTextFile(normalizedPath, rawContent)
          : rawContent;
      await writeFile(outputPath, transformedContent);
    } else {
      await writeFile(outputPath, Buffer.from(await zipEntry.async("uint8array")));
    }
  }

  const projectRoot = await findPackageRoot(workspace);
  if (projectRoot !== workspace) {
    await flattenWorkspace(projectRoot, workspace);
  }

  return detectedRoot;
}

async function flattenWorkspace(projectRoot: string, workspace: string) {
  const { readdir, rename } = await import("fs/promises");
  const entries = await readdir(projectRoot);

  for (const entry of entries) {
    await rename(path.join(projectRoot, entry), path.join(workspace, entry));
  }
}

async function findPackageRoot(workspace: string) {
  const { readdir, stat } = await import("fs/promises");
  const directPackage = path.join(workspace, "package.json");

  try {
    await stat(directPackage);
    return workspace;
  } catch {
    const entries = await readdir(workspace, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());

    if (directories.length === 1) {
      const nestedRoot = path.join(workspace, directories[0].name);
      await stat(path.join(nestedRoot, "package.json"));
      return nestedRoot;
    }
  }

  throw new Error("Uploaded ZIP does not contain a package.json at the root or single nested root.");
}

async function readPackageJson(workspace: string): Promise<PackageJson> {
  return JSON.parse(await readFile(path.join(workspace, "package.json"), "utf-8")) as PackageJson;
}

function detectFramework(packageJson: PackageJson) {
  const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };

  if (deps.next) return "next";
  if (deps.vite || packageJson.scripts?.dev?.includes("vite")) return "vite";
  if (deps.react) return "react";
  return "node";
}

function installCommand(workspace: string) {
  if (hasFile(workspace, "package-lock.json")) {
    return { command: "npm", args: ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"] };
  }

  return { command: "npm", args: ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"] };
}

function devCommand(packageJson: PackageJson, framework: string, port: number) {
  if (packageJson.scripts?.dev) {
    const args = ["run", "dev"];

    if (framework === "next") {
      args.push("--", "--hostname", "127.0.0.1", "--port", String(port), "--webpack");
    } else {
      args.push("--", "--host", "127.0.0.1", "--port", String(port));
    }

    return { command: "npm", args };
  }

  if (framework === "next") {
    return { command: "npx", args: ["next", "dev", "--hostname", "127.0.0.1", "--port", String(port), "--webpack"] };
  }

  throw new Error("Uploaded project does not define a dev script.");
}

function hasFile(workspace: string, fileName: string) {
  return existsSync(path.join(workspace, fileName));
}

async function runCommand(command: string, args: string[], cwd: string, label: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
    let outputTail = "";

    const appendOutput = (data: Buffer) => {
      outputTail = `${outputTail}${data.toString()}`.slice(-4000);
    };

    child.stdout.on("data", appendOutput);
    child.stderr.on("data", appendOutput);
    child.on("error", reject);
    child.on("exit", (exitCode) => {
      if (exitCode === 0) {
        resolve();
        return;
      }

      reject(new Error(`${label} failed with exit code ${exitCode}.\n${outputTail}`));
    });
  });
}

async function waitForPreview(url: string, child: ChildProcessWithoutNullStreams) {
  const startedAt = Date.now();
  let lastError = "";

  while (Date.now() - startedAt < 120_000) {
    if (child.exitCode !== null) {
      throw new Error(`Preview process exited before becoming healthy with code ${child.exitCode}.`);
    }

    try {
      const response = await fetch(url);
      const html = await response.text();

      if (response.ok && html.includes("GITHUB_INSPECTOR_READY")) {
        return;
      }

      lastError = `HTTP ${response.status}; inspector marker ${html.includes("GITHUB_INSPECTOR_READY") ? "present" : "missing"}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`Preview did not become healthy in time. Last check: ${lastError}`);
}

async function waitForProcessExit(child: ChildProcessWithoutNullStreams, timeoutMs: number) {
  if (child.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}

async function getAvailablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }

        reject(new Error("Unable to allocate a preview port."));
      });
    });
    server.on("error", reject);
  });
}

function shouldSkipPath(relativePath: string) {
  return relativePath.includes("__MACOSX/") || relativePath.includes("node_modules/") || relativePath.includes(".git/");
}

function isTextFile(relativePath: string) {
  return /\.(tsx|jsx|ts|js|json|css|scss|sass|html|md|mjs|cjs|env|txt|yml|yaml)$/.test(relativePath);
}
