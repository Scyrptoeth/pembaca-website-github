export function isTransformableSource(relativePath: string) {
  return /\.(tsx|jsx|ts|js)$/.test(relativePath);
}

export function transformUploadedTextFile(relativePath: string, content: string, options?: { normalizeNext?: boolean }) {
  if (relativePath.endsWith("package.json") && options?.normalizeNext) {
    return normalizePackageJsonForWebContainer(relativePath, content);
  }

  if (!isTransformableSource(relativePath)) {
    return content;
  }

  return transformUploadedSource(relativePath, content);
}

export function transformUploadedSource(relativePath: string, content: string) {
  const fontSafeContent = disableNextFontForPreview(relativePath, content);
  const headerSafeContent = disableNextHeadersForPreview(relativePath, fontSafeContent);
  const previewSafeContent = disableForceDynamicForPreview(relativePath, headerSafeContent);

  if (!relativePath.endsWith(".tsx") && !relativePath.endsWith(".jsx")) {
    return previewSafeContent;
  }

  return instrumentSource(relativePath, previewSafeContent);
}

function normalizePackageJsonForWebContainer(relativePath: string, content: string) {
  try {
    const packageJson = JSON.parse(content) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    const webContainerNextVersion = "16.1.6";

    if (packageJson.dependencies?.next) {
      packageJson.dependencies.next = webContainerNextVersion;
    }

    if (packageJson.devDependencies?.next) {
      packageJson.devDependencies.next = webContainerNextVersion;
    }

    return `${JSON.stringify(packageJson, null, 2)}\n`;
  } catch {
    console.warn(`Skipping package.json preview normalization for ${relativePath}.`);
    return content;
  }
}

function disableNextFontForPreview(relativePath: string, content: string) {
  if (!/\.(tsx|jsx|ts|js)$/.test(relativePath) || !content.includes("next/font/")) {
    return content;
  }

  const previewFontNames: string[] = [];
  let finalContent = content.replace(
    /import\s*\{([^}]+)\}\s*from\s*["']next\/font\/(?:google|local)["'];?/g,
    (_match, specifiers: string) => {
      for (const specifier of specifiers.split(",")) {
        const localName = specifier.trim().split(/\s+as\s+/i).pop()?.trim();
        if (localName) previewFontNames.push(localName);
      }

      return "";
    },
  );

  finalContent = finalContent.replace(
    /import\s+([A-Za-z_$][\w$]*)\s+from\s*["']next\/font\/local["'];?/g,
    (_match, localName: string) => {
      previewFontNames.push(localName);
      return "";
    },
  );

  if (previewFontNames.length === 0) return finalContent;

  const uniqueFontNames = Array.from(new Set(previewFontNames));
  const fontAliases = uniqueFontNames.map((name) => `const ${name} = __pwgPreviewFont;`).join("\n");
  const isTypeScript = /\.(tsx|ts)$/.test(relativePath);
  const fontHelper = isTypeScript
    ? 'const __pwgPreviewFont = (options?: Record<string, unknown> & { variable?: string }) => ({ className: "", variable: options?.variable ?? "", style: {} });'
    : 'const __pwgPreviewFont = (options) => ({ className: "", variable: options?.variable ?? "", style: {} });';

  return [fontHelper, fontAliases, finalContent].join("\n");
}

function disableNextHeadersForPreview(relativePath: string, content: string) {
  if (!/\.(tsx|jsx|ts|js)$/.test(relativePath) || !content.includes("next/headers")) {
    return content;
  }

  const headerNames: string[] = [];
  const finalContent = content.replace(
    /import\s*\{([^}]+)\}\s*from\s*["']next\/headers["'];?/g,
    (_match, specifiers: string) => {
      for (const specifier of specifiers.split(",")) {
        const localName = specifier.trim().split(/\s+as\s+/i).pop()?.trim();
        if (localName) headerNames.push(localName);
      }

      return "";
    },
  );

  if (headerNames.length === 0) return finalContent;

  const uniqueHeaderNames = new Set(headerNames);
  const isTypeScript = /\.(tsx|ts)$/.test(relativePath);
  const stubs = [
    uniqueHeaderNames.has("cookies")
      ? isTypeScript
        ? "const cookies = async () => ({ get: (_name?: string): { value: string } | undefined => undefined, getAll: (): { value: string }[] => [], has: (_name?: string) => false, set: () => undefined, delete: () => undefined });"
        : "const cookies = async () => ({ get: () => undefined, getAll: () => [], has: () => false, set: () => undefined, delete: () => undefined });"
      : "",
    uniqueHeaderNames.has("headers")
      ? isTypeScript
        ? "const headers = async () => ({ get: (_name?: string) => null, getAll: () => [], has: (_name?: string) => false, entries: () => [][Symbol.iterator]() });"
        : "const headers = async () => ({ get: () => null, getAll: () => [], has: () => false, entries: () => [][Symbol.iterator]() });"
      : "",
    uniqueHeaderNames.has("draftMode") ? "const draftMode = async () => ({ isEnabled: false });" : "",
  ].filter(Boolean);

  return [stubs.join("\n"), finalContent].join("\n");
}

function disableForceDynamicForPreview(relativePath: string, content: string) {
  if (!/\/src\/app\/.*\.(tsx|jsx|ts|js)$/.test(`/${relativePath}`)) return content;

  return content.replace(
    /export\s+const\s+dynamic\s*=\s*["']force-dynamic["'];?/g,
    'export const dynamic = "force-static";',
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
    "  window.parent.postMessage({ type: 'GITHUB_INSPECTOR_READY', href: window.location.href }, '*');\\n" +
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
