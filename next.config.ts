import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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