import ArrayBufferSlice from "../ArrayBufferSlice.js";
import { assert, hexzero0x, readString } from "../util.js";
import { decompress } from "./rom.js";
import { vec3 } from "gl-matrix";
import { Vertex, vertexStructSize } from "./ultra64.js";

/**
 * BGs (assumed to stand for "background") contains the level geometry as
 * packed vertices/colours and display lists in a cascading mess of offsets,
 * trees, and lists that accommodate F3DEX and pd64's room->portal->room
 * renderer reminiscing of a simplified BSP renderer.
 * The path to the packed data and display lists is BGRoom->Room->n Block->gdl.
 * There's also packed data in BGRoom->Room->GFXData, TODO: find out if block
 * vertices are pointers into this.
 *
 * Rooms are split arbitrarily into "blocks", a tree-like structure containing
 * offsets into the room packed data. There's two blocks list, one for opaque
 * geometry and one for transparent geometry.
 *
 * Structure of a BG segment/file, comment courtesy of the pd64 port (MIT).
 *
 * 4 bytes decompressed size of primary data
 * 4 bytes compressed size of section 1 in its entirety
 * 4 bytes compressed size of primary data
 * Section 1:
 *     Primary: (zipped)
 *         4 bytes null
 *         4 bytes pointer to room table
 *         4 bytes pointer to portal table
 *         4 bytes pointer to bgcmds
 *         4 bytes pointer to lights table
 *         4 bytes null
 *         (room table)
 *         (portal table)
 *         (bgcmds)
 *         (lights table)
 *     room 1 roomgfxdata (zipped)
 *     room 2 roomgfxdata (zipped)
 *     ...
 * Section 2:
 *     2 bytes decompressed size of section (mask with 0x7fff)
 *     2 bytes compressed size of section
 *     Texture ID list (zipped)
 * Section 3:
 *     2 bytes decompressed size of section (mask with 0x7fff)
 *     2 bytes compressed size of section
 *     Zipped:
 *         (room bbox table)
 *         (list of roomgfxdata sizes)
 *         (list of light counts per room)
 */

// All pointers found in a BG segment are offset by this. Don't know why.
// We could also consider all pointers to be 24bit and mask them.
const magicOffset = 0x0F000000;

// Matches the struct on ROM.
interface BGRoomEntry {
    roomOffset: number; // offset into section 1, almost, see loadRooms.
    pos: vec3;

    // FIXME: Unused for now, waiting for the renderer.
    brightnessMin: number;
    brightnessMax: number;
}

// Rooms are the are the basic building block of a pd64 level. The original
// renderer renders the room you're at and any other room visible through the
// open portals. Such portals can be open or closed at runtime, eg. every door
// in DataDyne infiltration/extraction is a togglable portal, no need to render
// what's behind a closed door.
// This interface is a mix of the decomp room and gfxdata structs, room is
// mostly a "runtime" type whereas gfxdata is loaded from the ROM.
interface Room {
    // Since in pd64 the first empty entry is left intact rooms are effectively
    // 1-indexed. I don't like keeping invalid data around so for clarity and
    // debugging I leave the "roomnum" here as it would appear in in the game
    // and keep our array clean of empty entries and canary values.
    number: number;

    // Raw vertices, loaded into the RSP the 0x0E segment.
    vertices: Vertex[];
}

// Matches the struct on ROM.
interface RoomGFXDataHeader {
    // Pointers into decompressed roomgfxdata.
    verticesPtr:          number,
    coloursPtr:           number,
    opaqueBlocksPtr:      number,
    translucentBlocksPtr: number,

    lightsIndex:          number,
    numLights:            number,
    numVertices:          number, // computed after loading
    numColours:           number, // computed after loading
}

function readRoomGFXDataHeader(view: DataView, roomOffset: number): RoomGFXDataHeader {
    let header:RoomGFXDataHeader = {
        verticesPtr:          view.getUint32(0),
        coloursPtr:           view.getUint32(4),
        opaqueBlocksPtr:      view.getUint32(8),
        translucentBlocksPtr: view.getUint32(12),
        lightsIndex:          view.getUint16(16),
        numLights:            view.getUint16(18),
        numVertices:          view.getUint16(20),
        numColours:           view.getUint16(22),
    };

    const offset = roomOffset + magicOffset;

    header.verticesPtr -= header.verticesPtr === 0 ? 0 : offset;
    header.coloursPtr -= header.coloursPtr === 0 ? 0 : offset;
    header.opaqueBlocksPtr -= header.opaqueBlocksPtr === 0 ? 0 : offset;
    header.translucentBlocksPtr -= header.translucentBlocksPtr === 0 ? 0 : offset;

    return header;
}

function loadRoomGFXDataVertices(header: RoomGFXDataHeader, view: DataView): Vertex[] {
    const ret: Vertex[] = [];
    const count = (header.coloursPtr - header.verticesPtr) / vertexStructSize;

    for (let i = 0; i < count; i++) {
        const offset = header.verticesPtr + (i * vertexStructSize);

        ret.push({
            x:      view.getInt16(offset),
            y:      view.getInt16(offset + 2),
            z:      view.getInt16(offset + 4),
            flags:  view.getUint8(offset + 6),
            colour: view.getUint8(offset + 7),
            s:      view.getInt16(offset + 8),
            t:      view.getInt16(offset + 10),
        });
    }

    return ret;
}

function loadRooms(
    seg: ArrayBufferSlice,
    bgRooms: BGRoomEntry[],
    baseOffset: number,
): Room[] {
    const ret: Room[] = [];

    bgRooms.forEach((bgRoom, i) => {
        // Like with files, first and last entry are not real rooms.
        if (i === 0 || i == bgRooms.length - 1) {
            return;
        }

        const offset = bgRoom.roomOffset - baseOffset;
        const len = (bgRooms[i+1].roomOffset - bgRoom.roomOffset + 0xF) & ~0xF;

        const gfx = decompress(seg.subarray(offset, len));
        const gfxView = gfx.createDataView();
        const gfxDataHeader = readRoomGFXDataHeader(gfxView, bgRoom.roomOffset);

        ret.push({
            number: i,
            vertices: loadRoomGFXDataVertices(gfxDataHeader, gfxView),
        });
    });

    return ret;
}

const roomGFXDataHeaderSize = 24;
const bgRoomEntryStructSize = 20;

function loadBGRoomTable(primary: ArrayBufferSlice): BGRoomEntry[] {
    const view = primary.createDataView();
    const ret: BGRoomEntry[] = [];

    let offset = view.getUint32(4) - magicOffset;
    for(;; offset += bgRoomEntryStructSize) {
        const rawRoomOffset = view.getUint32(offset);
        if (rawRoomOffset === 0 && ret.length > 0) {
            break;
        }

        ret.push({
            roomOffset: rawRoomOffset - magicOffset,
            pos: vec3.fromValues(
                view.getFloat32(offset + 4),
                view.getFloat32(offset + 8),
                view.getFloat32(offset + 12),
            ),
            brightnessMin: view.getUint8(offset + 16),
            brightnessMax: view.getUint8(offset + 17),
        });
    }

    return ret;
}

export class BGSegment {
    public readonly rooms: Room[];

    constructor(seg: ArrayBufferSlice) {
        const view = seg.createDataView();

        const primSize = view.getUint32(0);
        // TODO: section2 // const compSec1Size = view.getUint32(4);
        const compPrimSize = view.getUint32(8);

        const primary = decompress(seg.subarray(12, compPrimSize));
        if (primary.byteLength !== primSize) {
            throw new Error("unexpected decompressed section #1 primary data size");
        }
        const bgRooms = loadBGRoomTable(primary);

        // The roomOffset pointing to each Room compressed data is itself
        // offset by this value. I can't make sense of it, but it works.
        const roomsOffset = primSize - compPrimSize - 0x0C;
        this.rooms = loadRooms(seg, bgRooms, roomsOffset);
    }
}
