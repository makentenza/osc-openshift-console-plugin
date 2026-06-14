// Webpack config for Cypress component tests. Self-contained (no Console module
// federation): bundles React + PatternFly directly and aliases the dynamic
// plugin SDK to the local mock so components mount without a live cluster.
const path = require('path');

module.exports = {
  mode: 'development',
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
    alias: {
      '@openshift-console/dynamic-plugin-sdk': path.resolve(
        __dirname,
        'mocks/dynamic-plugin-sdk.tsx',
      ),
    },
  },
  module: {
    rules: [
      {
        test: /\.(jsx?|tsx?)$/,
        exclude: /\/node_modules\//,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: path.resolve(__dirname, '..', 'tsconfig.json'),
              transpileOnly: true,
              onlyCompileBundledFiles: true,
            },
          },
        ],
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.(png|jpe?g|gif|svg|woff2?|ttf|eot|otf)(\?.*)?$/,
        type: 'asset/resource',
      },
      {
        test: /\.m?js$/,
        resolve: { fullySpecified: false },
      },
    ],
  },
};
