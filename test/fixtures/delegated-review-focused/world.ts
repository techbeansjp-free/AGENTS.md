import { Given, World } from "@cucumber/cucumber";

export class AppWorld extends World {}

export function stepDefinitions<WorldType extends AppWorld>() {
  return { Given: Given<WorldType> };
}
