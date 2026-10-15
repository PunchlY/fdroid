run: dependencies clean
    bun update.ts

clean:
    rm -rf fdroid/{repo,metadata,tmp/repo_*}

test: clean
    bun test.ts

dependencies:
    bun install --frozen-lockfile
