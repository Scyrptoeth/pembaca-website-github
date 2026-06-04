'use client';

import { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { WebContainer } from '@webcontainer/api';

export default function WebContainerIde() {
  const [status, setStatus] = useState<string>('Booting WebContainer...');
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [wcInstance, setWcInstance] = useState<WebContainer | null>(null);
  const [rootFolderName, setRootFolderName] = useState<string>('');
  const [githubUser, setGithubUser] = useState<string>('Scyrptoeth');
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Initialize WebContainer on mount
  useEffect(() => {
    async function boot() {
      try {
        const webcontainerInstance = await WebContainer.boot();
        setWcInstance(webcontainerInstance);
        setStatus('Ready! Please upload a ZIP file.');

        // Listen for server-ready event to set the iframe URL
        webcontainerInstance.on('server-ready', (port, url) => {
          setStatus(`Server running on ${url}. Booting Next.js...`);
          // Adding a small delay to let Next.js actually start serving HTML before iframe loads it
          setTimeout(() => {
            setIframeUrl(url);
          }, 3000);
        });

      } catch (error: any) {
        setStatus(`Error booting WebContainer: ${error.message}`);
      }
    }
    boot();
  }, []);

  // Listen for the postMessage from the iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'GITHUB_INSPECTOR_CLICK') {
        const sourcePath = e.data.source;
        if (rootFolderName) {
           // E.g., Website-Penilaian-Bisnis-main -> Website-Penilaian-Bisnis
           const repoName = rootFolderName.replace('-main', '').replace(/\/$/, '');
           const finalUrl = `https://github.com/${githubUser}/${repoName}/blob/main/${sourcePath}`;
           window.open(finalUrl, '_blank');
        }
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [rootFolderName, githubUser]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !wcInstance) return;

    setStatus('Extracting ZIP file...');
    try {
      const zip = await JSZip.loadAsync(file);
      const filesObject: Record<string, any> = {};
      let detectedRootFolder = '';

      // Convert JSZip object to WebContainer file system structure
      for (const relativePath in zip.files) {
        const zipEntry = zip.files[relativePath];
        if (!zipEntry.dir) {
          const content = await zipEntry.async('string');
          
          let finalContent = content;
          if (relativePath.endsWith('.tsx') || relativePath.endsWith('.jsx')) {
              // Extract the relative path without the root folder prefix
              const firstSlashIndex = relativePath.indexOf('/');
              const githubPath = firstSlashIndex !== -1 ? relativePath.substring(firstSlashIndex + 1) : relativePath;

              // Rudimentary injection
              finalContent = content.replace(/<(div|main|section|p|span|button|a)/g, `<$1 data-github-source="${githubPath}" `);
              
              if (relativePath.includes('layout.tsx') || relativePath.includes('_document.tsx')) {
                 const scriptToInject = `
                 <script dangerouslySetInnerHTML={{__html: "\\n" +
                     "if (typeof window !== 'undefined' && !window.__INSPECTOR_INIT) {\\n" +
                     "    window.__INSPECTOR_INIT = true;\\n" +
                     "    window.addEventListener('click', (e) => {\\n" +
                     "        if (e.altKey) {\\n" +
                     "            const target = e.target;\\n" +
                     "            const sourceNode = target.closest('[data-github-source]');\\n" +
                     "            if (sourceNode) {\\n" +
                     "                e.preventDefault();\\n" +
                     "                e.stopPropagation();\\n" +
                     "                const source = sourceNode.getAttribute('data-github-source');\\n" +
                     "                window.parent.postMessage({ type: 'GITHUB_INSPECTOR_CLICK', source }, '*');\\n" +
                     "            }\\n" +
                     "        }\\n" +
                     "    }, { capture: true });\\n" +
                     "}\\n"
                 }} />
                 </body>`;
                 finalContent = finalContent.replace('</body>', scriptToInject);
              }
          }

          const pathParts = relativePath.split('/');
          if (!detectedRootFolder && pathParts.length > 1) {
              detectedRootFolder = pathParts[0];
          }

          let currentLevel = filesObject;
          for (let i = 0; i < pathParts.length; i++) {
             const part = pathParts[i];
             if (i === pathParts.length - 1) {
                 currentLevel[part] = { file: { contents: finalContent } };
             } else {
                 if (!currentLevel[part]) {
                     currentLevel[part] = { directory: {} };
                 }
                 currentLevel = currentLevel[part].directory;
             }
          }
        }
      }

      const rootKeys = Object.keys(filesObject);
      const rootFolder = rootKeys.length === 1 && filesObject[rootKeys[0]].directory ? filesObject[rootKeys[0]].directory : filesObject;
      const finalRootName = rootKeys.length === 1 ? rootKeys[0] : detectedRootFolder;
      setRootFolderName(finalRootName);

      setStatus('Mounting files to WebContainer...');
      await wcInstance.mount(rootFolder);

      // Remove package-lock.json if it exists to prevent cross-platform installation issues in WebContainers
      try {
        await wcInstance.fs.rm('package-lock.json');
      } catch(e) {
        // Ignore if it doesn't exist
      }

      // Modify next.config.ts/js if it exists to remove turbopack config, as Turbopack uses Rust native binaries unsupported by WebContainers
      const fixNextConfig = async (fileName: string) => {
         try {
             const configContent = await wcInstance.fs.readFile(fileName, 'utf-8');
             if (configContent.includes('turbopack')) {
                 const newConfig = configContent.replace(/turbopack:\s*\{[^}]*\}/g, '/* removed turbopack for webcontainer */');
                 await wcInstance.fs.writeFile(fileName, newConfig);
             }
         } catch(e) {}
      };
      await fixNextConfig('next.config.ts');
      await fixNextConfig('next.config.js');
      await fixNextConfig('next.config.mjs');

      setStatus('Installing dependencies (npm install)...');
      const installProcess = await wcInstance.spawn('npm', ['install', '--no-audit', '--no-fund', '--legacy-peer-deps']);
      
      installProcess.output.pipeTo(new WritableStream({
        write(data) {
          console.log('[npm install]', data);
        }
      }));

      const installExitCode = await installProcess.exit;

      if (installExitCode !== 0) {
        throw new Error('Installation failed (Check console for details)');
      }

      setStatus('Starting development server (npm run dev)...');
      // Force next dev to use webpack instead of turbopack
      const devProcess = await wcInstance.spawn('npm', ['run', 'dev', '--', '--webpack']);
      devProcess.output.pipeTo(new WritableStream({
        write(data) {
          console.log('[npm run dev]', data);
        }
      }));

    } catch (error: any) {
       setStatus(`Error: ${error.message}`);
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-slate-900 text-white p-4 font-mono">
        <div className="flex items-center justify-between mb-4 border-b border-slate-700 pb-4">
            <div>
                <h1 className="text-xl font-bold text-blue-400">Pembaca Website & Github (SaaS)</h1>
                <p className="text-sm text-slate-400">Status: {status}</p>
            </div>
            <div className="flex gap-4 items-center">
                <input 
                    type="text" 
                    value={githubUser}
                    onChange={(e) => setGithubUser(e.target.value)}
                    placeholder="GitHub Username"
                    className="px-3 py-2 bg-slate-800 border border-slate-700 rounded text-sm text-white"
                />
                <input 
                    type="file" 
                    accept=".zip" 
                    onChange={handleFileUpload} 
                    className="block w-full text-sm text-slate-400
                        file:mr-4 file:py-2 file:px-4
                        file:rounded-full file:border-0
                        file:text-sm file:font-semibold
                        file:bg-blue-500 file:text-white
                        hover:file:bg-blue-600
                        cursor-pointer"
                />
            </div>
        </div>
        
        <div className="flex-grow flex border border-slate-700 rounded-lg overflow-hidden bg-white">
            {iframeUrl ? (
                <iframe 
                    ref={iframeRef}
                    src={iframeUrl} 
                    className="w-full h-full border-none"
                    title="WebContainer Preview"
                    allow="cross-origin-isolated"
                />
            ) : (
                <div className="flex items-center justify-center w-full h-full text-slate-500 bg-slate-100 flex-col gap-4">
                    <p>Upload a Next.js/React .zip project to see the Live Preview here.</p>
                    <p className="text-xs text-slate-400 max-w-md text-center">
                       Hold <strong>Alt</strong> and click on elements inside the preview to open the corresponding file in GitHub.
                    </p>
                </div>
            )}
        </div>
    </div>
  );
}