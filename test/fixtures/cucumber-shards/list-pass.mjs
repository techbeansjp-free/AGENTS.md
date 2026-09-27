// shard実行scriptのintegration testで、列挙するscenarioを成功だけのfixtureに限る設定。
export default {
  paths: ["test/fixtures/cucumber-shards/pass/*.feature"],
  import: ["test/fixtures/cucumber-shards/steps.ts"],
};
