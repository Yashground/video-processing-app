{pkgs}: {
  deps = [
    pkgs.ffmpeg
    pkgs.nodejs
    pkgs.nodePackages.typescript-language-server
    pkgs.postgresql
  ];
}
