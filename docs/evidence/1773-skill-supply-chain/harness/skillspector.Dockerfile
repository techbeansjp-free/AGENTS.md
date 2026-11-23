# Build context: `git archive f9bb13dd1667eb4e7ac97b8ebace3160041ed571` of https://github.com/NVIDIA/SkillSpector, extracted
# into an empty directory outside any repository. Build (network is needed only here, to fetch the locked packages):
#   docker build --label asc.worktree=<worktree> -t asc-1773-skillspector:f9bb13dd -f skillspector.Dockerfile <context>
# Same base digest as the upstream Dockerfile, but dependencies come from uv.lock with hashes instead of `pip install .`.
FROM python:3.12-slim-bookworm@sha256:8a7e7cc04fd3e2bd787f7f24e22d5d119aa590d429b50c95dfe12b3abe52f48b
RUN pip install --no-cache-dir uv==0.9.7
WORKDIR /app
COPY . /app
RUN uv sync --frozen --no-dev --no-editable --no-install-project && uv pip install --no-deps --python /app/.venv/bin/python /app
RUN useradd -u 10001 -m scanner
USER scanner
ENV PATH="/app/.venv/bin:$PATH" HOME=/home/scanner
WORKDIR /scan
ENTRYPOINT ["skillspector"]
