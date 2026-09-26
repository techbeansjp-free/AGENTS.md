// impact --format=featuresが選んだfeatureだけを実行するための設定。
// cucumber.mjsのpathsは位置引数と合算されるため、pathsを持たない別設定を使う。
export default {
  import: ["test/support/**/*.ts", "test/steps/**/*.ts"],
  format: ["progress", "summary"],
  publishQuiet: true,
};
