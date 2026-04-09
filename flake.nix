{
  description = "bbcli — a gh-equivalent CLI for Bitbucket Cloud";

  inputs = {
    nixpkgs.url = "github:nixos/nixpkgs/nixpkgs-unstable";
  };

  outputs = { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in {
      devShells.${system}.default = pkgs.mkShell {
        name = "bbcli-shell";

        buildInputs = with pkgs; [
          bun
          gh
        ];
      };
    };
}
