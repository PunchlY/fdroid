#!/usr/bin/env bash
set -euo pipefail

OUT_DIR="$(pwd)/fdroid/repo"

OWNER="open-ani"
REPO="animeko"
APPNAME="animeko"

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
