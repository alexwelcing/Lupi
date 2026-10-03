# Environment HDRIs: notice

The seven image-based-lighting environments Lupi offers (Reflection
environment, the material scenes, MCP `lupi.set_material`), served from
Lupi's own origin at `/hdri/`. `packages/ui/src/sceneEnvironment.ts` maps each
preset to its file.

| Preset | File | Poly Haven asset | Author | sha256 |
|---|---|---|---|---|
| city | `potsdamer_platz_1k.hdr` | [Potsdamer Platz](https://polyhaven.com/a/potsdamer_platz) | Greg Zaal | `7afe4c2f9700ee78c7477c53fa355463d7dda1fdede401432d6b5f9ff0a95696` |
| dawn | `kiara_1_dawn_1k.hdr` | [Kiara 1 Dawn](https://polyhaven.com/a/kiara_1_dawn) | Greg Zaal | `ee70fb8c8fb3e34566802191d83b299e179ecc392b97639e6c750f66e161c8e2` |
| forest | `forest_slope_1k.hdr` | [Forest Slope](https://polyhaven.com/a/forest_slope) | Andreas Mischok | `926a6bb81897919b2924f42407162b8d54be91eab2da3fe7fe19daf308cfa09a` |
| night | `dikhololo_night_1k.hdr` | [Dikhololo Night](https://polyhaven.com/a/dikhololo_night) | Greg Zaal | `6861489f983cdc0c22435b781a3487171bd25f25f9cc52c46ac402d48e08249e` |
| park | `rooitou_park_1k.hdr` | [Rooitou Park](https://polyhaven.com/a/rooitou_park) | Greg Zaal | `af15cb5ca49de469e2ee74fcb6622cb32b36e3f9ee95504fc762d9c3d62c5163` |
| studio | `studio_small_03_1k.hdr` | [Studio Small 03](https://polyhaven.com/a/studio_small_03) | Greg Zaal | `29267a4aa8c10de26cae758e4e3c4daadde88673798666ad657724bab7224a35` |
| warehouse | `empty_warehouse_01_1k.hdr` | [Empty Warehouse 01](https://polyhaven.com/a/empty_warehouse_01) | Sergej Majboroda | `9b3d611cadc32c3a0c7e084ce5611c0650293881c4a041e7fa13748fe0dc6451` |

## Source

Byte-for-byte copies of `hdri/` in
[pmndrs/drei-assets](https://github.com/pmndrs/drei-assets) at revision
`456060a26bbeb8fdf79326f224b6d99b8bcce736` (the files drei's `Environment`
presets load). That revision is the `assetRevision` in every environment
identity, so moving the files here changed no `specId`. If the self-hosted file
cannot be loaded, the viewer tries the same file on raw.githack.com, then
renders with analytic light only.

Do not edit these files in place: a changed HDR needs a new file name and a
new `assetRevision`, because `/hdri/*` is served as immutable.

## Licence

All seven are from [Poly Haven](https://polyhaven.com) (formerly HDRI Haven)
and are released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/):
public domain, no attribution required. The authors are credited above anyway.
