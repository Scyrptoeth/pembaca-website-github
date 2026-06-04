'use client';

import { useEffect, useState } from 'react';

export default function InspectorOverlay() {
  const [hoveredNode, setHoveredNode] = useState<HTMLElement | null>(null);
  const [isActive, setIsActive] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey) setIsActive(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.altKey) {
        setIsActive(false);
        setHoveredNode(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(() => {
    if (!isActive) return;

    const handleMouseMove = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Find the closest element with data-github-source
      const sourceNode = target.closest('[data-github-source]') as HTMLElement;
      setHoveredNode(sourceNode || null);
    };

    const handleClick = (e: MouseEvent) => {
      if (!hoveredNode) return;
      e.preventDefault();
      e.stopPropagation();

      const sourcePath = hoveredNode.getAttribute('data-github-source');
      if (sourcePath) {
        // Build the GitHub URL
        const GITHUB_REPO = process.env.NEXT_PUBLIC_GITHUB_REPO || 'https://github.com/Scyrptoeth/pembaca-website-github';
        const BRANCH = 'main';
        const finalUrl = `${GITHUB_REPO}/blob/${BRANCH}/${sourcePath}`;
        window.open(finalUrl, '_blank');
      }
      setIsActive(false);
      setHoveredNode(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('click', handleClick, { capture: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('click', handleClick, { capture: true });
    };
  }, [isActive, hoveredNode]);

  if (!isActive || !hoveredNode) return null;

  const rect = hoveredNode.getBoundingClientRect();

  return (
    <div
      style={{
        position: 'fixed',
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        backgroundColor: 'rgba(59, 130, 246, 0.3)',
        border: '2px solid rgb(59, 130, 246)',
        pointerEvents: 'none',
        zIndex: 9999,
        transition: 'all 0.1s ease-out',
      }}
    >
      <div
        style={{
          position: 'absolute',
          bottom: '100%',
          left: 0,
          backgroundColor: '#1e293b',
          color: 'white',
          padding: '4px 8px',
          fontSize: '12px',
          borderRadius: '4px 4px 4px 0',
          whiteSpace: 'nowrap',
          marginBottom: '4px',
          fontFamily: 'monospace',
          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
        }}
      >
        {hoveredNode.getAttribute('data-github-source')}
      </div>
    </div>
  );
}