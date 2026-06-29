import ArrayBufferSlice from "../../ArrayBufferSlice";
import { assert, hexzero0x, hexzero } from "../../util";
import { inflateRawSync } from "zlib";
import { writeFileSync, readdirSync, mkdirSync } from "fs";
import { stages } from "../stages";

import ROM from "../rom";
import type { Inflater }  from "../rom";
import { Room, BGSegment } from "../bg";
import { formatBPP, Format, inflateTexture, InflatedTexture } from "../tex";

const pathROM = `./data/PerfectDark64/pd.ntsc-final.z64`;
const pathBaseOut = `./data/PerfectDark64/`;

function unique(input: Array<any>): Array<any> {
    return input.filter((v, i, a) => {
        return a.indexOf(v) === i;
    });
}

function writeBGSegments(rom: ROM) {
    const bgSegmentPaths = unique(stages.map(stage => stage.bgPath));

    mkdirSync(pathBaseOut + "bgdata", {recursive: true});

    bgSegmentPaths.forEach((path) => {
        const seg = new BGSegment(rom.openFile(path), decompress);
        const outPath = [pathBaseOut, path, ".json"].join("");
        writeFileSync(outPath, Buffer.from(JSON.stringify(seg)));

        console.info(
            `Wrote BG segment: ${outPath},`,
            `${seg.rooms.length} rooms,`,
            seg.rooms.reduce((acc, room) => acc + room.blocks.length, 0), "blocks,",
            seg.rooms.reduce((acc, room) => acc + room.vertices.length, 0), "vertices,",
            seg.rooms.reduce((acc, room) => acc + room.colours.length, 0), "colours",
        );
    });
}

function toMiB(v:number): string {
    return (v / 1024 / 1024).toFixed(2);
}

// Write all textures in a big blob and a .json file containing offsets.
// We cannot decompress textures client-side because of the zlib requirement
// and we cannot have the client make 3000+ requests to fetch textures, this is
// the compromise.
function writeTextureData(rom: ROM) {
    const outBase = pathBaseOut + "textures/";
    mkdirSync(outBase, {recursive: true});

    let inflatedSize = 0;
    let compressedSize = 0;
    let meta: tex.InflatedTexture[] = [];

    // Arbitrary, must be able to contain all decompressed textures.
    let bigBin = new Uint8Array(5 << 20);

    rom.textureData.forEach((data, i) => {
        let texture: InflatedTexture = {index: i};
        const decompressed = inflateTexture(texture, data, decompress);
        if (decompressed.byteLength <= 0) {
            // FIXME: Silence until we implement other decompression methods.
            // console.warn(`unable to inflate texture #${i}`);
            return;
        }

        const expectedSize = Math.ceil((formatBPP(texture.format) * texture.width * texture.height) / 8);
        if (expectedSize !== decompressed.byteLength) {
            console.warn(`texture #${i} expected ${expectedSize} bytes, got ${decompressed.byteLength}`);
        }

        texture.size = decompressed.byteLength;
        texture.offset = inflatedSize;
        meta.push(texture);

        const view = decompressed.createDataView();
        for (let i = 0; i < decompressed.byteLength; i++) {
            bigBin[texture.offset + i] = view.getUint8(i);
        }

        compressedSize += data.byteLength;
        inflatedSize += decompressed.byteLength;
    });

    bigBin = bigBin.subarray(0, inflatedSize);
    const binPath = pathBaseOut + "textures.bin";
    writeFileSync(binPath, bigBin);

    console.info(
        `Wrote texture data: ${outBase}*.bin,`,
        meta.length, "/", rom.textureData.length, "textures,",
        toMiB(compressedSize), "MiB compressed,",
        toMiB(bigBin.byteLength), "MiB uncompressed,",
    );

    const metaPath = pathBaseOut + "textures.json";
    writeFileSync(metaPath, Buffer.from(JSON.stringify(meta)));
    console.info(`Wrote texture index: ${metaPath}`);
}

function main() {
    const rom = new ROM(pathROM, decompress);
    writeBGSegments(rom);
    writeTextureData(rom);
}

const compressedMagicHeader = 0x1173;

// pd64 uses zlib-compressed data with a custom header:
//   uint16 magic string
//   uint24 decompressed size
//   []byte zlib-compressed data
// There's no compressed data size, only zlib knows when to stop.
// The decompression routine in pd64 also works on uncompressed data so every
// file should be automatically and _optionally_ decompressed when read.
// Despite this behaviour, compressed files larger than their uncompressed data
// can be found.
// HACK: This is kept here and injected into the ROM/BGSegment DI-style to
// avoid importing zlib into files imported by client-side code.
const decompress: Inflater = function(buf: ArrayBufferSlice): ArrayBufferSlice {
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
