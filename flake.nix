{
  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs?ref=nixos-unstable";
    systems.url = "github:nix-systems/default";
  };

  outputs = inputs: let
    eachSystem = inputs.nixpkgs.lib.genAttrs (import inputs.systems);
    pkgsFor = eachSystem (system: import inputs.nixpkgs {inherit system;});
  in {
    devShells = eachSystem (system: {
      default = pkgsFor.${system}.mkShell {
        packages = with pkgsFor.${system}; [
          fdroidserver
          jdk
          bun
        ];
        shellHook = ''
          bun install --frozen-lockfile --linker isolated
        '';
      };
    });
  };
}
