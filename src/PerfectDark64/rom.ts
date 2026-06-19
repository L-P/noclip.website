import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { inflateRawSync } from 'zlib';
import { readFileSync } from "fs";
import { readString } from "../util.js";

// FIXME: This has been copy-pasted everywhere, it's maybe time to move it to
// util.js or something.
function fetchDataSync(path: string): ArrayBufferSlice {
    const b: Buffer = readFileSync(path);
    return new ArrayBufferSlice(b.buffer);
}

/*
 * ROM
 * - 0x39850: data.bin (compressed)
 *          - 0x28080: file table, last offset points to file name table
 * - file name table
 */

// Offset into raw ROM.
// data.bin is an abitrary name given by the decomp project, it contains
// offsets to files and a bunch data we don't care about.
const compressedDatabinOffset = 0x39850;

// Offset into decompressed "data" section.
const filesTableOffset = 0x28080;

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
function decompress(buf: ArrayBufferSlice): ArrayBufferSlice {
    const view = buf.createDataView();
    if (view.getUint16(0) !== compressedMagicHeader) {
        throw new Error("compressed data does not start with magic number 0x1173");
    }

    const expectedDecompressedSize = view.getUint32(2) >> 8;
    const decompressed = inflateRawSync(buf.createTypedArray(Uint8Array, 5));
    if (expectedDecompressedSize !== decompressed.length) {
        throw new Error("decompressed data size doesn't match header");
    }

    return new ArrayBufferSlice(decompressed.buffer);
}

// PD64 assets are stored into named files, sometimes the contents are
// compressed, sometimes not, sometimes files wrap multiple section of
// compressed data.
// A "Z" name suffix is sometimes used to denote compressed data.
// Don't attempt to read from offset to offset+size directly, the data must go
// through decompress first.
interface FileEntry {
    offset: uint32; // offset into ROM
    size: uint32; // raw size in ROM
    name: string;
}

// Returns list of offsets into the raw ROM.
function readFileOffsets(data: ArrayBufferSlice): number[] {
    const view = data.createDataView();
    let i = filesTableOffset;
    let ret: number[] = [];

    while (true) {
        const offset = view.getUint32(i);
        // First entry is 0, that's a recurring pattern in this ROM.
        if (ret.length > 0 && offset === 0) {
            break;
        }

        ret.push(offset);
        i += 4;
    }

    return ret;
}

// Returns a list of strings that maps 1:1 to readFileTable.
// The file name table is a table of offsets into the raw ROM, starting at the
// table offset.
// Names are nul-terminated strings then padded to align to 8 bytes.
function readFileNames(rom: ArrayBufferSlice, tableAddr: number): string[] {
    const view = rom.createDataView();
    let i = tableAddr;
    var ret: string[] = [];

    while (true) {
        const offset = view.getUint32(i);
        if (ret.length > 0 && offset === 0) {
            break;
        }

        ret.push(readString(rom, tableAddr + offset));

        i += 4;
    }

    return ret;
};

// Parses the ROM to find the internal file-system that contains game assets.
function readFileTable(rom: ArrayBufferSlice, databin: ArrayBufferSlice): FileEntry[] {
    const fileOffsets = readFileOffsets(databin);
    const fileNames = readFileNames(rom, fileOffsets[fileOffsets.length - 1]);

    // There's one missing name because the last fileOffsets entry is not
    // really a file, only the end offset of the previous file which also
    // happens to be the start of the name table.
    // Thus fileNames contains the first empty entry and all the files,
    // fileOffsets has the first empty entry, all the files, and the
    // terminating pseudo-entry.
    if (fileOffsets.length !== (fileNames.length+1)) {
        throw new Error("file offset and name tables do not match");
    }

    const ret: FileEntry[] = [];
    for (let i = 0; i < fileNames.length; i++) {
        ret.push({
            offset: fileOffsets[i],
            name: fileNames[i],
            size: fileOffsets[i+1] - fileOffsets[i],
        });
    }

    return ret.slice(1); // Skip the first empty entry.
}

export default class ROM {
    private rom: ArrayBufferSlice;
    public readonly files: FileEntry[];

    constructor(path: string) {
        this.rom = fetchDataSync(path);
        const databin = decompress(this.rom.subarray(compressedDatabinOffset));
        this.files = readFileTable(this.rom, databin);
    }

    // Returns the raw uncompressed (if applicable) data for a file.
    // If the file was not compressed, the returned buffer is a slice of the raw ROM.
    public openFile(path: string): ArrayBufferSlice {
        const entry = this.files.find(f => f.name === path);
        if (!entry) {
            throw new Error(`File not found: ${path}`);
        }

        const raw = this.rom.slice(entry.offset, entry.offset + entry.size);
        const view = raw.createDataView();
        // Uncompressed file, return as-is.
        if (view.getUint16(0) !== compressedMagicHeader) {
            return raw;
        }

        return decompress(raw);
    }
}
