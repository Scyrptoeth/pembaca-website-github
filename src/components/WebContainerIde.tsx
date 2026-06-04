'use client';

import { useState, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { WebContainer } from '@webcontainer/api';

export default function WebContainerIde() {
  const [status, setStatus] = useState<string>('Booting WebContainer...');
  const [iframeUrl, setIframeUrl] = useState<string | null>(null);
  const [wcInstance, setWcInstance] = useState<WebContainer | null>(null);
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
          setIframeUrl(url);
          setStatus(`Server running on ${url}`);
        });

      } catch (error: any) {
        setStatus(`Error booting WebContainer: ${error.message}`);
      }
    }
    boot();
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !wcInstance) return;

    setStatus('Extracting ZIP file...');
    try {
      const zip = await JSZip.loadAsync(file);
      const filesObject: Record<string, any> = {};

      // Convert JSZip object to WebContainer file system structure
      for (const relativePath in zip.files) {
        const zipEntry = zip.files[relativePath];
        if (!zipEntry.dir) {
          const content = await zipEntry.async('string');
          
          // --- INJECTION LOGIC ---
          // In a real app, you would inject the data-github-source attributes here
          // before writing the file to the WebContainer
          let finalContent = content;
          if (relativePath.endsWith('.tsx') || relativePath.endsWith('.jsx')) {
              // Basic rudimentary injection for POC
              finalContent = content.replace(/<(div|main|section|p|span|button)/g, `<$1 data-github-source="${relativePath}" `);
          }
          // -----------------------

          // Split path into array to build nested object structure
          const pathParts = relativePath.split('/');
          let currentLevel = filesObject;
          
          for (let i = 0; i < pathParts.length; i++) {
             const part = pathParts[i];
             if (i === pathParts.length - 1) {
                 // It's a file
                 currentLevel[part] = {
                     file: { contents: finalContent }
                 };
             } else {
                 // It's a directory
                 if (!currentLevel[part]) {
                     currentLevel[part] = { directory: {} };
                 }
                 currentLevel = currentLevel[part].directory;
             }
          }
        }
      }

      setStatus('Mounting files to WebContainer...');
      // Note: WebContainers expect the root of the file system. 
      // If the ZIP contains a root folder (e.g. repo-main/), we should mount its contents.
      // For simplicity in this POC, we mount everything.
      
      // Determine the root folder if github zips
      const rootKeys = Object.keys(filesObject);
      const rootFolder = rootKeys.length === 1 && filesObject[rootKeys[0]].directory ? filesObject[rootKeys[0]].directory : filesObject;

      await wcInstance.mount(rootFolder);

      setStatus('Installing dependencies (npm install)...');
      const installProcess = await wcInstance.spawn('npm', ['install']);
      
      installProcess.output.pipeTo(new WritableStream({
        write(data) {
          console.log(data); // In real app, pipe to a visible terminal UI
        }
      }));

      const installExitCode = await installProcess.exit;

      if (installExitCode !== 0) {
        throw new Error('Installation failed');
      }

      setStatus('Starting development server (npm run dev)...');
      await wcInstance.spawn('npm', ['run', 'dev']);
      
      // The server-ready event listener will update the iframe URL

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
            <div>
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
                <div className="flex items-center justify-center w-full h-full text-slate-500">
                    Upload a Next.js/React .zip project to see the Live Preview here.
                </div>
            )}
        </div>
    </div>
  );
}