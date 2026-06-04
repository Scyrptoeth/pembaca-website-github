import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  // Required headers for WebContainers (SharedArrayBuffer)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
        ],
      },
    ];
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.(tsx|jsx)$/,
      exclude: /node_modules/,
      use: [
        {
          loader: require.resolve('./inject-source-loader.js'),
        },
      ],
    });
    return config;
  },
};

export default nextConfig;
