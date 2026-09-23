export interface DecisionRequest {
  questionId: string;
  claim: string;
  evidence: Array<{ artifactId: string; excerpt: string }>;
}

export type DecisionResult =
  | {
      state: "decided";
      providerId: string;
      answer: string;
      confidence: number;
      authority: false;
    }
  | { state: "degraded"; providerId: string; reason: string; authority: false };

export interface DecisionProvider {
  readonly id: string;
  decide(request: DecisionRequest): Promise<DecisionResult>;
}

export class DecisionProviderRegistry {
  readonly #providers = new Map<string, DecisionProvider>();

  register(provider: DecisionProvider): void {
    if (!/^[a-z][a-z0-9-]{0,63}$/u.test(provider.id))
      throw new Error("Decision Provider idが不正です");
    if (this.#providers.has(provider.id))
      throw new Error(`Decision Providerが重複しています: ${provider.id}`);
    this.#providers.set(provider.id, provider);
  }

  resolve(id: string): DecisionProvider {
    const provider = this.#providers.get(id);
    if (!provider) throw new Error(`Decision Providerが未登録です: ${id}`);
    return provider;
  }
}
