import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import ROM from "../rom";
import { Endianness } from "../../endian.js";
import { assert, hexzero0x, readString } from "../../util.js";
import { inflateRawSync } from 'zlib';
import { readFileSync, writeFileSync } from "fs";

const pathROM = `./data/PerfectDark64/pd.ntsc-final.z64`;

function main() {
    const rom = new ROM(pathROM);
}

main();
