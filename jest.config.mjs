export default {
  testEnvironment: 'node',
  transform: {
    '^.+\\.m?[jt]sx?$': ['@babel/jest', { presets: ["@babel/preset-env"] }],
  },
  moduleFileExtensions: ['js', 'mjs', 'json'],
  transformIgnorePatterns: ["/node_modules/"],
};
