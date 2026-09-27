import { Given } from "@cucumber/cucumber";

Given("shard fixtureの成功step", function () {
  return undefined;
});

Given("shard fixtureの失敗step", function () {
  throw new Error("shard fixtureの意図した失敗");
});

Given("shard fixtureの待機step", { timeout: 120_000 }, function () {
  return new Promise((resolve) => setTimeout(resolve, 60_000));
});
