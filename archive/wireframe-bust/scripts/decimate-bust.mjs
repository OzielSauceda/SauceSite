// One-shot decimation of public/models/oziel-bust.glb.
//
// Goal: shrink the 14 MB scan-grade mesh down to something the wireframe
// renderer can build a WireframeGeometry from without freezing the main
// thread when the hero section mounts.
//
// Run: node scripts/decimate-bust.mjs
//
// Reads:  public/models/oziel-bust.original.glb  (untouched source)
// Writes: public/models/oziel-bust.glb           (overwritten)

import { NodeIO } from "@gltf-transform/core";
import { KHRONOS_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup,
  weld,
  simplify,
  prune,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { statSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT = resolve(__dirname, "..");
const SRC = resolve(PROJECT, "public/models/oziel-bust.original.glb");
const DST = resolve(PROJECT, "public/models/oziel-bust.glb");

// Target a small fraction of the original tris. Scan meshes have huge
// redundancy on smooth skin; 5-8% lands at a few thousand tris which
// is plenty for a wireframe-overlay portrait.
const SIMPLIFY_RATIO = 0.06;
const ERROR_TOLERANCE = 0.0015;

async function main() {
  await MeshoptSimplifier.ready;

  const io = new NodeIO().registerExtensions(KHRONOS_EXTENSIONS);
  const doc = await io.read(SRC);

  const beforeBytes = statSync(SRC).size;
  let beforeTris = 0;
  doc
    .getRoot()
    .listMeshes()
    .forEach((m) =>
      m.listPrimitives().forEach((p) => {
        const idx = p.getIndices();
        const pos = p.getAttribute("POSITION");
        const triCount = idx
          ? idx.getCount() / 3
          : pos
            ? pos.getCount() / 3
            : 0;
        beforeTris += triCount;
      }),
    );

  await doc.transform(
    // Merge identical attributes -- scan exports often duplicate vertices
    // across triangles. Welding is required before simplification.
    weld({ tolerance: 0.0001 }),
    dedup(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: SIMPLIFY_RATIO,
      error: ERROR_TOLERANCE,
    }),
    prune(),
  );

  await io.write(DST, doc);

  const afterBytes = statSync(DST).size;
  let afterTris = 0;
  doc
    .getRoot()
    .listMeshes()
    .forEach((m) =>
      m.listPrimitives().forEach((p) => {
        const idx = p.getIndices();
        const pos = p.getAttribute("POSITION");
        const triCount = idx
          ? idx.getCount() / 3
          : pos
            ? pos.getCount() / 3
            : 0;
        afterTris += triCount;
      }),
    );

  const fmt = (n) =>
    n >= 1024 * 1024
      ? `${(n / 1024 / 1024).toFixed(2)} MB`
      : `${(n / 1024).toFixed(1)} KB`;

  console.log(`Source: ${SRC}`);
  console.log(`Output: ${DST}`);
  console.log(`Tris:   ${beforeTris.toLocaleString()} -> ${afterTris.toLocaleString()}`);
  console.log(`Size:   ${fmt(beforeBytes)} -> ${fmt(afterBytes)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
