{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    flake-parts.url = "github:hercules-ci/flake-parts";
    treefmt-nix = {
      url = "github:numtide/treefmt-nix";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    cache-nix-action = {
      url = "github:nix-community/cache-nix-action";
      flake = false;
    };
  };

  outputs = inputs:
    inputs.flake-parts.lib.mkFlake {inherit inputs;} ({lib, ...}: {
      systems = lib.systems.flakeExposed;
      imports = [
        inputs.treefmt-nix.flakeModule
      ];
      perSystem = {
        self',
        pkgs,
        ...
      }: {
        treefmt = {
          programs.deadnix = {
            enable = true;
            priority = 1;
          };
          programs.alejandra = {
            enable = true;
            priority = 2;
          };

          programs.deno.enable = true;
        };

        packages.fdroidserver = pkgs.fdroidserver.overrideAttrs (old: {
          patches =
            (old.patches or [])
            ++ [
              ./fdroidserver.patch
            ];
        });

        packages.saveFromGC =
          (import "${inputs.cache-nix-action}/saveFromGC.nix" {
            inherit pkgs inputs;
            inputsInclude = [
              "nixpkgs"
              "flake-parts"
            ];
            derivations = [
              self'.devShells.default
            ];
          }).package;

        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            self'.packages.fdroidserver
            jdk
            bun
            nodejs
            just
            apkeditor
          ];
        };
      };
    });
}
