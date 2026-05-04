#!/usr/bin/env bash
set -euo pipefail

OWNER="open-ani"
REPO="animeko"
APPNAME="animeko"

git fetch origin repo || true

if git show-ref --verify --quiet refs/remotes/origin/repo; then
  git worktree add -B repo fdroid origin/repo
else
  git worktree add -B repo --orphan fdroid
  cd fdroid

  git commit --allow-empty -m "init repo branch"

  cd ..
fi

OUT_DIR="$(pwd)/fdroid/repo"

mkdir -p "$OUT_DIR"

curl -s "https://api.github.com/repos/$OWNER/$REPO/releases" | jq -c 'reduce .[] as $i ({r:[],s:false}; if .s then . elif $i.prerelease==false then .r+=[ $i ]|.s=true else .r+=[ $i ] end) | .r[]' | while read -r release; do
  echo "$release" | jq -c '.assets[]?' | while read -r asset; do
    content_type=$(echo "$asset" | jq -r '.content_type')
    if [[ "$content_type" != "application/vnd.android.package-archive" ]]; then
      continue
    fi

    id=$(echo "$asset" | jq -r '.id')
    digest=$(echo "$asset" | jq -r '.digest // empty')
    url=$(echo "$asset" | jq -r '.browser_download_url')

    file="$OUT_DIR/$APPNAME.$id.apk"

    if [[ -f "$file" && -n "$digest" ]]; then
      local_hash=$(sha256sum "$file" | awk '{print $1}')
      if [[ "sha256:$local_hash" == "$digest" ]]; then
        continue
      fi
    fi

    echo "Downloading $url"
    curl -L "$url" -o "$file"
  done
done

cd fdroid

echo "$KEYSTORE_P12" | base64 -d > keystore.p12
echo "$CONFIG_YML" | base64 -d > config.yml
fdroid update -c

git add repo metadata
git add -u repo metadata

git commit -m "update: $(date -u +'%Y-%m-%dT%H:%M:%SZ')" || echo "no changes"

git push origin repo --force-with-lease || git push origin repo --force

cd ..
