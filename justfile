run: dependencies clean
    mkdir -p fdroid/repo
    bun update.ts

clean:
    rm -rf fdroid/{repo/*.apk,metadata,tmp/repo_*}

test: clean
    mkdir -p fdroid/repo
    bun test.ts

dependencies:
    bun install --frozen-lockfile
