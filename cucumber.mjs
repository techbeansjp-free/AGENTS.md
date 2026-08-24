export default {
  paths: ["test/features/**/*.feature"],
  import: ["test/support/**/*.ts", "test/steps/**/*.ts"],
  format: ["progress", "summary"],
  publishQuiet: true,
};
