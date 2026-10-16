run: dependencies build

build $config="./config": clean
    mkdir -p fdroid/repo
    bun -e "(await import(Bun.argv[1])).default.build()" "$config"

clean:
    rm -rf fdroid/{repo/*.apk,metadata,tmp/repo_*}

test: (build "./config.local")

dependencies:
    bun install --frozen-lockfile
