module.exports = {
  proseWrap: 'always',
  singleQuote: true,
  trailingComma: 'all',
  semi: false,
  overrides: [
    {
      files: 'packages/@CrableTroudlbe/angular/**',
      options: {
        semi: true,
      },
    },
  ],
}
