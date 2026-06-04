module.exports = function(source) {
  const resourcePath = this.resourcePath;
  if (!resourcePath.includes('/src/')) return source;
  
  const relativePath = resourcePath.replace(process.cwd() + '/', '');
  
  // Inject data-github-source into standard HTML tags
  const modified = source.replace(/<(div|main|section|p|span|h[1-6]|button|a|footer)(\s+[^>]*)?>/g, (match, tag, rest) => {
    if (rest && rest.includes('data-github-source')) return match;
    // Don't inject into self-closing tags easily to avoid breaking them, wait, the regex above doesn't check self closing, but it's fine for simple tags
    return `<${tag} data-github-source="${relativePath}"${rest || ''}>`;
  });
  
  return modified;
};