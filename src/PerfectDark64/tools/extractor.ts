import ArrayBufferSlice from "../../ArrayBufferSlice";
import { inflateRawSync } from "zlib";
import { writeFileSync, readdirSync, mkdirSync } from "fs";

import ROM from "../rom";
import { BGSegment } from "../bg";

const pathROM = `./data/PerfectDark64/pd.ntsc-final.z64`;
const pathBaseOut = `./data/PerfectDark64`;

const bgSegmentPaths: Array<string> = [
    "bgdata/bg_ame.seg",
    "bgdata/bg_arec.seg",
    "bgdata/bg_azt.seg",
    "bgdata/bg_cave.seg",
    "bgdata/bg_crad.seg",
    "bgdata/bg_cryp.seg",
    "bgdata/bg_dam.seg",
    "bgdata/bg_depo.seg",
    "bgdata/bg_dish.seg",
    "bgdata/bg_ear.seg",
    "bgdata/bg_eld.seg",
    "bgdata/bg_jun.seg",
    "bgdata/bg_lee.seg",
    "bgdata/bg_lue.seg",
    "bgdata/bg_mp1.seg",
    "bgdata/bg_mp10.seg",
    "bgdata/bg_mp11.seg",
    "bgdata/bg_mp12.seg",
    "bgdata/bg_mp13.seg",
    "bgdata/bg_mp15.seg",
    "bgdata/bg_mp3.seg",
    "bgdata/bg_mp4.seg",
    "bgdata/bg_mp5.seg",
    "bgdata/bg_mp9.seg",
    "bgdata/bg_oat.seg",
    "bgdata/bg_pam.seg",
    "bgdata/bg_pete.seg",
    "bgdata/bg_ref.seg",
    "bgdata/bg_rit.seg",
    "bgdata/bg_sho.seg",
];

function main() {
    const rom = new ROM(pathROM, decompress);

    bgSegmentPaths.forEach((path) => {
        const seg = new BGSegment(rom.openFile(path), decompress);
        const outPath = `${pathBaseOut}/${path}.json`;
        writeFileSync(outPath, Buffer.from(JSON.stringify(seg)));
        console.info("Wrote BG segment: ", outPath);
    });
}

const compressedMagicHeader = 0x1173;

// pd64 uses zlib-compressed data with a custom header:
//   uint16 magic string
//   uint24 decompressed size
//   []byte zlib-compressed data
// There's no compressed data size, only zlib knows when to stop.
// The decompression routine in pd64 also works on uncompressed data so every
// file should be automatically and _optionally_ decompressed when read.
// Despite this behaviour compressed files larger than their uncompressed data
// can be found.
// HACK: This is kept here and injected into the ROM/BGSegment DI-style to
// avoid importing zlib into files imported by client-side code.
function decompress(buf: ArrayBufferSlice): ArrayBufferSlice {
    const view = buf.createDataView();

    // Uncompressed file, return as-is.
    if (view.getUint16(0) !== compressedMagicHeader) {
        return buf;
    }

    const expectedDecompressedSize = view.getUint32(2) >> 8;
    const decompressed = inflateRawSync(buf.createTypedArray(Uint8Array, 5));
    if (expectedDecompressedSize !== decompressed.length) {
        throw new Error("decompressed data size doesn't match header");
    }

    return ArrayBufferSlice.fromView(decompressed);
}

main();
