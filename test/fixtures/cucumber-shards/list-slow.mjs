// shard実行scriptのintegration testで、中断されるまで終わらないscenarioを列挙する設定。
export default {
  paths: ["test/fixtures/cucumber-shards/slow/*.feature"],
  import: ["test/fixtures/cucumber-shards/steps.ts"],
};
