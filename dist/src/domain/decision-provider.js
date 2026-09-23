export class DecisionProviderRegistry {
    #providers = new Map();
    register(provider) {
        if (!/^[a-z][a-z0-9-]{0,63}$/u.test(provider.id))
            throw new Error("Decision Provider idが不正です");
        if (this.#providers.has(provider.id))
            throw new Error(`Decision Providerが重複しています: ${provider.id}`);
        this.#providers.set(provider.id, provider);
    }
    resolve(id) {
        const provider = this.#providers.get(id);
        if (!provider)
            throw new Error(`Decision Providerが未登録です: ${id}`);
        return provider;
    }
}
//# sourceMappingURL=decision-provider.js.map