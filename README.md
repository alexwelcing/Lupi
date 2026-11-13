# lupi.live

LUPI opens structures and LAMMPS dump files in a WebGPU-capable browser with no installation.

## What is here

- **Web viewer** (`apps/web`) that ships to [lupi.live](https://lupi.live), and the edge
  Worker that serves it and the agent (MCP) routes (`apps/mcp-worker`).
- **Viewer packages** (`packages/`): parsers, scene, renderer, UI and shared core.
- **Native iPhone and iPad app** (`apps/apple`); not yet compiled against Apple's SDK or run on a device.
- **Firebase support** (`functions`, `firestore.rules`) for optional sign-in and saved views.
- **Checks and tools** (`tools`, `tests/ui`): the viewer smoke check, gallery checks and asset tools.

## Status

Working drafts, not peer-reviewed. What the viewer collects: [privacy](https://lupi.live/privacy/) ([from the code](docs/privacy.md)).

## Start here

- [Open the viewer](https://lupi.live)
- [Product ownership contract](docs/product-ownership-contract.md): what this repo owns, and what it does not
- [Release truth contract](docs/release-truth-contract.md): what a check proves, and what it does not
- [Development](docs/development.md): quick start, iPhone and iPad, local checks
- [LUPINE.md](LUPINE.md): how this repo fits the other Lupine repositories

## More

- [Overview](docs/overview.md): scope, boundary, WebGL2 fallback and deploy status
- [Repository map](docs/repository-map.md): every app and package, and the docs index
- [Privacy, from the code](docs/privacy.md)
- [Development](docs/development.md), including the terminal sign-in that is not yet shipped

## License

You can reuse our code (MIT) and our first-party text and data (CC BY 4.0) with
attribution and no share-alike obligations. See [LICENSE](LICENSE),
[LICENSE-CONTENT.md](LICENSE-CONTENT.md) and [LICENSE-DATA.md](LICENSE-DATA.md);
third-party material keeps its own terms ([NOTICE.md](NOTICE.md)).

## Contact

Research partners, model builders, press and investors: alex@lupinesci.com.
