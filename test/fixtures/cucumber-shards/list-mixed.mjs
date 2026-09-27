// shard実行scriptのintegration testで、列挙するscenarioを失敗を含むfixtureに限る設定。
export default {
  paths: ["test/fixtures/cucumber-shards/mixed/*.feature"],
  import: ["test/fixtures/cucumber-shards/steps.ts"],
};
