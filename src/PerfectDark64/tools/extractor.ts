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
const pathBaseOut = `./data/PerfectDark64`;

function unique(input: Array<any>): Array<any> {
    return input.filter((v, i, a) => {
        return a.indexOf(v) === i;
    });
}

function writeBGSegments(rom: ROM) {
    const bgSegmentPaths = unique(stages.map(stage => stage.bgPath));

    mkdirSync(pathBaseOut + "/bgdata", {recursive: true});

    bgSegmentPaths.forEach((path) => {
        const seg = new BGSegment(rom.openFile(path), decompress);
        const outPath = `${pathBaseOut}/${path}.json`;
        writeFileSync(outPath, Buffer.from(JSON.stringify(seg)));

        const nVertices: number = seg.rooms.reduce((acc:number, room:Room) => {
            return acc + room.vertices.length;
        }, 0);

        const nColours: number = seg.rooms.reduce((acc:number, room:Room) => {
            return acc + room.colours.length;
        }, 0);

        const nBlocks: number = seg.rooms.reduce((acc:number, room:Room) => {
            return acc + room.blocks.length;
        }, 0);

        console.info(
            `Wrote BG segment: ${outPath},`,
            `${seg.rooms.length} rooms,`,
            `${nBlocks} blocks,`,
            `${nVertices} vertices,`,
            `${nColours} colours,`,
        );
    });
}

function toMiB(v:number): string {
    return (v / 1024 / 1024).toFixed(2);
}

function writeTextureData(rom: ROM) {
    const outBase = pathBaseOut + "/textures/";
    mkdirSync(outBase, {recursive: true});

    let inflatedSize = 0;
    let compressedSize = 0;

    rom.textureData.forEach((data, i) => {
        let texture: InflatedTexture = {};
        const uncompressed = inflateTexture(texture, data, decompress);
        if (uncompressed.byteLength <= 0) {
            // DEBUG console.warn(`unable to inflate texture #${i}`);
            return;
        }

        const expectedSize = Math.ceil((formatBPP(texture.format) * texture.width * texture.height) / 8);
        if (expectedSize !== uncompressed.byteLength) {
            console.warn(`texture #${i} expected ${expectedSize} bytes, got ${uncompressed.byteLength}`);
        }

        compressedSize += data.byteLength;
        inflatedSize += uncompressed.byteLength;

        const binPath = outBase + hexzero(i, 4) + ".bin";
        const jsonPath = outBase + hexzero(i, 4) + ".json";

        writeFileSync(binPath, Buffer.from(uncompressed.copyToBuffer()));
        writeFileSync(jsonPath, Buffer.from(JSON.stringify(texture)));
    });

    console.info(
        `Wrote texture data: ${outBase}*.bin,`,
        rom.textureData.length, "textures,",
        toMiB(compressedSize), "MiB compressed,",
        toMiB(inflatedSize), "MiB uncompressed,",
    );
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
