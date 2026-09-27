// shard実行scriptのintegration testで、構文errorのfeatureを含めて列挙する設定。
export default {
  paths: ["test/fixtures/cucumber-shards/broken/*.feature"],
  import: ["test/fixtures/cucumber-shards/steps.ts"],
};
