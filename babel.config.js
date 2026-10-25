module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    env: {
      production: {
        // Release logging must not include credential-bearing URLs or response
        // details. Debug builds keep console output for development.
        plugins: [require.resolve('./babel-plugins/remove-console')],
      },
    },
  };
};
