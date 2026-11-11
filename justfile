run: dependencies build

build $config="./config": clean
    mkdir -p fdroid/repo
    bun index.ts --config=$config

clean:
    rm -rf fdroid/{repo/*.apk,metadata,tmp/repo_*}

test: (build "./config.local")

dependencies:
    bun install --frozen-lockfile
