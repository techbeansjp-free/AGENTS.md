// shardの実行に使う設定。位置引数と合算されないようpathsを持たない。
export default {
  import: ["test/fixtures/cucumber-shards/steps.ts"],
  format: ["summary"],
};
